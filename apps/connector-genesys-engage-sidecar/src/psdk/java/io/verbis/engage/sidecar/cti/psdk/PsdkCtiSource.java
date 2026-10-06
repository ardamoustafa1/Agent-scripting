package io.verbis.engage.sidecar.cti.psdk;

import com.genesyslab.platform.commons.collections.KeyValueCollection;
import com.genesyslab.platform.commons.collections.KeyValuePair;
import com.genesyslab.platform.commons.protocol.ChannelState;
import com.genesyslab.platform.commons.protocol.Endpoint;
import com.genesyslab.platform.commons.protocol.Message;
import com.genesyslab.platform.openmedia.protocol.InteractionServerProtocol;
import com.genesyslab.platform.openmedia.protocol.interactionserver.InteractionClient;
import com.genesyslab.platform.openmedia.protocol.interactionserver.requests.interactionmanagement.RequestChangeProperties;
import com.genesyslab.platform.voice.protocol.ConnectionId;
import com.genesyslab.platform.voice.protocol.TServerProtocol;
import com.genesyslab.platform.voice.protocol.tserver.AddressType;
import com.genesyslab.platform.voice.protocol.tserver.CommonProperties;
import com.genesyslab.platform.voice.protocol.tserver.ControlMode;
import com.genesyslab.platform.voice.protocol.tserver.RegisterMode;
import com.genesyslab.platform.voice.protocol.tserver.events.EventUserEvent;
import com.genesyslab.platform.voice.protocol.tserver.requests.dn.RequestRegisterAddress;
import com.genesyslab.platform.voice.protocol.tserver.requests.special.RequestSendEvent;
import com.genesyslab.platform.voice.protocol.tserver.requests.userdata.RequestUpdateUserData;
import io.verbis.engage.sidecar.config.SidecarProperties;
import io.verbis.engage.sidecar.cti.CtiCommandException;
import io.verbis.engage.sidecar.cti.CtiSource;
import io.verbis.engage.sidecar.cti.ParticipantRegistry;
import io.verbis.engage.sidecar.envelope.EngageCommand;
import io.verbis.engage.sidecar.envelope.EngageEnvelope;
import java.util.Map;
import java.util.function.Consumer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Platform SDK source (compiled only with the licensed PSDK; docs/connectors/genesys-engage.md §1).
 * - T-Server: registers the configured agent DNs (`RegisterMode.ModeShare` — shares the DN with the
 *   agent's own desktop, never takes control, never sends agent-state requests).
 * - Interaction Server: connects as `ReportingEngine` for chat/email lifecycle, and as `Proxy` for
 *   `RequestChangeProperties` (attached data write-back).
 * - Config Server: DN / agent login → person (employeeId, userName) via {@link ConfigDirectory}.
 * - OCS: RecordProcessed / UpdateCallCompletionStats as a T-Server UserEvent (desktop protocol).
 */
public final class PsdkCtiSource implements CtiSource {
  private static final Logger log = LoggerFactory.getLogger(PsdkCtiSource.class);

  private final SidecarProperties props;
  private final ParticipantRegistry registry;
  private final ConfigDirectory directory;
  private final TServerMapper tserverMapper;
  private final IxnMapper ixnMapper;
  private TServerProtocol tserver;
  private InteractionServerProtocol ixnReporting;
  private InteractionServerProtocol ixnProxy;

  public PsdkCtiSource(SidecarProperties props, ParticipantRegistry registry) throws Exception {
    this.props = props;
    this.registry = registry;
    this.directory = new ConfigDirectory(props.psdk());
    var allow = props.psdk().userDataAllowList();
    this.tserverMapper = new TServerMapper(props.psdk().tserver().name(), directory, allow);
    this.ixnMapper = new IxnMapper(props.psdk().ixnServer().name(), directory, allow);
  }

  @Override
  public void start(Consumer<EngageEnvelope> sink) throws Exception {
    directory.open();
    var ts = props.psdk().tserver();
    tserver = new TServerProtocol(new Endpoint(ts.name(), ts.host(), ts.port()));
    tserver.setClientName(props.psdk().applicationName());
    tserver.setMessageHandler(message -> handle(sink, tserverMapper.map(message)));
    tserver.open();
    for (String dn : props.psdk().dns())
      tserver.send(RequestRegisterAddress.create(dn, RegisterMode.ModeShare, ControlMode.RegisterDefault, AddressType.DN));

    var ixn = props.psdk().ixnServer();
    if (ixn.host() != null && !ixn.host().isBlank()) {
      ixnReporting = new InteractionServerProtocol(new Endpoint(ixn.name(), ixn.host(), ixn.port()));
      ixnReporting.setClientName(props.psdk().applicationName());
      ixnReporting.setClientType(InteractionClient.ReportingEngine);
      ixnReporting.setMessageHandler(message -> handle(sink, ixnMapper.map(message)));
      ixnReporting.open();
      ixnProxy = new InteractionServerProtocol(new Endpoint(ixn.name() + "_proxy", ixn.host(), ixn.port()));
      ixnProxy.setClientName(props.psdk().applicationName());
      ixnProxy.setClientType(InteractionClient.Proxy);
      ixnProxy.open();
    }
  }

  private void handle(Consumer<EngageEnvelope> sink, EngageEnvelope envelope) {
    if (envelope == null) return;
    registry.observe(envelope);
    // Blocks on the JetStream ack (backpressure); a failure is logged and the envelope retried once.
    try {
      sink.accept(envelope);
    } catch (RuntimeException first) {
      try {
        sink.accept(envelope);
      } catch (RuntimeException second) {
        log.error("envelope could not be published: {}", envelope.eventId());
      }
    }
  }

  @Override
  public void execute(EngageCommand command) throws CtiCommandException {
    try {
      switch (command) {
        case EngageCommand.UpdateUserData update when "voice".equals(update.mediaType()) -> {
          String dn = dnOf(command);
          tserver.send(RequestUpdateUserData.create(dn, new ConnectionId(update.interactionId()), kv(update.userData())));
        }
        case EngageCommand.UpdateUserData update -> {
          if (ixnProxy == null) throw new CtiCommandException("engage_ixn_unavailable", true, "no interaction server");
          ixnProxy.send(RequestChangeProperties.create(update.interactionId(), kv(update.userData()), null, null));
        }
        case EngageCommand.OcsRecordProcessed ocs -> {
          CommonProperties event = CommonProperties.create();
          event.setUserEvent(EventUserEvent.ID);
          event.setThisDN(dnOf(command));
          event.setConnID(new ConnectionId(ocs.interactionId()));
          event.setUserData(kv(EngageCommand.ocsUserEvent(ocs)));
          tserver.send(RequestSendEvent.create(event));
        }
      }
    } catch (CtiCommandException e) {
      throw e;
    } catch (Exception e) {
      throw new CtiCommandException("engage_psdk_failed", true, e.getClass().getSimpleName());
    }
  }

  private String dnOf(EngageCommand command) throws CtiCommandException {
    var owner = command.agent() != null && command.agent().dn() != null ? command.agent() : registry.ownerOf(command.interactionId());
    if (owner == null || owner.dn() == null) throw new CtiCommandException("engage_interaction_unknown", false, "no DN for interaction");
    return owner.dn();
  }

  private static KeyValueCollection kv(Map<String, Object> data) {
    KeyValueCollection out = new KeyValueCollection();
    data.forEach((key, value) -> {
      if (value instanceof Number n && (value instanceof Integer || value instanceof Long)) out.addInt(key, n.intValue());
      else out.addString(key, String.valueOf(value));
    });
    return out;
  }

  @Override
  public boolean isParticipant(String platformUserId, String interactionId) {
    return registry.isParticipant(platformUserId, interactionId);
  }

  @Override
  public boolean connected() {
    return tserver != null && tserver.getState() == ChannelState.Opened;
  }

  @Override
  public void close() {
    for (var protocol : new com.genesyslab.platform.commons.protocol.ClientChannel[] {tserver, ixnReporting, ixnProxy}) {
      try {
        if (protocol != null) protocol.close();
      } catch (Exception ignored) {
        // shutting down
      }
    }
    directory.close();
  }

  static Map<String, Object> toMap(KeyValueCollection kv) {
    var map = new java.util.LinkedHashMap<String, Object>();
    if (kv == null) return map;
    for (Object item : kv) {
      if (item instanceof KeyValuePair pair) map.put(pair.getStringKey(), pair.getValue());
    }
    return map;
  }

  static boolean isEvent(Message message, int id) {
    return message != null && message.messageId() == id;
  }
}
