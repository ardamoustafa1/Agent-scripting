import { act, fireEvent, screen } from '@testing-library/react';
import { expect, it } from 'vitest';

import { mountDesigner } from '../fixtures.spec.helpers.js';

import Login from './login.js';

const provider = {
  tenant: 'first',
  providers: [{ id: 'first-idp', displayName: 'First SSO', protocol: 'oidc' }],
};

it('clears discovered providers when the email changes', async () => {
  await mountDesigner(<Login />, { '/auth/discover': provider });
  fireEvent.change(screen.getByLabelText('Work email'), { target: { value: 'user@first.test' } });
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  await screen.findByRole('link', { name: 'First SSO' });
  fireEvent.change(screen.getByLabelText('Work email'), { target: { value: 'user@second.test' } });
  expect(screen.queryByRole('link', { name: 'First SSO' })).toBeNull();
});

it('ignores a pending discovery response after the email changes', async () => {
  const f = await mountDesigner(<Login />);
  let resolve!: (response: Response) => void;
  f.fetcher.mockImplementationOnce(
    () =>
      new Promise<Response>((done) => {
        resolve = done;
      }),
  );
  fireEvent.change(screen.getByLabelText('Work email'), { target: { value: 'user@first.test' } });
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  await act(async () => {
    await Promise.resolve();
  });
  fireEvent.change(screen.getByLabelText('Work email'), { target: { value: 'user@second.test' } });
  await act(async () => {
    await Promise.resolve();
    resolve(Response.json(provider));
  });
  expect(screen.queryByRole('link', { name: 'First SSO' })).toBeNull();
});

it('lets the user pause and resume the decorative animation', async () => {
  await mountDesigner(<Login />);
  fireEvent.click(screen.getByRole('button', { name: 'Pause animation' }));
  expect(screen.getByRole('main').getAttribute('data-motion')).toBe('paused');
  fireEvent.click(screen.getByRole('button', { name: 'Play animation' }));
  expect(screen.getByRole('main').getAttribute('data-motion')).toBe('running');
});

it('switches the entire entry experience to Turkish without losing the email', async () => {
  await mountDesigner(<Login />);
  fireEvent.change(screen.getByLabelText('Work email'), { target: { value: 'user@first.test' } });
  fireEvent.click(screen.getByRole('button', { name: 'Türkçeye geç' }));
  expect(await screen.findByLabelText('İş e-postası')).toHaveProperty('value', 'user@first.test');
  expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('Her görüşme.');
  fireEvent.click(screen.getByRole('button', { name: 'Switch to English' }));
  expect(await screen.findByLabelText('Work email')).toHaveProperty('value', 'user@first.test');
});
