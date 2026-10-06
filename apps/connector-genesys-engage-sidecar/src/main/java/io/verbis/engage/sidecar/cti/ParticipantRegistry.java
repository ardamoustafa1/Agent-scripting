package io.verbis.engage.sidecar.cti;

import io.verbis.engage.sidecar.envelope.EngageAgent;
import io.verbis.engage.sidecar.envelope.EngageEnvelope;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Who currently owns which interaction, built from T-Server / Interaction Server events the
 * sidecar itself received (authoritative: a direct, authenticated platform link). Bounded.
 */
public final class ParticipantRegistry {
  private record Owner(EngageAgent agent, boolean live) {}

  private static final int MAX = 50_000;
  private final Map<String, Owner> owners = new ConcurrentHashMap<>();
  private final String identity;

  public ParticipantRegistry(String identity) {
    this.identity = identity == null ? "employeeId" : identity;
  }

  public void observe(EngageEnvelope envelope) {
    switch (envelope.event()) {
      case "markedDone", "abandoned" -> owners.remove(envelope.interactionId());
      case "partyChanged" -> owners.put(envelope.interactionId(), new Owner(envelope.transferTo() != null ? envelope.transferTo() : envelope.agent(), true));
      case "attachedDataChanged" -> { }
      default -> {
        if (envelope.agent() != null) owners.put(envelope.interactionId(), new Owner(envelope.agent(), true));
      }
    }
    if (owners.size() > MAX) owners.keySet().stream().findFirst().ifPresent(owners::remove);
  }

  public boolean isParticipant(String platformUserId, String interactionId) {
    Owner owner = owners.get(interactionId);
    return owner != null && owner.live() && platformUserId != null && platformUserId.equals(owner.agent().identity(identity));
  }

  public EngageAgent ownerOf(String interactionId) {
    Owner owner = owners.get(interactionId);
    return owner == null ? null : owner.agent();
  }
}
