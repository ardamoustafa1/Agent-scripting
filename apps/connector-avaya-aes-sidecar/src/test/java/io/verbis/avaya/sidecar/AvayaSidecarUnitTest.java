package io.verbis.avaya.sidecar;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.verbis.avaya.sidecar.aacc.AaccMapper;
import io.verbis.avaya.sidecar.aacc.SoapXml;
import io.verbis.avaya.sidecar.cti.ParticipantRegistry;
import io.verbis.avaya.sidecar.envelope.AvayaAgent;
import io.verbis.avaya.sidecar.envelope.AvayaCommand;
import io.verbis.avaya.sidecar.envelope.AvayaEnvelope;
import io.verbis.avaya.sidecar.outbound.OutboundDetector;
import io.verbis.avaya.sidecar.outbound.PcAgentProtocol;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class AvayaSidecarUnitTest {
  private final ObjectMapper mapper = new ObjectMapper();
  private final AvayaAgent a = new AvayaAgent("3001", "4001", null);

  @Test
  void encodesUuiAsAsciiOrHex() {
    assertThat(AvayaEnvelope.encodeUui("cust=C-42".getBytes(StandardCharsets.US_ASCII))).containsExactly("cust=C-42", "ascii");
    assertThat(AvayaEnvelope.encodeUui(new byte[] {(byte) 0xC8, 0x02, 0x41, 0x42})).containsExactly("C8024142", "hex");
    assertThat(AvayaEnvelope.encodeUui(null)).containsExactly(null, "ascii");
  }

  @Test
  void rejectsBadIdsAndDropsMalformedUcids() {
    assertThatThrownBy(() -> AvayaEnvelope.voice("e", "delivered", "2026-10-01T10:00:00Z", null, "../x", a)).isInstanceOf(IllegalArgumentException.class);
    var envelope = new AvayaEnvelope(AvayaEnvelope.SCHEMA, "e", "aes", "delivered", "2026-10-01T10:00:00Z", "call-1", "1", "12ab", "voice", "inbound", a, null, null, null, null, null, null, "ascii", null, false, null, null, null);
    assertThat(envelope.ucid()).isNull();
  }

  @Test
  void detectsPomRecordsFromUui() {
    var envelope = new AvayaEnvelope(AvayaEnvelope.SCHEMA, "e", "aes", "delivered", "2026-10-01T10:00:00Z", "00001002011696172345", null, null, "voice", "inbound", a, null, null, null, null, null, "POM_CMP=Renewal|POM_CID=98765|firstName=Ayse", "ascii", Map.of(), false, null, null, null);
    var detected = new OutboundDetector("pom").detect(envelope);
    assertThat(detected.direction()).isEqualTo("outbound");
    assertThat(detected.outbound().campaign()).isEqualTo("Renewal");
    assertThat(detected.outbound().recordId()).isEqualTo("98765");
    assertThat(detected.outbound().fields()).containsEntry("firstName", "Ayse").doesNotContainKey("POM_CID");
    assertThat(new OutboundDetector("none").detect(envelope).outbound()).isNull();
  }

  @Test
  void framesProactiveContactAgentApiMessages() {
    byte[] bytes = PcAgentProtocol.command("AGTFinishedItem", "verbis", "7", "20");
    String line = new String(bytes, StandardCharsets.US_ASCII);
    assertThat(line).isEqualTo("AGTFinishedItem\u001EC\u001Everbis\u001E7\u001E1\u001E20\n");
    var reply = PcAgentProtocol.parse("AGTFinishedItem\u001ER\u001Eagent\u001E7\u001E1\u001E0");
    assertThat(reply.type()).isEqualTo('R');
    assertThat(reply.data()).containsExactly("0");
    assertThatThrownBy(() -> PcAgentProtocol.command("AGTSetDataField", "verbis", "8", "a\u001Eb")).isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void mapsCctNotificationsWithIntrinsicsAllowList() throws Exception {
    String xml = new String(getClass().getResourceAsStream("/fixtures/cct-notify.xml").readAllBytes(), StandardCharsets.UTF_8);
    var envelopes = new AaccMapper(List.of("CustomerId")).map(xml);
    assertThat(envelopes).hasSize(1);
    var e = envelopes.get(0);
    assertThat(e.event()).isEqualTo("delivered");
    assertThat(e.mediaType()).isEqualTo("email");
    assertThat(e.skill()).isEqualTo("EM_Billing");
    assertThat(e.agent().handle()).isEqualTo("ayse.k");
    assertThat(e.intrinsics()).containsOnlyKeys("CustomerId");
    assertThat(e.eventId()).isEqualTo("aacc:1000123:ContactPresented:1");
  }

  @Test
  void refusesXxe() {
    String evil = "<?xml version=\"1.0\"?><!DOCTYPE x [<!ENTITY e SYSTEM \"file:///etc/passwd\">]><x>&e;</x>";
    assertThatThrownBy(() -> SoapXml.parse(evil)).isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void registryFollowsTransfersAndAfterCallWork() {
    var registry = new ParticipantRegistry("loginId");
    var b = new AvayaAgent("3002", "4002", null);
    var base = AvayaEnvelope.voice("1", "established", "2026-10-01T10:00:00Z", "00001002011696172345", "812", a);
    registry.observe(base);
    assertThat(registry.isParticipant("3001", "00001002011696172345")).isTrue();
    registry.observe(new AvayaEnvelope(AvayaEnvelope.SCHEMA, "2", "aes", "transferred", "2026-10-01T10:01:00Z", base.interactionId(), null, base.ucid(), "voice", "inbound", a, b, null, null, null, null, null, "ascii", Map.of(), false, null, null, null));
    assertThat(registry.isParticipant("3002", base.interactionId())).isTrue();
    registry.observe(new AvayaEnvelope(AvayaEnvelope.SCHEMA, "3", "aes", "cleared", "2026-10-01T10:02:00Z", base.interactionId(), null, base.ucid(), "voice", "inbound", b, null, null, null, null, null, null, "ascii", Map.of(), true, null, null, null));
    assertThat(registry.isParticipant("3002", base.interactionId())).isTrue();
    registry.observe(base.withEvent("4", "acwCompleted", "2026-10-01T10:03:00Z"));
    assertThat(registry.isParticipant("3002", base.interactionId())).isFalse();
  }

  @Test
  void readsHubCommands() throws Exception {
    var cmd = mapper.readValue("{\"type\":\"outboundResult\",\"commandId\":\"c\",\"interactionId\":\"x\",\"system\":\"pom\",\"campaign\":\"R\",\"recordId\":\"1\",\"completionCode\":\"SALE\",\"fields\":{}}", AvayaCommand.class);
    assertThat(cmd).isInstanceOf(AvayaCommand.OutboundResult.class);
    assertThat(mapper.readValue("{\"type\":\"disposition\",\"commandId\":\"c\",\"interactionId\":\"x\",\"mediaType\":\"email\",\"code\":\"101\"}", AvayaCommand.class)).isInstanceOf(AvayaCommand.Disposition.class);
  }
}
