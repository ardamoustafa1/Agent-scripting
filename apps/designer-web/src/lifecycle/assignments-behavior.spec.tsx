import { fireEvent, screen, waitFor } from '@testing-library/react';
import { expect, it } from 'vitest';

import { createAbility } from '@verbis/authz';

import { mountDesigner } from '../fixtures.spec.helpers.js';
import { campaignId, scriptId, tenantId } from '../test-fixtures.js';

import AssignmentsPage from './assignments.js';

const row = {
  id: tenantId,
  scriptId,
  campaignId,
  version: 4,
  priority: 20,
  effectiveFrom: '2026-10-03T10:00:00Z',
  effectiveTo: '2026-11-03T10:00:00Z',
  expression: { fact: 'interaction.channel', op: 'eq', value: 'voice' },
  variants: [
    { key: 'a', weight: 4000, pinnedVersionId: scriptId },
    { key: 'b', weight: 6000 },
  ],
};
const params = `/v1/assignments?scriptId=${scriptId}&limit=100&sort=priority`;
async function setup(extra: Record<string, unknown> = {}) {
  const f = await mountDesigner(
    <AssignmentsPage />,
    {
      [params]: { data: [row], page: { nextCursor: null } },
      [`/v1/assignments?campaignId=${campaignId}&limit=100&sort=priority`]: {
        data: [row],
        page: { nextCursor: null },
      },
      '/v1/campaigns?limit=100': {
        data: [{ id: campaignId, name: 'Synthetic campaign' }],
        page: { nextCursor: null },
      },
      '/v1/scripts?limit=100': {
        data: [{ id: scriptId, name: 'Synthetic script' }],
        page: { nextCursor: null },
      },
      [`/v1/scripts/${scriptId}/versions?limit=100&sort=-number`]: {
        data: [
          { id: scriptId, number: 3, state: 'published', createdAt: 'synthetic' },
          { id: campaignId, number: 2, state: 'published', createdAt: 'synthetic' },
        ],
        page: { nextCursor: null },
      },
      '/v1/script-resolutions': {
        outcome: 'resolved',
        campaignId,
        assignmentId: tenantId,
        scriptId,
        version: { id: scriptId, number: 3, semver: '1.2.0', checksum: 'synthetic' },
        variant: { key: 'b', bucket: 71 },
        workingHours: { configured: true, open: true },
        trace: {
          evaluated: [
            {
              assignmentId: tenantId,
              priority: 20,
              specificity: 1,
              eligible: true,
              reasons: [],
              factsRead: [],
            },
          ],
          ranking: [tenantId],
          tie: null,
          at: '2026-10-20T10:00:00Z',
        },
        cache: 'miss',
      },
      [`/v1/campaigns/${campaignId}/assignment-conflicts`]: [],
      [`/v1/assignments/${tenantId}/allocation`]: {
        assignmentId: tenantId,
        allocation: { reason: 'insufficient-sessions', arms: [] },
      },
      [`/v1/assignments/${tenantId}/rollout`]: {
        assignmentId: tenantId,
        stableSessions: 0,
        canarySessions: 0,
        windowDays: 7,
        decision: { action: 'none', reason: 'not-a-rollout', breached: [], from: null, to: null },
      },
      ...extra,
    },
    { path: `/scripts/${scriptId}/assignments`, route: '/scripts/:id/assignments' },
  );
  await screen.findByText('Synthetic campaign');
  return f;
}
async function choose(label: string, name: string) {
  fireEvent.click(screen.getByRole('combobox', { name: label }));
  fireEvent.click(await screen.findByRole('option', { name }));
}
it('edits versioned assignments, A/B weights and pinned versions', async () => {
  const f = await setup();
  fireEvent.click(screen.getByRole('button', { name: f.label('editor.apply') }));
  fireEvent.change(screen.getByLabelText(f.label('lifecycle.aWeight')), {
    target: { value: '100' },
  });
  const save = screen.getByRole('button', { name: f.label('lifecycle.save') });
  expect(save.hasAttribute('disabled')).toBe(true);
  fireEvent.change(screen.getByLabelText(f.label('lifecycle.aWeight')), {
    target: { value: '35' },
  });
  await choose(f.label('lifecycle.bVersion'), 'v2');
  fireEvent.change(screen.getByLabelText(f.label('lifecycle.validFrom')), {
    target: { value: '' },
  });
  fireEvent.change(screen.getByLabelText(f.label('lifecycle.validTo')), { target: { value: '' } });
  fireEvent.click(save);
  await waitFor(() => {
    expect(f.requests.some((r) => r.method === 'POST')).toBe(true);
  });
  expect(f.requests.find((r) => r.method === 'POST')!.body).toEqual({
    updates: [
      {
        id: tenantId,
        version: 4,
        patch: {
          effectiveFrom: null,
          effectiveTo: null,
          expression: row.expression,
          variants: [
            { key: 'a', weight: 3500, pinnedVersionId: scriptId },
            { key: 'b', weight: 6500, pinnedVersionId: campaignId },
          ],
        },
      },
    ],
  });
  await waitFor(() => {
    expect(screen.queryByRole('button', { name: f.label('lifecycle.cancel') })).toBeNull();
  });
});
it('creates campaign assignments with A/B disabled and validates date windows', async () => {
  const f = await setup();
  fireEvent.click(screen.getByRole('button', { name: f.label('workspace.nav.campaigns') }));
  fireEvent.click(await screen.findByRole('checkbox', { name: 'Synthetic campaign' }));
  fireEvent.keyDown(screen.getByRole('checkbox', { name: 'Synthetic campaign' }), {
    key: 'Escape',
  });
  fireEvent.change(screen.getByLabelText(f.label('lifecycle.validFrom')), {
    target: { value: '2026-10-05T12:00' },
  });
  fireEvent.change(screen.getByLabelText(f.label('lifecycle.validTo')), {
    target: { value: '2026-10-04T12:00' },
  });
  const save = screen.getByRole('button', { name: f.label('lifecycle.save') });
  expect(save.hasAttribute('disabled')).toBe(true);
  fireEvent.change(screen.getByLabelText(f.label('lifecycle.validTo')), {
    target: { value: '2026-10-06T12:00' },
  });
  fireEvent.click(save);
  await waitFor(() => {
    expect(f.requests.some((r) => r.method === 'POST')).toBe(true);
  });
  expect(f.requests.find((r) => r.method === 'POST')!.body).toMatchObject({
    creates: [
      {
        scriptId,
        campaignId,
        priority: 100,
        variants: null,
        expression: { fact: 'interaction.channel', op: 'exists' },
      },
    ],
  });
});
it('saves campaign-scoped priorities only when the complete page is loaded', async () => {
  const f = await setup();
  const save = screen.getByRole('button', { name: f.label('lifecycle.savePriorities') });
  expect(save.hasAttribute('disabled')).toBe(true);
  await choose(f.label('lifecycle.priorityCampaign'), 'Synthetic campaign');
  await screen.findByText('Synthetic script');
  await waitFor(() => {
    expect(
      screen
        .getByRole('button', { name: f.label('lifecycle.savePriorities') })
        .hasAttribute('disabled'),
    ).toBe(false);
  });
  fireEvent.click(screen.getByRole('button', { name: f.label('lifecycle.savePriorities') }));
  await waitFor(() => {
    expect(f.requests.some((r) => r.method === 'POST')).toBe(true);
  });
  expect(f.requests.find((r) => r.method === 'POST')!.body).toEqual({
    updates: [{ id: tenantId, version: 4, patch: { priority: 0 } }],
  });
});
it('describes a test interaction with fields and reads the decision as sentences', async () => {
  const f = await setup();
  await choose(f.label('workspace.nav.campaigns'), 'Synthetic campaign');
  await choose(f.label('preview.channel'), f.label('preview.channels.chat'));
  fireEvent.change(screen.getByLabelText(f.label('lifecycle.facts.queue')), {
    target: { value: 'synthetic-queue' },
  });
  fireEvent.change(screen.getByLabelText(f.label('lifecycle.facts.skills')), {
    target: { value: 'billing, vip' },
  });
  fireEvent.click(screen.getByRole('button', { name: f.label('preview.addField') }));
  fireEvent.change(screen.getByLabelText(f.label('preview.fieldName')), {
    target: { value: 'bad key' },
  });
  expect(screen.getByText(f.label('lifecycle.resolution.attributeInvalid'))).toBeTruthy();
  fireEvent.change(screen.getByLabelText(f.label('preview.fieldName')), {
    target: { value: 'segmentCode' },
  });
  fireEvent.change(screen.getByLabelText(f.label('preview.fieldValue')), {
    target: { value: 'gold' },
  });
  fireEvent.click(screen.getByRole('button', { name: f.label('lifecycle.resolveContext') }));
  await waitFor(() => {
    expect(f.requests.some((r) => r.path === '/v1/script-resolutions')).toBe(true);
  });
  expect(f.requests.find((r) => r.path === '/v1/script-resolutions')!.body).toEqual({
    campaignId,
    channel: 'chat',
    locale: 'tr',
    queue: 'synthetic-queue',
    skills: ['billing', 'vip'],
    attributes: { segmentCode: 'gold' },
  });
  const result = await screen.findByRole('region', { name: f.label('lifecycle.resolution.title') });
  expect(result.textContent).toContain('Synthetic script');
  expect(result.textContent).toContain('1.2.0');
  expect(result.textContent).toContain(f.label('lifecycle.resolution.workingHours.open'));
  expect(result.textContent).toContain(f.label('lifecycle.resolution.eligible'));
  expect(result.textContent).toContain('Synthetic script · Synthetic campaign');
  expect(result.textContent).not.toContain('{');
});
it('explains why no script opens and why each assignment was rejected', async () => {
  const f = await setup({
    '/v1/script-resolutions': {
      outcome: 'no_match',
      reason: 'no_eligible_assignment',
      campaignId,
      workingHours: { configured: false, open: true },
      trace: {
        evaluated: [
          {
            assignmentId: tenantId,
            priority: 20,
            specificity: 1,
            eligible: false,
            reasons: ['channel_mismatch', 'expired'],
            factsRead: [],
          },
        ],
        ranking: [],
        tie: null,
        at: '2026-10-20T10:00:00Z',
        abSkipped: 'missing_sticky_key',
      },
      cache: 'bypass',
    },
  });
  await choose(f.label('workspace.nav.campaigns'), 'Synthetic campaign');
  fireEvent.click(screen.getByRole('button', { name: f.label('lifecycle.resolveContext') }));
  const result = await screen.findByRole('region', { name: f.label('lifecycle.resolution.title') });
  for (const key of [
    'noMatch',
    'reasons.no_eligible_assignment',
    'workingHours.none',
    'abSkipped.missing_sticky_key',
    'rejected',
    'rejects.channel_mismatch',
    'rejects.expired',
  ])
    expect(result.textContent).toContain(f.label(`lifecycle.resolution.${key}`));
});
it('reports unreadable resolver responses instead of dumping them', async () => {
  const f = await setup({ '/v1/script-resolutions': { synthetic: true } });
  await choose(f.label('workspace.nav.campaigns'), 'Synthetic campaign');
  fireEvent.click(screen.getByRole('button', { name: f.label('lifecycle.resolveContext') }));
  expect(await screen.findByText(f.label('lifecycle.resolution.unreadable'))).toBeTruthy();
  expect(screen.queryByText(/synthetic/)).toBeNull();
});
it('keeps an assignment editor open when batch saving fails and allows cancel', async () => {
  const f = await setup({ '/v1/assignments/batch': Response.json({}, { status: 500 }) });
  fireEvent.click(screen.getByRole('button', { name: f.label('editor.apply') }));
  fireEvent.click(screen.getByRole('button', { name: f.label('lifecycle.save') }));
  expect(await screen.findByRole('alert')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: f.label('lifecycle.cancel') }));
  expect(screen.queryByRole('button', { name: f.label('lifecycle.cancel') })).toBeNull();
});
it('shows assignment loading errors', async () => {
  const f = await mountDesigner(
    <AssignmentsPage />,
    { [params]: Response.json({}, { status: 503 }) },
    {
      path: `/scripts/${scriptId}/assignments`,
      route: '/scripts/:id/assignments',
      ability: createAbility([]),
    },
  );
  expect(await screen.findByRole('button', { name: f.label('workspace.retry') })).toBeTruthy();
});
it('explains campaign permission when a designer cannot save assignments', async () => {
  const f = await mountDesigner(
    <AssignmentsPage />,
    {
      [params]: { data: [row], page: { nextCursor: null } },
      '/v1/campaigns?limit=100': {
        data: [{ id: campaignId, name: 'Synthetic campaign' }],
        page: { nextCursor: null },
      },
    },
    {
      path: `/scripts/${scriptId}/assignments`,
      route: '/scripts/:id/assignments',
      ability: createAbility([
        { action: 'read', subject: 'Campaign' },
        { action: 'read', subject: 'Script' },
      ]),
    },
  );
  expect(await screen.findByText(f.label('editor.assignmentPermission'))).toBeTruthy();
  expect(f.requests.some((r) => r.method === 'POST')).toBe(false);
});

