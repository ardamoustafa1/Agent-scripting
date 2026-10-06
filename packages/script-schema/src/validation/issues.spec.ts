import { describe, expect, it } from 'vitest';

import { en, flattenKeys, tr } from '@verbis/i18n';

import { createIssue, hasErrors, messageKeyFor, VALIDATION_CODES } from './issues.js';

describe('messageKeyFor', () => {
  it('derives camelCase keys', () => {
    expect(messageKeyFor('FLOW_CYCLE')).toBe('script.validation.flowCycle');
    expect(messageKeyFor('I18N_KEY_MISSING')).toBe('script.validation.i18nKeyMissing');
  });

  it('every code has tr and en messages (CLAUDE.md rule 5)', () => {
    const trKeys = new Set(flattenKeys(tr));
    const enKeys = new Set(flattenKeys(en));
    for (const code of VALIDATION_CODES) {
      expect(trKeys, code).toContain(messageKeyFor(code));
      expect(enKeys, code).toContain(messageKeyFor(code));
    }
  });

  it('codes are unique', () => {
    expect(new Set(VALIDATION_CODES).size).toBe(VALIDATION_CODES.length);
  });
});

describe('createIssue / hasErrors', () => {
  it('omits params when not given', () => {
    expect(createIssue('warning', 'FLOW_DEAD_END', '/flow')).toEqual({
      severity: 'warning',
      path: '/flow',
      code: 'FLOW_DEAD_END',
      messageKey: 'script.validation.flowDeadEnd',
    });
    expect(createIssue('error', 'DUPLICATE_ID', '', { id: 'a' }).params).toEqual({ id: 'a' });
  });

  it('detects errors', () => {
    expect(hasErrors([createIssue('warning', 'FLOW_DEAD_END', '')])).toBe(false);
    expect(
      hasErrors([createIssue('info', 'FLOW_DEAD_END', ''), createIssue('error', 'FLOW_CYCLE', '')]),
    ).toBe(true);
  });
});
