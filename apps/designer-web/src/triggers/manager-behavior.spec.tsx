import { fireEvent, screen, within } from '@testing-library/react';
import { expect, it } from 'vitest';

import { validateSemantics } from '@verbis/script-schema';
import { minimalScript } from '@verbis/script-schema/fixtures';

import { EditorStore } from '../editor/store.js';
import { mountDesigner } from '../fixtures.spec.helpers.js';

import { TriggerManager } from './manager.js';

async function choose(name: string, option: string) {
  fireEvent.click(screen.getByRole('combobox', { name }));
  fireEvent.click(await screen.findByRole('option', { name: option }));
}
const triggers = (store: EditorStore) => store.getSnapshot().document.triggers ?? [];

it('creates a trigger from the empty state with a hint in every locale', async () => {
  const store = new EditorStore(minimalScript());
  const f = await mountDesigner(<TriggerManager store={store} />);
  expect(screen.getByText(f.label('triggers.emptyTitle'))).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: f.label('triggers.add') }));
  expect(await screen.findByRole('combobox', { name: f.label('triggers.title') })).toBeTruthy();
  const [created] = triggers(store);
  expect(created?.name).toBe(f.i18n.t('designer.triggers.defaultName', { number: 1 }));
  const action = created?.actions[0];
  expect(action?.type).toBe('alert');
  const key = action?.type === 'alert' ? action.messageKey : '';
  const { messages } = store.getSnapshot().document.i18n;
  expect(messages['tr']?.[key]).toBe('');
  expect(messages['en']?.[key]).toBe('');
});

it('edits phrases line by line, writes the hint text and tries a sentence', async () => {
  const store = new EditorStore(minimalScript());
  const f = await mountDesigner(<TriggerManager store={store} />);
  fireEvent.click(screen.getByRole('button', { name: f.label('triggers.add') }));
  const tr = await screen.findByRole('textbox', {
    name: f.i18n.t('designer.triggers.phrases', { locale: 'TR' }),
  });
  fireEvent.change(tr, { target: { value: 'iptal etmek\n' } });
  // The half-typed new line survives; only real phrases reach the document.
  expect((tr as HTMLTextAreaElement).value).toBe('iptal etmek\n');
  expect(triggers(store)[0]?.phrases['tr']).toEqual(['iptal etmek']);
  fireEvent.change(
    screen.getByRole('textbox', { name: f.i18n.t('designer.triggers.message', { locale: 'TR' }) }),
    { target: { value: 'Önce sadakat indirimini önerin.' } },
  );
  const action = triggers(store)[0]?.actions[0];
  const key = action?.type === 'alert' ? action.messageKey : '';
  expect(store.getSnapshot().document.i18n.messages['tr']?.[key]).toBe(
    'Önce sadakat indirimini önerin.',
  );
  expect(store.getSnapshot().document.i18n.messages['en']?.[key]).toBe('');
  fireEvent.change(screen.getByRole('textbox', { name: f.label('triggers.trySentence') }), {
    target: { value: 'Aboneliğimi İPTAL ETMEK istiyorum' },
  });
  const status = screen.getAllByRole('status').find((node) => node.closest('.tg-try'));
  expect(
    within(status!).getByText(
      f.i18n.t('designer.triggers.tryHit', {
        trigger: triggers(store)[0]?.name,
        phrase: 'iptal etmek',
      }),
    ),
  ).toBeTruthy();
  fireEvent.change(screen.getByRole('textbox', { name: f.label('triggers.trySentence') }), {
    target: { value: 'Faturam yüksek' },
  });
  expect(screen.getByText(f.label('triggers.tryNone'))).toBeTruthy();
  expect(
    validateSemantics(store.getSnapshot().document).filter((issue) => issue.severity === 'error'),
  ).toEqual([]);
});

