import { toWireEvent } from '../core/formats.js';

import type { KafkaConfig, SiemSink } from './sink.js';
import type { StoredAuditRow } from '../core/audit-event.js';

/**
 * Minimal producer contract (matches kafkajs `Producer.send`). Kafka is optional: no client is
 * bundled; a deployment that enables it provides a producer with `acks: -1` (all in-sync replicas)
 * and idempotence on.
 */
export interface KafkaProducer {
  send(record: {
    topic: string;
    acks: -1;
    messages: { key: string; value: string; headers: Record<string, string> }[];
  }): Promise<unknown>;
  disconnect(): Promise<void>;
}

export class KafkaSink implements SiemSink {
  constructor(
    private readonly config: KafkaConfig,
    private readonly producer: KafkaProducer,
  ) {}

  async deliver(rows: readonly StoredAuditRow[]): Promise<void> {
    if (rows.length === 0) return;
    await this.producer.send({
      topic: this.config.topic,
      acks: -1,
      // Keyed by tenant: one partition per tenant keeps the chain order for consumers.
      messages: rows.map((row) => ({
        key: row.tenantId,
        value: JSON.stringify(toWireEvent(row)),
        headers: { seq: row.seq.toString(), hash: row.hash },
      })),
    });
  }

  async close(): Promise<void> {
    await this.producer.disconnect();
  }
}
