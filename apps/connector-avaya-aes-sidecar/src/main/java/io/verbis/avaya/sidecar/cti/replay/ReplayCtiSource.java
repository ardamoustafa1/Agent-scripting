package io.verbis.avaya.sidecar.cti.replay;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.verbis.avaya.sidecar.cti.CtiCommandException;
import io.verbis.avaya.sidecar.cti.CtiSource;
import io.verbis.avaya.sidecar.cti.ParticipantRegistry;
import io.verbis.avaya.sidecar.envelope.AvayaCommand;
import io.verbis.avaya.sidecar.envelope.AvayaEnvelope;
import io.verbis.avaya.sidecar.outbound.OutboundClient;
import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.function.Consumer;

/** Replays recorded envelopes (JSON lines) and records commands — dev and tests only. */
public final class ReplayCtiSource implements CtiSource {
  private final List<AvayaEnvelope> envelopes;
  private final ParticipantRegistry registry;
  private final OutboundClient outbound;
  private final List<AvayaCommand> commands = new CopyOnWriteArrayList<>();
  private volatile boolean started;

  public ReplayCtiSource(List<AvayaEnvelope> envelopes, ParticipantRegistry registry, OutboundClient outbound) {
    this.envelopes = List.copyOf(envelopes);
    this.registry = registry;
    this.outbound = outbound;
  }

  public static List<AvayaEnvelope> read(InputStream in, ObjectMapper mapper) throws java.io.IOException {
    try (var reader = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8))) {
      return reader.lines().filter(l -> !l.isBlank()).map(l -> {
        try {
          return mapper.readValue(l, AvayaEnvelope.class);
        } catch (java.io.IOException e) {
          throw new IllegalArgumentException("bad replay line", e);
        }
      }).toList();
    }
  }

  @Override
  public void start(Consumer<AvayaEnvelope> sink) {
    started = true;
    for (AvayaEnvelope envelope : envelopes) {
      registry.observe(envelope);
      sink.accept(envelope);
    }
  }

  @Override
  public void execute(AvayaCommand command) throws CtiCommandException {
    if (registry.last(command.interactionId()) == null) throw new CtiCommandException("avaya_interaction_unknown", false, "unknown interaction");
    if (command instanceof AvayaCommand.OutboundResult result && outbound != null) outbound.result(result);
    commands.add(command);
  }

  @Override
  public boolean isParticipant(String platformUserId, String interactionId) {
    return registry.isParticipant(platformUserId, interactionId);
  }

  @Override
  public boolean connected() {
    return started;
  }

  public List<AvayaCommand> commands() {
    return List.copyOf(commands);
  }

  @Override
  public void close() {
    started = false;
  }
}
