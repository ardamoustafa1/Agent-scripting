import { Settings, Save, Plus, Search, ArrowUpRight, Layers, CircleHelp } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import * as UI from '../index.js';

export const COMPONENT_NAMES = [
  'Button',
  'IconButton',
  'Input',
  'Textarea',
  'Select',
  'Combobox',
  'MultiSelect',
  'Checkbox',
  'Radio',
  'Switch',
  'Slider',
  'DatePicker',
  'TimePicker',
  'Tabs',
  'Accordion',
  'Dialog',
  'Drawer',
  'Sheet',
  'Popover',
  'Tooltip',
  'DropdownMenu',
  'ContextMenu',
  'Toast',
  'Alert',
  'Badge',
  'Avatar',
  'Skeleton',
  'Progress',
  'DataTable',
  'Tree',
  'Breadcrumb',
  'CommandPalette',
  'EmptyState',
  'Kbd',
  'SplitPane',
  'Toolbar',
  'BrandLogo',
] as const;
export type DemoName = (typeof COMPONENT_NAMES)[number];
export function ComponentDemo({ component }: { component: DemoName }) {
  const { t } = useTranslation();
  const s = (key: string) => t(`ui.sample.${key}`);
  const [value, setValue] = useState('agent');
  const [multiple, setMultiple] = useState<string[]>(['agent']);
  const [checked, setChecked] = useState(true);
  const [slider, setSlider] = useState([65]);
  const [date, setDate] = useState<Date | undefined>(new Date(2026, 9, 1, 12));
  const [open, setOpen] = useState(false);
  const [node, setNode] = useState('welcome');
  const options = [
    { value: 'agent', label: s('agent') },
    { value: 'designer', label: s('designer') },
    { value: 'admin', label: s('admin') },
  ];
  const trigger = (
    <UI.Button
      data-testid="story-trigger"
      variant="secondary"
      startIcon={<Layers size={16} aria-hidden />}
    >
      {s('details')}
    </UI.Button>
  );
  const menu = [
    {
      id: 'save',
      label: s('action'),
      icon: <Save size={16} aria-hidden />,
      shortcut: '⌘S',
      onSelect: () => {
        setOpen(true);
      },
    },
    {
      id: 'cancel',
      label: s('cancel'),
      onSelect: () => {
        setOpen(false);
      },
    },
  ];
  switch (component) {
    case 'Button':
      return (
        <div className="vb-demo-row">
          {(['primary', 'secondary', 'ghost', 'danger'] as const).map((variant) => (
            <UI.Button key={variant} variant={variant}>
              {s(variant)}
            </UI.Button>
          ))}
          <UI.Button loading>{s('action')}</UI.Button>
          <UI.Button disabled>{s('action')}</UI.Button>
        </div>
      );
    case 'IconButton':
      return (
        <UI.IconButton label={s('menu')}>
          <Settings size={18} />
        </UI.IconButton>
      );
    case 'Input':
      return <UI.Input label={s('name')} defaultValue={s('agent')} hint={s('description')} />;
    case 'Textarea':
      return <UI.Textarea label={s('message')} defaultValue={s('content')} />;
    case 'Select':
      return (
        <UI.Select label={s('team')} options={options} value={value} onValueChange={setValue} />
      );
    case 'Combobox':
      return (
        <UI.Combobox label={s('team')} options={options} value={value} onValueChange={setValue} />
      );
    case 'MultiSelect':
      return (
        <UI.MultiSelect
          label={s('multi')}
          options={options}
          value={multiple}
          onValueChange={setMultiple}
        />
      );
    case 'Checkbox':
      return (
        <UI.Checkbox
          label={s('check')}
          checked={checked}
          onCheckedChange={(next) => {
            setChecked(next === true);
          }}
        />
      );
    case 'Radio':
      return (
        <UI.Radio label={s('radio')} options={options} value={value} onValueChange={setValue} />
      );
    case 'Switch':
      return <UI.Switch label={s('switch')} checked={checked} onCheckedChange={setChecked} />;
    case 'Slider':
      return <UI.Slider label={s('volume')} value={slider} onValueChange={setSlider} />;
    case 'DatePicker':
      return (
        <UI.DatePicker
          label={s('date')}
          {...(date === undefined ? {} : { value: date })}
          onValueChange={setDate}
        />
      );
    case 'TimePicker':
      return <UI.TimePicker label={s('time')} defaultValue="09:30" />;
    case 'Tabs':
      return (
        <UI.Tabs
          label={s('details')}
          items={[
            { value: 'team', label: s('team'), content: s('description') },
            { value: 'settings', label: s('title'), content: s('content') },
          ]}
        />
      );
    case 'Accordion':
      return (
        <UI.Accordion
          items={[
            { value: 'routing', title: s('accordion'), content: s('description') },
            { value: 'details', title: s('details'), content: s('content') },
          ]}
        />
      );
    case 'Dialog':
      return (
        <UI.Dialog
          trigger={trigger}
          title={s('title')}
          description={s('description')}
          footer={<UI.Button>{s('action')}</UI.Button>}
        >
          <UI.Input label={s('name')} defaultValue={s('agent')} />
        </UI.Dialog>
      );
    case 'Drawer':
      return (
        <UI.Drawer trigger={trigger} title={s('sheet')} description={s('description')}>
          <UI.Input label={s('name')} />
        </UI.Drawer>
      );
    case 'Sheet':
      return (
        <UI.Sheet
          trigger={trigger}
          title={s('sheet')}
          description={s('description')}
          footer={<UI.Button>{s('action')}</UI.Button>}
        >
          <UI.Input label={s('name')} />
        </UI.Sheet>
      );
    case 'Popover':
      return (
        <UI.Popover trigger={trigger} label={s('popover')}>
          <p className="vb-description">{s('description')}</p>
        </UI.Popover>
      );
    case 'Tooltip':
      return (
        <UI.Tooltip content={s('tooltip')}>
          <UI.Button data-testid="story-trigger" startIcon={<Save size={16} aria-hidden />}>
            {s('action')}
          </UI.Button>
        </UI.Tooltip>
      );
    case 'DropdownMenu':
      return <UI.DropdownMenu label={s('menu')} items={menu} trigger={trigger} />;
    case 'ContextMenu':
      return (
        <UI.ContextMenu label={s('menu')} items={menu}>
          {s('content')}
        </UI.ContextMenu>
      );
    case 'Toast':
      return (
        <UI.ToastProvider>
          <UI.Button
            data-testid="story-trigger"
            onClick={() => {
              setOpen(true);
            }}
          >
            {s('action')}
          </UI.Button>
          <UI.Toast
            open={open}
            onOpenChange={setOpen}
            duration={30000}
            title={s('notification')}
            description={s('content')}
          />
        </UI.ToastProvider>
      );
    case 'Alert':
      return (
        <div className="vb-demo-stack">
          {(['info', 'success', 'warning', 'danger'] as const).map((tone) => (
            <UI.Alert key={tone} tone={tone} title={s('alert')}>
              {s('description')}
            </UI.Alert>
          ))}
        </div>
      );
    case 'Badge':
      return (
        <div className="vb-demo-row">
          {(['neutral', 'success', 'warning', 'danger', 'info'] as const).map((tone) => (
            <UI.Badge key={tone} tone={tone}>
              {s('badge')}
            </UI.Badge>
          ))}
        </div>
      );
    case 'Avatar':
      return (
        <div className="vb-demo-row">
          <UI.Avatar name={s('avatar')} size="sm" />
          <UI.Avatar name={s('avatar')} />
          <UI.Avatar name={s('avatar')} size="lg" />
        </div>
      );
    case 'Skeleton':
      return (
        <div className="vb-demo-stack">
          <UI.Skeleton circle width={40} height={40} />
          <UI.Skeleton width="80%" />
          <UI.Skeleton width="55%" />
        </div>
      );
    case 'Progress':
      return <UI.Progress label={s('progress')} value={65} />;
    case 'DataTable':
      return (
        <UI.DataTable
          label={s('table')}
          data={Array.from({ length: 1000 }, (_, index) => ({
            id: `row-${index}`,
            name: `${s('agent')} ${String(index + 1).padStart(4, '0')}`,
            status: index % 3 ? s('active') : s('pending'),
          }))}
          columns={[
            { id: 'name', header: s('name'), accessor: (row) => row.name, size: 300 },
            {
              id: 'status',
              header: s('status'),
              accessor: (row) => row.status,
              cell: (row) => (
                <UI.Badge tone={row.status === s('active') ? 'success' : 'warning'}>
                  {row.status}
                </UI.Badge>
              ),
            },
          ]}
          getRowId={(row) => row.id}
        />
      );
    case 'Tree':
      return (
        <UI.Tree
          label={s('tree')}
          nodes={[
            {
              id: 'root',
              label: s('root'),
              children: [
                { id: 'welcome', label: s('child') },
                { id: 'settings', label: s('title') },
              ],
            },
          ]}
          defaultExpanded={['root']}
          selectedId={node}
          onSelect={setNode}
        />
      );
    case 'Breadcrumb':
      return (
        <UI.Breadcrumb
          items={[
            { label: s('root'), href: '#campaigns' },
            { label: s('team'), href: '#team' },
            { label: s('title') },
          ]}
        />
      );
    case 'CommandPalette':
      return (
        <>
          <UI.Button
            data-testid="story-trigger"
            variant="secondary"
            onClick={() => {
              setOpen(true);
            }}
            startIcon={<Search size={16} aria-hidden />}
          >
            {t('ui.command')}
            <UI.Kbd>{s('commandShortcut')}</UI.Kbd>
          </UI.Button>
          <UI.CommandPalette open={open} onOpenChange={setOpen} items={menu} />
        </>
      );
    case 'EmptyState':
      return (
        <UI.EmptyState
          title={s('emptyTitle')}
          description={s('emptyBody')}
          action={<UI.Button startIcon={<Plus size={16} aria-hidden />}>{s('action')}</UI.Button>}
        />
      );
    case 'Kbd':
      return (
        <div className="vb-demo-row">
          <UI.Kbd>{s('commandKey')}</UI.Kbd>
          <UI.Kbd>{s('paletteKey')}</UI.Kbd>
          <UI.Kbd>{s('shiftKey')}</UI.Kbd>
          <UI.Kbd>{s('enterKey')}</UI.Kbd>
        </div>
      );
    case 'SplitPane':
      return (
        <UI.SplitPane
          label={s('resize')}
          first={<UI.EmptyState title={s('left')} description={s('description')} />}
          second={<UI.EmptyState title={s('right')} description={s('description')} />}
        />
      );
    case 'Toolbar':
      return (
        <UI.Toolbar label={s('toolbar')}>
          <UI.ToolbarButton>{s('action')}</UI.ToolbarButton>
          <UI.ToolbarSeparator />
          <UI.ToolbarButton aria-label={s('help')}>
            <CircleHelp size={18} aria-hidden />
          </UI.ToolbarButton>
          <UI.ToolbarLink href="#details">{s('details')}</UI.ToolbarLink>
        </UI.Toolbar>
      );
    case 'BrandLogo':
      return (
        <div className="vb-demo-stack">
          <UI.BrandLogo brand={{ name: 'Verbis', primaryColor: '#5145cd' }} />
          <UI.Button startIcon={<ArrowUpRight size={16} aria-hidden />}>{s('action')}</UI.Button>
        </div>
      );
  }
}

