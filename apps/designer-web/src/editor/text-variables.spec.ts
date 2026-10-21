import { describe, expect, it } from 'vitest';

import {
  insertToken,
  messageTokens,
  paramsValueMap,
  parseParamsExpression,
  syncParamsBinding,
} from './text-variables.js';

describe('messageTokens', () => {
  it('finds simple placeholders across locales once, ignoring ICU plural/select blocks', () => {
    expect(
      messageTokens(
        'Merhaba {musteriAdi}, takip no {takipNo}.',
        'Hello {musteriAdi}, {count, plural, one {# item} other {# items}}',
      ),
    ).toEqual(['musteriAdi', 'takipNo']);
    expect(messageTokens(undefined, '', 'no tokens')).toEqual([]);
  });
});

describe('insertToken', () => {
  it('inserts at the caret and separates the token from adjacent words', () => {
    expect(insertToken('Merhaba', 'ad')).toEqual({ text: 'Merhaba {ad}', caret: 12 });
    expect(insertToken('Merhaba !', 'ad', 8)).toEqual({ text: 'Merhaba {ad}!', caret: 12 });
    expect(insertToken('Sayın bey', 'ad', 6)).toEqual({ text: 'Sayın {ad} bey', caret: 11 });
    expect(insertToken('', 'ad')).toEqual({ text: '{ad}', caret: 4 });
  });
});

describe('paramsValueMap', () => {
  it('maps only tokens that name variables', () => {
    expect(paramsValueMap(['ad', 'bilinmeyen'], ['ad'])).toEqual({ ad: { $expr: 'vars.ad' } });
    expect(paramsValueMap(['bilinmeyen'], ['ad'])).toBeUndefined();
  });
});

describe('params binding sync', () => {
  it('parses flat object literals and rejects anything richer', () => {
    expect(parseParamsExpression('{ name: vars.customerName, agent: agent.firstName }')).toEqual(
      new Map([
        ['name', 'vars.customerName'],
        ['agent', 'agent.firstName'],
      ]),
    );
    expect(parseParamsExpression('{ left: 3 - vars.otpAttempts }')).toBeNull();
    expect(parseParamsExpression('vars.params')).toBeNull();
  });
  it('adds generated pairs, removes them with their token and keeps author pairs', () => {
    const variables = ['musteriAdi', 'takipNo'];
    expect(syncParamsBinding({ bindings: [] }, ['musteriAdi'], variables)).toEqual({
      prop: 'params',
      expression: '{ musteriAdi: vars.musteriAdi }',
    });
    const authored = {
      bindings: [
        { prop: 'params', expression: '{ name: vars.customerName, takipNo: vars.takipNo }' },
      ],
    };
    expect(syncParamsBinding(authored, ['name'], variables)).toEqual({
      prop: 'params',
      expression: '{ name: vars.customerName }',
    });
    expect(syncParamsBinding({ bindings: [] }, ['unknown'], variables)).toBeUndefined();
  });
  it('never rewrites a custom expression or a variable binding', () => {
    expect(
      syncParamsBinding(
        { bindings: [{ prop: 'params', expression: '{ left: 3 - vars.otpAttempts }' }] },
        ['musteriAdi'],
        ['musteriAdi'],
      ),
    ).toBeNull();
    expect(
      syncParamsBinding(
        { bindings: [{ prop: 'params', variable: 'musteriAdi' }] },
        ['musteriAdi'],
        ['musteriAdi'],
      ),
    ).toBeNull();
  });
});
