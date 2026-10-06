import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AppShell } from './app-shell.js';
import { SelectField } from './select-field.js';
import { StatusBadge } from './status-badge.js';
import { applyTheme, readStoredTheme, useTheme } from './theme.js';

describe('AppShell', () => {
  it('renders landmarks and a skip link targeting main', () => {
    render(
      <AppShell productName="Verbis" appName="Agent" skipLinkLabel="Skip" actions={<span>x</span>}>
        <p>content</p>
      </AppShell>,
    );
    expect(screen.getByRole('banner')).toBeTruthy();
    expect(screen.getByRole('main').id).toBe('main-content');
    expect(screen.getByRole('link', { name: 'Skip' }).getAttribute('href')).toBe('#main-content');
    expect(screen.getByRole('link', { name: 'Skip' }).getAttribute('tabindex')).toBe('0');
  });

  it('omits the actions region when no actions are given', () => {
    const { container } = render(
      <AppShell productName="Verbis" appName="Agent" skipLinkLabel="Skip">
        <p>content</p>
      </AppShell>,
    );
    expect(container.querySelector('.vb-shell__actions')).toBeNull();
  });
});

describe('SelectField', () => {
  it('is labelled and reports changes', () => {
    const onChange = vi.fn();
    render(
      <SelectField
        label="Theme"
        value="light"
        options={[
          { value: 'light', label: 'Light' },
          { value: 'dark', label: 'Dark' },
        ]}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByLabelText('Theme'), { target: { value: 'dark' } });
    expect(onChange).toHaveBeenCalledWith('dark');
  });
});

describe('StatusBadge', () => {
  it('conveys status in text, not only color', () => {
    render(<StatusBadge status="down" label="API" statusText="Unavailable" />);
    expect(screen.getByRole('status').textContent).toContain('API: Unavailable');
  });
});

describe('theme', () => {
  it('reads stored theme defensively', () => {
    expect(readStoredTheme({ getItem: () => 'dark' })).toBe('dark');
    expect(readStoredTheme({ getItem: () => 'neon' })).toBe('light');
    expect(readStoredTheme(undefined)).toBe('light');
    expect(readStoredTheme({ getItem: () => null })).toBe('light');
    expect(readStoredTheme({ getItem: () => 'system' })).toBe('system');
    expect(
      readStoredTheme({
        getItem: () => {
          throw new Error('blocked');
        },
      }),
    ).toBe('light');
  });

  it('applies and clears data-theme', () => {
    const root = document.createElement('html');
    applyTheme('dark', root);
    expect(root.dataset['theme']).toBe('dark');
    applyTheme('system', root);
    expect(root.dataset['theme']).toBeUndefined();
  });

  it('useTheme persists and applies the selection', () => {
    const { result } = renderHook(() => useTheme());
    act(() => {
      result.current[1]('light');
    });
    expect(result.current[0]).toBe('light');
    expect(document.documentElement.dataset['theme']).toBe('light');
    expect(window.localStorage.getItem('verbis.theme')).toBe('light');
  });
});
