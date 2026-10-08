import { screen, within } from '@testing-library/react';
import { expect, it } from 'vitest';

import { ScriptDocumentSchema, TestScenarioSchema } from '@verbis/script-schema';
import { minimalScript } from '@verbis/script-schema/fixtures';

import { mountDesigner } from '../fixtures.spec.helpers.js';

import { ReleaseRisk } from './release-risk.js';

const scriptId = '01928f3a-0000-7000-8000-0000000000aa';
const campaign = (n: number) => `01928f3a-0000-7000-8000-00000000000${String(n)}`;

function doc(withScenario: boolean) {
  const document = ScriptDocumentSchema.parse(minimalScript());
  if (withScenario)
    document.testScenarios = [
      TestScenarioSchema.parse({
        id: 'reachesHome',
        name: 'Reaches home',
        synthetic: true,
        context: {},
        steps: [{ type: 'event', node: 'btn-next', event: 'onPress' }],
        expected: { ended: true },
      }),
    ];
  return document;
}

it('rates an untested release, measures coverage and shows its reach', async () => {
  const f = await mountDesigner(
    <ReleaseRisk
      scriptId={scriptId}
      queryKey={['risk', 1]}
      document={doc(false)}
      baseline={undefined}
      patch={[]}
    />,
    {
      [`/v1/assignments?scriptId=${scriptId}&limit=100`]: {
        data: [
          { campaignId: campaign(1) },
          { campaignId: campaign(1) },
          { campaignId: campaign(2) },
        ],
        page: { nextCursor: null },
      },
    },
  );
  const t = (key: string, options: Record<string, unknown> = {}) =>
    f.i18n.t(`designer.risk.${key}`, options);
  const card = screen.getByRole('article', { name: t('title') });
  expect(within(card).getByText(t('levels.medium'))).toBeTruthy();
  expect(within(card).getByText(t('factors.noTests'))).toBeTruthy();
  await within(card).findByText(t('impactValue', { assignments: 3, campaigns: 2 }));
});

it('rates a tested, unchanged release low and says when reach is not visible', async () => {
  const f = await mountDesigner(
    <ReleaseRisk
      scriptId={scriptId}
      queryKey={['risk', 2]}
      document={doc(true)}
      baseline={doc(true)}
      patch={[]}
    />,
    {
      [`/v1/assignments?scriptId=${scriptId}&limit=100`]: Response.json(
        { code: 'VERBIS_AUTHZ_FORBIDDEN' },
        { status: 403 },
      ),
    },
  );
  const t = (key: string, options: Record<string, unknown> = {}) =>
    f.i18n.t(`designer.risk.${key}`, options);
  const card = screen.getByRole('article', { name: t('title') });
  await within(card).findByText(t('coverageValue', { percent: 100, covered: 1, total: 1 }));
  expect(within(card).getByText(t('levels.low'))).toBeTruthy();
  expect(within(card).getByText(t('none'))).toBeTruthy();
  await within(card).findByText(t('impactUnknown'));
});
