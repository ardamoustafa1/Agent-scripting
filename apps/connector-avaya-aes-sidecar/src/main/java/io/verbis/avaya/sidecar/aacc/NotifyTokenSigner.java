package io.verbis.avaya.sidecar.aacc;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Base64;
import java.util.Optional;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/**
 * HMAC-SHA256 signed callback token for CCT notifications (M-28). The token is embedded in the
 * callback URL registered at subscribe time (`/aacc/notify/{token}`), binds the local subscription
 * id, and is only honoured while that subscription is active. Replaces the static shared header.
 */
public final class NotifyTokenSigner {
  private static final int MIN_SECRET_BYTES = 32;
  private final byte[] secret;

  public NotifyTokenSigner(byte[] secret) {
    if (secret == null || secret.length < MIN_SECRET_BYTES) throw new IllegalArgumentException("notify secret must be at least 32 bytes");
    this.secret = secret.clone();
  }

  public String issue(String subscriptionId) {
    String id = Base64.getUrlEncoder().withoutPadding().encodeToString(subscriptionId.getBytes(StandardCharsets.UTF_8));
    return id + "." + Base64.getUrlEncoder().withoutPadding().encodeToString(mac(id));
  }

  /** The subscription id when the signature is valid; empty otherwise (constant-time compare). */
  public Optional<String> verify(String token) {
    if (token == null || token.length() > 512) return Optional.empty();
    String[] parts = token.split("\\.", -1);
    if (parts.length != 2) return Optional.empty();
    try {
      byte[] given = Base64.getUrlDecoder().decode(parts[1]);
      if (!MessageDigest.isEqual(given, mac(parts[0]))) return Optional.empty();
      return Optional.of(new String(Base64.getUrlDecoder().decode(parts[0]), StandardCharsets.UTF_8));
    } catch (IllegalArgumentException e) {
      return Optional.empty();
    }
  }

  private byte[] mac(String payload) {
    try {
      Mac mac = Mac.getInstance("HmacSHA256");
      mac.init(new SecretKeySpec(secret, "HmacSHA256"));
      return mac.doFinal(payload.getBytes(StandardCharsets.UTF_8));
    } catch (java.security.GeneralSecurityException e) {
      throw new IllegalStateException(e);
    }
  }
}
