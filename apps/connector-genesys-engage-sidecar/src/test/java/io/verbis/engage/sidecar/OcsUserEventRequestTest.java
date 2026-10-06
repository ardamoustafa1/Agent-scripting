package io.verbis.engage.sidecar;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.verbis.engage.sidecar.cti.OcsUserEventRequest;
import io.verbis.engage.sidecar.envelope.EngageCommand;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** M-27: OCS feedback is a T-Server RequestDistributeUserEvent (unverified against a live OCS). */
class OcsUserEventRequestTest {
  private final ObjectMapper mapper = new ObjectMapper();

  @Test
  void buildsADistributeUserEventFromTheRecordedFixture() throws Exception {
    var fixture = mapper.readTree(getClass().getResourceAsStream("/fixtures/ocs-userdata.json"));
    assertThat(fixture.get("requestKind").asText()).isEqualTo(OcsUserEventRequest.Kind.DISTRIBUTE_USER_EVENT.wireName());
    for (var testCase : fixture.get("cases")) {
      var command = (EngageCommand.OcsRecordProcessed) mapper.treeToValue(testCase.get("command"), EngageCommand.class);
      var request = OcsUserEventRequest.from(command, testCase.get("dn").asText());
      assertThat(request.kind()).isEqualTo(OcsUserEventRequest.Kind.DISTRIBUTE_USER_EVENT);
      assertThat(request.thisDn()).isEqualTo(testCase.get("dn").asText());
      assertThat(request.connId()).isEqualTo(command.interactionId());
      assertThat(mapper.writeValueAsString(request.userData())).as(testCase.get("name").asText()).isEqualTo(mapper.writeValueAsString(testCase.get("expectedUserData")));
    }
  }

  @Test
  void requiresADn() {
    var command = new EngageCommand.OcsRecordProcessed("c", "i", null, 1, null, null, null, Map.of(), true);
    assertThatThrownBy(() -> OcsUserEventRequest.from(command, "")).isInstanceOf(IllegalArgumentException.class);
  }
}
