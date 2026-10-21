import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  JsonPathSchema,
  VariableSchema,
  type DataSourceRef,
  type ScriptDocument,
  type Variable,
} from '@verbis/script-schema';
import { Button, Input, Select } from '@verbis/ui';

import { jsonDefault } from '../flow/variables.js';

import { inputFields, outputId, responseFields, type SchemaField } from './source-binding.js';
import { ValueEditor, emptyValue, valueKind } from './value-editor.js';
import { variableKeyFromLabel } from './value-variable.js';

type Inputs = DataSourceRef['inputs'];
type Outputs = DataSourceRef['outputs'];
const NONE = '__none__',
  RAW = '__raw__',
  NEW = '__new__';

/** A session variable for a response field; dates stay text because services vary in format. */
export function variableForField(field: Pick<SchemaField, 'name' | 'type'>, taken: string[]) {
  const key = variableKeyFromLabel(field.name.replace(/_/g, ' '), taken);
  const type = field.type === 'date' ? 'string' : field.type;
  return VariableSchema.parse({ key, type, scope: 'session', default: jsonDefault(type) });
}

/**
 * Inputs and outputs of a data source binding as rows. Declared fields come from the
 * integration's JSON Schemas; without them authors add rows by hand. No JSON is typed.
 */
export function SourceMapping({
  document,
  inputSchema,
  outputSchema,
  inputs,
  outputs,
  pending,
  onInputs,
  onOutputs,
  onPending,
}: {
  document: ScriptDocument;
  inputSchema: unknown;
  outputSchema: unknown;
  inputs: Inputs;
  outputs: Outputs;
  pending: readonly Variable[];
  onInputs: (inputs: Inputs) => void;
  onOutputs: (outputs: Outputs) => void;
  onPending: (variables: Variable[]) => void;
}) {
  const { t } = useTranslation();
  const variables = [...document.variables, ...pending].map((v) => ({ key: v.key, type: v.type }));
  const declaredInputs = inputFields(inputSchema);
  const manualInputs = Object.keys(inputs).filter(
    (name) => !declaredInputs.some((field) => field.name === name),
  );
  const declaredOutputs = responseFields(outputSchema);
  const manualOutputs = Object.entries(outputs).filter(
    ([, output]) => !declaredOutputs.some((field) => field.path === output.path),
  );
  const [inputName, setInputName] = useState(''),
    [outputPath, setOutputPath] = useState('$.');
  const outputFor = (path: string) => Object.entries(outputs).find(([, o]) => o.path === path);
  const assign = (field: Pick<SchemaField, 'path' | 'name' | 'type'>, choice: string) => {
    const existing = outputFor(field.path);
    const next = { ...outputs };
    if (existing) Reflect.deleteProperty(next, existing[0]);
    if (choice === NONE) {
      onOutputs(next);
      return;
    }
    const id = existing?.[0] ?? outputId(field.path, Object.keys(next));
    if (choice === RAW) next[id] = { path: field.path };
    else if (choice === NEW) {
      const created = variableForField(
        field,
        variables.map((v) => v.key),
      );
      onPending([...pending, created]);
      next[id] = { path: field.path, variable: created.key };
    } else next[id] = { path: field.path, variable: choice };
    onOutputs(next);
  };
  const choices = (field: Pick<SchemaField, 'type'>) => [
    { value: NONE, label: t('designer.sources.notUsed') },
    { value: RAW, label: t('designer.sources.componentsOnly') },
    ...variables
      .filter((v) => field.type === 'object' || v.type === field.type || v.type === 'string')
      .map((v) => ({ value: v.key, label: v.key, hint: t(`designer.variables.types.${v.type}`) })),
    { value: NEW, label: t('designer.sources.newVariable') },
  ];
  return (
    <>
      <fieldset className="ed-value">
        <legend>{t('designer.sources.inputs')}</legend>
        <p className="ed-help">
          {t(
            declaredInputs.length
              ? 'designer.sources.inputsHelp'
              : 'designer.sources.noInputSchema',
          )}
        </p>
        {[...declaredInputs.map((field) => field.name), ...manualInputs].map((name) => {
          const field = declaredInputs.find((f) => f.name === name);
          const kind = valueKind(field?.type);
          return (
            <div key={name} className="ed-attribute-row">
              <ValueEditor
                label={field?.required ? t('designer.sources.requiredInput', { name }) : name}
                value={inputs[name] ?? emptyValue(kind)}
                kind={kind}
                variables={variables}
                onChange={(value) => {
                  onInputs({ ...inputs, [name]: value });
                }}
              />
              {name in inputs && !field?.required && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    const next = { ...inputs };
                    Reflect.deleteProperty(next, name);
                    onInputs(next);
                  }}
                >
                  {t('designer.sources.removeInput', { name })}
                </Button>
              )}
            </div>
          );
        })}
        <div className="ed-inline-add">
          <Input
            label={t('designer.sources.inputName')}
            value={inputName}
            onChange={(event) => {
              setInputName(event.target.value.trim());
            }}
          />
          <Button
            size="sm"
            variant="secondary"
            disabled={!/^[a-z][a-zA-Z0-9]*$/.test(inputName) || inputName in inputs}
            onClick={() => {
              onInputs({ ...inputs, [inputName]: '' });
              setInputName('');
            }}
          >
            {t('designer.sources.addInput')}
          </Button>
        </div>
      </fieldset>
      <fieldset className="ed-value">
        <legend>{t('designer.sources.outputs')}</legend>
        <p className="ed-help">
          {t(
            declaredOutputs.length
              ? 'designer.sources.outputsHelp'
              : 'designer.sources.noOutputSchema',
          )}
        </p>
        {declaredOutputs.map((field) => {
          const current = outputFor(field.path)?.[1];
          return (
            <Select
              key={field.path}
              label={t('designer.sources.outputField', { path: field.path.slice(2) })}
              value={current ? (current.variable ?? RAW) : NONE}
              options={choices(field)}
              onValueChange={(choice) => {
                assign(field, choice);
              }}
            />
          );
        })}
        {manualOutputs.map(([id, output]) => (
          <div key={id} className="ed-attribute-row">
            <Select
              label={t('designer.sources.outputField', { path: output.path.slice(2) })}
              value={output.variable ?? RAW}
              options={choices({ type: 'string' })}
              onValueChange={(choice) => {
                assign({ path: output.path, name: id, type: 'string' }, choice);
              }}
            />
          </div>
        ))}
        <div className="ed-inline-add">
          <Input
            label={t('designer.sources.outputPath')}
            hint={t('designer.sources.outputPathHint')}
            value={outputPath}
            onChange={(event) => {
              setOutputPath(event.target.value.trim());
            }}
          />
          <Button
            size="sm"
            variant="secondary"
            disabled={!JsonPathSchema.safeParse(outputPath).success || !!outputFor(outputPath)}
            onClick={() => {
              assign(
                { path: outputPath, name: outputPath.split('.').at(-1) ?? 'value', type: 'string' },
                RAW,
              );
              setOutputPath('$.');
            }}
          >
            {t('designer.sources.addOutput')}
          </Button>
        </div>
      </fieldset>
    </>
  );
}
