import { describe, expect, it } from 'vitest';

import { ScriptDocumentSchema } from '@verbis/script-schema';
import { surveyScript } from '@verbis/script-schema/fixtures';

import { needsAttention, processingCsv, processingRows } from './processing-record.js';

const doc = ScriptDocumentSchema.parse({
  ...surveyScript,
  variables: [
    ...(surveyScript.variables ?? []),
    { key: 'customerName', type: 'string', scope: 'session', classification: 'pii', persist: true },
    { key: 'cardRef', type: 'string', scope: 'session', classification: 'pci' },
    { key: 'counter', type: 'number', scope: 'session' },
  ],
});

describe('processing record', () => {
  it('has exactly one row per classified variable and never values', () => {
    const rows = processingRows({ id: 's1', name: 'Survey', versionNumber: 3 }, doc);
    expect(rows.map((r) => r.variable)).toEqual(
      expect.arrayContaining(['cardRef', 'customerName']),
    );
    expect(rows.map((r) => r.variable)).not.toContain('counter');
    expect(rows.every((r) => r.versionNumber === 3 && r.scriptId === 's1')).toBe(true);
    expect(rows.find((r) => r.variable === 'customerName')?.persisted).toBe(true);
    expect(JSON.stringify(rows)).not.toMatch(/counter/);
  });
  it('flags card data anywhere and personal data sent to log or analytics', () => {
    const base = { variable: 'v', origins: [], persisted: false };
    expect(
      needsAttention({
        ...base,
        classification: 'pci',
        destinations: [{ kind: 'screen', path: '/a' }],
      }),
    ).toBe(true);
    expect(
      needsAttention({
        ...base,
        classification: 'pii',
        destinations: [{ kind: 'screen', path: '/a' }],
      }),
    ).toBe(false);
    expect(
      needsAttention({
        ...base,
        classification: 'pii',
        destinations: [{ kind: 'analytics', path: '/a' }],
      }),
    ).toBe(true);
    expect(needsAttention({ ...base, classification: 'pci', destinations: [] })).toBe(false);
  });
  it('writes a BOM-prefixed RFC 4180 CSV that neutralises formulas', () => {
    const csv = processingCsv([
      {
        scriptId: 's',
        scriptName: '=1+1',
        versionNumber: 1,
        variable: 'a"b',
        classification: 'pii',
        origins: 'script',
        destinations: 'screen:/x',
        persisted: false,
        attention: false,
      },
    ]);
    expect(csv.startsWith('﻿"scriptId"')).toBe(true);
    expect(csv).toContain(`"'=1+1"`);
    expect(csv).toContain('"a""b"');
    expect(csv.split('\r\n')).toHaveLength(2);
  });
});
