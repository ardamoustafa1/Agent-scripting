package io.verbis.engage.sidecar.cti;

import io.verbis.engage.sidecar.envelope.EngageCommand;
import io.verbis.engage.sidecar.envelope.EngageEnvelope;
import java.util.function.Consumer;

/** A Genesys event source + command sink (Platform SDK in production, replay in dev/tests). */
public interface CtiSource extends AutoCloseable {
  void start(Consumer<EngageEnvelope> sink) throws Exception;

  /** Executes a hub command; throws {@link CtiCommandException} with a stable code on refusal. */
  void execute(EngageCommand command) throws CtiCommandException;

  /** Platform-side ownership check (current, non-ended party of the interaction). */
  boolean isParticipant(String platformUserId, String interactionId);

  boolean connected();

  @Override
  void close();
}
