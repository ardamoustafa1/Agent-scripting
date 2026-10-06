import { context, propagation, SpanKind } from '@opentelemetry/api';

import { inSpan } from './metrics.js';

export function messagingHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  propagation.inject(context.active(), headers);
  return headers;
}
export function consumeMessage<T>(
  headers: Record<string, string>,
  fn: () => Promise<T>,
): Promise<T> {
  const parent = propagation.extract(context.active(), headers);
  return context.with(parent, () => inSpan('nats.consume', fn, SpanKind.CONSUMER));
}
