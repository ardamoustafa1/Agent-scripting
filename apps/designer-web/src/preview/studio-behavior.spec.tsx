import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { expect, it } from 'vitest';

import { createAbility } from '@verbis/authz';
import { DataSourceRefSchema, VariableSchema, TestScenarioSchema } from '@verbis/script-schema';
import { minimalScript } from '@verbis/script-schema/fixtures';

import { EditorStore } from '../editor/store.js';
import { mountDesigner } from '../fixtures.spec.helpers.js';
import { scriptId } from '../test-fixtures.js';

import { PreviewStudio } from './studio.js';

async function setup(options: { dirty?: boolean; readonly?: boolean; scenario?: boolean } = {}) {
  const store = new EditorStore(minimalScript());
  store.edit((doc) => {
    doc.variables.push(
      VariableSchema.parse({ key: 'synthetic', type: 'number', scope: 'session', default: 1 }),
      VariableSchema.parse({
        key: 'privateValue',
        type: 'string',
        scope: 'session',
        classification: 'pii',
      }),
      VariableSchema.parse({ key: 'sharedValue', type: 'string', scope: 'global' }),
    );
    if (options.scenario)
      doc.testScenarios = [
        TestScenarioSchema.parse({
          id: 'syntheticSaved',
          name: 'Synthetic saved scenario',
          synthetic: true,
          context: {
            locale: 'en',
            interaction: { channel: 'chat', ani: 'synthetic-initial' },
            variables: { synthetic: 7 },
          },
          dataSources: {},
          steps: [],
          expected: { page: 'home' },
        }),
      ];
    doc.dataSources.push(
      DataSourceRefSchema.parse({
        id: 'synthetic',
        ref: 'tenant-datasource:synthetic',
        version: 1,
      }),
    );
  });
  const f = await mountDesigner(
    <PreviewStudio
      store={store}
      scriptId={scriptId}
      number={1}
      versionState="draft"
      dirty={options.dirty ?? false}
    />,
    {},
    { ...(options.readonly ? { ability: createAbility([]) } : {}) },
  );
  await waitFor(() => {
    expect(screen.getByTitle(f.label('preview.deviceFrame'))).toBeTruthy();
  });
  // JSDOM does not navigate srcDoc; model its load event explicitly. Real
  // script/CSP execution is covered by the browser preview tests.
  const frame = screen.getByTitle<HTMLIFrameElement>(f.label('preview.deviceFrame'));
  if (frame.contentDocument)
    frame.contentDocument.documentElement.innerHTML = new DOMParser().parseFromString(
      frame.srcdoc,
      'text/html',
    ).documentElement.innerHTML;
  fireEvent.load(frame);
  const tab = (key: string) =>
    fireEvent.mouseDown(screen.getByRole('tab', { name: f.label(`preview.${key}`) }), {
      button: 0,
      ctrlKey: false,
    });
  return { ...f, store, tab };
}
async function choose(label: string, name: string) {
  fireEvent.click(screen.getByRole('combobox', { name: label }));
  fireEvent.click(await screen.findByRole('option', { name }));
}
function json(label: string, source: string) {
  const input = screen.getByLabelText(label);
  fireEvent.change(input, { target: { value: source } });
  fireEvent.blur(input);
}
it('controls real runtime debugger and sets bounded device dimensions', async () => {
  const f = await setup();
  fireEvent.click(screen.getByRole('button', { name: f.label('preview.pause') }));
  fireEvent.click(await screen.findByRole('button', { name: f.label('preview.step') }));
  fireEvent.click(await screen.findByRole('button', { name: f.label('preview.resume') }));
  fireEvent.change(screen.getByLabelText(f.label('preview.width')), { target: { value: '100' } });
  fireEvent.change(screen.getByLabelText(f.label('preview.height')), { target: { value: '5000' } });
  const frame = screen.getByTitle<HTMLIFrameElement>(f.label('preview.deviceFrame'));
  expect(frame.style.width).toBe('320px');
  expect(frame.style.height).toBe('1200px');
  await choose(f.label('preview.device'), '768px');
  expect(frame.style.width).toBe('768px');
  await choose(f.label('preview.theme'), f.i18n.t('common.theme.dark'));
  await choose(f.label('preview.language'), f.i18n.t('common.locale.en'));
  fireEvent.click(screen.getByRole('button', { name: f.label('preview.restart') }));
  await waitFor(() => {
    expect(frame.contentDocument?.documentElement.lang).toBe('en');
  });
});
it('records watch edits, masks sensitive variables and saves only explicitly synthetic scenarios', async () => {
  const f = await setup();
  f.tab('watch');
  expect(await screen.findByText(f.label('preview.masked'))).toBeTruthy();
  json('synthetic', '12');
  const save = screen.getByRole('button', { name: f.label('preview.saveScenario') });
  await waitFor(() => {
    expect(save.hasAttribute('disabled')).toBe(false);
  });
  fireEvent.click(save);
  const dialog = await screen.findByRole('dialog');
  const confirm = within(dialog).getByRole('button', { name: f.label('preview.saveScenario') });
  expect(confirm.hasAttribute('disabled')).toBe(true);
  fireEvent.change(within(dialog).getByLabelText(f.label('preview.scenarioName')), {
    target: { value: 'Synthetic recorded scenario' },
  });
  fireEvent.click(
    within(dialog).getByRole('checkbox', { name: f.label('preview.syntheticConfirm') }),
  );
  fireEvent.click(confirm);
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  expect(f.store.getSnapshot().document.testScenarios?.[0]).toMatchObject({
    synthetic: true,
    name: 'Synthetic recorded scenario',
    steps: [{ type: 'variable', variable: 'synthetic', value: 12 }],
  });
  f.tab('scenarios');
  fireEvent.click(
    await within(screen.getByRole('tabpanel', { name: f.label('preview.scenarios') })).findByRole(
      'button',
      { name: f.label('preview.delete') },
    ),
  );
  expect(f.store.getSnapshot().document.testScenarios).toHaveLength(0);
});
it('edits context JSON, diagnoses invalid context and allows a restart', async () => {
  const f = await setup();
  fireEvent.change(screen.getByLabelText(f.label('preview.ani')), {
    target: { value: 'synthetic-caller' },
  });
  json(f.label('preview.campaign'), '{"id":"synthetic-campaign"}');
  json(f.label('preview.attachedData'), '{"synthetic":true}');
  json(f.label('preview.customer'), '{"synthetic":true}');
  json(f.label('preview.initialState'), '{"locale":"invalid-locale"}');
  expect(await screen.findByRole('alert')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: f.label('preview.restart') }));
  await waitFor(() => {
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
it('sets mock outcomes and debugger breakpoints without making live calls', async () => {
  const f = await setup();
  f.tab('dataSources');
  await choose(f.label('preview.mockKind'), f.label('preview.mocks.delay'));
  json(f.label('preview.mockOutputs'), '{"synthetic":12}');
  fireEvent.click(screen.getByRole('checkbox', { name: f.label('preview.liveTest') }));
  fireEvent.click(screen.getByRole('checkbox', { name: f.label('preview.liveTest') }));
  f.tab('breakpoints');
  fireEvent.click(screen.getByRole('checkbox', { name: 'Home' }));
  await waitFor(() => {
    expect(screen.getByRole('checkbox', { name: 'Home' }).getAttribute('aria-checked')).toBe(
      'true',
    );
  });
  fireEvent.click(screen.getByRole('checkbox', { name: 'Home' }));
  fireEvent.click(screen.getByRole('checkbox', { name: f.label('preview.actions.next') }));
  expect(f.requests.some((r) => r.method === 'POST')).toBe(false);
});
it('blocks live execution and scenario recording for dirty documents', async () => {
  const f = await setup({ dirty: true, readonly: true });
  expect(
    screen.getByRole('button', { name: f.label('preview.saveScenario') }).hasAttribute('disabled'),
  ).toBe(true);
  f.tab('dataSources');
  expect(
    screen.getByRole('checkbox', { name: f.label('preview.liveTest') }).hasAttribute('disabled'),
  ).toBe(true);
});
it('loads an existing scenario and edits channel and interaction context before restarting', async () => {
  const f = await setup({ scenario: true });
  await choose(f.label('preview.loadScenario'), 'Synthetic saved scenario');
  expect(screen.getByLabelText<HTMLInputElement>(f.label('preview.ani')).value).toBe(
    'synthetic-initial',
  );
  await choose(f.label('preview.channel'), f.label('preview.channels.voice'));
  fireEvent.change(screen.getByLabelText(f.label('preview.ani')), {
    target: { value: 'synthetic-updated' },
  });
  fireEvent.click(screen.getByRole('button', { name: f.label('preview.restart') }));
  f.tab('watch');
  expect(screen.getByLabelText<HTMLInputElement>('synthetic').value).toBe('7');
});

it('isolates the preview from scripts and exposes the page name', async () => {
  const f = await setup();
  const frame = screen.getByTitle<HTMLIFrameElement>(f.label('preview.deviceFrame'));
  expect(frame.getAttribute('sandbox')).toBe('allow-same-origin');
  expect(frame.srcdoc).toContain("script-src 'none'");
  expect(screen.getByText(new RegExp(f.label('preview.page') + ':')).textContent).toContain('Home');
});
