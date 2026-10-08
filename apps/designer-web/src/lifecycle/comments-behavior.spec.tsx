import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { expect, it } from 'vitest';

import { mountDesigner } from '../fixtures.spec.helpers.js';
import { campaignId, scriptId, sessionFixture } from '../test-fixtures.js';

import { Comments } from './comments.js';
import { Notifications } from './notifications.js';

const path = `/v1/scripts/${scriptId}/versions/1/comments`;
const thread = {
  id: campaignId,
  nodeId: 'script',
  resolved: false,
  version: 4,
  messages: [
    {
      id: scriptId,
      author: `user:${sessionFixture.user.id}`,
      text: 'Synthetic comment',
      mentions: [sessionFixture.user.id, campaignId],
      createdAt: '2026-10-03T10:00:00Z',
    },
  ],
};
it('sends new comments and replies, resolves and reopens a versioned thread', async () => {
  const f = await mountDesigner(
    <Comments scriptId={scriptId} number={1} nodeId="other-node" focusedThreadId={campaignId} />,
    {
      [path]: [thread],
      [`${path}/${campaignId}/resolve`]: thread,
      [`${path}/${campaignId}/replies`]: thread,
      [`POST ${path}`]: thread,
      [`/v1/scripts/${scriptId}/versions/1/team-members`]: [
        { id: sessionFixture.user.id, name: 'Synthetic member' },
      ],
    },
  );
  await screen.findByText('Synthetic comment');
  expect(await screen.findByText('Synthetic member')).toBeTruthy();
  expect(screen.getByText(new RegExp(`@Synthetic member @${campaignId}`))).toBeTruthy();
  const change = (value: string) =>
    fireEvent.change(screen.getByLabelText(f.label('lifecycle.comment')), { target: { value } });
  change('Synthetic new comment');
  fireEvent.click(screen.getByRole('button', { name: f.label('lifecycle.sendComment') }));
  await waitFor(() => {
    expect(f.requests.some((r) => r.method === 'POST' && r.path === path)).toBe(true);
  });
  expect(f.requests.find((r) => r.method === 'POST')!.body).toEqual({
    text: 'Synthetic new comment',
    mentions: [],
    nodeId: 'script',
  });
  await waitFor(() => {
    expect(screen.getByLabelText<HTMLTextAreaElement>(f.label('lifecycle.comment')).value).toBe('');
  });
  fireEvent.click(screen.getByRole('button', { name: f.label('lifecycle.reply') }));
  fireEvent.click(screen.getByRole('button', { name: f.label('lifecycle.cancel') }));
  expect(screen.queryByRole('status')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: f.label('lifecycle.reply') }));
  change('Synthetic reply');
  fireEvent.click(screen.getByRole('button', { name: f.label('lifecycle.sendComment') }));
  await waitFor(() => {
    expect(f.requests.some((r) => r.path.endsWith('/replies'))).toBe(true);
  });
  expect(f.requests.find((r) => r.path.endsWith('/replies'))!.body).toEqual({
    text: 'Synthetic reply',
    mentions: [],
  });
  await waitFor(() => {
    expect(screen.queryByRole('status')).toBeNull();
  });
  f.responses[path] = [{ ...thread, resolved: true }];
  fireEvent.click(screen.getByRole('button', { name: f.label('lifecycle.resolve') }));
  await screen.findByRole('button', { name: f.label('lifecycle.reopen') });
  expect(f.requests.find((r) => r.path.endsWith('/resolve'))!.body).toEqual({
    version: 4,
    resolved: true,
  });
  fireEvent.click(screen.getByRole('button', { name: f.label('lifecycle.reopen') }));
  await waitFor(() => {
    expect(f.requests.filter((r) => r.path.endsWith('/resolve'))).toHaveLength(2);
  });
  expect(f.requests.filter((r) => r.path.endsWith('/resolve'))[1]!.body).toEqual({
    version: 4,
    resolved: false,
  });
});
it('retains unsent text after failure and renders anonymous authors safely', async () => {
  const f = await mountDesigner(<Comments scriptId={scriptId} number={1} nodeId="script" />, {
    [path]: [
      {
        ...thread,
        messages: [{ ...thread.messages[0], author: 'synthetic-anonymous', mentions: [] }],
      },
    ],
    [`POST ${path}`]: Response.json({ code: 'VERBIS_UNAVAILABLE' }, { status: 503 }),
  });
  expect(await screen.findByText('synthetic-anonymous')).toBeTruthy();
  const input = screen.getByLabelText(f.label('lifecycle.comment'));
  fireEvent.change(input, { target: { value: 'Keep this draft' } });
  fireEvent.click(screen.getByRole('button', { name: f.label('lifecycle.sendComment') }));
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect((input as HTMLTextAreaElement).value).toBe('Keep this draft');
});
it('reports comment loading errors', async () => {
  await mountDesigner(<Comments scriptId={scriptId} number={1} nodeId="script" />, {
    [path]: Response.json({}, { status: 500 }),
  });
  expect(await screen.findByRole('alert')).toBeTruthy();
});
it('links review and mention notifications to their release and focused thread', async () => {
  await mountDesigner(<Notifications />, {
    '/v1/authoring-notifications': [
      { id: 'review', scriptId, number: 2, kind: 'review', createdAt: 'synthetic' },
      {
        id: 'mention',
        scriptId,
        number: 1,
        kind: 'mention',
        threadId: campaignId,
        createdAt: 'synthetic',
      },
    ],
  });
  await screen.findByRole('link', { name: /v2/ });
  const links = screen.getAllByRole('link');
  expect(links.map((link) => link.getAttribute('href'))).toEqual([
    `/scripts/${scriptId}/versions/2/release`,
    `/scripts/${scriptId}/versions/1/release?thread=${campaignId}`,
  ]);
  expect(within(links[0]!).getByText(/review/i)).toBeTruthy();
});
it('shows empty and failed notification states', async () => {
  const f = await mountDesigner(<Notifications />, { '/v1/authoring-notifications': [] });
  expect(await screen.findByText(f.label('workspace.notificationsEmpty'))).toBeTruthy();
  f.responses['/v1/authoring-notifications'] = Response.json({}, { status: 500 });
  await f.client.invalidateQueries();
  expect(await screen.findByRole('alert')).toBeTruthy();
});
it('shows agent feedback from page roots in the script-wide view, localized and without text', async () => {
  const feedbackThread = {
    id: '01928f3a-0000-7000-8000-0000000000fb',
    nodeId: 'home-root',
    resolved: false,
    version: 1,
    messages: [
      {
        id: '01928f3a-0000-7000-8000-0000000000fc',
        author: 'user:01928f3a-0000-7000-8000-0000000000fd',
        text: '',
        mentions: [],
        createdAt: '2026-10-07T10:00:00Z',
        feedback: { reason: 'missingStep' },
      },
    ],
  };
  const f = await mountDesigner(<Comments scriptId={scriptId} number={1} nodeId="script" />, {
    [path]: [thread, feedbackThread],
    [`/v1/scripts/${scriptId}/versions/1/team-members`]: [],
  });
  expect(await screen.findByText(f.label('comments.feedbackReasons.missingStep'))).toBeTruthy();
  expect(screen.getByText(f.label('comments.agentFeedback'))).toBeTruthy();
  expect(screen.getByText('Synthetic comment')).toBeTruthy();
});
