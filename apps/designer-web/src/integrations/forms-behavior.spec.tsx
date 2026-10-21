import { fireEvent, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { expect, it } from 'vitest';

import { mountDesigner } from '../fixtures.spec.helpers.js';

import {
  BodyField,
  ProfileSummary,
  SchemaFieldsEditor,
  TestInputFields,
  TraceView,
  UrlListField,
} from './forms.js';

function output(): unknown {
  const text = screen.getByTestId('out').textContent;
  return text === '' ? undefined : (JSON.parse(text) as unknown);
}
async function choose(name: string, option: string) {
  fireEvent.click(screen.getByRole('combobox', { name }));
  fireEvent.click(await screen.findByRole('option', { name: option }));
}
function change(label: string, value: string, index = 0) {
  const field = screen.getAllByLabelText(label)[index];
  if (!field) throw new Error(`no field ${label}`);
  fireEvent.change(field, { target: { value } });
}

function SchemaHarness({ initial }: { initial: Record<string, unknown> }) {
  const [schema, setSchema] = useState(initial);
  return (
    <>
      <SchemaFieldsEditor label="Synthetic fields" help="" schema={schema} onChange={setSchema} />
      <button
        type="button"
        onClick={() => {
          setSchema({ type: 'object', properties: { inferred: { type: 'boolean' } } });
        }}
      >
        replace
      </button>
      <output data-testid="out">{JSON.stringify(schema)}</output>
    </>
  );
}

it('builds an input schema from field rows without JSON', async () => {
  const f = await mountDesigner(<SchemaHarness initial={{}} />);
  expect(screen.getByText(f.label('integrations.forms.noFields'))).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: f.label('integrations.forms.addField') }));
  change(f.label('integrations.forms.fieldName'), 'customer.no');
  await choose(
    f.label('integrations.forms.fieldKind'),
    f.label('integrations.forms.kinds.integer'),
  );
  fireEvent.click(screen.getByRole('checkbox', { name: f.label('integrations.forms.required') }));
  expect(output()).toEqual({
    type: 'object',
    properties: {
      customer: { type: 'object', properties: { no: { type: 'integer' } }, required: ['no'] },
    },
  });
  fireEvent.click(screen.getByRole('button', { name: f.label('integrations.forms.addField') }));
  change(f.label('integrations.forms.fieldName'), '1-bad', 1);
  expect(screen.getByText(f.label('integrations.forms.fieldNameInvalid'))).toBeTruthy();
  expect(Object.keys((output() as { properties: object }).properties)).toEqual(['customer']);
  fireEvent.click(
    screen.getByRole('button', {
      name: f.label('integrations.forms.removeField').replace('{{field}}', 'customer.no'),
    }),
  );
  expect(output()).toEqual({ type: 'object', properties: {} });
});

it('reloads rows when the schema is replaced and keeps unsupported schemas in the JSON view', async () => {
  const f = await mountDesigner(
    <SchemaHarness initial={{ type: 'object', properties: { status: { type: 'string' } } }} />,
  );
  expect(
    screen.getByLabelText<HTMLInputElement>(f.label('integrations.forms.fieldName')).value,
  ).toBe('status');
  fireEvent.click(screen.getByRole('button', { name: 'replace' }));
  expect(
    screen.getByLabelText<HTMLInputElement>(f.label('integrations.forms.fieldName')).value,
  ).toBe('inferred');

  await mountDesigner(<SchemaHarness initial={{ oneOf: [{ type: 'string' }] }} />);
  expect(screen.getByText(f.label('integrations.forms.advancedSchema'))).toBeTruthy();
});

function UrlHarness() {
  const [values, setValues] = useState(['https://kept.example.test']);
  return (
    <>
      <UrlListField label="Synthetic origins" help="" values={values} onChange={setValues} />
      <output data-testid="out">{JSON.stringify(values)}</output>
    </>
  );
}
it('edits a URL list one address at a time and drops invalid entries', async () => {
  const f = await mountDesigner(<UrlHarness />);
  const url = f.label('integrations.forms.url');
  fireEvent.click(screen.getByRole('button', { name: f.label('integrations.forms.addUrl') }));
  change(`${url} 2`, 'not-a-url');
  expect(screen.getByText(f.label('integrations.forms.urlInvalid'))).toBeTruthy();
  expect(output()).toEqual(['https://kept.example.test']);
  change(`${url} 2`, 'https://added.example.test');
  expect(output()).toEqual(['https://kept.example.test', 'https://added.example.test']);
  fireEvent.click(screen.getAllByRole('button', { name: f.label('integrations.remove') })[0]!);
  expect(output()).toEqual(['https://added.example.test']);
});

