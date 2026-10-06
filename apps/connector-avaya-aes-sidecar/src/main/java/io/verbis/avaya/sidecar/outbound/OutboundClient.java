package io.verbis.avaya.sidecar.outbound;

import io.verbis.avaya.sidecar.cti.CtiCommandException;
import io.verbis.avaya.sidecar.envelope.AvayaCommand;
import io.verbis.avaya.sidecar.envelope.AvayaEnvelope;
import java.util.Optional;

/**
 * Outbound (POM / Proactive Contact) record access and result feedback.
 * Record identification comes from the call itself (UUI/intrinsics, see {@link OutboundDetector});
 * field values may be enriched by the client; the result is reported to the dialer.
 */
public interface OutboundClient {
  /** Adds dialer record fields to an outbound envelope (or returns it unchanged). */
  default AvayaEnvelope enrich(AvayaEnvelope envelope) {
    return envelope;
  }

  void result(AvayaCommand.OutboundResult result) throws CtiCommandException;

  static Optional<OutboundClient> none() {
    return Optional.empty();
  }
}
