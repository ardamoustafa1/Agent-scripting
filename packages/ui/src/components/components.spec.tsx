import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { type ReactNode } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { createI18n, type I18nInstance } from '@verbis/i18n';

import { UiProvider } from '../provider.js';

import { Button, IconButton } from './button.js';
import { DataTable } from './data-table.js';
import { Input, Textarea, Checkbox, Switch, Radio, Slider, TimePicker } from './fields.js';
import { Dialog } from './overlays.js';
import { Tree } from './tree.js';

let i18n: I18nInstance;
beforeAll(async () => {
  i18n = await createI18n('tr');
});
function mount(children: ReactNode) {
  return render(
    <UiProvider i18n={i18n} theme="light">
      {children}
    </UiProvider>,
  );
}

describe('controls', () => {
  it('loading buttons block duplicate submissions and retain their accessible name', async () => {
    const click = vi.fn();
    mount(
      <Button loading onClick={click}>
        Kaydet
      </Button>,
    );
    const button = screen.getByRole('button', { name: /Kaydet/ });
    expect(button.getAttribute('aria-busy')).toBe('true');
    await userEvent.click(button);
    expect(click).not.toHaveBeenCalled();
  });
  it('names icon buttons', () => {
    mount(
      <IconButton label="Ayarlar">
        <span>*</span>
      </IconButton>,
    );
    expect(screen.getByRole('button', { name: 'Ayarlar' })).toBeTruthy();
  });
  it('associates field labels, hints and error descriptions', () => {
    mount(
      <>
        <Input label="E-posta" hint="İş adresiniz" error="Geçersiz adres" />
        <Textarea label="Not" />
        <TimePicker label="Saat" />
      </>,
    );
    const input = screen.getByLabelText('E-posta');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')?.split(' ')).toHaveLength(2);
    expect(screen.getByLabelText('Not').tagName).toBe('TEXTAREA');
    expect(screen.getByLabelText('Saat').getAttribute('type')).toBe('time');
  });
  it('checkbox and switch support keyboard activation', async () => {
    const change = vi.fn();
    mount(
      <>
        <Checkbox label="Onayla" checked={false} onCheckedChange={change} />
        <Switch label="Bildirimler" checked={false} onCheckedChange={change} />
      </>,
    );
    screen.getByRole('checkbox').focus();
    await userEvent.keyboard(' ');
    expect(change).toHaveBeenCalledWith(true);
    screen.getByRole('switch').focus();
    await userEvent.keyboard(' ');
    expect(change).toHaveBeenCalledTimes(2);
  });
  it('names radio groups and range thumbs', () => {
    mount(
      <>
        <Radio
          label="Rol"
          value="agent"
          onValueChange={vi.fn()}
          options={[{ value: 'agent', label: 'Temsilci' }]}
        />
        <Slider
          label="Aralık"
          thumbLabels={['Başlangıç', 'Bitiş']}
          value={[10, 80]}
          onValueChange={vi.fn()}
        />
      </>,
    );
    expect(screen.getByRole('radiogroup', { name: 'Rol' })).toBeTruthy();
    expect(screen.getByRole('slider', { name: 'Başlangıç' })).toBeTruthy();
    expect(screen.getByRole('slider', { name: 'Bitiş' })).toBeTruthy();
  });
});
describe('tree keyboard navigation', () => {
  it('skips disabled nodes, selects with Enter and collapses with ArrowLeft', async () => {
    const select = vi.fn();
    mount(
      <Tree
        label="Outline"
        nodes={[
          {
            id: 'root',
            label: 'Root',
            children: [
              { id: 'disabled', label: 'Disabled', disabled: true },
              { id: 'child', label: 'Child' },
            ],
          },
        ]}
        defaultExpanded={['root']}
        onSelect={select}
      />,
    );
    const root = screen.getByRole('treeitem', { name: 'Root' });
    root.focus();
    await userEvent.keyboard('{ArrowDown}{Enter}');
    expect(document.activeElement?.textContent).toContain('Child');
    expect(select).toHaveBeenCalledWith('child');
    await userEvent.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(root.getAttribute('aria-expanded')).toBe('false');
  });
});
it('dialog closes with Escape and restores the trigger focus', async () => {
  mount(
    <main>
      <Dialog title="Ayarlar" description="Ekip tercihleri" trigger={<Button>Düzenle</Button>}>
        <Input label="Ad" />
      </Dialog>
    </main>,
  );
  const trigger = screen.getByRole('button', { name: 'Düzenle' });
  await userEvent.click(trigger);
  expect(screen.getByRole('dialog', { name: 'Ayarlar' })).toBeTruthy();
  const background = document.querySelector('main');
  await waitFor(() => {
    expect(background?.inert).toBe(true);
  });
  await userEvent.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(trigger);
  await waitFor(() => {
    expect(background?.inert).toBe(false);
  });
});
it('table filtering, sorting and keyboard resizing change the actual row model', async () => {
  mount(
    <DataTable
      virtualized={false}
      label="Üyeler"
      data={[
        { id: 'b', name: 'Zeynep' },
        { id: 'a', name: 'Arda' },
      ]}
      getRowId={(row) => row.id}
      columns={[{ id: 'name', header: 'Ad', accessor: (row) => row.name }]}
    />,
  );
  await userEvent.click(screen.getByRole('button', { name: 'Ad alanına göre sırala' }));
  expect(screen.getAllByRole('row')[1]?.textContent).toContain('Arda');
  fireEvent.change(screen.getByLabelText('Kayıtları filtrele'), { target: { value: 'Zeynep' } });
  expect(screen.getAllByRole('row')).toHaveLength(2);
  const resize = screen.getByRole('slider', { name: 'Ad kolonunu boyutlandır' });
  const initial = Number(resize.getAttribute('aria-valuenow'));
  fireEvent.keyDown(resize, { key: 'ArrowRight' });
  expect(resize.getAttribute('aria-valuenow')).toBe(String(initial + 16));
});
