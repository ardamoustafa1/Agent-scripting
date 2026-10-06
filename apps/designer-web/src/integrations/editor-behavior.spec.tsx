import { File as NodeFile } from 'node:buffer';

import { fireEvent, screen, waitFor } from '@testing-library/react';
import { expect, it } from 'vitest';

import { createAbility } from '@verbis/authz';
import { IntegrationRecordSchema } from '@verbis/shared-types';

import { mountDesigner } from '../fixtures.spec.helpers.js';
import { scriptId } from '../test-fixtures.js';

import IntegrationEditor from './editor.js';
import { defaults } from './importers.js';

const initial = IntegrationRecordSchema.parse({ id: scriptId, ...defaults(), version: 3 });
async function setup(isNew = false, extra: Record<string, unknown> = {}) {
  const f = await mountDesigner(
    <IntegrationEditor />,
    {
      [`/v1/data-sources/${scriptId}`]: initial,
      [`PUT /v1/data-sources/${scriptId}`]: { ...initial, version: 4 },
      'POST /v1/data-sources': initial,
      '/v1/data-sources/preview': {
        request: { synthetic: true },
        response: { synthetic: true },
        mapped: { result: 'synthetic-result' },
        durationMs: 12,
        cached: false,
        mock: true,
        error: null,
      },
      ...extra,
    },
    { route: '/integrations/:id', path: `/integrations/${isNew ? 'new' : scriptId}` },
  );
  await screen.findByRole('heading', {
    name: isNew ? f.label('integrations.create') : initial.key,
  });
  return f;
}
async function tab(f: Awaited<ReturnType<typeof setup>>, key: string) {
  fireEvent.mouseDown(screen.getByRole('tab', { name: f.label(`integrations.tabs.${key}`) }), {
    button: 0,
    ctrlKey: false,
  });
  await screen.findByRole('tabpanel');
}
async function choose(label: string, option: string) {
  fireEvent.click(screen.getByRole('combobox', { name: label }));
  fireEvent.click(await screen.findByRole('option', { name: option }));
}
function change(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}
it('saves a versioned integration request and protects unsaved changes', async () => {
  const f = await setup();
  change(f.label('integrations.key'), 'synthetic-integration');
  change(f.label('integrations.baseUrl'), 'https://synthetic.example.test');
  change(f.label('integrations.endpoint'), '/synthetic');
  await choose(f.label('integrations.method'), 'POST');
  const unload = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(unload);
  expect(unload.defaultPrevented).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: f.label('integrations.save') }));
  await waitFor(() => {
    expect(f.requests.some((r) => r.method === 'PUT')).toBe(true);
  });
  const request = f.requests.find((r) => r.method === 'PUT')!;
  expect(new Headers(request.init?.headers).get('if-match')).toBe('"3"');
  expect(new Headers(request.init?.headers).get('x-csrf-token')).toBe('synthetic-csrf-only');
  expect(request.body).toMatchObject({
    key: 'synthetic-integration',
    definition: {
      baseUrl: 'https://synthetic.example.test',
      endpoint: '/synthetic',
      method: 'POST',
    },
  });
});
it('imports curl without executing it and creates an integration', async () => {
  const f = await setup(true);
  change(
    f.label('integrations.importSource'),
    "curl 'https://synthetic.example.test/resource?synthetic=yes' -X POST -H 'X-Synthetic: yes' -d '{\"synthetic\":true}'",
  );
  fireEvent.click(screen.getByRole('button', { name: f.label('integrations.import') }));
  await tab(f, 'request');
  await waitFor(() => {
    expect(screen.getByLabelText<HTMLInputElement>(f.label('integrations.baseUrl')).value).toBe(
      'https://synthetic.example.test',
    );
  });
  change(f.label('integrations.key'), 'synthetic-created');
  fireEvent.click(screen.getByRole('button', { name: f.label('integrations.save') }));
  await waitFor(() => {
    expect(f.requests.some((r) => r.method === 'POST' && r.path === '/v1/data-sources')).toBe(true);
  });
  expect(f.requests.find((r) => r.path === '/v1/data-sources')!.body).toMatchObject({
    key: 'synthetic-created',
    definition: { endpoint: '/resource', query: { synthetic: 'yes' } },
  });
});
it('rejects unsafe imports and keeps the last valid definition', async () => {
  const f = await setup(true);
  change(f.label('integrations.importSource'), 'curl $(synthetic-command)');
  fireEvent.click(screen.getByRole('button', { name: f.label('integrations.import') }));
  expect(await screen.findByText(f.label('integrations.importError'))).toBeTruthy();
  expect(f.requests.some((r) => r.method !== 'GET')).toBe(false);
});
it.each(['SOAP', 'GRAPHQL'])('configures protocol-specific fields for %s', async (protocol) => {
  const f = await setup();
  await choose(f.label('integrations.protocol'), protocol);
  const label = protocol === 'SOAP' ? 'soap' : 'graphqlQuery';
  expect(screen.getByLabelText(f.label(`integrations.${label}`))).toBeTruthy();
  if (protocol === 'GRAPHQL')
    change(f.label('integrations.graphqlQuery'), 'query Synthetic { synthetic }');
  fireEvent.click(screen.getByRole('button', { name: f.label('integrations.save') }));
  await waitFor(() => {
    expect(f.requests.some((r) => r.method === 'PUT')).toBe(true);
  });
  expect(f.requests.find((r) => r.method === 'PUT')!.body).toMatchObject({
    protocol: protocol.toLowerCase(),
    definition: { method: 'POST' },
  });
});
it('infers response schema from a synthetic sample and saves it', async () => {
  const f = await setup();
  await tab(f, 'schemas');
  const input = screen.getByLabelText(f.label('integrations.sampleResponse'));
  fireEvent.change(input, { target: { value: '{"synthetic":12}' } });
  fireEvent.blur(input);
  fireEvent.click(screen.getByRole('button', { name: f.label('integrations.infer') }));
  fireEvent.click(screen.getByRole('button', { name: f.label('integrations.save') }));
  await waitFor(() => {
    expect(f.requests.some((r) => r.method === 'PUT')).toBe(true);
  });
  expect(f.requests.find((r) => r.method === 'PUT')!.body).toMatchObject({
    definition: {
      outputSchema: { type: 'object', properties: { synthetic: { type: 'integer' } } },
      mock: { response: { synthetic: 12 } },
    },
  });
});
it.each([409, 503])('reports save status %s without losing entered changes', async (status) => {
  const f = await setup(false, {
    [`PUT /v1/data-sources/${scriptId}`]: Response.json({ code: 'VERBIS_SYNTHETIC' }, { status }),
  });
  change(f.label('integrations.endpoint'), '/keep-this-draft');
  fireEvent.click(screen.getByRole('button', { name: f.label('integrations.save') }));
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.getByLabelText<HTMLInputElement>(f.label('integrations.endpoint')).value).toBe(
    '/keep-this-draft',
  );
});
it('forbids creation without permission', async () => {
  const f = await mountDesigner(
    <IntegrationEditor />,
    {},
    { route: '/integrations/:id', path: '/integrations/new', ability: createAbility([]) },
  );
  expect(await screen.findByText(f.label('workspace.denied'))).toBeTruthy();
  expect(f.requests).toHaveLength(0);
});
it('retries integration loading errors', async () => {
  const f = await mountDesigner(
    <IntegrationEditor />,
    { [`/v1/data-sources/${scriptId}`]: Response.json({}, { status: 500 }) },
    { route: '/integrations/:id', path: `/integrations/${scriptId}` },
  );
  const retry = await screen.findByRole('button', { name: f.label('workspace.retry') });
  f.responses[`/v1/data-sources/${scriptId}`] = initial;
  fireEvent.click(retry);
  expect(await screen.findByRole('heading', { name: initial.key })).toBeTruthy();
});
it('edits resilience policies and named mock scenarios before saving', async () => {
  const f = await setup();
  await tab(f, 'resilience');
  change(f.label('integrations.policy.timeoutMs'), '3000');
  change(f.label('integrations.policy.retries'), '2');
  fireEvent.click(screen.getByRole('checkbox', { name: f.label('integrations.allowHttp') }));
  const origins = screen.getByLabelText(f.label('integrations.allowedOrigins'));
  fireEvent.change(origins, { target: { value: '["https://synthetic.example.test"]' } });
  fireEvent.blur(origins);
  await tab(f, 'mocks');
  fireEvent.click(screen.getByRole('checkbox', { name: f.label('integrations.mockEnabled') }));
  fireEvent.click(screen.getByRole('button', { name: f.label('integrations.addScenario') }));
  change(f.label('integrations.scenario'), 'synthetic-delay');
  await choose(f.label('integrations.scenarioKind'), f.label('integrations.scenarios.empty'));
  await choose(f.label('integrations.scenarioKind'), f.label('integrations.scenarios.delay'));
  change(f.label('integrations.delay'), '150');
  fireEvent.click(screen.getByRole('button', { name: f.label('integrations.save') }));
  await waitFor(() => {
    expect(f.requests.some((r) => r.method === 'PUT')).toBe(true);
  });
  expect(f.requests.find((r) => r.method === 'PUT')!.body).toMatchObject({
    policy: {
      timeoutMs: 3000,
      retries: 2,
      allowHttp: true,
      allowedOrigins: ['https://synthetic.example.test'],
    },
    definition: {
      mock: { enabled: true },
      mockScenarios: [{ key: 'synthetic-delay', kind: 'delay', delayMs: 150, response: [] }],
    },
  });
  await waitFor(() => {
    expect(
      screen.getByRole('button', { name: f.label('integrations.save') }).hasAttribute('disabled'),
    ).toBe(false);
  });
  await tab(f, 'mocks');
  // The synthetic save response returns the original record, so add a fresh scenario before removal.
  fireEvent.click(screen.getByRole('button', { name: f.label('integrations.addScenario') }));
  fireEvent.click(screen.getByRole('button', { name: f.label('integrations.remove') }));
  expect(screen.queryByLabelText(f.label('integrations.scenarioKind'))).toBeNull();
});
it('does not send the previous valid console input when the visible JSON is malformed', async () => {
  const f = await setup();
  await tab(f, 'console');
  change(f.label('integrations.testInput'), '{bad-json');
  fireEvent.click(screen.getByRole('button', { name: f.label('integrations.send') }));
  await screen.findByText(f.label('integrations.invalidJson'));
  expect(f.requests.some((r) => r.path === '/v1/data-sources/preview')).toBe(false);
});
it.each([200, 500])('runs synthetic console requests and handles HTTP %s', async (status) => {
  const f = await setup(false, {
    '/v1/data-sources/preview':
      status === 200
        ? {
            request: { synthetic: true },
            response: { synthetic: true },
            mapped: 'synthetic-mapped',
            durationMs: 12,
            cached: false,
            mock: true,
            error: null,
          }
        : Response.json({}, { status }),
  });
  await tab(f, 'console');
  const input = screen.getByLabelText(f.label('integrations.testInput'));
  fireEvent.change(input, { target: { value: '{"synthetic":true}' } });
  fireEvent.blur(input);
  fireEvent.click(screen.getByRole('button', { name: f.label('integrations.send') }));
  await waitFor(() => {
    expect(f.requests.some((r) => r.path === '/v1/data-sources/preview')).toBe(true);
  });
  expect(f.requests.find((r) => r.path === '/v1/data-sources/preview')!.body).toMatchObject({
    call: { input: { synthetic: true }, environment: 'dev' },
  });
  if (status === 200) {
    expect(await screen.findByText(/synthetic-mapped/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: f.label('integrations.clearHistory') }));
    expect(screen.queryByText(/synthetic-mapped/)).toBeNull();
  } else expect(await screen.findByRole('alert')).toBeTruthy();
});
it('sends explicit live sandbox calls to the saved definition with CSRF', async () => {
  const f = await setup(false, {
    [`/v1/data-sources/${scriptId}/test`]: {
      request: {},
      response: {},
      mapped: 'synthetic-live-result',
      durationMs: 12,
      cached: true,
      mock: false,
      error: 'synthetic-trace-error',
    },
  });
  await tab(f, 'console');
  fireEvent.click(screen.getByRole('checkbox', { name: f.label('integrations.liveSandbox') }));
  fireEvent.click(screen.getByRole('button', { name: f.label('integrations.send') }));
  expect(await screen.findByText(/synthetic-live-result/)).toBeTruthy();
  expect(f.requests.find((r) => r.path.endsWith('/test'))!.body).toEqual({
    input: {},
    environment: 'dev',
  });
});
it('requests a profile promotion using an optimistic version and an explicit reason', async () => {
  const f = await setup(false, {
    [`/v1/data-sources/${scriptId}/promotion`]: { ...initial, version: 4 },
  });
  await tab(f, 'profiles');
  await choose(f.label('integrations.promoteFrom'), 'dev');
  change(f.label('integrations.reason'), 'Synthetic promotion reason');
  fireEvent.click(screen.getByRole('button', { name: f.label('integrations.requestPromotion') }));
  await waitFor(() => {
    expect(f.requests.some((r) => r.path.endsWith('/promotion'))).toBe(true);
  });
  const request = f.requests.find((r) => r.path.endsWith('/promotion'))!;
  expect(request.body).toEqual({ from: 'dev', reason: 'Synthetic promotion reason' });
  expect(new Headers(request.init?.headers).get('if-match')).toBe('"3"');
});
it.each([true, false])('imports WSDL operations with explicit namespace %s', async (namespace) => {
  const f = await setup(false, {
    [`POST /v1/data-sources/${scriptId}/wsdl`]: {
      operations: [{ name: 'SyntheticOperation', action: 'synthetic:action' }],
      ...(namespace ? { namespace: 'https://synthetic.example.test/namespace' } : {}),
    },
  });
  await tab(f, 'import');
  await choose(f.label('integrations.protocol'), 'SOAP');
  await tab(f, 'import');
  change(f.label('integrations.importSource'), '<synthetic-wsdl/>');
  fireEvent.click(screen.getByRole('button', { name: f.label('integrations.import') }));
  await screen.findByRole('combobox', { name: f.label('integrations.operation') });
  await choose(f.label('integrations.operation'), 'SyntheticOperation');
  await tab(f, 'request');
  expect(
    JSON.parse(screen.getByLabelText<HTMLTextAreaElement>(f.label('integrations.soap')).value),
  ).toMatchObject({ operation: 'SyntheticOperation', action: 'synthetic:action' });
  const request = f.requests.find((r) => r.path.endsWith('/wsdl'))!;
  expect(request.body).toEqual({ xml: '<synthetic-wsdl/>' });
  expect(new Headers(request.init?.headers).get('x-csrf-token')).toBe('synthetic-csrf-only');
});
it('imports YAML OpenAPI operations with local schemas and chooses their request definition', async () => {
  const f = await setup();
  await tab(f, 'import');
  change(
    f.label('integrations.importSource'),
    'openapi: 3.0.3\nservers:\n  - url: https://synthetic.example.test\npaths:\n  /synthetic/{id}:\n    get:\n      operationId: syntheticGet\n',
  );
  fireEvent.click(screen.getByRole('button', { name: f.label('integrations.import') }));
  await screen.findByRole('combobox', { name: f.label('integrations.operation') });
  await choose(f.label('integrations.operation'), 'GET /synthetic/{id}');
  await tab(f, 'request');
  expect(screen.getByLabelText<HTMLInputElement>(f.label('integrations.endpoint')).value).toBe(
    '/synthetic/{{input.id}}',
  );
});
it('introspects a saved GraphQL integration through the authenticated server boundary', async () => {
  const f = await setup(false, {
    [`POST /v1/data-sources/${scriptId}/introspection`]: {
      data: { __schema: { synthetic: true } },
    },
  });
  await tab(f, 'import');
  await choose(f.label('integrations.protocol'), 'GRAPHQL');
  await tab(f, 'import');
  fireEvent.click(screen.getByRole('button', { name: f.label('integrations.introspect') }));
  expect(await screen.findByText(/__schema/)).toBeTruthy();
  expect(f.requests.find((r) => r.path.endsWith('/introspection'))!.body).toEqual({
    environment: 'dev',
  });
});
it('requires saving a SOAP integration before importing its WSDL', async () => {
  const f = await setup(true);
  await tab(f, 'import');
  await choose(f.label('integrations.protocol'), 'SOAP');
  await tab(f, 'import');
  expect(
    screen.getByRole('button', { name: f.label('integrations.import') }).hasAttribute('disabled'),
  ).toBe(true);
  expect(screen.getByText(f.label('integrations.saveFirst'))).toBeTruthy();
});
it('reads a local import file and rejects files beyond the authoring size limit', async () => {
  const f = await setup();
  await tab(f, 'import');
  const input = screen.getByLabelText(f.label('integrations.file'));
  fireEvent.change(input, { target: { files: [] } });
  expect(screen.queryByRole('alert')).toBeNull();
  const source = "curl 'https://synthetic.example.test/uploaded'";
  fireEvent.change(input, { target: { files: [new NodeFile([source], 'synthetic.txt')] } });
  await waitFor(() => {
    expect(
      screen.getByLabelText<HTMLTextAreaElement>(f.label('integrations.importSource')).value,
    ).toBe(source);
  });
  fireEvent.click(screen.getByRole('button', { name: f.label('integrations.import') }));
  await tab(f, 'request');
  expect(screen.getByLabelText<HTMLInputElement>(f.label('integrations.endpoint')).value).toBe(
    '/uploaded',
  );
  await tab(f, 'import');
  fireEvent.change(screen.getByLabelText(f.label('integrations.file')), {
    target: { files: [new NodeFile(['x'.repeat(1048577)], 'synthetic-large.txt')] },
  });
  expect(await screen.findByText(f.label('integrations.importError'))).toBeTruthy();
});
