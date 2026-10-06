package io.verbis.engage.sidecar;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.verbis.engage.sidecar.cti.ParticipantRegistry;
import io.verbis.engage.sidecar.envelope.EngageAgent;
import io.verbis.engage.sidecar.envelope.EngageCommand;
import io.verbis.engage.sidecar.envelope.EngageEnvelope;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class EnvelopeContractTest {
  private final ObjectMapper mapper = new ObjectMapper();
  private final EngageAgent agent = new EngageAgent("E1001", "ayse.k", "5001", "7001", null);

  @Test
  void serializesOnlyContractFields() throws Exception {
    var envelope = EngageEnvelope.of("TServer:1", "tserver", "ringing", Instant.parse("2026-10-01T10:00:00Z"), "006d02a8b1c3f001", "voice", agent, Map.of("CustomerId", "C-42"));
    var json = mapper.readTree(mapper.writeValueAsBytes(envelope));
    assertThat(json.get("schema").asText()).isEqualTo("verbis.engage.envelope.v1");
    assertThat(json.has("email")).isFalse();
    var names = new java.util.ArrayList<String>();
    json.fieldNames().forEachRemaining(names::add);
    assertThat(names).isSubsetOf(List.of("schema", "eventId", "source", "event", "occurredAt", "interactionId", "previousInteractionId", "mediaType", "callType", "agent", "transferTo", "ani", "dnis", "queue", "userData", "email", "chat"));
  }

  @Test
  void rejectsPathLikeInteractionIds() {
    assertThatThrownBy(() -> EngageEnvelope.of("x", "tserver", "ringing", Instant.now(), "../../admin", "voice", agent, Map.of())).isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void flattensAttachedDataWithAllowListAndBounds() {
    Map<String, Object> raw = new LinkedHashMap<>();
    raw.put("CustomerId", "C-42");
    raw.put("CardNumber", "4111111111111111");
    raw.put("Nested", Map.of("a", 1));
    raw.put("Long", "x".repeat(5_000));
    raw.put("Count", 3);
    assertThat(EngageEnvelope.flatten(raw, List.of("CustomerId", "Nested", "Long", "Count")))
        .containsEntry("CustomerId", "C-42")
        .containsEntry("Count", 3L)
        .doesNotContainKeys("CardNumber", "Nested")
        .hasEntrySatisfying("Long", v -> assertThat((String) v).hasSize(4_000));
  }

  @Test
  void readsHubCommandsIncludingTheFinalFlag() throws Exception {
    var update = mapper.readValue("{\"type\":\"updateUserData\",\"commandId\":\"c1\",\"interactionId\":\"006d02a8b1c3f001\",\"mediaType\":\"voice\",\"userData\":{\"Verbis_outcome\":\"sale\"}}", EngageCommand.class);
    assertThat(update).isInstanceOf(EngageCommand.UpdateUserData.class);
    var ocs = (EngageCommand.OcsRecordProcessed) mapper.readValue("{\"type\":\"ocsRecordProcessed\",\"commandId\":\"c2\",\"interactionId\":\"006d02a8b1c3f002\",\"recordHandle\":77,\"callResult\":33,\"final\":false,\"fields\":{}}", EngageCommand.class);
    assertThat(ocs.finalResult()).isFalse();
    assertThat(EngageCommand.ocsUserEvent(ocs)).containsEntry("GSW_AGENT_REQ_TYPE", "UpdateCallCompletionStats").containsEntry("GSW_RECORD_HANDLE", 77L).containsEntry("GSW_CALL_RESULT", 33);
  }

  @Test
  void registryTracksOwnershipAcrossTransferAndDone() {
    var registry = new ParticipantRegistry("employeeId");
    var other = new EngageAgent("E2002", "mehmet.y", "5002", "7002", null);
    registry.observe(EngageEnvelope.of("1", "ixn", "established", Instant.now(), "IX1", "chat", agent, Map.of()));
    assertThat(registry.isParticipant("E1001", "IX1")).isTrue();
    registry.observe(new EngageEnvelope(EngageEnvelope.SCHEMA, "2", "ixn", "partyChanged", Instant.now().toString(), "IX1", null, "chat", "Inbound", agent, other, null, null, null, Map.of(), null, null));
    assertThat(registry.isParticipant("E1001", "IX1")).isFalse();
    assertThat(registry.isParticipant("E2002", "IX1")).isTrue();
    registry.observe(EngageEnvelope.of("3", "ixn", "markedDone", Instant.now(), "IX1", "chat", other, Map.of()));
    assertThat(registry.isParticipant("E2002", "IX1")).isFalse();
  }
}
