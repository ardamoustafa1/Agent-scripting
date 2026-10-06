package io.verbis.avaya.sidecar.aes;

import com.avaya.jtapi.tsapi.LucentAddress;
import com.avaya.jtapi.tsapi.LucentCallInfo;
import com.avaya.jtapi.tsapi.LucentV5CallInfo;
import com.avaya.jtapi.tsapi.UserToUserInfo;
import io.verbis.avaya.sidecar.config.SidecarProperties;
import io.verbis.avaya.sidecar.cti.CtiCommandException;
import io.verbis.avaya.sidecar.cti.CtiSource;
import io.verbis.avaya.sidecar.cti.ParticipantRegistry;
import io.verbis.avaya.sidecar.envelope.AvayaAgent;
import io.verbis.avaya.sidecar.envelope.AvayaCommand;
import io.verbis.avaya.sidecar.envelope.AvayaEnvelope;
import io.verbis.avaya.sidecar.outbound.OutboundClient;
import io.verbis.avaya.sidecar.outbound.OutboundDetector;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.Consumer;
import javax.telephony.Address;
import javax.telephony.Call;
import javax.telephony.JtapiPeer;
import javax.telephony.JtapiPeerFactory;
import javax.telephony.Provider;
import javax.telephony.callcenter.ACDAddress;
import javax.telephony.callcenter.Agent;
import javax.telephony.callcenter.AgentTerminal;
import javax.telephony.callcontrol.CallControlCallObserver;
import javax.telephony.callcontrol.events.CallCtlConnDisconnectedEv;
import javax.telephony.callcontrol.events.CallCtlConnEstablishedEv;
import javax.telephony.callcontrol.events.CallCtlConnAlertingEv;
import javax.telephony.callcontrol.events.CallCtlTermConnHeldEv;
import javax.telephony.callcontrol.events.CallCtlTermConnTalkingEv;
import javax.telephony.callcontrol.events.CallCtlCallEv;
import javax.telephony.events.CallEv;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * AES JTAPI (over TSAPI) source — compiled only with the Avaya JTAPI SDK (assumptions A1–A6).
 * Observes the configured agent stations (and optionally VDNs) with call observers; maps
 * alerting (delivered), established, held, talking-after-hold (retrieved), transfer
 * (CallCtlCallEv cause CAUSE_TRANSFER) and disconnected (cleared). Avaya extensions:
 * UCID (`LucentV5CallInfo.getUCID`), UUI (`LucentCallInfo.getUserToUserInfo`), VDN
 * (`getCalledAddress`), split/skill (`getDeliveringACDAddress`). The agent login id comes from
 * the station's logged-in `Agent`. Observation only: no call control, no agent-state requests.
 */
public final class AesJtapiSource implements CtiSource {
  private static final Logger log = LoggerFactory.getLogger(AesJtapiSource.class);
  private final SidecarProperties.Aes aes;
  private final ParticipantRegistry registry;
  private final OutboundDetector detector;
  private final OutboundClient outbound;
  private final AtomicLong sequence = new AtomicLong();
  private final Map<String, Boolean> heldConnections = new ConcurrentHashMap<>();
  private Provider provider;

  public AesJtapiSource(SidecarProperties.Aes aes, ParticipantRegistry registry, OutboundDetector detector, OutboundClient outbound) {
    this.aes = aes;
    this.registry = registry;
    this.detector = detector;
    this.outbound = outbound;
  }

  @Override
  public void start(Consumer<AvayaEnvelope> sink) throws Exception {
    JtapiPeer peer = JtapiPeerFactory.getJtapiPeer("com.avaya.jtapi.tsapi.TsapiPeer");
    String password = Files.readString(Path.of(aes.passwordFile())).trim();
    provider = peer.getProvider(aes.tlink() + ";login=" + aes.user() + ";passwd=" + password + ";servers=" + aes.servers());
    for (String extension : aes.extensions()) {
      Address address = provider.getAddress(extension);
      address.addCallObserver(observer(sink, extension));
    }
    if (aes.vdns() != null) for (String vdn : aes.vdns()) provider.getAddress(vdn).addCallObserver(observer(sink, null));
    log.info("AES JTAPI observing {} stations", aes.extensions().size());
  }

