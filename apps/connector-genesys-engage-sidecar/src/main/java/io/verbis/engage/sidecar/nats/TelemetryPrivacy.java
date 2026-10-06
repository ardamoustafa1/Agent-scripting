package io.verbis.engage.sidecar.nats;

import io.opentelemetry.api.common.Attributes;
import io.opentelemetry.sdk.autoconfigure.spi.AutoConfigurationCustomizerProvider;
import io.opentelemetry.sdk.common.CompletableResultCode;
import io.opentelemetry.sdk.resources.Resource;
import io.opentelemetry.sdk.trace.data.DelegatingSpanData;
import io.opentelemetry.sdk.trace.data.EventData;
import io.opentelemetry.sdk.trace.data.LinkData;
import io.opentelemetry.sdk.trace.data.SpanData;
import io.opentelemetry.sdk.trace.data.StatusData;
import io.opentelemetry.sdk.trace.export.SpanExporter;
import java.util.Collection;
import java.util.List;
import java.util.Set;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
class TelemetryPrivacy {
  private static final Set<String> ALLOWED = Set.of("http.route", "http.request.method", "http.response.status_code", "http.method", "http.status_code", "db.system", "messaging.system", "messaging.operation");
  @Bean
  AutoConfigurationCustomizerProvider privacyCustomizer() {
    return config -> config.addSpanExporterCustomizer((exporter, properties) -> new SpanExporter() {
      public CompletableResultCode export(Collection<SpanData> spans) {
        return exporter.export(spans.stream().map(TelemetryPrivacy::sanitize).toList());
      }
      public CompletableResultCode flush() { return exporter.flush(); }
      public CompletableResultCode shutdown() { return exporter.shutdown(); }
    });
  }
  static SpanData sanitize(SpanData span) {
    Attributes safe = span.getAttributes().toBuilder().removeIf(key -> !ALLOWED.contains(key.getKey())).build();
    Resource safeResource = Resource.create(span.getResource().getAttributes().toBuilder()
        .removeIf(key -> !Set.of("service.name", "service.version", "service.instance.id").contains(key.getKey())).build());
    return new DelegatingSpanData(span) {
      public Attributes getAttributes() { return safe; }
      public Resource getResource() { return safeResource; }
      public String getName() { return span.getName().matches("nats\\.(publish|consume)") ? span.getName() : "operation"; }
      public List<EventData> getEvents() { return List.of(); }
      public List<LinkData> getLinks() { return List.of(); }
      public StatusData getStatus() { return StatusData.create(span.getStatus().getStatusCode(), ""); }
    };
  }
}
