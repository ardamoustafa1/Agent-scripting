package io.verbis.avaya.sidecar.cti;

import io.verbis.avaya.sidecar.envelope.AvayaCommand;
import io.verbis.avaya.sidecar.envelope.AvayaEnvelope;
import java.util.function.Consumer;

/** An Avaya event source + command sink (AES JTAPI, AACC, replay). */
public interface CtiSource extends AutoCloseable {
  void start(Consumer<AvayaEnvelope> sink) throws Exception;

  void execute(AvayaCommand command) throws CtiCommandException;

  boolean isParticipant(String platformUserId, String interactionId);

  boolean connected();

  @Override
  void close();
}
