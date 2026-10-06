import { fireEvent, screen, waitFor } from '@testing-library/react';
import { expect, it } from 'vitest';

import { createAbility } from '@verbis/authz';

import { DeadLettersSection } from './dead-letters-section.js';
import { mountAdmin } from './fixtures.spec.helpers.js';

const stats = { durable: true, persisted: 7, persistFailures: 1 };

it('shows DLQ counters and replays only after confirmation, with a bounded limit and CSRF', async () => {
  const f = await mountAdmin(<DeadLettersSection />, {
    '/v1/connector-dead-letters': stats,
    '/v1/connector-dead-letters/replay': { replayed: 4 },
  });
  await screen.findByText('7', {}, { timeout: 5000 });
  fireEvent.change(screen.getByLabelText(f.label('deadLettersReplayLimit')), {
    target: { value: '25' },
  });
  fireEvent.click(screen.getByRole('button', { name: f.label('deadLettersReplay') }));
  expect(f.requests.some((r) => r.method === 'POST')).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: f.label('confirm') }));
  await waitFor(() => {
    expect(f.requests.some((r) => r.method === 'POST')).toBe(true);
  });
  const post = f.requests.find((r) => r.method === 'POST')!;
  expect(post.path).toBe('/v1/connector-dead-letters/replay');
  expect(post.body).toEqual({ limit: 25 });
  expect(post.init?.headers).toMatchObject({ 'x-csrf-token': 'synthetic-csrf' });
  await screen.findByText(/4/, { selector: '[role="status"]' }, { timeout: 5000 });
});

it('hides the replay action from principals that may only read connectors', async () => {
  const f = await mountAdmin(
    <DeadLettersSection />,
    { '/v1/connector-dead-letters': stats },
    createAbility([{ action: 'read', subject: 'Connector' }]),
  );
  await screen.findByText('7', {}, { timeout: 5000 });
  expect(screen.queryByRole('button', { name: f.label('deadLettersReplay') })).toBeNull();
});

it('renders nothing for principals without connector access', async () => {
  const f = await mountAdmin(<DeadLettersSection />, {}, createAbility([]));
  expect(screen.queryByText(f.label('deadLetters'))).toBeNull();
});
