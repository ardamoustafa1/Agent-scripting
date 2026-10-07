import { describe, it, expect } from 'vitest';
import { z } from 'zod';

import {
  ActionSchema,
  ScriptDocumentSchema,
  PreviewContextSchema,
  NodeSchema,
} from '@verbis/script-schema';
import { minimalScript } from '@verbis/script-schema/fixtures';

import { PreviewController } from './controller.js';
import { previewLint } from './lint.js';

describe('preview recording and travel', () => {
  it('asserts the final values of recorded synthetic variable edits in saved scenarios', async () => {
    const document = ScriptDocumentSchema.parse(minimalScript());
    document.variables.push({
      key: 'parcel',
      type: 'string',
      scope: 'session',
      default: 'initial',
      classification: 'internal',
      pii: false,
      persist: false,
    });
    const preview = new PreviewController(document, PreviewContextSchema.parse({}), {});
    try {
      await preview.runtime.start();
      preview.runtime.store.setVariable('parcel', 'updated');
      preview.runtime.recordInput({ type: 'variable', variable: 'parcel', value: 'updated' });
      expect(preview.scenario('Parcel edit').expected.variables).toEqual({ parcel: 'updated' });
    } finally {
      preview.dispose();
    }
  });
  it('records user input, restores a prior page and drops the future branch', async () => {
    const document = ScriptDocumentSchema.parse(minimalScript());
    const preview = new PreviewController(document, PreviewContextSchema.parse({}), {});
    try {
      await preview.runtime.start();
      const row = preview.timeline.find(
        (entry) => entry.event.action === 'page' && entry.event.phase === 'started',
      );
      expect(row?.snapshot).toBeDefined();
      await preview.runtime.executor.execute([{ type: 'next' }], undefined, 'ui:btn-next');
      expect(preview.runtime.store.get('runtime.ended')).toBe(true);
      preview.jump(row!.id);
      expect(preview.runtime.store.get('runtime.page')).toBe('home');
      expect(preview.runtime.store.get('runtime.ended')).not.toBe(true);
      expect(preview.runtime.executor.debugger.paused).toBe(true);
      expect(preview.inputs).toHaveLength(0);
      expect(() => preview.scenario('Branch')).toThrow('VERBIS_PREVIEW_SYNTHETIC_ONLY');
    } finally {
      preview.dispose();
    }
  });
  it('saves inputs and expected outcome without session state telemetry', async () => {
    const preview = new PreviewController(
      ScriptDocumentSchema.parse(minimalScript()),
      PreviewContextSchema.parse({}),
      {},
    );
    try {
      await preview.runtime.start();
      await preview.runtime.executor.execute(
        [{ type: 'submitOutcome', outcome: 'DONE' }],
        undefined,
        'ui:submit',
      );
      const scenario = preview.scenario('Synthetic outcome');
      expect(scenario.synthetic).toBe(true);
      expect(scenario.expected.outcome).toBe('DONE');
      expect(scenario.steps).toHaveLength(1);
      expect(JSON.stringify(preview.timeline.map((row) => row.event))).not.toContain('DONE');
      preview.liveUsed = true;
      expect(() => preview.scenario('Unsafe')).toThrow('VERBIS_PREVIEW_SYNTHETIC_ONLY');
    } finally {
      preview.dispose();
    }
  });
  it('collects label, debounce, prechecked legal acknowledgement and submission warnings', () => {
    const doc = ScriptDocumentSchema.parse(minimalScript());
    const root = NodeSchema.parse(doc.pages[0]!.layout);
    doc.pages[0]!.layout = root;
    root.children!.push(
      { id: 'field', type: 'textInput', props: {}, bindings: [], events: {} },
      {
        id: 'service',
        type: 'webService',
        props: { trigger: 'onChange', debounceMs: 0 },
        bindings: [],
        events: {},
      },
      {
        id: 'legal',
        type: 'scriptText',
        props: { mustRead: true, acknowledged: true },
        bindings: [],
        events: {},
      },
      { id: 'submit', type: 'outcomeSubmit', props: { outcome: 'DONE' }, bindings: [], events: {} },
    );
    expect(previewLint(doc, []).map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        'VERBIS_LINT_LABEL',
        'VERBIS_LINT_DEBOUNCE',
        'VERBIS_LINT_LEGAL_PRECHECKED',
        'VERBIS_LINT_LEGAL',
      ]),
    );
    Object.assign(root.children!.find((node) => node.id === 'service')!.props, { debounceMs: 300 });
    expect(previewLint(doc, []).some((issue) => issue.code === 'VERBIS_LINT_DEBOUNCE')).toBe(false);
  });
});

describe('time travel, step diffs and watch expressions', () => {
  function document() {
    const doc = ScriptDocumentSchema.parse(minimalScript());
    doc.variables.push(
      {
        key: 'plan',
        type: 'string',
        scope: 'session',
        default: 'basic',
        classification: 'internal',
        pii: false,
        persist: false,
      },
      {
        key: 'tckn',
        type: 'string',
        scope: 'session',
        default: '',
        classification: 'pii',
        pii: true,
        persist: false,
      },
    );
    doc.pages[0]!.layout.children = [
      NodeSchema.parse({
        id: 'btn-next',
        type: 'button',
        props: { labelKey: 'common.next' },
        events: { onPress: press },
      }),
    ];
    return doc;
  }
  const press = z
    .array(ActionSchema)
    .parse([
      { type: 'setVariable', variable: 'plan', value: 'premium' },
      { type: 'setVariable', variable: 'tckn', value: '12345678901' },
      { type: 'next' },
    ]);

  it('shows which variables a step changed, masking personal data', async () => {
    const preview = new PreviewController(document(), PreviewContextSchema.parse({}), {});
    try {
      await preview.runtime.start();
      await preview.runtime.executor.execute(press, undefined, 'ui:btn-next');
      // Each change is reported on the step that made it; other steps report none.
      const changes = preview.timeline.flatMap((row) => preview.changes(row.id));
      expect(changes).toEqual([
        { variable: 'plan', masked: false, before: 'basic', after: 'premium' },
        { variable: 'tckn', masked: true },
      ]);
      expect(preview.changes(-1)).toEqual([]);
    } finally {
      preview.dispose();
    }
  });

  it('steps back to the previous snapshot and refuses when there is none', async () => {
    const preview = new PreviewController(document(), PreviewContextSchema.parse({}), {});
    try {
      await preview.runtime.start();
      expect(preview.stepBack()).toBe(false);
      await preview.runtime.executor.execute(press, undefined, 'ui:btn-next');
      expect(preview.runtime.store.get('runtime.ended')).toBe(true);
      expect(preview.stepBack()).toBe(true);
      expect(preview.runtime.store.get('runtime.ended')).not.toBe(true);
      expect(preview.branched).toBe(true);
    } finally {
      preview.dispose();
    }
  });

  it('evaluates watch expressions safely and masks anything reading personal data', async () => {
    const preview = new PreviewController(document(), PreviewContextSchema.parse({}), {});
    try {
      await preview.runtime.start();
      expect(preview.watch('vars.plan == "basic"')).toEqual({ status: 'value', value: true });
      expect(preview.watch('upper(vars.plan)')).toEqual({ status: 'value', value: 'BASIC' });
      expect(preview.watch('vars.tckn')).toEqual({ status: 'masked' });
      expect(preview.watch('constructor.constructor("return 1")()')).toEqual({ status: 'error' });
      expect(preview.watch('vars.plan +')).toEqual({ status: 'error' });
    } finally {
      preview.dispose();
    }
  });
});
