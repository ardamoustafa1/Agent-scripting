import { describe, expect, it } from 'vitest';

import { testEnv } from '../../../test/support/env.js';
import { EVENT_SUBJECT } from '../outbox/outbox.types.js';

import { DOMAIN_CONTEXTS, streamDefinitions, streamForSubject } from './streams.js';

describe('JetStream topology', () => {
  it('routes every subject family to exactly one stream', () => {
    expect(streamForSubject('verbis.audit.event.recorded.v1')).toBe('AUDIT');
    expect(streamForSubject('verbis.security.csp.reported.v1')).toBe('SECURITY');
    expect(streamDefinitions().find((stream) => stream.name === 'SECURITY')).toMatchObject({
      deny_delete: true,
      deny_purge: true,
      max_bytes: 1073741824,
      discard: 'new',
    });
    expect(streamForSubject('verbis.runtime.session.started.v1')).toBe('SESSION');
    expect(streamForSubject('verbis.interaction.call.offered.v1')).toBe('INTERACTION');
    expect(streamForSubject('verbis.dlq.analytics-event-counter')).toBe('DLQ');
    for (const context of DOMAIN_CONTEXTS)
      expect(streamForSubject(`verbis.${context}.thing.happened.v1`)).toBe('DOMAIN');
    expect(streamForSubject('other.topic')).toBeUndefined();
  });

  it('defines non-overlapping subjects with dedupe windows', () => {
    const definitions = streamDefinitions(3);
    const subjects = definitions.flatMap((definition) => definition.subjects);
    expect(new Set(subjects).size).toBe(subjects.length);
    expect(
      definitions.every(
        (definition) => definition.num_replicas === 3 && definition.duplicate_window > 0,
      ),
    ).toBe(true);
  });

  it('accepts only versioned subjects for domain events', () => {
    expect(EVENT_SUBJECT.test('verbis.campaigns.campaign.created.v1')).toBe(true);
    for (const bad of [
      'verbis.campaigns.campaign.created',
      'verbis.Campaigns.c.e.v1',
      'verbis.a.b.c.v0',
      'evil.campaigns.campaign.created.v1',
    ]) {
      expect(EVENT_SUBJECT.test(bad), bad).toBe(false);
    }
  });
});

describe('JetStream replica environment', () => {
  it.each([1, 3, 5])('accepts odd quorum size %s', (replicas) => {
    const env = testEnv('{"keys":[{"kty":"OKP"}]}', { NATS_STREAM_REPLICAS: String(replicas) });
    expect(env.NATS_STREAM_REPLICAS).toBe(replicas);
    expect(
      streamDefinitions(env.NATS_STREAM_REPLICAS).every(
        (stream) => stream.num_replicas === replicas,
      ),
    ).toBe(true);
  });
  it.each([0, 2, 4, 6])('rejects unsupported size %s', (replicas) => {
    expect(() =>
      testEnv('{"keys":[{"kty":"OKP"}]}', { NATS_STREAM_REPLICAS: String(replicas) }),
    ).toThrow();
  });
});
