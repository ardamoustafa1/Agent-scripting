package io.verbis.avaya.sidecar.nats;
import io.opentelemetry.api.common.Attributes;
import io.opentelemetry.sdk.resources.Resource;
import io.opentelemetry.sdk.trace.data.SpanData;
import io.opentelemetry.sdk.trace.data.StatusData;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
class TelemetryPrivacyTest {
  @Test void stripsSensitiveAttributesBeforeExport() {
    SpanData span = mock(SpanData.class);
    when(span.getName()).thenReturn("GET /private-customer");
    when(span.getAttributes()).thenReturn(Attributes.builder().put("http.url", "https://test/?token=private").put("http.method", "GET").build());
    when(span.getResource()).thenReturn(Resource.empty());
    when(span.getStatus()).thenReturn(StatusData.unset());
    var safe = TelemetryPrivacy.sanitize(span);
    assertEquals("operation", safe.getName());
    assertFalse(safe.getAttributes().toString().contains("private"));
    assertTrue(safe.getEvents().isEmpty());
  }
}
