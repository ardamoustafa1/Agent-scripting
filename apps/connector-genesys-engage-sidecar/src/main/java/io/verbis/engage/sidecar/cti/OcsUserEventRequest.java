package io.verbis.engage.sidecar.cti;

import io.verbis.engage.sidecar.envelope.EngageCommand;
import java.util.Map;

/**
 * SDK-independent description of the T-Server request that reports an OCS record result (M-27).
 * The Genesys desktop protocol delivers `GSW_AGENT_REQ_TYPE` user data with
 * `RequestDistributeUserEvent` (not `RequestSendEvent`). Built here so the contract is unit tested
 * without the licensed Platform SDK; the PSDK source only translates it. Unverified against a
 * live OCS.
 */
public record OcsUserEventRequest(Kind kind, String thisDn, String connId, Map<String, Object> userData) {
  public enum Kind {
    DISTRIBUTE_USER_EVENT("DistributeUserEvent");

    private final String wireName;

    Kind(String wireName) {
      this.wireName = wireName;
    }

    public String wireName() {
      return wireName;
    }
  }

  public static OcsUserEventRequest from(EngageCommand.OcsRecordProcessed command, String dn) {
    if (dn == null || dn.isBlank()) throw new IllegalArgumentException("DN required");
    return new OcsUserEventRequest(Kind.DISTRIBUTE_USER_EVENT, dn, command.interactionId(), EngageCommand.ocsUserEvent(command));
  }
}
