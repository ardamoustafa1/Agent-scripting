import { screen, within } from '@testing-library/react';
import { expect, it } from 'vitest';

import { ScriptDocumentSchema } from '@verbis/script-schema';
import { minimalScript } from '@verbis/script-schema/fixtures';

import { mountDesigner } from '../fixtures.spec.helpers.js';

import { DataMapView } from './data-map-view.js';

function doc(logged: boolean) {
  const input = minimalScript();
  return ScriptDocumentSchema.parse({
    ...input,
    variables: [
      { key: 'tckn', type: 'string', scope: 'session', classification: 'pii', persist: true },
      { key: 'pan', type: 'string', scope: 'session', classification: 'pci' },
    ],
    pages: [
      {
        ...input.pages[0],
        layout: {
          id: 'home-root',
          type: 'box',
          children: [
            { id: 'show', type: 'text', bindings: [{ prop: 'text', expression: 'vars.tckn' }] },
            {
              id: 'btn',
              type: 'button',
              props: { labelKey: 'common.next' },
              events: {
                onPress: logged
                  ? [
                      {
                        type: 'logEvent',
                        event: 'customer.seen',
                        data: { id: { $expr: 'vars.tckn' } },
                      },
                    ]
                  : [],
              },
            },
          ],
        },
      },
    ],
  });
}

it('lists sensitive fields with origin, destinations, storage and exposure risk', async () => {
  const f = await mountDesigner(<DataMapView document={doc(true)} />);
  const t = (key: string, options: Record<string, unknown> = {}) =>
    f.i18n.t(`designer.dataMap.${key}`, options);
  const table = screen.getByRole('table', { name: t('title') });
  const tckn = within(table).getByRole('row', { name: /tckn/ });
  expect(within(tckn).getByText(t('classes.pii'))).toBeTruthy();
  expect(within(tckn).getByText(t('destinations.screen'))).toBeTruthy();
  const log = within(tckn).getByText(t('destinations.log')).closest('li')!;
  expect(log.getAttribute('data-risky')).toBe('true');
  expect(within(log).getByText(t('risky'))).toBeTruthy();
  expect(within(tckn).getByText(t('yes'))).toBeTruthy();
  const pan = within(table).getByRole('row', { name: /pan/ });
  expect(within(pan).getByText(t('nowhere'))).toBeTruthy();
});

it('marks flows a release adds compared with its baseline', async () => {
  const f = await mountDesigner(<DataMapView document={doc(true)} baseline={doc(false)} />);
  const log = screen.getByText(f.i18n.t('designer.dataMap.destinations.log')).closest('li')!;
  expect(log.getAttribute('data-new')).toBe('true');
  const screenFlow = screen
    .getByText(f.i18n.t('designer.dataMap.destinations.screen'))
    .closest('li')!;
  expect(screenFlow.getAttribute('data-new')).toBe('false');
});

it('says so when a script handles no personal data', async () => {
  const f = await mountDesigner(
    <DataMapView document={ScriptDocumentSchema.parse(minimalScript())} />,
  );
  expect(screen.getByText(f.i18n.t('designer.dataMap.empty'))).toBeTruthy();
});
