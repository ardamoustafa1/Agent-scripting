package io.verbis.engage.sidecar.envelope;

import com.fasterxml.jackson.annotation.JsonSubTypes;
import com.fasterxml.jackson.annotation.JsonTypeInfo;
import java.util.Map;

/** Commands from the hub (NATS request/reply on `…command.v1`). */
@JsonTypeInfo(use = JsonTypeInfo.Id.NAME, property = "type")
@JsonSubTypes({
  @JsonSubTypes.Type(value = EngageCommand.UpdateUserData.class, name = "updateUserData"),
  @JsonSubTypes.Type(value = EngageCommand.OcsRecordProcessed.class, name = "ocsRecordProcessed")
})
public sealed interface EngageCommand {
  String commandId();

  String interactionId();

  EngageAgent agent();

  record UpdateUserData(String commandId, String interactionId, String mediaType, EngageAgent agent, Map<String, Object> userData) implements EngageCommand {}

  record OcsRecordProcessed(
      String commandId,
      String interactionId,
      EngageAgent agent,
      long recordHandle,
      Integer callResult,
      String campaignName,
      Long applicationId,
      Map<String, Object> fields,
      boolean finalResult) implements EngageCommand {

    /** The hub sends `final`; Java reserves the word. */
    @com.fasterxml.jackson.annotation.JsonCreator
    public static OcsRecordProcessed create(
        @com.fasterxml.jackson.annotation.JsonProperty("commandId") String commandId,
        @com.fasterxml.jackson.annotation.JsonProperty("interactionId") String interactionId,
        @com.fasterxml.jackson.annotation.JsonProperty("agent") EngageAgent agent,
        @com.fasterxml.jackson.annotation.JsonProperty("recordHandle") long recordHandle,
        @com.fasterxml.jackson.annotation.JsonProperty("callResult") Integer callResult,
        @com.fasterxml.jackson.annotation.JsonProperty("campaignName") String campaignName,
        @com.fasterxml.jackson.annotation.JsonProperty("applicationId") Long applicationId,
        @com.fasterxml.jackson.annotation.JsonProperty("fields") Map<String, Object> fields,
        @com.fasterxml.jackson.annotation.JsonProperty("final") Boolean isFinal) {
      return new OcsRecordProcessed(commandId, interactionId, agent, recordHandle, callResult, campaignName, applicationId, fields == null ? Map.of() : fields, isFinal == null || isFinal);
    }
  }

  /** OCS desktop protocol attributes for a RecordProcessed / UpdateCallCompletionStats UserEvent. */
  static Map<String, Object> ocsUserEvent(OcsRecordProcessed c) {
    var map = new java.util.LinkedHashMap<String, Object>();
    map.put("GSW_AGENT_REQ_TYPE", c.finalResult() ? "RecordProcessed" : "UpdateCallCompletionStats");
    map.put("GSW_RECORD_HANDLE", c.recordHandle());
    if (c.callResult() != null) map.put("GSW_CALL_RESULT", c.callResult());
    if (c.applicationId() != null) map.put("GSW_APPLICATION_ID", c.applicationId());
    if (c.campaignName() != null) map.put("GSW_CAMPAIGN_NAME", c.campaignName());
    map.putAll(c.fields());
    return map;
  }
}
