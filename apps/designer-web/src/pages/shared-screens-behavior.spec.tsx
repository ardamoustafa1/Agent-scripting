import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { expect, it } from 'vitest';

import { createAbility } from '@verbis/authz';

import { editorFixture } from '../editor/fixtures.js';
import { mountDesigner } from '../fixtures.spec.helpers.js';
import { campaignId, scriptId, scriptFixture, sessionFixture } from '../test-fixtures.js';

import SharedScreens from './shared-screens.js';

async function select(label: string, name: string) {
  fireEvent.click(screen.getByRole('combobox', { name: label }));
  fireEvent.click(await screen.findByRole('option', { name }));
}
it.each([false, true])(
  'creates or versions a shared screen from an authorized page: versioning=%s',
  async (versioning) => {
    const doc = editorFixture();
    const f = await mountDesigner(<SharedScreens />, {
      '/v1/shared-screens': [
        {
          id: campaignId,
          key: 'shared',
          name: 'Shared screen',
          latest: { number: 1, semver: '1.0.0' },
        },
      ],
      '/v1/scripts?limit=100': { data: [scriptFixture], page: { nextCursor: null } },
      [`/v1/scripts/${scriptId}/versions?limit=100&sort=-number`]: {
        data: [{ ...doc, number: 1, createdAt: 'synthetic' }],
        page: { nextCursor: null },
      },
      [`/v1/scripts/${scriptId}/versions/1`]: doc,
      'POST /v1/shared-screens': { id: campaignId },
      [`POST /v1/shared-screens/${campaignId}/versions`]: { version: { number: 2 } },
    });
    fireEvent.click(
      await screen.findByRole('button', {
        name: f.label(versioning ? 'screens.publish' : 'screens.create'),
      }),
    );
    const dialog = await screen.findByRole('dialog');
    if (!versioning) {
      fireEvent.change(within(dialog).getByLabelText(f.label('screens.key')), {
        target: { value: 'synthetic-screen' },
      });
      fireEvent.change(within(dialog).getByLabelText(f.label('workspace.name')), {
        target: { value: 'Synthetic screen' },
      });
    }
    await select(f.label('screens.source'), scriptFixture.name);
    await select(f.label('screens.sourceVersion'), 'v1');
    await select(f.label('preview.page'), doc.document.pages[0]!.name);
    fireEvent.change(within(dialog).getByLabelText(f.label('lifecycle.semver')), {
      target: { value: versioning ? '1.1.0' : '1.0.0' },
    });
    fireEvent.change(within(dialog).getByLabelText(f.label('lifecycle.changeNote')), {
      target: { value: 'Synthetic reusable page' },
    });
    fireEvent.submit(dialog.querySelector('form')!);
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    const post = f.requests.find((r) => r.method === 'POST')!;
    expect(post.path).toBe(
      versioning ? `/v1/shared-screens/${campaignId}/versions` : '/v1/shared-screens',
    );
    expect(post.body).toMatchObject({
      fragment: {
        pages: [doc.document.pages[0]],
        variables: doc.document.variables,
        dataSources: doc.document.dataSources,
        messages: doc.document.i18n.messages,
      },
    });
    expect(new Headers(post.init?.headers).get('x-csrf-token')).toBe(sessionFixture.csrfToken);
  },
);
it('hides creation and publication controls from readers', async () => {
  const f = await mountDesigner(
    <SharedScreens />,
    { '/v1/shared-screens': [] },
    { ability: createAbility([{ action: 'read', subject: 'Screen' }]) },
  );
  await screen.findByText(f.label('screens.empty'));
  expect(screen.queryByRole('button', { name: f.label('screens.create') })).toBeNull();
});
