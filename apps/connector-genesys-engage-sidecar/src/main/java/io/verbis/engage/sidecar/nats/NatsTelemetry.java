package io.verbis.engage.sidecar.nats;

import io.nats.client.Message;
import io.nats.client.impl.Headers;
import io.opentelemetry.api.OpenTelemetry;
import org.springframework.stereotype.Component;
import io.opentelemetry.api.trace.Span;
import io.opentelemetry.api.trace.SpanKind;
import io.opentelemetry.context.Context;
import io.opentelemetry.context.propagation.TextMapGetter;
import java.util.List;
import java.util.function.Consumer;

@Component
final class NatsTelemetry {
  private static volatile OpenTelemetry telemetry = OpenTelemetry.noop();
  NatsTelemetry(OpenTelemetry configured) { telemetry = configured; }
  static Span producer() {
    return telemetry.getTracer("verbis.sidecar").spanBuilder("nats.publish").setSpanKind(SpanKind.PRODUCER).startSpan();
  }
  static Headers inject() {
    Headers headers = new Headers();
    telemetry.getPropagators().getTextMapPropagator().inject(Context.current(), headers, (h, k, v) -> h.put(k, v));
    return headers;
  }
  static void consume(Message message, Consumer<Message> handler) {
    TextMapGetter<Message> getter = new TextMapGetter<>() {
      public Iterable<String> keys(Message m) { return List.of("traceparent", "tracestate"); }
      public String get(Message m, String key) { return m.getHeaders() == null ? null : m.getHeaders().getFirst(key); }
    };
    Context parent = telemetry.getPropagators().getTextMapPropagator().extract(Context.current(), message, getter);
    Span span = telemetry.getTracer("verbis.sidecar").spanBuilder("nats.consume").setParent(parent).setSpanKind(SpanKind.CONSUMER).startSpan();
    try (var scope = span.makeCurrent()) { handler.accept(message); }
    finally { span.end(); }
  }
}
