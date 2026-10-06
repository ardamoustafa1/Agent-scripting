package io.verbis.avaya.sidecar.aacc;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;

/**
 * WS-Notification consumer endpoint for CCT (`POST /aacc/notify`, text/xml). The CCT
 * subscription is created with this URL and a token header; requests without the exact token are
 * refused before parsing. Deploy behind TLS on the contact-center network only.
 */
@RestController
public class CctNotificationController {
  private static final int MAX_BYTES = 512 * 1024;
  private final AaccEndpoint endpoint;

  public CctNotificationController(AaccEndpoint endpoint) {
    this.endpoint = endpoint;
  }

  @PostMapping(path = "/aacc/notify", consumes = {"text/xml", "application/soap+xml", "application/xml"})
  public ResponseEntity<Void> notify(@RequestHeader(name = "X-Verbis-Notify-Token", required = false) String token, @RequestBody byte[] body) {
    if (!endpoint.enabled()) return ResponseEntity.notFound().build();
    if (token == null || !MessageDigest.isEqual(token.getBytes(StandardCharsets.UTF_8), endpoint.token().getBytes(StandardCharsets.UTF_8)))
      return ResponseEntity.status(401).build();
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

    String token();

    AaccCtiSource source();
  }
}
