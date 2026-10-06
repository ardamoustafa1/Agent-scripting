import { expect, it, vi } from 'vitest';

import {
  ScriptDocumentSchema,
  PreviewContextSchema,
  DataSourceRefSchema,
  VariableSchema,
} from '@verbis/script-schema';
import { minimalScript } from '@verbis/script-schema/fixtures';

import { PreviewController } from './controller.js';

function document() {
  const doc = ScriptDocumentSchema.parse(minimalScript());
  doc.dataSources.push(
    DataSourceRefSchema.parse({
      id: 'synthetic',
      ref: 'tenant-datasource:synthetic',
      version: 1,
      outputs: { result: { path: '$.result' } },
    }),
  );
  return doc;
}
it('uses only explicitly selected live sources and forbids recording their results', async () => {
  const live = vi.fn().mockResolvedValue({ result: 'synthetic-response' });
  const preview = new PreviewController(
    document(),
    PreviewContextSchema.parse({}),
    {},
    live,
    new Set(['synthetic']),
  );
  try {
    await preview.runtime.executor.execute([{ type: 'callDataSource', dataSource: 'synthetic' }]);
    expect(live).toHaveBeenCalledOnce();
    expect(live).toHaveBeenCalledWith(expect.objectContaining({ id: 'synthetic', version: 1 }));
    expect(preview.liveUsed).toBe(true);
    expect(() => preview.scenario('Unsafe record')).toThrow('VERBIS_PREVIEW_SYNTHETIC_ONLY');
  } finally {
    preview.dispose();
  }
});
it('rejects a selected live source without an authorized live transport', async () => {
  const preview = new PreviewController(
    document(),
    PreviewContextSchema.parse({}),
    {},
    undefined,
    new Set(['synthetic']),
  );
  try {
    await expect(
      preview.runtime.executor.execute([{ type: 'callDataSource', dataSource: 'synthetic' }]),
    ).rejects.toThrow();
    expect(preview.liveUsed).toBe(false);
  } finally {
    preview.dispose();
  }
});
it.each(['pii', 'pci'] as const)(
  'rejects recording initial %s values and subsequent sensitive inputs',
  (classification) => {
    const doc = document();
    doc.variables.push(
      VariableSchema.parse({
        key: 'privateValue',
        type: 'string',
        scope: 'session',
        classification,
      }),
    );
    const initial = new PreviewController(
      doc,
      PreviewContextSchema.parse({ variables: { privateValue: 'synthetic-value' } }),
      {},
    );
    try {
      expect(() => initial.scenario('Unsafe initial')).toThrow('VERBIS_PREVIEW_SYNTHETIC_ONLY');
    } finally {
      initial.dispose();
    }
    const changed = new PreviewController(doc, PreviewContextSchema.parse({}), {});
    try {
      changed.inputs.push({ type: 'variable', variable: 'privateValue', value: 'synthetic-value' });
      expect(() => changed.scenario('Unsafe input')).toThrow('VERBIS_PREVIEW_SYNTHETIC_ONLY');
      changed.inputs.length = 0;
      expect(changed.scenario('Safe empty').synthetic).toBe(true);
    } finally {
      changed.dispose();
    }
  },
);
