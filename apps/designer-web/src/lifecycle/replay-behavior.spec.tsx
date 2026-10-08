import { fireEvent, screen } from '@testing-library/react';
import { expect, it } from 'vitest';

import { mountDesigner } from '../fixtures.spec.helpers.js';
import { scriptId } from '../test-fixtures.js';

import ReplayPage, { formatOffset } from './replay.js';

const versionId = '01928f3a-0000-7000-8000-0000000000b1';
const sessionId = '01928f3a-0000-7000-8000-0000000000b2';
const replay = {
  sessionId,
  scriptId,
  versionNumber: 1,
  state: 'completed',
  startedAt: '2026-10-07T10:00:00.000Z',
  durationMs: 75_000,
  steps: [
    { seq: 1, atMs: 0, kind: 'page', pageId: 'welcome', pageName: 'Welcome' },
    { seq: 2, atMs: 4000, kind: 'field', variable: 'segment', value: '[REDACTED]' },
    { seq: 3, atMs: 70_000, kind: 'state', from: 'active', to: 'completed' },
  ],
  pages: [{ pageId: 'welcome', name: 'Welcome', visits: 1, dwellMs: 70_000 }],
  unreached: [{ id: 'wrap', name: 'Wrap-up' }],
  truncated: true,
};
const routes = {
  [`/v1/scripts/${scriptId}/versions/1`]: { id: versionId },
  [`/v1/sessions?scriptVersionId=${versionId}&limit=50`]: {
    data: [{ id: sessionId, state: 'completed', startedAt: '2026-10-07T10:00:00.000Z' }],
  },
  [`/v1/sessions/${sessionId}/replay`]: replay,
};

it('formats offsets as m:ss and h:mm:ss', () => {
  expect(formatOffset(0)).toBe('0:00');
  expect(formatOffset(75_000)).toBe('1:15');
  expect(formatOffset(3_725_000)).toBe('1:02:05');
  expect(formatOffset(-5)).toBe('0:00');
});

it('lists the sessions of the version, then shows the path, dwell, unreached pages and redaction', async () => {
  const f = await mountDesigner(<ReplayPage />, routes, {
    path: `/scripts/${scriptId}/versions/1/replay`,
    route: '/scripts/:id/versions/:number/replay',
  });
  expect(await screen.findByText(f.label('replay.watermark'))).toBeTruthy();
  fireEvent.click(await screen.findByRole('combobox', { name: f.label('replay.session') }));
  fireEvent.click(await screen.findByRole('option'));
  expect(await screen.findByText(/Entered page Welcome|Welcome sayfasına/)).toBeTruthy();
  expect(screen.getAllByText('1:10').length).toBeGreaterThan(0);
  expect(screen.getByText(/\[REDACTED\]/)).toBeTruthy();
  expect(screen.getByText(/Wrap-up/)).toBeTruthy();
  expect(screen.getByText(f.label('replay.truncated'))).toBeTruthy();
  expect(f.requests.some((r) => r.path === `/v1/sessions/${sessionId}/replay`)).toBe(true);
});

it('says so when no session ran on the version', async () => {
  const f = await mountDesigner(
    <ReplayPage />,
    {
      [`/v1/scripts/${scriptId}/versions/1`]: { id: versionId },
      [`/v1/sessions?scriptVersionId=${versionId}&limit=50`]: { data: [] },
    },
    {
      path: `/scripts/${scriptId}/versions/1/replay`,
      route: '/scripts/:id/versions/:number/replay',
    },
  );
  expect(await screen.findByText(f.label('replay.empty'))).toBeTruthy();
});
