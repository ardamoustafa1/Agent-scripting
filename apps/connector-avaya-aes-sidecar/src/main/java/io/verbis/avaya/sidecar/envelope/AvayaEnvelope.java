package io.verbis.avaya.sidecar.envelope;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * Envelope v1 — must match `contracts/avaya-envelope.v1.json` and the hub's zod schema
 * (apps/connector-hub/src/connectors/avaya/envelope.ts). The hub validates everything again.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record AvayaEnvelope(
    String schema,
    String eventId,
    String source,
    String event,
    String occurredAt,
    String interactionId,
    String callId,
    String ucid,
    String mediaType,
    String direction,
    AvayaAgent agent,
    AvayaAgent transferTo,
    String ani,
    String dnis,
    String vdn,
    String skill,
    String uui,
    String uuiEncoding,
    Map<String, String> intrinsics,
    Boolean afterCallWork,
    Outbound outbound,
    Email email,
    Chat chat) {

  public static final String SCHEMA = "verbis.avaya.envelope.v1";
  private static final Pattern ID = Pattern.compile("^[A-Za-z0-9._:@-]{1,128}$");
  private static final Pattern UCID = Pattern.compile("^\\d{20}$");

  public record Outbound(String system, String campaign, String list, String recordId, Map<String, Object> fields) {}

  public record Email(String from, List<String> to, String subject, String body) {}

  public record Chat(String customerName, List<Message> messages) {}

  public record Message(String from, String text, String at) {}

  public AvayaEnvelope {
    if (interactionId == null || !ID.matcher(interactionId).matches()) throw new IllegalArgumentException("interactionId");
    if (ucid != null && !UCID.matcher(ucid).matches()) ucid = null;
    if (uui != null && uui.length() > 256) uui = uui.substring(0, 256);
    intrinsics = intrinsics == null ? Map.of() : intrinsics;
  }

  /** Short builder for the common voice case. */
  public static AvayaEnvelope voice(String eventId, String event, String occurredAt, String ucid, String callId, AvayaAgent agent) {
    return new AvayaEnvelope(SCHEMA, eventId, "aes", event, occurredAt, ucid != null ? ucid : "call-" + callId, callId, ucid, "voice", "inbound", agent, null, null, null, null, null, null, "ascii", Map.of(), false, null, null, null);
  }

  public AvayaEnvelope withEvent(String eventId, String event, String occurredAt) {
    return new AvayaEnvelope(schema, eventId, source, event, occurredAt, interactionId, callId, ucid, mediaType, direction, agent, transferTo, ani, dnis, vdn, skill, uui, uuiEncoding, intrinsics, afterCallWork, outbound, email, chat);
  }

  public AvayaEnvelope withOutbound(Outbound value) {
    return new AvayaEnvelope(schema, eventId, source, event, occurredAt, interactionId, callId, ucid, mediaType, "outbound", agent, transferTo, ani, dnis, vdn, skill, uui, uuiEncoding, intrinsics, afterCallWork, value, email, chat);
  }

  /** Bytes → UUI string: printable ASCII as-is, otherwise hex (binary / shared UUI). */
  public static String[] encodeUui(byte[] bytes) {
    if (bytes == null || bytes.length == 0) return new String[] {null, "ascii"};
    boolean printable = true;
    for (byte b : bytes) if (b < 0x20 || b > 0x7E) { printable = false; break; }
    if (printable) return new String[] {new String(bytes, java.nio.charset.StandardCharsets.US_ASCII), "ascii"};
    StringBuilder hex = new StringBuilder();
    for (int i = 0; i < Math.min(bytes.length, 128); i++) hex.append(String.format("%02X", bytes[i]));
    return new String[] {hex.toString(), "hex"};
  }
}
