import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { useState, type ReactNode } from 'react';
import { beforeAll, expect, it, vi } from 'vitest';

import { createI18n, type I18nInstance } from '@verbis/i18n';

import { UiProvider, BrandLogo } from '../provider.js';

import { Button } from './button.js';
import { Combobox, MultiSelect } from './combobox.js';
import {
  CommandPalette,
  commandSearchText,
  rankCommands,
  scoreCommand,
} from './command-palette.js';
import { Tabs, Accordion, Toolbar, ToolbarButton } from './disclosure.js';
import { Toast, ToastProvider, Avatar, Alert, Badge, Progress, Skeleton } from './feedback.js';
import { Breadcrumb, EmptyState, Kbd, SplitPane } from './layout.js';
import { DropdownMenu, ContextMenu } from './menus.js';
import { Popover, Sheet, Tooltip } from './overlays.js';
import { Select } from './select.js';

let i18n: I18nInstance;
beforeAll(async () => {
  i18n = await createI18n('tr');
});
const mount = (children: ReactNode) =>
  render(
    <UiProvider
      i18n={i18n}
      theme="dark"
      direction="rtl"
      brand={{ name: 'Tenant', primaryColor: '#ffff00' }}
    >
      {children}
    </UiProvider>,
  );
const options = [
  { value: 'a', label: 'Arda' },
  { value: 'z', label: 'Zeynep' },
  { value: 'x', label: 'Disabled', disabled: true },
];

