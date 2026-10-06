package io.verbis.avaya.sidecar.cti;

import io.verbis.avaya.sidecar.envelope.AvayaAgent;
import io.verbis.avaya.sidecar.envelope.AvayaEnvelope;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Current owner per interaction from events the sidecar itself received over its authenticated
 * AES/AACC link; answers the hub's verify requests. Also remembers each interaction's last
 * envelope (outbound record, extension) for commands. Bounded.
 */
public final class ParticipantRegistry {
  private record Entry(AvayaEnvelope last, AvayaAgent owner, boolean live) {}

  private static final int MAX = 50_000;
  private final Map<String, Entry> entries = new ConcurrentHashMap<>();
  private final String identity;

  public ParticipantRegistry(String identity) {
    this.identity = identity == null ? "loginId" : identity;
  }

  public void observe(AvayaEnvelope e) {
    Entry previous = entries.get(e.interactionId());
    AvayaAgent owner = "transferred".equals(e.event()) && e.transferTo() != null ? e.transferTo() : e.agent() != null ? e.agent() : previous == null ? null : previous.owner();
    boolean ended = "acwCompleted".equals(e.event()) || "closed".equals(e.event()) || ("cleared".equals(e.event()) && !Boolean.TRUE.equals(e.afterCallWork()));
    AvayaEnvelope last = previous != null && e.outbound() == null && previous.last().outbound() != null ? e.withOutbound(previous.last().outbound()) : e;
    entries.put(e.interactionId(), new Entry(last, owner, !ended));
    if (entries.size() > MAX) entries.keySet().stream().findFirst().ifPresent(entries::remove);
  }

  public boolean isParticipant(String platformUserId, String interactionId) {
    Entry entry = entries.get(interactionId);
    if (entry == null || !entry.live() || entry.owner() == null || platformUserId == null) return false;
    String value = switch (identity) {
      case "extension" -> entry.owner().extension();
      case "handle" -> entry.owner().handle();
      default -> entry.owner().loginId();
    };
    return platformUserId.equals(value);
  }

  public AvayaEnvelope last(String interactionId) {
    Entry entry = entries.get(interactionId);
    return entry == null ? null : entry.last();
  }

  public AvayaAgent owner(String interactionId) {
    Entry entry = entries.get(interactionId);
    return entry == null ? null : entry.owner();
  }
}
