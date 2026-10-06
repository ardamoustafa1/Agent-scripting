import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { expect, it } from 'vitest';

import { createAbility } from '@verbis/authz';

import { mountDesigner } from '../fixtures.spec.helpers.js';
import { scriptId } from '../test-fixtures.js';

import { RegressionPanel } from './regression-panel.js';

const base = `/v1/scripts/${scriptId}/versions/1`;
const report = {
  checksum: 'synthetic-checksum',
  version: 1,
  passed: true,
  checkedAt: '2026-10-03T10:00:00Z',
  results: [
    {
      id: 'synthetic-scenario',
      passed: true,
      durationMs: 12,
      assertions: [{ path: 'runtime.ended', passed: true }],
    },
  ],
};
it('blocks an empty legacy passed report and explains the scenario requirement', async () => {
  const f = await mountDesigner(
    <RegressionPanel scriptId={scriptId} number={1} state="approved" />,
    { [`${base}/regression`]: { ...report, results: [] } },
  );
  fireEvent.click(screen.getByRole('button', { name: f.label('preview.runScenarios') }));
  await screen.findByText(f.label('preview.scenariosRequired'));
  expect(
    screen.getByRole('button', { name: f.label('preview.publish') }).hasAttribute('disabled'),
  ).toBe(true);
});
it.each(['in_review', 'approved'])(
  'requires successful regression before %s lifecycle changes',
  async (state) => {
    const f = await mountDesigner(
      <RegressionPanel scriptId={scriptId} number={1} state={state} />,
      { [`${base}/regression`]: report },
    );
    const name = state === 'in_review' ? 'approve' : 'publish';
    const button = screen.getByRole('button', { name: f.label(`preview.${name}`) });
    expect(button.hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: f.label('preview.runScenarios') }));
    await screen.findByText(report.checksum);
    await waitFor(() => {
      expect(button.hasAttribute('disabled')).toBe(false);
    });
    if (state === 'in_review')
      fireEvent.change(screen.getByLabelText(f.label('preview.reviewComment')), {
        target: { value: 'Synthetic approval' },
      });
    fireEvent.click(button);
    await screen.findByText(f.label('preview.lifecycleDone'));
    expect(button.hasAttribute('disabled')).toBe(true);
    const request = f.requests.find(
      (r) => r.path === `${base}/${state === 'in_review' ? 'reviews' : 'publish'}`,
    )!;
    expect(request.method).toBe('POST');
    expect(request.body).toEqual(
      state === 'in_review' ? { decision: 'approved', comment: 'Synthetic approval' } : undefined,
    );
    expect(new Headers(request.init?.headers).get('x-csrf-token')).toBe('synthetic-csrf-only');
  },
);
it('keeps publishing disabled for failed assertions and displays report details', async () => {
  const failed = {
    ...report,
    passed: false,
    results: [
      {
        ...report.results[0],
        passed: false,
        code: 'VERBIS_TEST_FAILED',
        assertions: [{ path: 'vars.synthetic', passed: false }],
      },
    ],
  };
  const f = await mountDesigner(
    <RegressionPanel scriptId={scriptId} number={1} state="approved" />,
    { [`${base}/regression`]: failed },
  );
  fireEvent.click(screen.getByRole('button', { name: f.label('preview.runScenarios') }));
  await screen.findByText('vars.synthetic', { exact: false });
  expect(
    screen.getByRole('button', { name: f.label('preview.publish') }).hasAttribute('disabled'),
  ).toBe(true);
});
it('reports transport errors and permits retry', async () => {
  const f = await mountDesigner(<RegressionPanel scriptId={scriptId} number={1} state="draft" />, {
    [`${base}/regression`]: Response.json({}, { status: 500 }),
  });
  const button = screen.getByRole('button', { name: f.label('preview.runScenarios') });
  fireEvent.click(button);
  expect(await screen.findByRole('alert')).toBeTruthy();
  f.responses[`${base}/regression`] = report;
  await waitFor(() => {
    expect(button.hasAttribute('disabled')).toBe(false);
  });
  fireEvent.click(button);
  await screen.findByText(report.checksum);
  expect(screen.queryByRole('alert')).toBeNull();
});
it('blocks dirty documents and hides forbidden review/publish controls', async () => {
  const f = await mountDesigner(
    <RegressionPanel scriptId={scriptId} number={1} state="approved" dirty />,
    {},
    { ability: createAbility([]) },
  );
  expect(
    screen.getByRole('button', { name: f.label('preview.runScenarios') }).hasAttribute('disabled'),
  ).toBe(true);
  expect(screen.queryByRole('button', { name: f.label('preview.publish') })).toBeNull();
  expect(screen.getByText(f.label('preview.saveFirst'))).toBeTruthy();
  expect(f.requests).toHaveLength(0);
});

