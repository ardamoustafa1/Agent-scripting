package io.verbis.engage.sidecar.envelope;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;
import java.util.regex.Pattern;

/**
 * Envelope v1 — must match `contracts/engage-envelope.v1.json` and the hub's zod schema
 * (apps/connector-hub/src/connectors/genesys-engage/envelope.ts). The hub validates everything again.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record EngageEnvelope(
    String schema,
    String eventId,
    String source,
    String event,
    String occurredAt,
    String interactionId,
    String previousInteractionId,
    String mediaType,
    String callType,
    EngageAgent agent,
    EngageAgent transferTo,
    String ani,
    String dnis,
    String queue,
    Map<String, Object> userData,
    Email email,
    Chat chat) {

  public static final String SCHEMA = "verbis.engage.envelope.v1";
  private static final Pattern ID = Pattern.compile("^[A-Za-z0-9._:@-]{1,128}$");
  private static final int MAX_VALUE = 4_000;
  private static final int MAX_KEYS = 500;

  public record Email(String from, java.util.List<String> to, String subject, String body) {}

  public record Chat(String customerName, java.util.List<Message> messages) {}

  public record Message(String from, String text, String at) {}

  public EngageEnvelope {
    Objects.requireNonNull(eventId, "eventId");
    if (!ID.matcher(interactionId).matches()) throw new IllegalArgumentException("interactionId");
    userData = userData == null ? Map.of() : userData;
  }

  /** Builder entry for producers (T-Server/Ixn mappers, replay). */
  public static EngageEnvelope of(String eventId, String source, String event, Instant at, String interactionId, String mediaType, EngageAgent agent, Map<String, Object> userData) {
    return new EngageEnvelope(SCHEMA, eventId, source, event, at.toString(), interactionId, null, mediaType, "Unknown", agent, null, null, null, null, userData, null, null);
  }

  /**
   * Flattens attached data one level: scalars only, bounded, optional allow-list (data
   * minimisation at the source — PAN/PII keys never leave the contact center unless allowed).
   */
  public static Map<String, Object> flatten(Map<String, ?> raw, java.util.Collection<String> allowList) {
    Map<String, Object> out = new LinkedHashMap<>();
    if (raw == null) return out;
    for (var entry : raw.entrySet()) {
      if (out.size() >= MAX_KEYS) break;
      String key = entry.getKey();
      if (key == null || key.length() > 128) continue;
      if (allowList != null && !allowList.isEmpty() && !allowList.contains(key)) continue;
      Object value = entry.getValue();
      if (value instanceof String s) out.put(key, s.length() > MAX_VALUE ? s.substring(0, MAX_VALUE) : s);
      else if (value instanceof Integer || value instanceof Long) out.put(key, ((Number) value).longValue());
      else if (value instanceof Double || value instanceof Float) out.put(key, ((Number) value).doubleValue());
      else if (value instanceof Boolean b) out.put(key, b);
      // nested KVLists and binary values are dropped
    }
    return out;
  }
}
