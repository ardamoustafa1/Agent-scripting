package io.verbis.avaya.sidecar.aacc;

import java.nio.charset.StandardCharsets;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;

/**
 * WS-Notification consumer endpoint for CCT (`POST /aacc/notify/{token}`, text/xml). The CCT
 * subscription is created by {@link CctSubscriptionManager} with a signed, subscription-bound token
 * in the URL; anything else is refused before parsing. Deploy behind TLS on the contact-center network.
 */
@RestController
public class CctNotificationController {
  private static final int MAX_BYTES = 512 * 1024;
  private final AaccEndpoint endpoint;

  public CctNotificationController(AaccEndpoint endpoint) {
    this.endpoint = endpoint;
  }

  @PostMapping(path = "/aacc/notify/{token}", consumes = {"text/xml", "application/soap+xml", "application/xml"})
  public ResponseEntity<Void> notify(@PathVariable("token") String token, @RequestBody byte[] body) {
    if (!endpoint.enabled()) return ResponseEntity.notFound().build();
    if (token == null || !endpoint.authentic(token)) return ResponseEntity.status(401).build();
    if (body.length > MAX_BYTES) return ResponseEntity.status(413).build();
    try {
      endpoint.source().accept(new String(body, StandardCharsets.UTF_8));
      return ResponseEntity.accepted().build();
    } catch (IllegalArgumentException e) {
      return ResponseEntity.badRequest().build();
    } catch (IllegalStateException e) {
      return ResponseEntity.status(503).build();
    }
  }

  /** Bound at runtime by the runner (AACC mode only). */
  public interface AaccEndpoint {
    boolean enabled();

    /** Signed token valid and bound to the currently active CCT subscription (fail closed). */
    boolean authentic(String token);

    AaccCtiSource source();
  }
}