it('revokes a previous passing report when the next regression request fails', async () => {
  const f = await mountDesigner(
    <RegressionPanel scriptId={scriptId} number={1} state="approved" />,
    { [`${base}/regression`]: report },
  );
  const run = screen.getByRole('button', { name: f.label('preview.runScenarios') });
  fireEvent.click(run);
  await screen.findByText(report.checksum);
  await waitFor(() => {
    expect(
      screen.getByRole('button', { name: f.label('preview.publish') }).hasAttribute('disabled'),
    ).toBe(false);
  });
  f.responses[`${base}/regression`] = Response.json({}, { status: 500 });
  fireEvent.click(run);
  await screen.findByRole('alert');
  expect(
    screen.getByRole('button', { name: f.label('preview.publish') }).hasAttribute('disabled'),
  ).toBe(true);
  expect(screen.queryByText(report.checksum)).toBeNull();
});
it('does not authorize publication with a report for another document revision', async () => {
  const f = await mountDesigner(
    <RegressionPanel scriptId={scriptId} number={1} documentVersion={1} state="approved" />,
    { [`${base}/regression`]: { ...report, version: 2 } },
  );
  fireEvent.click(screen.getByRole('button', { name: f.label('preview.runScenarios') }));
  await screen.findByText(report.checksum);
  expect(
    screen.getByRole('button', { name: f.label('preview.publish') }).hasAttribute('disabled'),
  ).toBe(true);
});

it('invalidates passed regression after editing and saving, and isolates another script identity', async () => {
  let change: (value: { dirty: boolean; id: string; number: number }) => void = () => undefined;
  function Harness() {
    const [value, setValue] = useState({ dirty: false, id: scriptId, number: 1 });
    change = setValue;
    return (
      <RegressionPanel
        scriptId={value.id}
        number={value.number}
        state="approved"
        dirty={value.dirty}
      />
    );
  }
  const f = await mountDesigner(<Harness />, { [`${base}/regression`]: report });
  const run = () =>
    fireEvent.click(screen.getByRole('button', { name: f.label('preview.runScenarios') }));
  const publish = () => screen.getByRole('button', { name: f.label('preview.publish') });
  run();
  await screen.findByText(report.checksum);
  await waitFor(() => {
    expect(publish().hasAttribute('disabled')).toBe(false);
  });
  act(() => {
    change({ dirty: true, id: scriptId, number: 1 });
  });
  act(() => {
    change({ dirty: false, id: scriptId, number: 1 });
  });
  expect(publish().hasAttribute('disabled')).toBe(true);
  expect(screen.queryByText(report.checksum)).toBeNull();
  run();
  await screen.findByText(report.checksum);
  act(() => {
    change({ dirty: false, id: '01928f3a-0000-7000-8000-000000000010', number: 1 });
  });
  expect(publish().hasAttribute('disabled')).toBe(true);
  expect(screen.queryByText(report.checksum)).toBeNull();
});
it('ignores an old in-flight regression response after the document becomes dirty', async () => {
  let change: (value: boolean) => void = () => undefined;
  function Harness() {
    const [dirty, setDirty] = useState(false);
    change = setDirty;
    return <RegressionPanel scriptId={scriptId} number={1} state="approved" dirty={dirty} />;
  }
  const f = await mountDesigner(<Harness />);
  let resolve: (response: Response) => void = () => undefined;
  const pending = new Promise<Response>((done) => {
    resolve = done;
  });
  f.fetcher.mockImplementationOnce(() => pending);
  fireEvent.click(screen.getByRole('button', { name: f.label('preview.runScenarios') }));
  act(() => {
    change(true);
  });
  await act(async () => {
    resolve(Response.json(report));
    await pending;
  });
  act(() => {
    change(false);
  });
  expect(
    screen.getByRole('button', { name: f.label('preview.publish') }).hasAttribute('disabled'),
  ).toBe(true);
  expect(screen.queryByText(report.checksum)).toBeNull();
});

it('distinguishes release number from the saved document revision', async () => {
  const f = await mountDesigner(
    <RegressionPanel scriptId={scriptId} number={2} documentVersion={7} state="approved" />,
    { [`/v1/scripts/${scriptId}/versions/2/regression`]: { ...report, version: 7 } },
  );
  fireEvent.click(screen.getByRole('button', { name: f.label('preview.runScenarios') }));
  await screen.findByText(report.checksum);
  await waitFor(() => {
    expect(
      screen.getByRole('button', { name: f.label('preview.publish') }).hasAttribute('disabled'),
    ).toBe(false);
  });
});