const allocationPath = `/v1/assignments/${tenantId}/allocation`;
const rolloutPath = `/v1/assignments/${tenantId}/rollout`;
const conflictsPath = `/v1/campaigns/${campaignId}/assignment-conflicts`;

it('shows which arm is winning and the canary verdict while editing an experiment', async () => {
  const f = await setup({
    [allocationPath]: {
      assignmentId: tenantId,
      allocation: {
        reason: 'ok',
        arms: [
          { key: 'a', probabilityBest: 0.18, weight: 4000 },
          { key: 'b', probabilityBest: 0.82, weight: 6000 },
        ],
      },
    },
    [rolloutPath]: {
      assignmentId: tenantId,
      stableSessions: 120,
      canarySessions: 40,
      windowDays: 7,
      decision: {
        action: 'rollback',
        reason: 'guardrail-breached',
        breached: ['abandonRate'],
        from: 2000,
        to: 0,
        proposal: [
          { key: 'a', weight: 10000 },
          { key: 'b', weight: 0 },
        ],
      },
    },
  });
  fireEvent.click(screen.getByRole('button', { name: f.label('editor.apply') }));
  expect(await screen.findByText('82%')).toBeTruthy();
  expect(screen.getByText('Arm B', { selector: 'th' })).toBeTruthy();
  expect(screen.getByText(f.label('lifecycle.insights.action.rollback'))).toBeTruthy();
  expect(screen.getByText(f.label('lifecycle.insights.reason.guardrail-breached'))).toBeTruthy();
  expect(screen.getByText(/abandonRate/)).toBeTruthy();
});

