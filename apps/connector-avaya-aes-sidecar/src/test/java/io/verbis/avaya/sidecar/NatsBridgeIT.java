package io.verbis.avaya.sidecar;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.nats.client.Connection;
import io.nats.client.JetStreamSubscription;
import io.nats.client.Nats;
import io.nats.client.PullSubscribeOptions;
import io.verbis.avaya.sidecar.cti.ParticipantRegistry;
import io.verbis.avaya.sidecar.cti.replay.ReplayCtiSource;
import io.verbis.avaya.sidecar.nats.NatsBridge;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.containers.wait.strategy.Wait;
import org.testcontainers.junit.jupiter.Testcontainers;

/** Sidecar ↔ NATS JetStream with a real server (Testcontainers). */
@Testcontainers
class NatsBridgeIT {
  private static final String CONNECTOR = "0190f000-0000-7000-8000-00000000e001";
  private static final String EVENTS = "verbis.connector.avaya." + CONNECTOR + ".event.v1";
  private static GenericContainer<?> nats;
  private static Connection connection;
  private final ObjectMapper mapper = new ObjectMapper();

  @BeforeAll
  static void startNats() throws Exception {
    nats = new GenericContainer<>("nats:2.11-alpine").withCommand("-js").withExposedPorts(4222).waitingFor(Wait.forLogMessage(".*Server is ready.*", 1));
    nats.start();
    connection = Nats.connect("nats://" + nats.getHost() + ":" + nats.getMappedPort(4222));
    NatsBridge.ensureStream(connection, "VERBIS_AVAYA");
  }

  @AfterAll
  static void stopNats() throws Exception {
    if (connection != null) connection.close();
    if (nats != null) nats.stop();
  }

  @Test
  void publishesDedupedEnvelopesAndAnswersCommandsAndVerify() throws Exception {
    var registry = new ParticipantRegistry("loginId");
    var envelopes = ReplayCtiSource.read(getClass().getResourceAsStream("/fixtures/aes-inbound.jsonl"), mapper);
    var source = new ReplayCtiSource(envelopes, registry, null);
    try (var bridge = new NatsBridge(connection, mapper, source, CONNECTOR)) {
      bridge.start();
      source.start(bridge::publish);
      bridge.publish(envelopes.get(0)); // producer retry of the same event: deduped by Nats-Msg-Id

      JetStreamSubscription sub = connection.jetStream().subscribe(EVENTS, PullSubscribeOptions.builder().durable("it-reader").build());
      var messages = sub.fetch(10, Duration.ofSeconds(3));
      assertThat(messages).hasSize(2);
      assertThat(mapper.readTree(messages.get(0).getData()).get("eventId").asText()).isEqualTo("aes:00001002011696172345:delivered:1");

      var reply = connection.request("verbis.connector.avaya." + CONNECTOR + ".command.v1",
          "{\"type\":\"disposition\",\"commandId\":\"cmd-1\",\"interactionId\":\"00001002011696172345\",\"mediaType\":\"voice\",\"code\":\"101\"}".getBytes(StandardCharsets.UTF_8), Duration.ofSeconds(3));
      assertThat(new String(reply.getData(), StandardCharsets.UTF_8)).isEqualTo("{\"ok\":true}");
      connection.request("verbis.connector.avaya." + CONNECTOR + ".command.v1",
          "{\"type\":\"disposition\",\"commandId\":\"cmd-1\",\"interactionId\":\"00001002011696172345\",\"mediaType\":\"voice\",\"code\":\"102\"}".getBytes(StandardCharsets.UTF_8), Duration.ofSeconds(3));
      assertThat(source.commands()).hasSize(1); // commandId deduplicated

      var bad = connection.request("verbis.connector.avaya." + CONNECTOR + ".command.v1", "{\"type\":\"rm -rf\"}".getBytes(StandardCharsets.UTF_8), Duration.ofSeconds(3));
      assertThat(mapper.readTree(bad.getData()).get("ok").asBoolean()).isFalse();

      var yes = connection.request("verbis.connector.avaya." + CONNECTOR + ".verify.v1", "{\"platformUserId\":\"3001\",\"interactionId\":\"00001002011696172345\"}".getBytes(StandardCharsets.UTF_8), Duration.ofSeconds(3));
      var no = connection.request("verbis.connector.avaya." + CONNECTOR + ".verify.v1", "{\"platformUserId\":\"3002\",\"interactionId\":\"00001002011696172345\"}".getBytes(StandardCharsets.UTF_8), Duration.ofSeconds(3));
      assertThat(mapper.readTree(yes.getData()).get("participant").asBoolean()).isTrue();
      assertThat(mapper.readTree(no.getData()).get("participant").asBoolean()).isFalse();
    }
  }
}
