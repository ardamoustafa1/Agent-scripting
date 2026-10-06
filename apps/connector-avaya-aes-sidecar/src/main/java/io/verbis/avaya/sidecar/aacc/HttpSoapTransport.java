package io.verbis.avaya.sidecar.aacc;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Base64;

/** HTTPS-only SOAP transport for the CCT subscription calls (no redirects, bounded timeouts). */
public final class HttpSoapTransport implements CctSubscriptionManager.SoapTransport {
  private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).followRedirects(HttpClient.Redirect.NEVER).build();
  private final String authorization;

  /** `user` may be null when CCT is fronted by a mutually authenticated gateway. */
  public HttpSoapTransport(String user, String password) {
    this.authorization = user == null || user.isBlank() ? null
        : "Basic " + Base64.getEncoder().encodeToString((user + ":" + password).getBytes(StandardCharsets.UTF_8));
  }

  @Override
  public CctSubscriptionManager.Response post(URI url, String soapAction, String body) throws Exception {
    if (!"https".equals(url.getScheme())) throw new IllegalArgumentException("https required");
    var request = HttpRequest.newBuilder(url).timeout(Duration.ofSeconds(10)).header("content-type", "text/xml; charset=utf-8").header("SOAPAction", soapAction);
    if (authorization != null) request.header("authorization", authorization);
    var response = http.send(request.POST(HttpRequest.BodyPublishers.ofString(body)).build(), HttpResponse.BodyHandlers.ofString());
    return new CctSubscriptionManager.Response(response.statusCode(), response.body());
  }
}
