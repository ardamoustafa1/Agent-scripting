package io.verbis.engage.sidecar.cti.psdk;

import com.genesyslab.platform.commons.collections.KeyValueCollection;
import com.genesyslab.platform.commons.protocol.Message;
import com.genesyslab.platform.openmedia.protocol.interactionserver.InteractionProperties;

/**
 * Uniform read access over Interaction Server reporting events (each event type exposes
 * `getInteraction()` with `InteractionProperties`; agent ids sit on the party info).
 */
final class ReportingView {
  private final InteractionProperties props;
  private final String agentId;

  ReportingView(Message message) {
    InteractionProperties p = null;
    String agent = null;
    try {
      p = (InteractionProperties) message.getClass().getMethod("getInteraction").invoke(message);
      Object party = message.getClass().getMethod("getPartyInfo").invoke(message);
      if (party != null) agent = (String) party.getClass().getMethod("getAgentId").invoke(party);
    } catch (ReflectiveOperationException ignored) {
      // event without interaction/party info
    }
    this.props = p;
    this.agentId = agent;
  }

  String interactionId() {
    return props == null ? null : props.getInteractionId();
  }

  String mediaType() {
    return props == null ? null : props.getInteractionMediatype();
  }

  String queue() {
    return props == null ? null : props.getInteractionQueue();
  }

  KeyValueCollection userData() {
    return props == null ? null : props.getInteractionUserData();
  }

  String agentId() {
    return agentId;
  }
}
