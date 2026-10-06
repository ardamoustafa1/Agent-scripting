import { resourceFromAttributes } from '@opentelemetry/resources';

import type { ExportResult } from '@opentelemetry/core';
import type { SpanExporter, ReadableSpan } from '@opentelemetry/sdk-trace-base';

const allowed =
  /^(http\.route|http\.request\.method|http\.response\.status_code|http\.method|http\.status_code|db\.system|db\.system\.name|messaging\.system|messaging\.operation)$/;
export function safeSpan(span: ReadableSpan): ReadableSpan {
  const attributes = Object.fromEntries(
    Object.entries(span.attributes).filter(([key]) => allowed.test(key)),
  );
  const resource = resourceFromAttributes(
    Object.fromEntries(
      Object.entries(span.resource.attributes).filter(([key]) =>
        ['service.name', 'service.version', 'service.instance.id'].includes(key),
      ),
    ),
  );
  const name =
    'http.route' in attributes
      ? `${String(attributes['http.request.method'] ?? attributes['http.method'] ?? 'HTTP')} ${String(attributes['http.route'])}`
      : Object.keys(attributes).some((key) => key.startsWith('http.'))
        ? 'http.request'
        : Object.keys(attributes).some((key) => key.startsWith('db.'))
          ? 'db.query'
          : /^(nats\.|integration\.|connector\.|outbox\.|event\.)[a-z._]+$/.test(span.name)
            ? span.name
            : 'operation';
  return {
    kind: span.kind,
    startTime: span.startTime,
    endTime: span.endTime,
    duration: span.duration,
    ended: span.ended,
    instrumentationScope: { name: span.instrumentationScope.name },
    droppedAttributesCount: span.droppedAttributesCount,
    droppedEventsCount: span.droppedEventsCount,
    droppedLinksCount: span.droppedLinksCount,
    name,
    attributes,
    resource,
    events: [],
    links: [],
    status: { code: span.status.code },
    spanContext: () => span.spanContext(),
  };
}
export class SafeTraceExporter implements SpanExporter {
  constructor(private readonly exporter: SpanExporter) {}
  export(spans: ReadableSpan[], callback: (result: ExportResult) => void): void {
    this.exporter.export(spans.map(safeSpan), callback);
  }
  shutdown(): Promise<void> {
    return this.exporter.shutdown();
  }
  forceFlush(): Promise<void> {
    return this.exporter.forceFlush?.() ?? Promise.resolve();
  }
}
