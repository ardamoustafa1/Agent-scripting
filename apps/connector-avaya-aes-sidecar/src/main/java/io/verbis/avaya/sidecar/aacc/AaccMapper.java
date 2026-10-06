package io.verbis.avaya.sidecar.aacc;

import io.verbis.avaya.sidecar.envelope.AvayaAgent;
import io.verbis.avaya.sidecar.envelope.AvayaEnvelope;
import java.time.Instant;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.Map;
import org.w3c.dom.Element;

/**
 * CCT WS-Notification messages → envelopes (assumption C2, docs/connectors/avaya.md §AACC).
 * Each `Notify/NotificationMessage/Message` carries a `ContactEvent` with `EventType`
 * (ContactPresented, ContactAccepted, ContactHeld, ContactRetrieved, ContactTransferred,
 * ContactReleased, ContactClosed, IntrinsicsChanged), `ContactID`, `ContactType`
 * (Voice, Email, WebComm, SMS, IM, Social, Fax, ScannedDocument, VoiceMail), agent (`AgentID`,
 * `UserID`), `Skillset`, `CDN`, `ANI`, `DNIS`, `UCID`, `TransferTo` and `Intrinsic` key/values.
 * Event ids: `aacc:<ContactID>:<EventType>:<SequenceNumber>` (CCT sequence per contact).
 */
public final class AaccMapper {
  private final Collection<String> intrinsicsAllow;

  public AaccMapper(Collection<String> intrinsicsAllow) {
    this.intrinsicsAllow = intrinsicsAllow;
  }

  public java.util.List<AvayaEnvelope> map(String soap) {
    var document = SoapXml.parse(soap);
    var out = new java.util.ArrayList<AvayaEnvelope>();
    for (Element event : SoapXml.all(document, "ContactEvent")) {
      AvayaEnvelope envelope = one(event);
      if (envelope != null) out.add(envelope);
    }
    return out;
  }

  private AvayaEnvelope one(Element e) {
    String type = SoapXml.text(e, "EventType");
    String contactId = SoapXml.text(e, "ContactID");
    if (type == null || contactId == null || !contactId.matches("^[A-Za-z0-9._:-]{1,64}$")) return null;
    String event = switch (type) {
      case "ContactPresented" -> "delivered";
      case "ContactAccepted" -> "established";
      case "ContactHeld" -> "held";
      case "ContactRetrieved" -> "retrieved";
      case "ContactTransferred" -> "transferred";
      case "ContactReleased" -> "cleared";
      case "ContactClosed" -> "closed";
      case "IntrinsicsChanged" -> "dataChanged";
      default -> null;
    };
    if (event == null) return null;
    String media = media(SoapXml.text(e, "ContactType"));
    String seq = SoapXml.text(e, "SequenceNumber");
    String at = SoapXml.text(e, "Timestamp");
    Map<String, String> intrinsics = new LinkedHashMap<>();
    for (Element intrinsic : SoapXml.all(e, "Intrinsic")) {
      String key = SoapXml.text(intrinsic, "Key");
      String value = SoapXml.text(intrinsic, "Value");
      if (key != null && value != null && key.length() <= 64 && (intrinsicsAllow.isEmpty() || intrinsicsAllow.contains(key)))
        intrinsics.put(key, value.length() > 1_000 ? value.substring(0, 1_000) : value);
    }
    AvayaAgent agent = agent(SoapXml.first(e, "Agent"));
    AvayaAgent transferTo = agent(SoapXml.first(e, "TransferTo"));
    String ucid = SoapXml.text(e, "UCID");
    return new AvayaEnvelope(
        AvayaEnvelope.SCHEMA,
        ("aacc:" + contactId + ":" + type + ":" + (seq == null ? "0" : seq)).replaceAll("[^A-Za-z0-9._:@-]", "_"),
        "aacc",
        event,
        parseTime(at),
        contactId,
        null,
        ucid,
        media,
        "Outbound".equalsIgnoreCase(SoapXml.text(e, "Direction")) ? "outbound" : "inbound",
        agent,
        transferTo,
        SoapXml.text(e, "ANI"),
        SoapXml.text(e, "DNIS"),
        SoapXml.text(e, "CDN"),
        SoapXml.text(e, "Skillset"),
        null,
        "ascii",
        intrinsics,
        "true".equalsIgnoreCase(SoapXml.text(e, "AfterCallWork")),
        null,
        null,
        null);
  }

  private static AvayaAgent agent(Element element) {
    if (element == null) return null;
    String login = SoapXml.text(element, "AgentID");
    String handle = SoapXml.text(element, "UserID");
    String extension = SoapXml.text(element, "Extension");
    return login == null && handle == null && extension == null ? null : new AvayaAgent(login, extension, handle);
  }

  private static String parseTime(String value) {
    try {
      return value == null ? Instant.now().toString() : Instant.parse(value).toString();
    } catch (Exception ex) {
      return Instant.now().toString();
    }
  }

  static String media(String type) {
    if (type == null) return "voice";
    return switch (type.toLowerCase()) {
      case "email" -> "email";
      case "webcomm", "webcommunications", "chat" -> "webcomm";
      case "sms" -> "sms";
      case "im", "instantmessage" -> "im";
      case "social", "socialnetworking" -> "social";
      case "fax" -> "fax";
      case "scanneddocument" -> "scanned";
      case "voicemail" -> "voicemail";
      default -> "voice";
    };
  }
}
