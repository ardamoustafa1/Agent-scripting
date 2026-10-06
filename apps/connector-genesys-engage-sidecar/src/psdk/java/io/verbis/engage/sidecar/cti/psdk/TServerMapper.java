package io.verbis.engage.sidecar.cti.psdk;

import com.genesyslab.platform.commons.protocol.Message;
import com.genesyslab.platform.voice.protocol.tserver.CallType;
import com.genesyslab.platform.voice.protocol.tserver.events.*;
import io.verbis.engage.sidecar.envelope.EngageAgent;
import io.verbis.engage.sidecar.envelope.EngageEnvelope;
import java.time.Instant;
import java.util.List;

/**
 * T-Server events on registered agent DNs → envelopes. eventId = `<T-Server app>:<EventSequenceNumber>`
 * (unique per T-Server, stable across sidecar retries). interactionId = ConnID (hex); for
 * EventPartyChanged the envelope keeps the surviving ConnID and reports the previous one.
 */
final class TServerMapper {
  private final String server;
  private final ConfigDirectory directory;
  private final List<String> allowList;

  TServerMapper(String server, ConfigDirectory directory, List<String> allowList) {
    this.server = server;
    this.directory = directory;
    this.allowList = allowList;
  }

  EngageEnvelope map(Message message) {
    if (message instanceof EventAgentLogin login) {
      directory.rememberLogin(login.getThisDN(), login.getAgentID());
      return null;
    }
    if (message instanceof EventAgentLogout logout) {
      directory.forgetLogin(logout.getThisDN());
      return null;
    }
    String event;
    if (message instanceof EventRinging) event = "ringing";
    else if (message instanceof EventDialing) event = "dialing";
    else if (message instanceof EventEstablished) event = "established";
    else if (message instanceof EventHeld) event = "held";
    else if (message instanceof EventRetrieved) event = "retrieved";
    else if (message instanceof EventPartyChanged) event = "partyChanged";
    else if (message instanceof EventReleased) event = "released";
    else if (message instanceof EventAbandoned) event = "abandoned";
    else if (message instanceof EventAttachedDataChanged) event = "attachedDataChanged";
    else return null;
    var common = (com.genesyslab.platform.voice.protocol.tserver.CallEvent) message;
    EngageAgent agent = directory.agentOnDn(common.getThisDN());
    var userData = EngageEnvelope.flatten(PsdkCtiSource.toMap(common.getUserData()), allowList);
    String previous = message instanceof EventPartyChanged changed && changed.getPreviousConnID() != null ? changed.getPreviousConnID().toString() : null;
    EngageAgent transferTo = null;
    if (message instanceof EventPartyChanged changed) transferTo = directory.agentOnDn(changed.getThirdPartyDN());
    return new EngageEnvelope(
        EngageEnvelope.SCHEMA,
        server + ":" + common.getEventSequenceNumber(),
        "tserver",
        event,
        Instant.now().toString(),
        common.getConnID().toString(),
        previous,
        "voice",
        callType(common.getCallType()),
        agent,
        transferTo,
        common.getANI(),
        common.getDNIS(),
        common.getThisQueue(),
        userData,
        null,
        null);
  }

  private static String callType(CallType type) {
    if (type == null) return "Unknown";
    if (type == CallType.Inbound) return "Inbound";
    if (type == CallType.Outbound) return "Outbound";
    if (type == CallType.Internal) return "Internal";
    if (type == CallType.Consult) return "Consult";
    return "Unknown";
  }
}
