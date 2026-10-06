package io.verbis.avaya.sidecar.aacc;

import io.verbis.avaya.sidecar.cti.CtiCommandException;
import io.verbis.avaya.sidecar.cti.CtiSource;
import io.verbis.avaya.sidecar.cti.ParticipantRegistry;
import io.verbis.avaya.sidecar.envelope.AvayaCommand;
import io.verbis.avaya.sidecar.envelope.AvayaEnvelope;
import io.verbis.avaya.sidecar.outbound.OutboundClient;
import io.verbis.avaya.sidecar.outbound.OutboundDetector;
import java.util.function.Consumer;

/**
 * AACC source: CCT pushes WS-Notification messages to {@link CctNotificationController}; contacts
 * are enriched from CCMM; commands: intrinsics update, disposition (multimedia: CCMM CloseContact
 * with closed reason; voice: closed reason via the same call — activity codes need CCT, A-C3),
 * outbound result via POM/PC when configured.
 */
public final class AaccCtiSource implements CtiSource {
  private final AaccMapper mapper;
  private final CcmmClient ccmm;
  private final ParticipantRegistry registry;
  private final OutboundDetector detector;
  private final OutboundClient outbound;
  private volatile Consumer<AvayaEnvelope> sink;

  public AaccCtiSource(AaccMapper mapper, CcmmClient ccmm, ParticipantRegistry registry, OutboundDetector detector, OutboundClient outbound) {
    this.mapper = mapper;
    this.ccmm = ccmm;
    this.registry = registry;
    this.detector = detector;
    this.outbound = outbound;
  }

  @Override
  public void start(Consumer<AvayaEnvelope> sink) {
    this.sink = sink;
  }

  /** Called by the notification endpoint after the push was authenticated. */
  public int accept(String soap) {
    Consumer<AvayaEnvelope> target = sink;
    if (target == null) throw new IllegalStateException("not started");
    int count = 0;
    for (AvayaEnvelope raw : mapper.map(soap)) {
      AvayaEnvelope envelope = detector.detect(ccmm.enrich(raw));
      if (outbound != null && envelope.outbound() != null) envelope = outbound.enrich(envelope);
      registry.observe(envelope);
      target.accept(envelope);
      count += 1;
    }
    return count;
  }

  @Override
  public void execute(AvayaCommand command) throws CtiCommandException {
    if (registry.last(command.interactionId()) == null) throw new CtiCommandException("avaya_interaction_unknown", false, "unknown contact");
    switch (command) {
      case AvayaCommand.SetIntrinsics set -> ccmm.updateIntrinsics(set.interactionId(), set.intrinsics());
      case AvayaCommand.Disposition d -> ccmm.closeContact(d.interactionId(), d.code(), d.note() == null ? "" : d.note());
      case AvayaCommand.OutboundResult r -> {
        if (outbound == null) throw new CtiCommandException("avaya_outbound_not_configured", false, "no outbound system");
        outbound.result(r);
      }
    }
  }

  @Override
  public boolean isParticipant(String platformUserId, String interactionId) {
    return registry.isParticipant(platformUserId, interactionId);
  }

  @Override
  public boolean connected() {
    return sink != null;
  }

  @Override
  public void close() {
    sink = null;
  }
}