function BodyHarness({ initial }: { initial: unknown }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <BodyField value={value} onChange={setValue} />
      <output data-testid="out">{value === undefined ? '' : JSON.stringify(value)}</output>
    </>
  );
}
it('authors a flat request body as fields and removes it again', async () => {
  const f = await mountDesigner(<BodyHarness initial={undefined} />);
  const mode = f.label('integrations.forms.bodyMode');
  await choose(mode, f.label('integrations.forms.bodyModes.form'));
  fireEvent.click(screen.getByRole('button', { name: f.label('preview.addField') }));
  change(f.label('integrations.forms.bodyField'), 'customerNo');
  change(f.label('integrations.forms.bodyValue'), '{{input.customerNo}}');
  expect(output()).toEqual({ customerNo: '{{input.customerNo}}' });
  await choose(mode, f.label('integrations.forms.bodyModes.none'));
  expect(output()).toBeUndefined();
});
it('opens nested request bodies in the JSON view', async () => {
  const f = await mountDesigner(<BodyHarness initial={{ customer: { no: 1 } }} />);
  expect(screen.getByLabelText<HTMLTextAreaElement>(f.label('integrations.body')).value).toContain(
    '"no": 1',
  );
});

function InputHarness() {
  const [value, setValue] = useState<unknown>({});
  return (
    <>
      <TestInputFields
        schema={{
          type: 'object',
          required: ['trackingNo'],
          properties: {
            trackingNo: { type: 'string' },
            customer: { type: 'object', properties: { age: { type: 'integer' } } },
          },
        }}
        value={value}
        onChange={setValue}
      />
      <output data-testid="out">{JSON.stringify(value)}</output>
    </>
  );
}
it('fills console test input from the declared input fields', async () => {
  const f = await mountDesigner(<InputHarness />);
  change(f.label('sources.requiredInput').replace('{{name}}', 'trackingNo'), 'TRK-1');
  change('customer.age', '42');
  expect(output()).toEqual({ trackingNo: 'TRK-1', customer: { age: 42 } });
});

it('summarises a test call without JSON and keeps the raw trace one click away', async () => {
  const f = await mountDesigner(
    <TraceView
      trace={{
        request: { method: 'GET', url: 'https://synthetic.example.test/track' },
        response: { raw: true },
        mapped: { status: 'delivered', items: [1, 2] },
        durationMs: 12,
        cached: true,
        mock: false,
        error: null,
      }}
    />,
  );
  expect(screen.getByText(f.label('integrations.success'))).toBeTruthy();
  expect(screen.getByText(/GET https:\/\/synthetic\.example\.test\/track/)).toBeTruthy();
  const table = screen.getByRole('table', { name: f.label('integrations.forms.mappedFields') });
  expect(within(table).getByRole('row', { name: 'status delivered' })).toBeTruthy();
  expect(within(table).getByRole('row', { name: 'items [2]' })).toBeTruthy();
  expect(screen.getByText(f.label('integrations.forms.rawTrace'))).toBeTruthy();
});
it('marks failed test calls with the error message', async () => {
  const f = await mountDesigner(
    <TraceView
      trace={{
        request: {},
        response: null,
        mapped: null,
        durationMs: 3,
        cached: false,
        mock: true,
        error: 'synthetic-timeout',
      }}
    />,
  );
  expect(screen.getByText(f.label('integrations.forms.failed'))).toBeTruthy();
  expect(screen.getByRole('alert').textContent).toContain('synthetic-timeout');
});

it('shows profile changes to the approver as labelled values', async () => {
  const f = await mountDesigner(
    <ProfileSummary
      value={{
        baseUrl: 'https://prod.example.test',
        auth: { type: 'bearer', secretRef: '01990000-0000-7000-8000-000000000001' },
      }}
    />,
  );
  expect(screen.getByText('https://prod.example.test')).toBeTruthy();
  expect(screen.getByText(f.label('integrations.authTypes.bearer'))).toBeTruthy();
  expect(screen.getByText(f.label('integrations.forms.secretStored'))).toBeTruthy();
});
