import { describe, expect, it } from 'vitest';

import { FakeVerbisApi, TENANT_ID } from '../test/fake-api.js';

import { ConnectorSupervisor } from './connector-supervisor.js';
import { EventPipeline } from './event-pipeline.js';

const WEBHOOK = '0190f000-0000-7000-8000-0000000000w1';
const SIM = '0190f000-0000-7000-8000-0000000000s1';
const OTHER = '0190f000-0000-7000-8000-0000000000o1';

function setup(simulatorEnabled = true) {
  const api = new FakeVerbisApi();
  api.connectors = [
    {
      id: WEBHOOK,
      adapterType: 'generic',
      platform: 'generic',
      config: { kind: 'webhook' },
      version: 1,
    },
    {
      id: SIM,
      adapterType: 'generic',
      platform: 'generic',
      config: { kind: 'simulator' },
      version: 1,
    },
    { id: OTHER, adapterType: 'five9', platform: 'five9', config: {}, version: 1 },
  ];
  api.secrets = { [WEBHOOK]: { signingSecret: 'sig-secret-value-1' } };
  const pipeline = new EventPipeline(api, { capacity: 10, concurrency: 1 });
  const supervisor = new ConnectorSupervisor(api, pipeline, {
    simulatorEnabled,
    healthIntervalMs: 60_000,
    refreshIntervalMs: 60_000,
    random: () => 0,
  });
  return { api, supervisor };
}

describe('ConnectorSupervisor', () => {
  it('starts supported connectors, marks unknown adapters unsupported and reports health', async () => {
    const { api, supervisor } = setup();
    await supervisor.sync();
    const states = Object.fromEntries(supervisor.list().map((i) => [i.connectorId, i.state]));
    expect(states).toEqual({ [WEBHOOK]: 'running', [SIM]: 'running', [OTHER]: 'unsupported' });
    expect(api.health.map((h) => [h.connectorId, h.report.status])).toEqual([
      [WEBHOOK, 'up'],
      [SIM, 'up'],
    ]);
    expect(supervisor.get(TENANT_ID, WEBHOOK)).toBeDefined();
    expect(supervisor.get('another-tenant', WEBHOOK)).toBeUndefined();
    await supervisor.shutdown();
  });

  it('never starts the simulator when disabled', async () => {
    const { supervisor } = setup(false);
    await supervisor.sync();
    expect(supervisor.byId(SIM)?.state).toBe('unsupported');
    await supervisor.shutdown();
  });

  it('retries a failing init (missing secret) and reports it down', async () => {
    const { api, supervisor } = setup();
    api.secrets = {};
    await supervisor.sync();
    expect(supervisor.byId(WEBHOOK)?.state).toBe('reconnecting');
    expect(api.health.find((h) => h.connectorId === WEBHOOK)?.report).toMatchObject({
      status: 'down',
    });
    api.secrets = { [WEBHOOK]: { signingSecret: 'sig-secret-value-1' } };
    await new Promise((r) => setTimeout(r, 10));
    expect(supervisor.byId(WEBHOOK)?.state).toBe('running');
    await supervisor.shutdown();
  });

  it('stops removed connectors and restarts updated ones; rejects invalid config', async () => {
    const { api, supervisor } = setup();
    await supervisor.sync();
    const before = supervisor.byId(SIM)?.connector;
    api.connectors = [
      {
        id: SIM,
        adapterType: 'generic',
        platform: 'generic',
        config: { kind: 'simulator' },
        version: 2,
      },
      {
        id: WEBHOOK,
        adapterType: 'generic',
        platform: 'generic',
        config: { kind: 'webhook', callbackUrl: 'http://insecure' },
        version: 2,
      },
    ];
    await supervisor.sync();
    expect(supervisor.byId(SIM)?.connector).not.toBe(before);
    expect(supervisor.byId(WEBHOOK)?.state).toBe('stopped');
    expect(supervisor.byId(OTHER)).toBeUndefined();
    await supervisor.shutdown();
  });
});
