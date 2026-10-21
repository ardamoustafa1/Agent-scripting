/** Append-only upgrade of an already provisioned local demo bundle. Never edits or removes rows. */
import { canonicalJson, sha256Hex } from '../../src/common/crypto/canonical-json.js';
import { checksumOf } from '../../src/modules/scripts/document-storage.js';
import { projectDocument } from '../../src/modules/scripts/projection.js';

import {
  DEMO_ACTOR,
  DEMO_SEED_VERSION,
  DEMO_SHARED_ID,
  DEMO_TENANT_ID,
  DEMO_USERS,
  demoCampaigns,
  demoId,
  sharedFragment,
} from './fixture.js';

import type { Prisma } from '../../src/generated/prisma/client.js';

const json = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;

/**
 * Ids an upgrade to `target` writes: the shared welcome version at the base, script versions at
 * base + 10 and their screen links at base + 20 (campaign order). Fixed per target, so two
 * upgrades can never collide and a rerun of the same one fails instead of writing twice.
 */
export function upgradeIds(target: number, index: number) {
  const base = 800 + (target - 3) * 30;
  return {
    shared: demoId(base),
    version: demoId(base + 10 + index),
    link: demoId(base + 20 + index),
  };
}

/**
 * Brings an older local bundle up to the current fixture without touching what exists: the
 * shared welcome and every demo script whose published content differs from the fixture get
 * one new published version, and that campaign's assignment is repinned to it. Unchanged ones
 * are left alone, and earlier versions, sessions and audit history stay exactly as they were.
 * Bundle 3 dropped a heading prop the agent rejects from the shared welcome; bundle 4 made the
 * survey's reason fields multi-select, as they are bound to a list. Like the first publication
 * this is a synthetic bootstrap, not a real approval.
 */
export async function upgradeDemoBundle(
  tx: Prisma.TransactionClient,
  from: number,
  settings: Prisma.JsonObject,
  record: (action: string, type: string, id: string) => Promise<void>,
  now: Date,
): Promise<void> {
  if (from < 2 || from >= DEMO_SEED_VERSION)
    throw new Error(`No upgrade path from demo seed v${String(from)}; use a fresh database`);
  const meta = { tenantId: DEMO_TENANT_ID, createdBy: DEMO_ACTOR, updatedBy: DEMO_ACTOR };
  const changeNote = `Sentetik demo yükseltmesi (paket v${String(DEMO_SEED_VERSION)}): içerik güncel demo fikstürüne getirildi; gerçek approval kabulü değildir.`;

  let shared = await tx.sharedScreenVersion.findFirst({
    where: { sharedScreenId: DEMO_SHARED_ID },
    orderBy: { number: 'desc' },
    select: { id: true, number: true, checksum: true },
  });
  if (!shared) throw new Error('Demo shared welcome is missing; use a fresh database');
  const sharedChecksum = sha256Hex(canonicalJson(sharedFragment));
  if (shared.checksum !== sharedChecksum) {
    const id = upgradeIds(DEMO_SEED_VERSION, 0).shared;
    await tx.sharedScreenVersion.create({
      data: {
        tenantId: DEMO_TENANT_ID,
        createdBy: DEMO_ACTOR,
        id,
        sharedScreenId: DEMO_SHARED_ID,
        number: shared.number + 1,
        semver: `1.0.${String(shared.number)}`,
        fragment: json(sharedFragment),
        checksum: sharedChecksum,
      },
    });
    await record('demo.sharedScreen.versionPublished', 'SharedScreenVersion', id);
    shared = { id, number: shared.number + 1, checksum: sharedChecksum };
  }

  for (const [index, campaign] of demoCampaigns().entries()) {
    const checksum = checksumOf(campaign.document);
    const assignment = await tx.assignment.findUnique({
      where: { id: campaign.assignmentId },
      select: { pinnedVersionId: true },
    });
    const pinned = assignment?.pinnedVersionId
      ? await tx.scriptVersion.findUnique({
          where: { id: assignment.pinnedVersionId },
          select: { checksum: true },
        })
      : null;
    // What agents run already matches the fixture.
    if (pinned?.checksum === checksum) continue;
    const latest = await tx.scriptVersion.findFirst({
      where: { scriptId: campaign.scriptId },
      orderBy: { number: 'desc' },
      select: { number: true },
    });
    if (!assignment || !latest)
      throw new Error('Demo campaign is incomplete; use a fresh database');
    const ids = upgradeIds(DEMO_SEED_VERSION, index);
    await tx.scriptVersion.create({
      data: {
        ...meta,
        id: ids.version,
        scriptId: campaign.scriptId,
        number: latest.number + 1,
        state: 'published',
        schemaVersion: campaign.document.schemaVersion,
        document: json(campaign.document),
        documentSize: Buffer.byteLength(canonicalJson(campaign.document)),
        checksum,
        semver: `1.0.${String(latest.number)}`,
        publishedAt: now,
        publishedBy: DEMO_USERS[2].id,
        changeNote,
      },
    });
    await tx.script.update({
      where: { id: campaign.scriptId },
      data: { currentVersionId: ids.version, updatedBy: DEMO_ACTOR },
    });
    await projectDocument(
      tx,
      { tenantId: DEMO_TENANT_ID, scriptVersionId: ids.version, actor: DEMO_ACTOR },
      campaign.document,
    );
    await tx.scriptScreenLink.create({
      data: {
        tenantId: DEMO_TENANT_ID,
        createdBy: DEMO_ACTOR,
        id: ids.link,
        scriptVersionId: ids.version,
        sharedScreenId: DEMO_SHARED_ID,
        sharedScreenVersionId: shared.id,
        mode: 'linked',
        pageIds: ['demo-intro'],
      },
    });
    await tx.assignment.update({
      where: { id: campaign.assignmentId },
      data: { pinnedVersionId: ids.version, updatedBy: DEMO_ACTOR, version: { increment: 1 } },
    });
    await record('demo.script.bootstrapPublished', 'ScriptVersion', ids.version);
    await record('demo.assignment.repinned', 'Assignment', campaign.assignmentId);
  }
  await tx.tenant.update({
    where: { id: DEMO_TENANT_ID },
    data: { settings: { ...settings, demoSeedVersion: DEMO_SEED_VERSION } },
  });
  await record('demo.bundle.upgraded', 'Tenant', DEMO_TENANT_ID);
}
