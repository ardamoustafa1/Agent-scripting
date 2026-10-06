/// <reference types="node" />
import { File as NodeFile } from 'node:buffer';

import { fireEvent, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import { createAbility } from '@verbis/authz';

import { mountDesigner } from '../fixtures.spec.helpers.js';
import { campaignId, scriptId, tenantId } from '../test-fixtures.js';

import PackagesPage from './packages.js';

const pkg = {
  manifest: { packageId: 'synthetic-package', sourceEnvironment: 'dev' },
  payload: { scripts: [{ name: 'Synthetic packaged script' }] },
};
const plan = {
  packageId: 'synthetic-package',
  dryRun: true,
  plan: [{ name: 'Synthetic packaged script', semver: '1.0.0', action: 'create' }],
  dependencies: [
    {
      key: 'source-key',
      version: 2,
      targetKey: 'source-key',
      missing: false,
      canCreate: true,
      secretRefs: [tenantId],
    },
  ],
};
async function setup(extra: Record<string, unknown> = {}) {
  return mountDesigner(
    <PackagesPage />,
    {
      [`/v1/scripts/${scriptId}/versions?limit=100&sort=-number`]: {
        data: [
          { id: campaignId, number: 1, state: 'published', createdAt: 'synthetic' },
          { id: scriptId, number: 2, state: 'draft', createdAt: 'synthetic' },
        ],
        page: { nextCursor: null },
      },
      '/v1/data-sources?limit=100': {
        data: [{ id: campaignId, key: 'target-key', version: 4, secretRefs: [] }],
        page: { nextCursor: null },
      },
      '/v1/secrets?limit=100': { data: [{ id: campaignId, name: 'Synthetic target secret' }] },
      '/v1/script-packages/export': pkg,
      '/v1/script-packages/import?dryRun=true': plan,
      '/v1/script-packages/import?dryRun=false': {
        ...plan,
        dryRun: false,
        created: [{ scriptId, number: 4, name: 'Synthetic imported draft' }],
      },
      ...extra,
    },
    { path: `/scripts/${scriptId}/packages`, route: '/scripts/:id/packages' },
  );
}
async function choose(label: string, option: string) {
  fireEvent.click(screen.getByRole('combobox', { name: label }));
  fireEvent.click(await screen.findByRole('option', { name: option }));
}
function upload(label: string, content: string) {
  fireEvent.change(screen.getByLabelText(label), {
    target: { files: [new NodeFile([content], 'synthetic.verbis', { type: 'application/json' })] },
  });
}
it('checks dependencies, invalidates verified plans after remapping, and imports a draft', async () => {
  const f = await setup();
  upload(f.label('lifecycle.packageFile'), JSON.stringify(pkg));
  const check = screen.getByRole('button', { name: f.label('lifecycle.checkDependencies') });
  await waitFor(() => {
    expect(check.hasAttribute('disabled')).toBe(false);
  });
  fireEvent.click(check);
  const importDraft = await screen.findByRole('button', { name: f.label('lifecycle.importDraft') });
  await waitFor(() => {
    expect(importDraft.hasAttribute('disabled')).toBe(false);
  });
  await choose(f.label('lifecycle.integrationMapping'), 'target-key v4');
  expect(importDraft.hasAttribute('disabled')).toBe(true);
  await choose(
    f.i18n.t('designer.lifecycle.secretMapping', { id: tenantId.slice(0, 8) }),
    'Synthetic target secret',
  );
  fireEvent.click(
    screen.getAllByRole('button', { name: f.label('lifecycle.checkDependencies') })[1]!,
  );
  await waitFor(() => {
    expect(importDraft.hasAttribute('disabled')).toBe(false);
  });
  fireEvent.click(importDraft);
  expect(await screen.findByRole('link', { name: 'Synthetic imported draft' })).toBeTruthy();
  const request = f.requests.find((r) => r.path.endsWith('dryRun=false'))!;
  expect(request.body).toEqual({
    package: pkg,
    integrationMappings: { 'source-key': { key: 'target-key', version: 4 } },
    secretMappings: { [tenantId]: campaignId },
  });
  expect(new Headers(request.init?.headers).get('x-csrf-token')).toBe('synthetic-csrf-only');
});
it('prevents import while required dependencies are missing', async () => {
  const f = await setup({
    '/v1/script-packages/import?dryRun=true': {
      ...plan,
      dependencies: [{ ...plan.dependencies[0], missing: true, canCreate: false }],
    },
  });
  upload(f.label('lifecycle.packageFile'), JSON.stringify(pkg));
  const check = screen.getByRole('button', { name: f.label('lifecycle.checkDependencies') });
  await waitFor(() => {
    expect(check.hasAttribute('disabled')).toBe(false);
  });
  fireEvent.click(check);
  const button = await screen.findByRole('button', { name: f.label('lifecycle.importDraft') });
  expect(button.hasAttribute('disabled')).toBe(true);
  expect(screen.queryByRole('combobox', { name: /secret/i })).toBeNull();
});
it('rejects malformed and oversized package files without sending them', async () => {
  const f = await setup();
  upload(f.label('lifecycle.packageFile'), '{');
  expect(await screen.findByRole('alert')).toBeTruthy();
  fireEvent.change(screen.getByLabelText(f.label('lifecycle.packageFile')), {
    target: { files: [new NodeFile([new Uint8Array(10 * 1024 * 1024 + 1)], 'large.verbis')] },
  });
  expect(
    screen
      .getByRole('button', { name: f.label('lifecycle.checkDependencies') })
      .hasAttribute('disabled'),
  ).toBe(true);
  expect(f.requests.some((r) => r.method === 'POST')).toBe(false);
});
it('downloads only approved or published versions and revokes the Blob URL', async () => {
  const create = vi.fn(() => 'blob:synthetic'),
    revoke = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  const f = await setup();
  vi.stubGlobal(
    'URL',
    class extends URL {
      static override createObjectURL = create;
      static override revokeObjectURL = revoke;
    },
  );
  await choose(f.label('workspace.version'), 'v1');
  await choose(f.label('lifecycle.target'), 'prod');
  fireEvent.click(screen.getByRole('button', { name: f.label('lifecycle.export') }));
  await waitFor(() => {
    expect(create).toHaveBeenCalledOnce();
  });
  expect(f.requests.find((r) => r.path.endsWith('/export'))!.body).toEqual({
    items: [{ scriptId, versionNumber: 1 }],
    targetEnvironments: ['prod'],
  });
  await waitFor(
    () => {
      expect(revoke).toHaveBeenCalledWith('blob:synthetic');
    },
    { timeout: 1500 },
  );
});
it('reports dependency-check failures and permits retry', async () => {
  const f = await setup({
    '/v1/script-packages/import?dryRun=true': Response.json({}, { status: 503 }),
  });
  upload(f.label('lifecycle.packageFile'), JSON.stringify(pkg));
  const button = screen.getByRole('button', { name: f.label('lifecycle.checkDependencies') });
  await waitFor(() => {
    expect(button.hasAttribute('disabled')).toBe(false);
  });
  fireEvent.click(button);
  expect(await screen.findByRole('alert')).toBeTruthy();
  f.responses['/v1/script-packages/import?dryRun=true'] = plan;
  await waitFor(() => {
    expect(button.hasAttribute('disabled')).toBe(false);
  });
  fireEvent.click(button);
  expect(
    await screen.findByRole('button', { name: f.label('lifecycle.importDraft') }),
  ).toBeTruthy();
});
it('does not expose secret or integration metadata to unauthorized readers', async () => {
  const f = await mountDesigner(
    <PackagesPage />,
    {},
    {
      path: `/scripts/${scriptId}/packages`,
      route: '/scripts/:id/packages',
      ability: createAbility([]),
    },
  );
  expect(
    f.requests.every(
      (r) => !r.path.startsWith('/v1/secrets') && !r.path.startsWith('/v1/data-sources'),
    ),
  ).toBe(true);
  expect(
    screen
      .getByRole('button', { name: f.label('lifecycle.checkDependencies') })
      .hasAttribute('disabled'),
  ).toBe(true);
});
