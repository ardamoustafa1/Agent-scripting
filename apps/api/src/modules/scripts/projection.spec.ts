import { expect, it, vi } from 'vitest';

import { ScriptDocumentSchema } from '@verbis/script-schema';
import { minimalScript } from '@verbis/script-schema/fixtures';

import { projectDocument } from './projection.js';

import type { TransactionClient } from '../../infra/database/prisma.service.js';

it('projects all screen identifiers with one batch, preserving component ownership', async () => {
  const document = ScriptDocumentSchema.parse(minimalScript());
  document.pages.push({ ...structuredClone(document.pages[0]!), id: 'second', name: 'Second' });
  const screens = vi.fn().mockResolvedValue([
    { id: 'one', key: 'home' },
    { id: 'two', key: 'second' },
  ]);
  const components = vi
    .fn<(input: { data: { screenId: string }[] }) => Promise<{ count: number }>>()
    .mockResolvedValue({ count: 4 });
  const tx = {
    screen: { createManyAndReturn: screens },
    component: { createMany: components },
    flow: { createMany: vi.fn() },
    variable: { createMany: vi.fn() },
  };
  await projectDocument(
    tx as unknown as TransactionClient,
    { tenantId: 'tenant', scriptVersionId: 'version', actor: 'user:test' },
    document,
  );
  expect(screens).toHaveBeenCalledOnce();
  expect(
    components.mock.calls[0]?.[0].data.map((row: { screenId: string }) => row.screenId),
  ).toEqual(['one', 'one', 'two', 'two']);
});
