package io.verbis.avaya.sidecar.envelope;

import com.fasterxml.jackson.annotation.JsonSubTypes;
import com.fasterxml.jackson.annotation.JsonTypeInfo;
import java.util.Map;

/** Commands from the hub (NATS request/reply on `verbis.connector.avaya.<id>.command.v1`). */
@JsonTypeInfo(use = JsonTypeInfo.Id.NAME, property = "type")
@JsonSubTypes({
  @JsonSubTypes.Type(value = AvayaCommand.SetIntrinsics.class, name = "setIntrinsics"),
  @JsonSubTypes.Type(value = AvayaCommand.Disposition.class, name = "disposition"),
  @JsonSubTypes.Type(value = AvayaCommand.OutboundResult.class, name = "outboundResult")
})
public sealed interface AvayaCommand {
  String commandId();

  String interactionId();

  record SetIntrinsics(String commandId, String interactionId, Map<String, String> intrinsics) implements AvayaCommand {}

  record Disposition(String commandId, String interactionId, String mediaType, String code, String note, AvayaAgent agent) implements AvayaCommand {}

  record OutboundResult(String commandId, String interactionId, String system, String campaign, String recordId, String completionCode, Map<String, Object> fields, AvayaAgent agent) implements AvayaCommand {}
}
