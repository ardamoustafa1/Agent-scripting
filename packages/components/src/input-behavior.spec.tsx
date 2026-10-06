import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { Runtime } from '@verbis/core-runtime';
import { createI18n, type I18nInstance } from '@verbis/i18n';
import { UiProvider } from '@verbis/ui';

import { InputComponent } from './inputs.js';
import { createFixtureRuntime, syntheticRendererProps } from './test-fixtures.js';

let i18n: I18nInstance;
const engines: Runtime[] = [];
beforeAll(async () => {
  i18n = await createI18n('tr');
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});
afterEach(() => {
  engines.splice(0).forEach((runtime) => {
    runtime.dispose();
  });
});
function mount(type: string, extra: Record<string, unknown> = {}) {
  const runtime = createFixtureRuntime(type);
  engines.push(runtime);
  const component = syntheticRendererProps(runtime, type),
    write = vi.fn();
  const view = render(
    <UiProvider i18n={i18n}>
      <InputComponent {...component} write={write} props={{ ...component.props, ...extra }} />
    </UiProvider>,
  );
  return { component, write, view };
}
describe('input value contracts', () => {
  it.each(['textInput', 'textArea', 'note', 'timePicker'])('writes %s edits as strings', (type) => {
    const f = mount(type);
    const input = document.querySelector<HTMLInputElement | HTMLTextAreaElement>('input,textarea')!;
    fireEvent.change(input, { target: { value: type === 'timePicker' ? '12:30' : 'new value' } });
    expect(f.write).toHaveBeenCalledWith('value', type === 'timePicker' ? '12:30' : 'new value');
  });
  it.each(['numberInput', 'currencyInput'])('writes finite %s values and null on clear', (type) => {
    const f = mount(type, { value: 1 });
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '12.5' } });
    expect(f.write).toHaveBeenLastCalledWith('value', 12.5);
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '' } });
    expect(f.write).toHaveBeenLastCalledWith('value', null);
  });
  it.each(['checkbox', 'toggle'])('writes %s changes as booleans', async (type) => {
    const f = mount(type);
    await userEvent.click(screen.getByRole(type === 'checkbox' ? 'checkbox' : 'switch'));
    expect(f.write).toHaveBeenCalledWith('value', true);
  });
  it('changes radio and rating selections through their labels', async () => {
    const f = mount('radioGroup');
    await userEvent.click(screen.getAllByRole('radio')[1]!);
    expect(f.write).toHaveBeenCalledWith('value', 'second');
    f.view.unmount();
    const rating = mount('rating');
    await userEvent.click(screen.getAllByRole('radio')[2]!);
    expect(rating.write).toHaveBeenCalledWith('value', 3);
  });
  it('adds and removes checkbox group values while retaining other selections', async () => {
    const f = mount('checkboxGroup', { value: ['first'] });
    await userEvent.click(screen.getAllByRole('checkbox')[1]!);
    expect(f.write).toHaveBeenLastCalledWith('value', ['first', 'second']);
    await userEvent.click(screen.getAllByRole('checkbox')[0]!);
    expect(f.write).toHaveBeenLastCalledWith('value', []);
  });
  it('edits each structured address key without losing existing data', () => {
    const f = mount('addressInput', { value: { city: 'Istanbul' } });
    const inputs = screen.getAllByRole('textbox');
    fireEvent.change(inputs[0]!, { target: { value: 'Synthetic street' } });
    expect(f.write).toHaveBeenCalledWith('value', { city: 'Istanbul', line: 'Synthetic street' });
    fireEvent.change(inputs[3]!, { target: { value: '34000' } });
    expect(f.write).toHaveBeenCalledWith('value', { city: 'Istanbul', postalCode: '34000' });
  });
  it('checks email and phone validators without exposing validation details', async () => {
    const f = mount('emailInput', { value: 'broken' });
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'broken' } });
    fireEvent.blur(screen.getByRole('textbox'));
    await waitFor(() => {
      expect(screen.getAllByRole('alert')[0]!.textContent).toContain(i18n.t('components.invalid'));
    });
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'safe@example.test' } });
    fireEvent.blur(screen.getByRole('textbox'));
    expect(f.write).toHaveBeenCalledWith('value', 'safe@example.test');
  });
  it('updates slider values with the keyboard', async () => {
    const f = mount('slider');
    const slider = screen.getByRole('slider');
    slider.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(f.write).toHaveBeenCalledWith('value', 1);
  });
  it.each(['select', 'multiSelect'])('writes %s choices', async (type) => {
    const f = mount(type);
    await userEvent.click(
      type === 'select'
        ? screen.getByRole('combobox')
        : screen.getByRole('button', { name: 'Alan' }),
    );
    await userEvent.click(
      await screen.findByRole(type === 'select' ? 'option' : 'checkbox', { name: 'Ayrıntılar' }),
    );
    expect(f.write).toHaveBeenCalledWith('value', type === 'select' ? 'second' : ['second']);
  });
});

it('writes selected calendar dates as local ISO dates without timezone shifts', async () => {
  const f = mount('datePicker', { value: '2026-10-10' });
  await userEvent.click(screen.getByRole('button'));
  const day = screen
    .getByRole('dialog')
    .querySelector<HTMLButtonElement>('[data-day="2026-10-15"] button');
  if (!day) throw new Error('Expected selected-month day');
  fireEvent.click(day);
  expect(f.write).toHaveBeenCalledWith('value', '2026-10-15');
});
it('stores masked digits rather than formatting characters and validates international phones', () => {
  const masked = mount('maskedInput', {
    mask: '(###) ### ## ##',
    value: '1234567890',
    placeholderKey: 'components.sample.title',
  });
  expect(screen.getByRole('textbox').getAttribute('value')).toBe('(123) 456 78 90');
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '(555) 222 11 00' } });
  expect(masked.write).toHaveBeenCalledWith('value', '5552221100');
  masked.view.unmount();
  mount('phoneInput', { country: 'international', value: '+12025550123' });
  fireEvent.blur(screen.getByRole('textbox'));
  expect(screen.queryByRole('alert')).toBeNull();
});
it('blocks edits to masked fields and preserves field error and hint associations', () => {
  const f = mount('textInput', { hintKey: 'components.sample.description' });
  f.view.unmount();
  f.component.runtime.store.set('runtime.mask.sample', true);
  f.component.runtime.store.set('runtime.errors.sample', ['components.invalid']);
  render(
    <UiProvider i18n={i18n}>
      <InputComponent
        {...f.component}
        props={{ ...f.component.props, hintKey: 'components.sample.description' }}
        write={f.write}
      />
    </UiProvider>,
  );
  const input = screen.getByRole('textbox');
  expect(input.getAttribute('disabled')).not.toBeNull();
  fireEvent.change(input, { target: { value: 'attempted' } });
  expect(f.write).not.toHaveBeenCalled();
  expect(screen.getAllByRole('alert')[0]?.textContent).toContain(i18n.t('components.invalid'));
});
