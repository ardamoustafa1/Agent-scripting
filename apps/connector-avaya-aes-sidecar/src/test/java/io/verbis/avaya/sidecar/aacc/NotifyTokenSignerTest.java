package io.verbis.avaya.sidecar.aacc;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.Test;

class NotifyTokenSignerTest {
  private static final byte[] SECRET = "0123456789abcdef0123456789abcdef".getBytes(StandardCharsets.UTF_8);

  @Test
  void roundTripsTheSubscriptionId() {
    var signer = new NotifyTokenSigner(SECRET);
    assertThat(signer.verify(signer.issue("sub-1"))).contains("sub-1");
  }

  @Test
  void rejectsTamperedWrongKeyAndMalformedTokens() {
    var signer = new NotifyTokenSigner(SECRET);
    var other = new NotifyTokenSigner("fedcba9876543210fedcba9876543210".getBytes(StandardCharsets.UTF_8));
    String token = signer.issue("sub-1");
    assertThat(other.verify(token)).isEmpty();
    assertThat(signer.verify(token + "A")).isEmpty();
    assertThat(signer.verify(signer.issue("sub-2").split("\\.")[0] + "." + token.split("\\.")[1])).isEmpty();
    for (String bad : new String[] {"", "x", ".", "a.b", "a.b.c", "!!!.???"}) assertThat(signer.verify(bad)).isEmpty();
    assertThat(signer.verify(null)).isEmpty();
  }

  @Test
  void refusesWeakSecrets() {
    assertThatThrownBy(() -> new NotifyTokenSigner("short".getBytes(StandardCharsets.UTF_8))).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new NotifyTokenSigner(null)).isInstanceOf(IllegalArgumentException.class);
  }
}