it('switches an action to a step suggestion and cleans up its hint text', async () => {
  const store = new EditorStore(minimalScript());
  const f = await mountDesigner(<TriggerManager store={store} />);
  fireEvent.click(screen.getByRole('button', { name: f.label('triggers.add') }));
  await screen.findByRole('combobox', { name: f.label('triggers.title') });
  const before = triggers(store)[0]?.actions[0];
  const key = before?.type === 'alert' ? before.messageKey : '';
  await choose(
    f.i18n.t('designer.triggers.actionType', { number: 1 }),
    f.label('triggers.types.suggestPage'),
  );
  expect(triggers(store)[0]?.actions).toEqual([{ type: 'suggestPage', pageId: 'home' }]);
  expect(key in (store.getSnapshot().document.i18n.messages['tr'] ?? {})).toBe(false);
  expect(screen.getByRole('combobox', { name: f.label('triggers.page') })).toBeTruthy();
});

it('adds and removes actions within the limit and deletes the trigger with its texts', async () => {
  const store = new EditorStore(minimalScript());
  const f = await mountDesigner(<TriggerManager store={store} />);
  fireEvent.click(screen.getByRole('button', { name: f.label('triggers.add') }));
  const add = await screen.findByRole('button', { name: f.label('triggers.addAction') });
  fireEvent.click(add);
  fireEvent.click(add);
  expect(triggers(store)[0]?.actions).toHaveLength(3);
  expect(add.hasAttribute('disabled')).toBe(true);
  fireEvent.click(
    screen.getByRole('button', {
      name: f.i18n.t('designer.triggers.removeAction', { number: 3 }),
    }),
  );
  expect(triggers(store)[0]?.actions).toHaveLength(2);
  fireEvent.click(screen.getByRole('button', { name: f.label('triggers.remove') }));
  expect(triggers(store)).toEqual([]);
  const tr = store.getSnapshot().document.i18n.messages['tr'] ?? {};
  expect(Object.keys(tr).some((key) => key.startsWith('triggers.'))).toBe(false);
  expect(await screen.findByText(f.label('triggers.emptyTitle'))).toBeTruthy();
});

it('is read-only for a published version', async () => {
  const doc = minimalScript();
  doc.triggers = [
    {
      id: 'trigger-a',
      name: 'Cancel',
      phrases: { tr: ['iptal'] },
      actions: [{ type: 'suggestPage', pageId: 'home' }],
    },
  ];
  const store = new EditorStore(doc);
  const f = await mountDesigner(<TriggerManager store={store} readOnly />);
  expect(
    screen.getByRole('button', { name: f.label('triggers.add') }).hasAttribute('disabled'),
  ).toBe(true);
  const name = screen.getByRole('textbox', { name: f.label('triggers.name') });
  expect(name.closest('fieldset')?.disabled).toBe(true);
});

it('suggests a knowledge base article picked by search (ADR-0057)', async () => {
  const store = new EditorStore(minimalScript());
  const f = await mountDesigner(<TriggerManager store={store} />, {
    '/v1/knowledge-articles/search?q=refund&limit=10': {
      results: [
        {
          key: 'refund-policy',
          title: 'Refund policy',
          snippet: 'Refunds within 14 days.',
          tags: [],
          locale: 'en',
          status: 'published',
          updatedAt: '2026-10-22T10:00:00.000Z',
        },
      ],
    },
  });
  fireEvent.click(screen.getByRole('button', { name: f.label('triggers.add') }));
  await choose(
    f.i18n.t('designer.triggers.actionType', { number: 1 }),
    f.label('triggers.types.suggestArticle'),
  );
  fireEvent.change(screen.getByRole('searchbox', { name: f.label('knowledge.picker.search') }), {
    target: { value: 'refund' },
  });
  fireEvent.click(await screen.findByRole('button', { name: 'Add “Refund policy”' }));
  expect(triggers(store)[0]?.actions).toEqual([
    { type: 'suggestArticle', articleKey: 'refund-policy' },
  ]);
  // The hint text of the replaced alert action is cleaned up with it.
  expect(
    Object.keys(store.getSnapshot().document.i18n.messages['tr'] ?? {}).some((key) =>
      key.startsWith('triggers.'),
    ),
  ).toBe(false);
});