export function WorkspaceDemo() {
  const { t } = useTranslation();
  const s = (key: string) => t(`ui.sample.${key}`);
  const [enabled, setEnabled] = useState(true);
  return (
    <div className="vb-workspace-preview">
      <aside className="vb-workspace-sidebar">
        <UI.BrandLogo brand={{ name: 'Verbis', primaryColor: '#5145cd' }} />
        <UI.Breadcrumb items={[{ label: s('root') }]} />
        <ComponentDemo component="Tree" />
        <div className="vb-workspace-sidebar-foot">
          <UI.Avatar name={s('avatar')} />
          <span>{s('admin')}</span>
          <UI.Kbd>{s('commandShortcut')}</UI.Kbd>
        </div>
      </aside>
      <section className="vb-workspace-main">
        <header className="vb-workspace-header">
          <UI.Breadcrumb
            items={[{ label: s('root'), href: '#campaigns' }, { label: s('title') }]}
          />
          <UI.IconButton label={s('help')}>
            <CircleHelp size={18} />
          </UI.IconButton>
        </header>
        <div className="vb-workspace-body">
          <div className="vb-workspace-title">
            <div>
              <UI.Badge tone="success">{s('badge')}</UI.Badge>
              <h1>{s('title')}</h1>
              <p>{s('description')}</p>
            </div>
            <UI.Button startIcon={<Plus size={16} aria-hidden />}>{s('action')}</UI.Button>
          </div>
          <UI.Tabs
            label={s('details')}
            items={[
              { value: 'team', label: s('team'), content: <ComponentDemo component="DataTable" /> },
              {
                value: 'settings',
                label: s('title'),
                content: (
                  <div className="vb-card vb-demo-stack">
                    <UI.Input label={s('name')} defaultValue="Verbis" />
                    <UI.Switch label={s('switch')} checked={enabled} onCheckedChange={setEnabled} />
                    <UI.Button>{s('action')}</UI.Button>
                  </div>
                ),
              },
            ]}
          />
        </div>
      </section>
    </div>
  );
}
