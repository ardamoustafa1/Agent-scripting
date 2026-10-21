import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DEMO_SEED_VERSION,
  DEMO_SHARED_ID,
  DEMO_SHARED_VERSION_ID,
  demoCampaigns,
  sharedFragment,
} from '../prisma/demo/fixture.js';
import { upgradeDemoBundle, upgradeIds } from '../prisma/demo/upgrade.js';

import { canonicalJson, sha256Hex } from './common/crypto/canonical-json.js';
import { checksumOf } from './modules/scripts/document-storage.js';
import { projectDocument } from './modules/scripts/projection.js';

import type { Prisma } from './generated/prisma/client.js';

vi.mock('./modules/scripts/projection.js', () => ({ projectDocument: vi.fn() }));

interface Call {
  readonly model: string;
  readonly method: string;
  readonly args: { where?: { id?: string }; data: Record<string, unknown> };
}
type Read = (model: string, method: string, args: Call['args']) => unknown;

/** A transaction that answers reads from `read` and records every call, writes included. */
function recordingTx(read: Read): { tx: Prisma.TransactionClient; calls: Call[] } {
  const calls: Call[] = [];
  const tx = new Proxy(
    {},
    {
      get: (_target, model: string) =>
        new Proxy(
          {},
          {
            get: (_inner, method: string) => (args: Call['args']) => {
              calls.push({ model, method, args });
              return Promise.resolve(
                method.startsWith('find') ? (read(model, method, args) ?? null) : {},
              );
            },
          },
        ),
    },
  ) as Prisma.TransactionClient;
  return { tx, calls };
}

const now = new Date('2026-10-21T09:00:00.000Z');
const campaigns = demoCampaigns();
const writes = (calls: Call[]) => calls.filter((c) => !c.method.startsWith('find'));

/** A bundle-2 database: first versions everywhere, the survey already matching the fixture. */
function bundleTwo(sharedChecksum = 'outdated'): Read {
  return (model, method, args) => {
    if (model === 'sharedScreenVersion')
      return { id: DEMO_SHARED_VERSION_ID, number: 1, checksum: sharedChecksum };
    if (model === 'assignment') return { pinnedVersionId: `pinned-${args.where?.id ?? ''}` };
    if (model === 'scriptVersion' && method === 'findUnique') {
      const survey = campaigns[3]!;
      return {
        checksum:
          args.where?.id === `pinned-${survey.assignmentId}`
            ? checksumOf(survey.document)
            : 'outdated',
      };
    }
    if (model === 'scriptVersion') return { number: 1 };
    return undefined;
  };
}

describe('demo bundle upgrade', () => {
  beforeEach(() => vi.mocked(projectDocument).mockClear());

  it('appends a version only where published content differs, and repins those campaigns', async () => {
    const { tx, calls } = recordingTx(bundleTwo());
    const recorded: string[] = [];
    await upgradeDemoBundle(
      tx,
      2,
      { demoSeedVersion: 2, demoDate: '2026-10-21' },
      (action, type, id) => {
        recorded.push(`${action} ${type} ${id}`);
        return Promise.resolve();
      },
      now,
    );

    // Append-only: rows are created or pointed elsewhere, never removed or overwritten wholesale.
    expect(new Set(writes(calls).map((c) => c.method))).toEqual(new Set(['create', 'update']));
    const shared = writes(calls).filter((c) => c.model === 'sharedScreenVersion');
    expect(shared.map((c) => c.args.data)).toEqual([
      expect.objectContaining({
        id: upgradeIds(DEMO_SEED_VERSION, 0).shared,
        sharedScreenId: DEMO_SHARED_ID,
        number: 2,
        checksum: sha256Hex(canonicalJson(sharedFragment)),
      }),
    ]);

    // The survey's pinned version already matches, so only the other three get a new one.
    const changed = campaigns.slice(0, 3);
    const versions = writes(calls).filter((c) => c.model === 'scriptVersion');
    expect(versions.map((c) => c.args.data['scriptId'])).toEqual(changed.map((c) => c.scriptId));
    for (const version of versions)
      expect(version.args.data).toMatchObject({ number: 2, state: 'published', publishedAt: now });
    const versionIds = changed.map((_c, i) => upgradeIds(DEMO_SEED_VERSION, i).version);
    expect(versions.map((c) => c.args.data['id'])).toEqual(versionIds);

    const links = writes(calls).filter((c) => c.model === 'scriptScreenLink');
    expect(links.map((c) => c.args.data['scriptVersionId'])).toEqual(versionIds);
    for (const link of links)
      expect(link.args.data['sharedScreenVersionId']).toBe(upgradeIds(DEMO_SEED_VERSION, 0).shared);

    const repins = writes(calls).filter((c) => c.model === 'assignment');
    expect(repins.map((c) => c.args.where?.id)).toEqual(changed.map((c) => c.assignmentId));
    expect(repins.map((c) => c.args.data['pinnedVersionId'])).toEqual(versionIds);
    expect(vi.mocked(projectDocument)).toHaveBeenCalledTimes(changed.length);

    const tenant = writes(calls).find((c) => c.model === 'tenant');
    expect(tenant?.args.data['settings']).toEqual({
      demoSeedVersion: DEMO_SEED_VERSION,
      demoDate: '2026-10-21',
    });
    // Every change is audited, and the bundle-level record comes last.
    expect(recorded).toHaveLength(2 + changed.length * 2);
    expect(recorded.at(-1)).toMatch(/^demo\.bundle\.upgraded Tenant /);
  });

  it('links new script versions to the existing shared welcome when it is unchanged', async () => {
    const { tx, calls } = recordingTx(bundleTwo(sha256Hex(canonicalJson(sharedFragment))));
    await upgradeDemoBundle(tx, DEMO_SEED_VERSION - 1, {}, () => Promise.resolve(), now);
    expect(writes(calls).filter((c) => c.model === 'sharedScreenVersion')).toEqual([]);
    for (const link of writes(calls).filter((c) => c.model === 'scriptScreenLink'))
      expect(link.args.data['sharedScreenVersionId']).toBe(DEMO_SHARED_VERSION_ID);
  });

  it('keeps target ids apart so two upgrades can never collide', () => {
    const ids = [3, 4, 5].flatMap((target) => [
      upgradeIds(target, 0).shared,
      ...campaigns.flatMap((_c, i) => [upgradeIds(target, i).version, upgradeIds(target, i).link]),
    ]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('refuses bundles it has no path for without touching the database', async () => {
    for (const from of [1, DEMO_SEED_VERSION]) {
      const { tx, calls } = recordingTx(() => undefined);
      await expect(upgradeDemoBundle(tx, from, {}, () => Promise.resolve(), now)).rejects.toThrow(
        /No upgrade path/,
      );
      expect(calls).toEqual([]);
    }
  });
});