  private CallControlCallObserver observer(Consumer<AvayaEnvelope> sink, String extension) {
    return new CallControlCallObserver() {
      @Override
      public void callChangedEvent(CallEv[] events) {
        for (CallEv event : events) {
          try {
            AvayaEnvelope envelope = map(event, extension);
            if (envelope == null) continue;
            envelope = detector.detect(envelope);
            if (outbound != null && envelope.outbound() != null) envelope = outbound.enrich(envelope);
            registry.observe(envelope);
            sink.accept(envelope);
          } catch (RuntimeException e) {
            log.warn("AES event not published: {}", e.getClass().getSimpleName());
          }
        }
      }
    };
  }

  private AvayaEnvelope map(CallEv event, String extension) {
    String type;
    if (event instanceof CallCtlConnAlertingEv) type = "delivered";
    else if (event instanceof CallCtlConnEstablishedEv) type = "established";
    else if (event instanceof CallCtlTermConnHeldEv) type = "held";
    else if (event instanceof CallCtlTermConnTalkingEv) type = "retrieved";
    else if (event instanceof CallCtlCallEv cc && cc.getCallControlCause() == CallCtlCallEv.CAUSE_TRANSFER) type = "transferred";
    else if (event instanceof CallCtlConnDisconnectedEv) type = "cleared";
    else return null;
    Call call = event.getCall();
    String ucid = call instanceof LucentV5CallInfo v5 ? v5.getUCID() : null;
    String callId = String.valueOf(call.hashCode());
    String key = (ucid == null ? callId : ucid) + ":" + extension;
    if ("retrieved".equals(type) && heldConnections.remove(key) == null) return null; // talking without prior hold
    if ("held".equals(type)) heldConnections.put(key, true);
    String uui = null;
    String uuiEncoding = "ascii";
    String vdn = null;
    String skill = null;
    if (call instanceof LucentCallInfo info) {
      UserToUserInfo u = info.getUserToUserInfo();
      if (u != null) {
        String[] encoded = AvayaEnvelope.encodeUui(u.getBytes());
        uui = encoded[0];
        uuiEncoding = encoded[1];
      }
      Address called = info.getCalledAddress();
      vdn = called == null ? null : called.getName();
      ACDAddress acd = info.getDeliveringACDAddress();
      skill = acd == null ? null : acd.getName();
    }
    AvayaAgent agent = agentOn(extension);
    String ani = call.getConnections() != null && call.getConnections().length > 0 ? call.getConnections()[0].getAddress().getName() : null;
    String interactionId = ucid != null ? ucid : "call-" + callId;
    return new AvayaEnvelope(AvayaEnvelope.SCHEMA, "aes:" + interactionId + ":" + type + ":" + sequence.incrementAndGet(), "aes", type, Instant.now().toString(),
        interactionId, callId, ucid, "voice", "inbound", agent, null, ani, null, vdn, skill, uui, uuiEncoding, Map.of(), false, null, null, null);
  }

  private AvayaAgent agentOn(String extension) {
    if (extension == null) return null;
    try {
      LucentAddress address = (LucentAddress) provider.getAddress(extension);
      for (var terminal : address.getTerminals())
        if (terminal instanceof AgentTerminal agentTerminal && agentTerminal.getAgents() != null)
          for (Agent agent : agentTerminal.getAgents()) return new AvayaAgent(agent.getAgentID(), extension, null);
    } catch (Exception ignored) {
      // station without a logged-in agent
    }
    return new AvayaAgent(null, extension, null);
  }

  @Override
  public void execute(AvayaCommand command) throws CtiCommandException {
    if (command instanceof AvayaCommand.OutboundResult result && outbound != null) {
      outbound.result(result);
      return;
    }
    throw new CtiCommandException("avaya_aes_not_supported", false, "AES cannot write into a live call");
  }

  @Override
  public boolean isParticipant(String platformUserId, String interactionId) {
    return registry.isParticipant(platformUserId, interactionId);
  }

  @Override
  public boolean connected() {
    return provider != null && provider.getState() == Provider.IN_SERVICE;
  }

  @Override
  public void close() {
    if (provider != null) provider.shutdown();
  }
}
