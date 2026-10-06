import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';

import { createI18n } from '@verbis/i18n';

import { UiProvider } from '../provider.js';

import { AccessLayout } from './access-layout.js';
import { ScriptAtlas } from './script-atlas.js';

it('shares branding and switches language without replacing application form state', async () => {
  const i18n = await createI18n('en');
  render(
    <UiProvider i18n={i18n}>
      <AccessLayout appName="Admin">
        <label>
          Email
          <input defaultValue="user@example.test" />
        </label>
      </AccessLayout>
    </UiProvider>,
  );
  expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('Every conversation.');
  fireEvent.click(screen.getByRole('button', { name: 'Türkçeye geç' }));
  expect(await screen.findByText('Her görüşme.')).toBeTruthy();
  expect(screen.getByLabelText('Email')).toHaveProperty('value', 'user@example.test');
  fireEvent.click(screen.getByRole('button', { name: 'Switch to English' }));
  expect(await screen.findByText('Every conversation.')).toBeTruthy();
});
it('pauses and resumes the shared atlas while keeping authentication mounted', async () => {
  const i18n = await createI18n('en');
  render(
    <UiProvider i18n={i18n}>
      <AccessLayout appName="Agent">
        <input aria-label="Tenant" defaultValue="tenant" />
      </AccessLayout>
    </UiProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Pause animation' }));
  expect(screen.getByRole('main').getAttribute('data-motion')).toBe('paused');
  expect(document.querySelector('.vb-script-atlas')?.getAttribute('data-motion')).toBe('paused');
  fireEvent.click(screen.getByRole('button', { name: 'Play animation' }));
  expect(screen.getByRole('main').getAttribute('data-motion')).toBe('running');
  expect(screen.getByLabelText('Tenant')).toHaveProperty('value', 'tenant');
});
it('gives simultaneous vector atlases independent gradient references', async () => {
  const i18n = await createI18n('en');
  const { container } = render(
    <UiProvider i18n={i18n}>
      <ScriptAtlas paused={false} />
      <ScriptAtlas paused />
    </UiProvider>,
  );
  const ids = [...container.querySelectorAll('linearGradient,radialGradient')].map((el) => el.id);
  expect(new Set(ids).size).toBe(4);
  for (const el of container.querySelectorAll('[stroke^="url"],[fill^="url"]')) {
    const value = el.getAttribute('stroke')?.startsWith('url')
      ? el.getAttribute('stroke')
      : el.getAttribute('fill');
    expect(ids).toContain(value?.slice(5, -1));
  }
});
