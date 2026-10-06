package io.verbis.engage.sidecar.cti.replay;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.verbis.engage.sidecar.cti.CtiCommandException;
import io.verbis.engage.sidecar.cti.CtiSource;
import io.verbis.engage.sidecar.cti.ParticipantRegistry;
import io.verbis.engage.sidecar.envelope.EngageCommand;
import io.verbis.engage.sidecar.envelope.EngageEnvelope;
import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.function.Consumer;

/**
 * Replays recorded envelopes (JSON lines) and records commands — for dev without a Genesys
 * environment and for tests. Never enabled with `source=psdk`.
 */
public final class ReplayCtiSource implements CtiSource {
  private final List<EngageEnvelope> envelopes;
  private final ParticipantRegistry registry;
  private final List<EngageCommand> commands = new CopyOnWriteArrayList<>();
  private volatile boolean started;

  public ReplayCtiSource(List<EngageEnvelope> envelopes, ParticipantRegistry registry) {
    this.envelopes = List.copyOf(envelopes);
    this.registry = registry;
  }

  public static List<EngageEnvelope> read(InputStream in, ObjectMapper mapper) throws java.io.IOException {
    try (var reader = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8))) {
      return reader.lines().filter(l -> !l.isBlank()).map(l -> {
        try {
          return mapper.readValue(l, EngageEnvelope.class);
        } catch (java.io.IOException e) {
          throw new IllegalArgumentException("bad replay line", e);
        }
      }).toList();
    }
  }

  @Override
  public void start(Consumer<EngageEnvelope> sink) {
    started = true;
    for (EngageEnvelope envelope : envelopes) {
      registry.observe(envelope);
      sink.accept(envelope);
    }
  }

  @Override
  public void execute(EngageCommand command) throws CtiCommandException {
    if (registry.ownerOf(command.interactionId()) == null && !(command instanceof EngageCommand.OcsRecordProcessed))
      throw new CtiCommandException("engage_interaction_unknown", false, "unknown interaction");
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

  public List<EngageCommand> commands() {
    return List.copyOf(commands);
  }

  @Override
  public void close() {
    started = false;
  }
}
