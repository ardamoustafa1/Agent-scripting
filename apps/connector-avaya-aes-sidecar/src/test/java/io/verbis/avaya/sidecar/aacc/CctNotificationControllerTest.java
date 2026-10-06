package io.verbis.avaya.sidecar.aacc;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.Test;

/** Notification authenticity fails closed (M-28). */
class CctNotificationControllerTest {
  private final AaccCtiSource source = mock(AaccCtiSource.class);
  private final byte[] body = "<x/>".getBytes(StandardCharsets.UTF_8);

  private CctNotificationController controller(boolean enabled, boolean authentic) {
    return new CctNotificationController(new CctNotificationController.AaccEndpoint() {
      public boolean enabled() { return enabled; }
      public boolean authentic(String token) { return authentic && "good".equals(token); }
      public AaccCtiSource source() { return source; }
    });
  }

  @Test
  void acceptsAnAuthenticNotification() {
    when(source.accept("<x/>")).thenReturn(1);
    assertThat(controller(true, true).notify("good", body).getStatusCode().value()).isEqualTo(202);
    verify(source).accept("<x/>");
  }

  @Test
  void refusesUnknownTokensBeforeParsing() {
    assertThat(controller(true, true).notify("bad", body).getStatusCode().value()).isEqualTo(401);
    assertThat(controller(true, true).notify(null, body).getStatusCode().value()).isEqualTo(401);
    verify(source, never()).accept("<x/>");
  }

  @Test
  void isNotFoundWhenNotInAaccMode() {
    assertThat(controller(false, true).notify("good", body).getStatusCode().value()).isEqualTo(404);
  }

  @Test
  void boundsTheBody() {
    assertThat(controller(true, true).notify("good", new byte[600 * 1024]).getStatusCode().value()).isEqualTo(413);
  }
}
