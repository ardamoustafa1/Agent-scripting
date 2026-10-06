import { describe, expect, it } from 'vitest';

import { requestContext } from '../../../common/context/request-context.js';

import { AttachedDataMapService } from './attached-data-map.service.js';

const TENANT = '0190f000-0000-7000-8000-00000000beef';
const CONNECTOR = '0190f000-0000-7000-8000-00000000e001';

function build(version = 3) {
  const audits: { action: string; after?: unknown }[] = [];
  const updates: unknown[] = [];
  const tx = {
    connector: {
      findFirst: () =>
        Promise.resolve({
          version,
          config: { kind: 'sidecar', attachedData: [{ key: 'Old', variable: 'old' }] },
        }),
      updateMany: (args: unknown) => {
        updates.push(args);
        return Promise.resolve({ count: 1 });
      },
    },
  };
  const service = new AttachedDataMapService(
    { current: () => tx, tenantId: () => TENANT } as never,
    {
      record: (_t: unknown, i: { action: string }) => Promise.resolve(void audits.push(i)),
    } as never,
  );
  return { service, audits, updates };
}
const admin = <T>(fn: () => Promise<T>) =>
  requestContext.run(
    {
      requestId: 'r',
      correlationId: 'c',
      ip: '',
      userAgent: '',
      principal: { type: 'user', id: 'u', tenantId: TENANT, scopes: [] },
    },
    fn,
  );

describe('attached data map', () => {
  it('replaces the mapping with optimistic locking and audits before/after', async () => {
    const { service, audits, updates } = build();
    const result = await admin(() =>
      service.replace(CONNECTOR, 3, [
        { key: 'CustomerId', variable: 'customerId', type: 'string', writeBack: false, pii: true },
      ]),
    );
    expect(result.version).toBe(4);
    expect(JSON.stringify(updates[0])).toContain('customerId');
    expect(JSON.stringify(updates[0])).toContain('"kind":"sidecar"');
    expect(audits[0]?.action).toBe('connector.attachedDataMap.updated');
  });

  it('refuses a stale version', async () => {
    const { service, updates } = build(5);
    await expect(admin(() => service.replace(CONNECTOR, 3, []))).rejects.toThrow();
    expect(updates).toHaveLength(0);
  });

  it('returns the current mapping (invalid stored data reads as empty)', async () => {
    const { service } = build();
    expect((await admin(() => service.get(CONNECTOR))).attachedData).toEqual([
      { key: 'Old', variable: 'old', type: 'string', writeBack: false, pii: false },
    ]);
  });
});
