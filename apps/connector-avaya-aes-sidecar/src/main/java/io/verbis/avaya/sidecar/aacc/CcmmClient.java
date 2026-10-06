package io.verbis.avaya.sidecar.aacc;

import io.verbis.avaya.sidecar.cti.CtiCommandException;
import io.verbis.avaya.sidecar.envelope.AvayaEnvelope;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * CCMM Open Interfaces (SOAP over HTTPS, assumption C1): `CIContactWs` for contact details,
 * intrinsics and closing multimedia contacts (closed reason = disposition). Session key from
 * `CIUtilityWs.GetSessionKey`. Contact text is bounded before it reaches the envelope.
 */
public final class CcmmClient {
  private static final String NS = "http://webservices.ci.ccmm.applications.nortel.com";
  private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).followRedirects(HttpClient.Redirect.NEVER).build();
  private final URI base;
  private final String user;
  private final String password;
  private volatile String sessionKey;

  public CcmmClient(String baseUrl, String user, String password) {
    URI uri = URI.create(baseUrl.endsWith("/") ? baseUrl : baseUrl + "/");
    if (!"https".equals(uri.getScheme())) throw new IllegalArgumentException("CCMM URL must be https");
    this.base = uri;
    this.user = user;
    this.password = password;
  }

  /** Adds email/chat context to a multimedia envelope (best effort; voice is returned as is). */
  public AvayaEnvelope enrich(AvayaEnvelope e) {
    if ("voice".equals(e.mediaType()) || !"delivered".equals(e.event())) return e;
    try {
      String xml = call("CIContactWs.asmx", "GetContactByID", "<ws:GetContactByID><ws:contactID>" + SoapXml.escape(e.interactionId())
          + "</ws:contactID><ws:sessionKey>" + SoapXml.escape(session()) + "</ws:sessionKey></ws:GetContactByID>");
      var doc = SoapXml.parse(xml);
      AvayaEnvelope.Email email = null;
      AvayaEnvelope.Chat chat = null;
      if ("email".equals(e.mediaType())) {
        email = new AvayaEnvelope.Email(cap(SoapXml.text(doc, "From"), 320), List.of(), cap(SoapXml.text(doc, "Subject"), 1_000), cap(SoapXml.text(doc, "Text"), 100_000));
      } else {
        List<AvayaEnvelope.Message> messages = new ArrayList<>();
        for (var action : SoapXml.all(doc, "CIContactAction")) {
          if (messages.size() >= 500) break;
          String from = "Customer".equalsIgnoreCase(SoapXml.text(action, "Source")) ? "customer" : "agent";
          messages.add(new AvayaEnvelope.Message(from, cap(SoapXml.text(action, "Text"), 8_000), e.occurredAt()));
        }
        chat = new AvayaEnvelope.Chat(cap(SoapXml.text(doc, "CustomerName"), 256), messages);
      }
      return new AvayaEnvelope(e.schema(), e.eventId(), e.source(), e.event(), e.occurredAt(), e.interactionId(), e.callId(), e.ucid(), e.mediaType(), e.direction(), e.agent(), e.transferTo(), e.ani(), e.dnis(), e.vdn(), e.skill(), e.uui(), e.uuiEncoding(), e.intrinsics(), e.afterCallWork(), e.outbound(), email, chat);
    } catch (Exception ex) {
      return e;
    }
  }

  public void updateIntrinsics(String contactId, Map<String, String> intrinsics) throws CtiCommandException {
    StringBuilder items = new StringBuilder();
    intrinsics.forEach((k, v) -> items.append("<ws:CIContactIntrinsic><ws:Key>").append(SoapXml.escape(k)).append("</ws:Key><ws:Value>").append(SoapXml.escape(v)).append("</ws:Value></ws:CIContactIntrinsic>"));
    invoke("UpdateContactIntrinsics", "<ws:UpdateContactIntrinsics><ws:contactID>" + SoapXml.escape(contactId) + "</ws:contactID><ws:intrinsics>" + items
        + "</ws:intrinsics><ws:sessionKey>" + SoapXml.escape(session()) + "</ws:sessionKey></ws:UpdateContactIntrinsics>");
  }

  public void closeContact(String contactId, String closedReasonCode, String note) throws CtiCommandException {
    invoke("CloseContact", "<ws:CloseContact><ws:contactID>" + SoapXml.escape(contactId) + "</ws:contactID><ws:closedReasonCode>" + SoapXml.escape(closedReasonCode)
        + "</ws:closedReasonCode><ws:closingNote>" + SoapXml.escape(note) + "</ws:closingNote><ws:sessionKey>" + SoapXml.escape(session()) + "</ws:sessionKey></ws:CloseContact>");
  }

  private void invoke(String operation, String body) throws CtiCommandException {
    try {
      call("CIContactWs.asmx", operation, body);
    } catch (CtiCommandException e) {
      throw e;
    } catch (Exception e) {
      throw new CtiCommandException("avaya_ccmm_unavailable", true, e.getClass().getSimpleName());
    }
  }

  private String session() throws CtiCommandException {
    if (sessionKey != null) return sessionKey;
    try {
    String xml = call("CIUtilityWs.asmx", "GetSessionKey", "<ws:GetSessionKey><ws:userName>" + SoapXml.escape(user) + "</ws:userName><ws:password>" + SoapXml.escape(password) + "</ws:password></ws:GetSessionKey>");
    sessionKey = SoapXml.text(SoapXml.parse(xml), "SessionKey");
    if (sessionKey == null) throw new CtiCommandException("avaya_ccmm_auth", false, "no session key");
    return sessionKey;
    } catch (CtiCommandException e) { throw e; }
    catch (Exception e) { throw new CtiCommandException("avaya_ccmm_unavailable", true, e.getClass().getSimpleName()); }
  }

  private String call(String service, String operation, String body) throws Exception {
    var request = HttpRequest.newBuilder(base.resolve(service)).timeout(Duration.ofSeconds(10))
        .header("content-type", "text/xml; charset=utf-8").header("SOAPAction", NS + "/" + operation)
        .POST(HttpRequest.BodyPublishers.ofString(SoapXml.envelope(NS, body))).build();
    var response = http.send(request, HttpResponse.BodyHandlers.ofString());
    if (response.statusCode() == 500 && response.body().contains("SessionKey")) sessionKey = null;
    if (response.statusCode() >= 500) throw new CtiCommandException("avaya_ccmm_unavailable", true, operation + " " + response.statusCode());
    if (response.statusCode() >= 400) throw new CtiCommandException("avaya_ccmm_refused", false, operation + " " + response.statusCode());
    return response.body();
  }

  private static String cap(String value, int max) {
    if (value == null) return "";
    return value.length() > max ? value.substring(0, max) : value;
  }
}