it('popover portals inherit tenant theme and can be dismissed with keyboard', async () => {
  mount(
    <Popover label="Bilgi" trigger={<Button>Aç</Button>}>
      Details
    </Popover>,
  );
  await userEvent.click(screen.getByRole('button', { name: 'Aç' }));
  expect(screen.getByRole('dialog').closest('.vb-theme')?.getAttribute('data-theme')).toBe('dark');
  await userEvent.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).toBeNull();
});
it('combobox filters labels and returns the original selected value', async () => {
  const selected = vi.fn();
  mount(<Combobox label="Üye" options={options} value="a" onValueChange={selected} />);
  await userEvent.click(screen.getByRole('button', { name: 'Üye' }));
  const search = screen.getByRole('combobox');
  await userEvent.type(search, 'Zeynep');
  await userEvent.keyboard('{Enter}');
  expect(selected).toHaveBeenCalledWith('z');
  expect(screen.queryByRole('combobox')).toBeNull();
});
it('multiselect retains selections when filtering and does not duplicate values', async () => {
  function Demo() {
    const [value, setValue] = useState(['a']);
    return <MultiSelect label="Üyeler" value={value} onValueChange={setValue} options={options} />;
  }
  mount(<Demo />);
  await userEvent.click(screen.getByRole('button', { name: 'Üyeler' }));
  await userEvent.click(screen.getByRole('checkbox', { name: 'Zeynep' }));
  await userEvent.type(screen.getByLabelText('Ara…'), 'Arda');
  expect(screen.getByRole('checkbox', { name: 'Arda' }).getAttribute('data-state')).toBe('checked');
  expect(screen.queryByRole('checkbox', { name: 'Zeynep' })).toBeNull();
});
it('select exposes a labeled trigger and respects disabled controls', () => {
  mount(<Select label="Üye" options={options} value="a" onValueChange={vi.fn()} disabled />);
  expect(screen.getByRole('combobox', { name: 'Üye' }).hasAttribute('disabled')).toBe(true);
});
it('tabs activate panels and accordion toggles its controlled disclosure', async () => {
  mount(
    <>
      <Tabs
        label="Alanlar"
        items={[
          { value: 'a', label: 'First', content: 'First content' },
          { value: 'b', label: 'Second', content: 'Second content' },
        ]}
      />
      <Accordion items={[{ value: 'details', title: 'Details', content: 'Expanded content' }]} />
    </>,
  );
  await userEvent.click(screen.getByRole('tab', { name: 'Second' }));
  expect(screen.getByRole('tabpanel').textContent).toBe('Second content');
  await userEvent.click(screen.getByRole('button', { name: 'Details' }));
  expect(screen.getByText('Expanded content')).toBeTruthy();
});
it('sheet has a named dialog, description and localized close action', async () => {
  mount(
    <Sheet title="Kampanya" description="Kampanya ayrıntıları" trigger={<Button>Open</Button>}>
      Content
    </Sheet>,
  );
  await userEvent.click(screen.getByRole('button', { name: 'Open' }));
  expect(screen.getByRole('dialog', { name: 'Kampanya' })).toBeTruthy();
  await userEvent.click(screen.getByRole('button', { name: 'Kapat' }));
  expect(screen.queryByRole('dialog')).toBeNull();
});
it('sheet restores focus to its trigger unless onCloseAutoFocus moves it elsewhere', async () => {
  const moveFocus = (event: Event) => {
    event.preventDefault();
    screen.getByRole('button', { name: 'Elsewhere' }).focus();
  };
  const { rerender } = mount(
    <>
      <Sheet title="Panel" description="Ayrıntılar" trigger={<Button>Open</Button>}>
        Content
      </Sheet>
      <Button>Elsewhere</Button>
    </>,
  );
  await userEvent.click(screen.getByRole('button', { name: 'Open' }));
  await userEvent.click(screen.getByRole('button', { name: 'Kapat' }));
  await waitFor(() => {
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Open' }));
  });
  rerender(
    <UiProvider i18n={i18n}>
      <Sheet
        title="Panel"
        description="Ayrıntılar"
        trigger={<Button>Open</Button>}
        onCloseAutoFocus={moveFocus}
      >
        Content
      </Sheet>
      <Button>Elsewhere</Button>
    </UiProvider>,
  );
  await userEvent.click(screen.getByRole('button', { name: 'Open' }));
  await userEvent.click(screen.getByRole('button', { name: 'Kapat' }));
  await waitFor(() => {
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Elsewhere' }));
  });
});
it('menus run actions and skip disabled actions', async () => {
  const choose = vi.fn();
  mount(
    <DropdownMenu
      label="Menü"
      trigger={<Button>Open</Button>}
      items={[
        { id: 'save', label: 'Kaydet', onSelect: choose },
        { id: 'disabled', label: 'Disabled', disabled: true, onSelect: choose },
      ]}
    />,
  );
  await userEvent.click(screen.getByRole('button', { name: 'Open' }));
  expect(
    screen.getByRole('menuitem', { name: 'Disabled' }).getAttribute('data-disabled'),
  ).not.toBeNull();
  await userEvent.click(screen.getByRole('menuitem', { name: 'Kaydet' }));
  expect(choose).toHaveBeenCalledOnce();
});
it('context menus open on Shift+F10 and select actions by keyboard', async () => {
  const choose = vi.fn();
  mount(
    <ContextMenu label="Actions" items={[{ id: 'save', label: 'Save', onSelect: choose }]}>
      Target
    </ContextMenu>,
  );
  screen.getByRole('button', { name: 'Actions' }).focus();
  await userEvent.keyboard('{Shift>}{F10}{/Shift}');
  expect(screen.getByRole('menu')).toBeTruthy();
  await userEvent.keyboard('{ArrowDown}{Enter}');
  expect(choose).toHaveBeenCalledOnce();
});
it('command palette runs actions and closes; shortcuts do not consume text input', async () => {
  const choose = vi.fn();
  function Demo() {
    const [open, setOpen] = useState(true);
    return (
      <CommandPalette
        open={open}
        onOpenChange={setOpen}
        items={[{ id: 'save', label: 'Kaydet', onSelect: choose }]}
      />
    );
  }
  mount(<Demo />);
  await waitFor(() => {
    expect(document.activeElement).toBe(screen.getByRole('combobox'));
  });
  await userEvent.type(screen.getByRole('combobox'), 'Kaydet');
  await userEvent.keyboard('{Enter}');
  expect(choose).toHaveBeenCalledOnce();
  expect(screen.queryByRole('dialog')).toBeNull();
});
it('command palette matches Turkish text without diacritics, keywords and recent commands', async () => {
  const health = vi.fn();
  const ran = vi.fn();
  const query = vi.fn();
  function Demo() {
    const [open, setOpen] = useState(true);
    return (
      <>
        <Button
          onClick={() => {
            setOpen(true);
          }}
        >
          Reopen
        </Button>
        <CommandPalette
          open={open}
          onOpenChange={setOpen}
          recent={['flow']}
          onItemRun={ran}
          onQueryChange={query}
          items={[
            { id: 'health', label: 'Sağlık panelini aç', onSelect: health },
            { id: 'flow', label: 'Akış', group: 'Mod', onSelect: vi.fn() },
            { id: 'node', label: 'Düğme', keywords: ['Karşılama sayfası'], onSelect: vi.fn() },
          ]}
        />
      </>
    );
  }
  mount(<Demo />);
  const input = await screen.findByRole('combobox');
  // Recent commands lead while the query is empty.
  expect(screen.getByRole('group', { name: 'Son kullanılanlar' })).toBeTruthy();
  await userEvent.type(input, 'saglik');
  expect(query).toHaveBeenLastCalledWith('saglik');
  expect(screen.queryByRole('group', { name: 'Son kullanılanlar' })).toBeNull();
  expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Sağlık panelini aç']);
  await userEvent.clear(input);
  await userEvent.type(input, 'karsilama');
  expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Düğme']);
  await userEvent.clear(input);
  await userEvent.type(input, 'saglik');
  await userEvent.keyboard('{Enter}');
  expect(health).toHaveBeenCalledOnce();
  expect(ran).toHaveBeenCalledWith('health');
  // Closing resets the query for the host as well.
  expect(query).toHaveBeenLastCalledWith('');
  await userEvent.click(screen.getByRole('button', { name: 'Reopen' }));
  expect((await screen.findByRole<HTMLInputElement>('combobox')).value).toBe('');
});
it('scoreCommand ranks prefixes above contained terms above subsequences', () => {
  expect(scoreCommand('Akışa git', '')).toBe(1);
  expect(scoreCommand('Akışa git', 'akisa')).toBe(1);
  expect(scoreCommand('Sayfaya git: Karşılama', 'karsi')).toBe(0.8);
  expect(scoreCommand('Bileşen ekle düğme', 'ekle dug')).toBe(0.6);
  expect(scoreCommand('Tam ekran', 'tmekr')).toBe(0.2);
  expect(scoreCommand('Tam ekran', 'zzz')).toBe(0);
  expect(commandSearchText(' İLERİ ')).toBe('ileri');
  // One or two characters never match loosely ("v-a-li-d-ation" is not "ad").
  expect(scoreCommand('Validation details', 'ad')).toBe(0);
});
it('rankCommands puts the top hit and its group first, keeping declared order without a query', () => {
  const noop = vi.fn();
  const items = [
    {
      id: 'health',
      label: 'Open script health',
      group: 'Script',
      keywords: ['Validation details'],
      onSelect: noop,
    },
    { id: 'keys', label: 'Keyboard shortcuts', group: 'Script', onSelect: noop },
    { id: 'add-box', label: 'Add Box', group: 'Insert', onSelect: noop },
    { id: 'go-add', label: 'Go to page: Address', group: 'Pages', onSelect: noop },
  ];
  expect(rankCommands(items, '').map((g) => [g.group, g.items.map((i) => i.id)])).toEqual([
    ['Script', ['health', 'keys']],
    ['Insert', ['add-box']],
    ['Pages', ['go-add']],
  ]);
  expect(rankCommands(items, 'ad').map((g) => [g.group, g.items.map((i) => i.id)])).toEqual([
    ['Insert', ['add-box']],
    ['Pages', ['go-add']],
  ]);
  expect(rankCommands(items, 'zzz')).toEqual([]);
});
it('toast can be explicitly dismissed without waiting for timers', async () => {
  const change = vi.fn();
  mount(
    <ToastProvider>
      <Toast
        open
        onOpenChange={change}
        title="Kaydedildi"
        description="Tercihler güncellendi"
        duration={30000}
      />
    </ToastProvider>,
  );
  expect(screen.getByText('Kaydedildi')).toBeTruthy();
  await userEvent.click(screen.getByRole('button', { name: 'Kapat' }));
  expect(change).toHaveBeenCalledWith(false);
});
it('feedback conveys information beyond color and clamps progress', () => {
  mount(
    <>
      <Alert tone="danger" title="Hata">
        Details
      </Alert>
      <Badge tone="success">Yayımlandı</Badge>
      <Avatar name="Arda Moustafa" />
      <Skeleton label="Loading row" />
      <Progress label="İlerleme" value={140} />
    </>,
  );
  expect(screen.getByRole('alert').textContent).toContain('Hata');
  expect(screen.getByRole('img', { name: 'Arda Moustafa' })).toBeTruthy();
  expect(screen.getByRole('status', { name: 'Loading row' })).toBeTruthy();
  expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('100');
});
it('breadcrumbs identify the current location and empty states expose their action', () => {
  mount(
    <>
      <Breadcrumb items={[{ label: 'Home', href: '#home' }, { label: 'Team' }]} />
      <EmptyState title="Empty" description="No members" action={<Button>Create</Button>} />
      <Kbd>⌘K</Kbd>
      <BrandLogo brand={{ name: 'Tenant', primaryColor: '#000000', logoUrl: '/logo.svg' }} />
    </>,
  );
  expect(screen.getByText('Team').getAttribute('aria-current')).toBe('page');
  expect(screen.getByRole('button', { name: 'Create' })).toBeTruthy();
  expect(screen.getByRole('img', { name: 'Tenant' })).toBeTruthy();
});
it('toolbar buttons participate in roving keyboard focus', async () => {
  mount(
    <Toolbar label="Araçlar">
      <ToolbarButton>First</ToolbarButton>
      <ToolbarButton>Second</ToolbarButton>
    </Toolbar>,
  );
  screen.getByRole('button', { name: 'First' }).focus();
  await userEvent.keyboard('{ArrowLeft}');
  expect(document.activeElement?.textContent).toBe('Second');
});
it('split pane exposes a labeled keyboard resize handle', () => {
  mount(<SplitPane label="Panels" first={<p>First</p>} second={<p>Second</p>} />);
  const handle = screen.getByRole('separator', { name: 'Panelleri boyutlandır' });
  expect(handle.getAttribute('tabindex')).toBe('0');
  fireEvent.keyDown(handle, { key: 'ArrowRight' });
  expect(screen.getByText('First')).toBeTruthy();
});
it('tooltips appear on focus and name their trigger independently', async () => {
  mount(
    <Tooltip content="Save changes">
      <Button>Save</Button>
    </Tooltip>,
  );
  const trigger = screen.getByRole('button', { name: 'Save' });
  trigger.focus();
  expect(await screen.findByRole('tooltip')).toBeTruthy();
});
it('restores external focus after a controlled sheet with explicit initial focus closes', async () => {
  const { createRef } = await import('react');
  const input = createRef<HTMLInputElement>();
  const outside = document.createElement('button');
  outside.textContent = 'Outside';
  document.body.append(outside);
  outside.focus();
  try {
    const view = mount(
      <Sheet
        open
        title="Review"
        description="Details"
        initialFocus={input}
        footer={<span>Footer</span>}
      >
        <input ref={input} aria-label="Review text" />
      </Sheet>,
    );
    await waitFor(() => {
      expect(document.activeElement).toBe(input.current);
    });
    view.rerender(
      <UiProvider i18n={i18n}>
        <Sheet open={false} title="Review" description="Details" initialFocus={input}>
          <input ref={input} aria-label="Review text" />
        </Sheet>
      </UiProvider>,
    );
    await waitFor(() => {
      expect(document.activeElement).toBe(outside);
    });
  } finally {
    outside.remove();
  }
});
it('links textarea descriptions and range thumb labels to their corresponding controls', async () => {
  const { Textarea, Slider, Checkbox } = await import('./fields.js');
  const { ToolbarSeparator } = await import('./disclosure.js');
  const view = mount(
    <>
      <Textarea id="notes" label="Notes" hint="Hint" error="Error" aria-describedby="external" />
      <Slider label="Range" value={[1, 9]} onValueChange={vi.fn()} />
      <Checkbox label="Mixed" checked="indeterminate" onCheckedChange={vi.fn()} />
      <Toolbar label="Tools">
        <ToolbarSeparator />
      </Toolbar>
      <Breadcrumb items={[{ label: 'Root' }, { label: 'Current' }]} />
    </>,
  );
  const textarea = screen.getByRole('textbox', { name: 'Notes' });
  expect(textarea.id).toBe('notes');
  expect(textarea.getAttribute('aria-invalid')).toBe('true');
  expect(textarea.getAttribute('aria-describedby')).toContain('external');
  expect(screen.getByRole('slider', { name: 'Range 1' })).toBeDefined();
  expect(screen.getByRole('slider', { name: 'Range 2' })).toBeDefined();
  expect(screen.getByRole('checkbox').getAttribute('aria-checked')).toBe('mixed');
  view.rerender(
    <UiProvider i18n={i18n}>
      <Textarea label="Notes" aria-invalid="true" />
      <Slider label="Range" value={[1]} onValueChange={vi.fn()} thumbLabels={['Custom thumb']} />
    </UiProvider>,
  );
  expect(screen.getByRole('textbox').getAttribute('aria-invalid')).toBe('true');
  expect(screen.getByRole('slider', { name: 'Custom thumb' })).toBeDefined();
});
it('does not dispatch a native select value that is absent from its options', async () => {
  const { SelectField } = await import('../select-field.js');
  const changed = vi.fn();
  mount(
    <SelectField
      label="Allowed"
      value="a"
      options={[{ value: 'a', label: 'A' }]}
      onChange={changed}
    />,
  );
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'unlisted' } });
  expect(changed).not.toHaveBeenCalled();
});
