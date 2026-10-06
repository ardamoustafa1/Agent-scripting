import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { WebTracerProvider } from '@opentelemetry/sdk-trace-web';

export function createBrowserProvider(): WebTracerProvider {
  const provider = new WebTracerProvider({
    resource: resourceFromAttributes({ 'service.name': 'verbis-agent-web' }),
    spanProcessors: [
      new BatchSpanProcessor(new OTLPTraceExporter({ url: '/telemetry/v1/traces' })),
    ],
  });
  provider.register({ propagator: new W3CTraceContextPropagator() });
  return provider;
}
