package io.verbis.avaya.sidecar.outbound;

import io.verbis.avaya.sidecar.cti.CtiCommandException;
import io.verbis.avaya.sidecar.envelope.AvayaCommand;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;

/**
 * POM result feedback through POM web services (SOAP over HTTPS, assumption O2): updates the
 * contact's completion code (and attributes) for the campaign. Operation and namespace are
 * configurable because they differ between POM releases.
 */
public final class PomWebServiceClient implements OutboundClient {
  private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).followRedirects(HttpClient.Redirect.NEVER).build();
  private final URI endpoint;
  private final String authorization;

  public PomWebServiceClient(String endpoint, String authorization) {
    URI uri = URI.create(endpoint);
    if (!"https".equals(uri.getScheme())) throw new IllegalArgumentException("POM endpoint must be https");
    this.endpoint = uri;
    this.authorization = authorization;
  }

  @Override
  public void result(AvayaCommand.OutboundResult result) throws CtiCommandException {
    StringBuilder attrs = new StringBuilder();
    result.fields().forEach((k, v) -> attrs.append("<attribute><name>").append(xml(k)).append("</name><value>").append(xml(String.valueOf(v))).append("</value></attribute>"));
    String body = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>"
        + "<soapenv:Envelope xmlns:soapenv=\"http://schemas.xmlsoap.org/soap/envelope/\" xmlns:pom=\"http://services.pom.avaya.com\"><soapenv:Body>"
        + "<pom:updateContactCompletionCode><campaignName>" + xml(result.campaign()) + "</campaignName><contactId>" + xml(result.recordId())
        + "</contactId><completionCode>" + xml(result.completionCode()) + "</completionCode><attributes>" + attrs + "</attributes></pom:updateContactCompletionCode>"
        + "</soapenv:Body></soapenv:Envelope>";
    try {
      var request = HttpRequest.newBuilder(endpoint).timeout(Duration.ofSeconds(10))
          .header("content-type", "text/xml; charset=utf-8").header("SOAPAction", "updateContactCompletionCode").header("authorization", authorization)
          .POST(HttpRequest.BodyPublishers.ofString(body)).build();
      int status = http.send(request, HttpResponse.BodyHandlers.discarding()).statusCode();
      if (status >= 500 || status == 429) throw new CtiCommandException("avaya_pom_unavailable", true, "POM " + status);
      if (status >= 400) throw new CtiCommandException("avaya_pom_refused", false, "POM " + status);
    } catch (CtiCommandException e) {
      throw e;
    } catch (Exception e) {
      throw new CtiCommandException("avaya_pom_unavailable", true, e.getClass().getSimpleName());
    }
  }

  static String xml(String value) {
    return value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;").replace("'", "&apos;");
  }
}
