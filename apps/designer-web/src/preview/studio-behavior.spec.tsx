import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { expect, it } from 'vitest';

import { createAbility } from '@verbis/authz';
import { createI18n } from '@verbis/i18n';
import { DataSourceRefSchema, VariableSchema, TestScenarioSchema } from '@verbis/script-schema';
import { minimalScript } from '@verbis/script-schema/fixtures';

import { EditorStore } from '../editor/store.js';
import { mountDesigner } from '../fixtures.spec.helpers.js';
import { scriptId } from '../test-fixtures.js';

import { PreviewStudio } from './studio.js';

async function setup(
  options: { dirty?: boolean; readonly?: boolean; scenario?: boolean; outputs?: boolean } = {},
) {
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
      VariableSchema.parse({
        key: 'customerNo',
        type: 'string',
        scope: 'session',
        source: 'interaction.attributes.customerNo',
      }),
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
        ...(options.outputs
          ? {
              outputs: {
                status: { path: '$.status', variable: 'customerNo' },
                score: { path: '$.score' },
              },
            }
          : {}),
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
  // The frame root paints below short pages, so it must follow the chosen theme, not the OS.
  await waitFor(() => {
    expect(frame.contentDocument?.documentElement.dataset['theme']).toBe('light');
  });
  await choose(f.label('preview.theme'), f.i18n.t('common.theme.dark'));
  await waitFor(() => {
    expect(frame.contentDocument?.documentElement.dataset['theme']).toBe('dark');
  });
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
it('edits test call data as fields, diagnoses an invalid advanced context and allows a restart', async () => {
  const f = await setup();
  fireEvent.change(screen.getByLabelText(f.label('preview.ani')), {
    target: { value: 'synthetic-caller' },
  });
  // The script's expected call data is offered as a field, written at its source path.
  fireEvent.change(screen.getByLabelText('customerNo · interaction.attributes.customerNo'), {
    target: { value: 'C-1001' },
  });
  const attached = screen.getByRole('group', { name: f.label('preview.attachedData') });
  fireEvent.click(within(attached).getByRole('button', { name: f.label('preview.addField') }));
  fireEvent.change(within(attached).getByLabelText(f.label('preview.fieldName')), {
    target: { value: 'segment' },
  });
  fireEvent.change(within(attached).getByLabelText(f.label('preview.fieldValue')), {
    target: { value: 'gold' },
  });
  // Scripts greet with the signed-in agent's name; the preview starts with a synthetic one.
  const agent = screen.getByLabelText<HTMLInputElement>(f.label('preview.agentName'));
  expect(agent.value).toBe(f.label('preview.sampleAgent'));
  fireEvent.change(agent, { target: { value: 'Synthetic agent' } });
  const state = screen.getByLabelText<HTMLTextAreaElement>(f.label('preview.initialState'));
  await waitFor(() => {
    expect(JSON.parse(state.value)).toMatchObject({
      interaction: {
        ani: 'synthetic-caller',
        attributes: { customerNo: 'C-1001' },
        attachedData: { segment: 'gold' },
      },
      agent: { firstName: 'Synthetic agent' },
    });
  });
  json(f.label('preview.initialState'), '{"locale":"invalid-locale"}');
  expect(await screen.findByRole('alert')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: f.label('preview.restart') }));
  await waitFor(() => {
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
it('explains rejected sensitive recordings inside the save dialog without persisting them', async () => {
  const f = await setup();
  json(f.label('preview.initialState'), '{"variables":{"privateValue":"synthetic"}}');
  fireEvent.click(screen.getByRole('button', { name: f.label('preview.restart') }));
  await waitFor(() => {
    expect(
      screen
        .getByRole('button', { name: f.label('preview.saveScenario') })
        .hasAttribute('disabled'),
    ).toBe(false);
  });
  fireEvent.click(screen.getByRole('button', { name: f.label('preview.saveScenario') }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.change(within(dialog).getByLabelText(f.label('preview.scenarioName')), {
    target: { value: 'Rejected sensitive recording' },
  });
  fireEvent.click(
    within(dialog).getByRole('checkbox', { name: f.label('preview.syntheticConfirm') }),
  );
  fireEvent.click(within(dialog).getByRole('button', { name: f.label('preview.saveScenario') }));
  expect((await within(dialog).findByRole('alert')).textContent).toContain(
    f.label('preview.recordingBlocked'),
  );
  expect(f.store.getSnapshot().document.testScenarios ?? []).toHaveLength(0);
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
  // The scenario names no agent, so the greeting keeps the synthetic one.
  expect(screen.getByLabelText<HTMLInputElement>(f.label('preview.agentName')).value).toBe(
    f.label('preview.sampleAgent'),
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
it('fills a data source mock from the integration output schema through its output paths', async () => {
  const store = new EditorStore(minimalScript());
  store.edit((doc) => {
    doc.dataSources.push(
      DataSourceRefSchema.parse({
        id: 'crm',
        ref: 'tenant-datasource:crm-lookup',
        version: 2,
        outputs: {
          name: { path: '$.customer.name' },
          tier: { path: '$.tier' },
        },
      }),
    );
  });
  const f = await mountDesigner(
    <PreviewStudio
      store={store}
      scriptId={scriptId}
      number={1}
      versionState="draft"
      dirty={false}
    />,
    {
      '/v1/data-sources?limit=20&q=crm-lookup': {
        data: [
          {
            key: 'crm-lookup',
            version: 2,
            definition: {
              outputSchema: {
                type: 'object',
                properties: {
                  customer: { type: 'object', properties: { name: { type: 'string' } } },
                  tier: { enum: ['gold', 'silver'] },
                },
              },
            },
          },
        ],
        page: { nextCursor: null },
      },
    },
  );
  fireEvent.mouseDown(screen.getByRole('tab', { name: f.label('preview.dataSources') }), {
    button: 0,
  });
  fireEvent.click(await screen.findByRole('button', { name: f.label('preview.sampleFromSchema') }));
  await screen.findByText(f.label('preview.sample.done'));
  const field = screen.getByRole('textbox', { name: f.label('preview.mockOutputs') });
  expect(JSON.parse((field as HTMLTextAreaElement).value)).toEqual({
    name: 'sample',
    tier: 'gold',
  });
});
it('evaluates watch expressions safely, masks personal data and lets the designer remove them', async () => {
  const f = await setup();
  f.tab('watch');
  const add = async (expression: string) => {
    fireEvent.change(
      await screen.findByRole('textbox', { name: f.label('preview.watchExpression') }),
      {
        target: { value: expression },
      },
    );
    fireEvent.click(screen.getByRole('button', { name: f.label('preview.addWatch') }));
  };
  await add('vars.synthetic + 2');
  await add('vars.synthetic + 2');
  await add('vars.privateValue');
  await add('vars.');
  const list = await screen.findByRole('list', { name: f.label('preview.watchList') });
  await waitFor(() => {
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
  });
  await waitFor(() => {
    expect(within(list).getByText('3')).toBeTruthy();
  });
  expect(within(list).getByText(f.label('preview.masked'))).toBeTruthy();
  expect(within(list).getByText(f.label('preview.watchError'))).toBeTruthy();
  fireEvent.click(
    within(list).getByRole('button', {
      name: f.label('preview.removeWatch').replace('{{expression}}', 'vars.'),
    }),
  );
  expect(within(list).getAllByRole('listitem')).toHaveLength(2);
});
it.each([
  ['missing', { data: [], page: { nextCursor: null } }],
  ['failed', Response.json({ code: 'VERBIS_HTTP_UNAVAILABLE' }, { status: 503 })],
] as const)('explains a %s integration schema when filling a mock', async (state, response) => {
  const store = new EditorStore(minimalScript());
  store.edit((doc) => {
    doc.dataSources.push(
      DataSourceRefSchema.parse({ id: 'crm', ref: 'tenant-datasource:crm-lookup', version: 1 }),
    );
  });
  const f = await mountDesigner(
    <PreviewStudio
      store={store}
      scriptId={scriptId}
      number={1}
      versionState="draft"
      dirty={false}
    />,
    { '/v1/data-sources?limit=20&q=crm-lookup': response },
  );
  fireEvent.mouseDown(screen.getByRole('tab', { name: f.label('preview.dataSources') }), {
    button: 0,
  });
  fireEvent.click(await screen.findByRole('button', { name: f.label('preview.sampleFromSchema') }));
  await screen.findByText(f.label(`preview.sample.${state}`));
});

it('fills a mock response field by field and keeps the whole response under advanced', async () => {
  const f = await setup({ outputs: true });
  f.tab('dataSources');
  // Fields read as the variable they fill ("Customer no"), else as their name in words; the
  // data source is titled in words too, never as a code name.
  expect(screen.getByText('Synthetic', { selector: 'legend' })).toBeTruthy();
  const field = await screen.findByRole('textbox', {
    name: f.i18n.t('designer.preview.mockField', { field: 'Customer no' }),
  });
  fireEvent.change(field, { target: { value: 'Yolda' } });
  // An output no variable receives is typed as written, so `ds.x.score >= 650` can be tested.
  const score = screen.getByRole('textbox', {
    name: f.i18n.t('designer.preview.mockField', { field: 'Score' }),
  });
  fireEvent.change(score, { target: { value: '720' } });
  // The advanced JSON field remounts on every change; read the current one.
  const whole = () =>
    JSON.parse(
      screen.getByLabelText<HTMLTextAreaElement>(f.label('preview.mockOutputs')).value,
    ) as unknown;
  await waitFor(() => {
    expect(whole()).toEqual({ status: 'Yolda', score: 720 });
  });
  fireEvent.change(score, { target: { value: '"720"' } });
  await waitFor(() => {
    expect(whole()).toEqual({ status: 'Yolda', score: '720' });
  });
  expect(score).toHaveProperty('value', '"720"');
});
it('frames the script like the agent desktop and can show the bare script instead', async () => {
  const f = await setup();
  // The frame speaks the script's language (Turkish by default), not the studio's.
  const tr = await createI18n('tr');
  const frame = screen.getByTitle<HTMLIFrameElement>(f.label('preview.deviceFrame'));
  const body = () => within(frame.contentDocument!.body);
  // The script's own button may also say "Next"; the frame's controls live in its footer.
  const footer = () =>
    within(frame.contentDocument!.querySelector<HTMLElement>('.pv-agent-footer')!);
  // Same step header, progress and Back/Next as the agent desktop.
  expect(await body().findByText(tr.t('agent.desktop.step', { number: 1 }))).toBeTruthy();
  expect(body().getByRole('heading', { name: 'Home' })).toBeTruthy();
  expect(body().getByText(tr.t('agent.desktop.progress', { current: 1, total: 1 }))).toBeTruthy();
  const back = footer().getByRole('button', { name: tr.t('agent.desktop.back') });
  expect(back.hasAttribute('disabled')).toBe(true);
  fireEvent.click(footer().getByRole('button', { name: tr.t('agent.desktop.next') }));
  // The only page leads to the end: the frame stops offering steps.
  await waitFor(() => {
    expect(body().queryByText(tr.t('agent.desktop.step', { number: 1 }))).toBeNull();
  });
  expect(
    footer()
      .getByRole('button', { name: tr.t('agent.desktop.next') })
      .hasAttribute('disabled'),
  ).toBe(true);
  fireEvent.mouseDown(screen.getByRole('radio', { name: f.label('preview.frames.script') }), {
    button: 0,
  });
  fireEvent.click(screen.getByRole('radio', { name: f.label('preview.frames.script') }));
  await waitFor(() => {
    expect(frame.contentDocument!.querySelector('.pv-agent-footer')).toBeNull();
  });
});
