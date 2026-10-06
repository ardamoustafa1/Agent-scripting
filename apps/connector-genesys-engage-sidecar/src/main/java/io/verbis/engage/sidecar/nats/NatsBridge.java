package io.verbis.engage.sidecar.nats;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.nats.client.Connection;
import io.nats.client.Dispatcher;
import io.nats.client.JetStream;
import io.nats.client.Message;
import io.nats.client.api.StorageType;
import io.nats.client.api.StreamConfiguration;
import io.nats.client.PublishOptions;
import io.verbis.engage.sidecar.cti.CtiCommandException;
import io.verbis.engage.sidecar.cti.CtiSource;
import io.verbis.engage.sidecar.envelope.EngageCommand;
import io.verbis.engage.sidecar.envelope.EngageEnvelope;
import java.time.Duration;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Sidecar side of the hub link:
 * - envelopes → JetStream `verbis.connector.engage.<connectorId>.event.v1`, `Nats-Msg-Id = eventId`
 *   (dedupe window covers producer retries). Publishing blocks on ack, so a stalled stream applies
 *   backpressure to the PSDK handler thread instead of losing events.
 * - `…command.v1` / `…verify.v1` request/reply → {@link CtiSource}. Commands are deduplicated by id.
 * Never logs attached data, tokens or credentials.
 */
public final class NatsBridge implements AutoCloseable {
  private static final Logger log = LoggerFactory.getLogger(NatsBridge.class);
  private static final int MAX_SEEN = 20_000;

  private final Connection connection;
  private final JetStream jetStream;
  private final ObjectMapper mapper;
  private final CtiSource source;
  private final String events;
  private final String commands;
  private final String verify;
  private final Set<String> seenCommands = ConcurrentHashMap.newKeySet();
  private Dispatcher dispatcher;

  public NatsBridge(Connection connection, ObjectMapper mapper, CtiSource source, String connectorId) throws java.io.IOException {
    if (!connectorId.matches("^[0-9a-f-]{36}$")) throw new IllegalArgumentException("connectorId must be a UUID");
    this.connection = connection;
    this.jetStream = connection.jetStream();
    this.mapper = mapper;
    this.source = source;
    this.events = "verbis.connector.engage." + connectorId + ".event.v1";
    this.commands = "verbis.connector.engage." + connectorId + ".command.v1";
    this.verify = "verbis.connector.engage." + connectorId + ".verify.v1";
  }

  /** Dev/test only: production streams are provisioned by ops with retention + replicas. */
  public static void ensureStream(Connection connection, String stream) throws Exception {
    var jsm = connection.jetStreamManagement();
    if (jsm.getStreamNames().contains(stream)) return;
    jsm.addStream(StreamConfiguration.builder()
        .name(stream)
        .subjects("verbis.connector.engage.*.event.v1")
        .storageType(StorageType.File)
        .duplicateWindow(Duration.ofMinutes(2))
        .maxAge(Duration.ofDays(1))
        .build());
  }

  public void start() {
    dispatcher = connection.createDispatcher();
    dispatcher.subscribe(commands, message -> NatsTelemetry.consume(message, this::onCommand));
    dispatcher.subscribe(verify, message -> NatsTelemetry.consume(message, this::onVerify));
  }

  public void publish(EngageEnvelope envelope) {
    var span = NatsTelemetry.producer();
    try (var scope = span.makeCurrent()) {
      byte[] body = mapper.writeValueAsBytes(envelope);
      jetStream.publish(events, NatsTelemetry.inject(), body, PublishOptions.builder().messageId(envelope.eventId()).build());
    } catch (Exception e) {
      // Surface to the source: PSDK adapter retries / goes degraded; never silently dropped.
      span.setStatus(io.opentelemetry.api.trace.StatusCode.ERROR);
      throw new IllegalStateException("publish failed", e);
    } finally { span.end(); }
  }

  private void onCommand(Message message) {
    Map<String, Object> reply;
    try {
      EngageCommand command = mapper.readValue(message.getData(), EngageCommand.class);
      if (seenCommands.contains(command.commandId())) {
        reply = Map.of("ok", true);
      } else {
        source.execute(command);
        seenCommands.add(command.commandId());
        if (seenCommands.size() > MAX_SEEN) seenCommands.clear();
        reply = Map.of("ok", true);
      }
    } catch (CtiCommandException e) {
      reply = Map.of("ok", false, "code", e.code(), "retryable", e.retryable());
    } catch (java.io.IOException e) {
      reply = Map.of("ok", false, "code", "engage_command_invalid", "retryable", false);
    } catch (RuntimeException e) {
      log.warn("command failed: {}", e.getClass().getSimpleName());
      reply = Map.of("ok", false, "code", "engage_command_failed", "retryable", true);
    }
    respond(message, reply);
  }

  private void onVerify(Message message) {
    boolean participant = false;
    try {
      var request = mapper.readTree(message.getData());
      String user = request.path("platformUserId").asText("");
      String interaction = request.path("interactionId").asText("");
      participant = !user.isEmpty() && !interaction.isEmpty() && source.isParticipant(user, interaction);
    } catch (Exception e) {
      participant = false; // fail closed
    }
    respond(message, Map.of("participant", participant));
  }

  private void respond(Message message, Map<String, Object> body) {
    if (message.getReplyTo() == null) return;
    try {
      connection.publish(message.getReplyTo(), mapper.writeValueAsBytes(body));
    } catch (Exception e) {
      log.warn("reply failed: {}", e.getClass().getSimpleName());
    }
  }

  @Override
  public void close() {
    if (dispatcher != null) connection.closeDispatcher(dispatcher);
  }
}