it('explains an experiment that has no evidence yet instead of showing numbers', async () => {
  const f = await setup({
    [allocationPath]: {
      assignmentId: tenantId,
      allocation: { reason: 'insufficient-sessions', arms: [] },
    },
    [rolloutPath]: {
      assignmentId: tenantId,
      stableSessions: 0,
      canarySessions: 0,
      windowDays: 7,
      decision: { action: 'none', reason: 'not-a-rollout', breached: [], from: null, to: null },
    },
  });
  fireEvent.click(screen.getByRole('button', { name: f.label('editor.apply') }));
  expect(
    await screen.findByText(f.label('lifecycle.insights.allocationReason.insufficient-sessions')),
  ).toBeTruthy();
  expect(screen.getByText(f.label('lifecycle.insights.reason.not-a-rollout'))).toBeTruthy();
});

it('lists overlapping assignments of the chosen campaign with the winning rule', async () => {
  const f = await setup({
    [conflictsPath]: [
      {
        assignmentIds: [tenantId, campaignId],
        priority: 20,
        severity: 'certain',
        resolvedBy: 'specificity',
        overlap: { channels: ['voice', 'chat'], queues: 'any' },
      },
    ],
  });
  await choose(f.label('lifecycle.priorityCampaign'), 'Synthetic campaign');
  expect(await screen.findByText(f.label('lifecycle.conflicts.severity.certain'))).toBeTruthy();
  expect(
    screen.getByText(new RegExp(f.label('lifecycle.conflicts.resolvedBy.specificity'))),
  ).toBeTruthy();
  expect(
    screen.getByText(
      new RegExp(
        `${f.label('lifecycle.conflicts.dimensions.channels')}: ${f.label('preview.channels.voice')}, ${f.label('preview.channels.chat')}; ${f.label('lifecycle.conflicts.dimensions.queues')}: ${f.label('lifecycle.conflicts.anyValue')}`,
      ),
    ),
  ).toBeTruthy();
});

it('confirms when a campaign has no overlapping assignments', async () => {
  const f = await setup();
  await choose(f.label('lifecycle.priorityCampaign'), 'Synthetic campaign');
  expect(await screen.findByText(f.label('lifecycle.conflicts.none'))).toBeTruthy();
});
