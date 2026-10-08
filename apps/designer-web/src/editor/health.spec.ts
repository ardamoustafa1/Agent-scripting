import { describe, expect, it } from 'vitest';

import { ScriptDocumentSchema, VariableSchema } from '@verbis/script-schema';
import { minimalScript } from '@verbis/script-schema/fixtures';

import {
  HEALTH_CATEGORIES,
  categoryOf,
  hygieneIssues,
  issueTarget,
  scriptHealth,
} from './health.js';

import type { EditorIssue } from './store.js';

const issue = (code: string, severity = 'warning', path = ''): EditorIssue => ({
  code,
  severity,
  path,
  messageKey: `test.${code}`,
});

describe('scriptHealth', () => {
  it('scores a clean script 100 / excellent with every category present', () => {
    const health = scriptHealth([]);
    expect(health).toMatchObject({ score: 100, grade: 'excellent', errors: 0, warnings: 0 });
    expect(health.categories.map((c) => c.category)).toEqual([...HEALTH_CATEGORIES]);
  });

  it('caps any script with a blocking error below the passing grades', () => {
    const health = scriptHealth([issue('FLOW_CYCLE', 'error')]);
    expect(health.score).toBe(59);
    expect(health.grade).toBe('poor');
    expect(health.errors).toBe(1);
  });

  it('counts inspector field problems as data errors', () => {
    const health = scriptHealth([], 2);
    expect(health.errors).toBe(2);
    expect(health.score).toBeLessThanOrEqual(59);
    expect(health.categories.find((c) => c.category === 'data')?.penalty).toBe(24);
  });

  it('weighs repeats of one rule with diminishing returns', () => {
    const one = scriptHealth([issue('I18N_TRANSLATION_MISSING')]).score;
    const many = scriptHealth(
      Array.from({ length: 50 }, (_, i) => issue('I18N_TRANSLATION_MISSING', 'warning', `/${i}`)),
    );
    expect(one).toBe(96);
    // 4 × H(50) ≈ 18: fifty missing translations are one problem, not fifty.
    expect(many.score).toBe(82);
    expect(many.grade).toBe('good');
  });

  it('caps the penalty of a single category', () => {
    const health = scriptHealth(
      Array.from({ length: 40 }, (_, i) => issue(`I18N_CODE_${String(i)}`)),
    );
    expect(health.categories.find((c) => c.category === 'language')?.penalty).toBe(35);
    expect(health.score).toBe(65);
    expect(health.grade).toBe('fair');
  });

  it('weighs privacy and compliance findings double', () => {
    expect(scriptHealth([issue('VERBIS_LINT_LABEL')]).score).toBe(96);
    expect(scriptHealth([issue('VERBIS_LINT_UNUSED_SENSITIVE')]).score).toBe(92);
    // An unused PII variable plus an unlabeled input is no longer "excellent".
    expect(
      scriptHealth([issue('VERBIS_LINT_UNUSED_SENSITIVE'), issue('VERBIS_LINT_LABEL')]).grade,
    ).toBe('good');
  });

  it('is deterministic and independent of issue order', () => {
    const issues = [
      issue('FLOW_DEAD_END'),
      issue('VERBIS_LINT_LABEL'),
      issue('SENSITIVE_DATA_EXPOSED', 'error'),
      issue('VERBIS_LINT_UNUSED_VARIABLE', 'info'),
    ];
    expect(scriptHealth([...issues].reverse()).score).toBe(scriptHealth(issues).score);
  });
});

describe('categoryOf', () => {
  it.each([
    ['FLOW_NODE_UNREACHABLE', 'flow'],
    ['PAGE_UNREACHABLE', 'flow'],
    ['SUBFLOW_CYCLE', 'flow'],
    ['RULE_REF_BROKEN', 'flow'],
    ['VARIABLE_UNDEFINED', 'data'],
    ['VERBIS_EXPRESSION', 'data'],
    ['VERBIS_COMPONENT_PROPS', 'data'],
    ['SENSITIVE_DATA_EXPOSED', 'privacy'],
    ['CONSENT_PRESELECTED', 'privacy'],
    ['VERBIS_LINT_LEGAL', 'privacy'],
    ['VERBIS_LINT_UNUSED_SENSITIVE', 'privacy'],
    ['VERBIS_LINT_LABEL', 'accessibility'],
    ['I18N_KEY_MISSING', 'language'],
    ['VERBIS_LINT_DEBOUNCE', 'performance'],
    ['NODE_COUNT_EXCEEDED', 'performance'],
  ])('%s → %s', (code, category) => {
    expect(categoryOf(code)).toBe(category);
  });
});

describe('hygieneIssues', () => {
  it('reports unused variables, raising sensitive ones to privacy warnings', () => {
    const document = ScriptDocumentSchema.parse(minimalScript());
    document.variables.push(
      VariableSchema.parse({ key: 'notes', type: 'string', scope: 'session' }),
      VariableSchema.parse({ key: 'tckn', type: 'string', scope: 'session', pii: true }),
    );
    expect(hygieneIssues(document)).toEqual([
      {
        severity: 'info',
        code: 'VERBIS_LINT_UNUSED_VARIABLE',
        path: '/variables/0',
        messageKey: 'designer.health.issues.unusedVariable',
        params: { variable: 'notes' },
      },
      {
        severity: 'warning',
        code: 'VERBIS_LINT_UNUSED_SENSITIVE',
        path: '/variables/1',
        messageKey: 'designer.health.issues.unusedSensitive',
        params: { variable: 'tckn' },
      },
    ]);
  });
});

describe('issueTarget', () => {
  const document = ScriptDocumentSchema.parse(minimalScript());

  it('resolves a component pointer to its page and deepest node', () => {
    expect(issueTarget(document, '/pages/0/layout/children/0/props/labelKey')).toEqual({
      mode: 'screen',
      pageId: 'home',
      nodeId: 'btn-next',
    });
  });

  it('resolves the page layout root and page-level fields', () => {
    expect(issueTarget(document, '/pages/0/layout')).toEqual({
      mode: 'screen',
      pageId: 'home',
      nodeId: 'home-root',
    });
    expect(issueTarget(document, '/pages/0/titleKey')).toEqual({ mode: 'screen', pageId: 'home' });
  });

  it('stops at the last existing node when the pointer runs past the tree', () => {
    expect(issueTarget(document, '/pages/0/layout/children/9/props')).toEqual({
      mode: 'screen',
      pageId: 'home',
      nodeId: 'home-root',
    });
  });

  it('maps flow, rule and variable pointers to their editors', () => {
    expect(issueTarget(document, '/flow/nodes/0')).toEqual({ mode: 'flow' });
    expect(issueTarget(document, '/subflows/0/edges/1')).toEqual({ mode: 'flow' });
    expect(issueTarget(document, '/rules/0/when')).toEqual({ mode: 'rules' });
    expect(issueTarget(document, '/variables/2')).toEqual({ mode: 'variables' });
  });

  it('returns undefined for unknown roots and missing pages', () => {
    expect(issueTarget(document, '')).toBeUndefined();
    expect(issueTarget(document, '/dataSources/0')).toBeUndefined();
    expect(issueTarget(document, '/pages/7/layout')).toBeUndefined();
  });
});
