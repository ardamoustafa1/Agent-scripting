import { describe, expect, it } from 'vitest';

import { ScriptDocumentSchema, VariableSchema } from '@verbis/script-schema';
import { minimalScript } from '@verbis/script-schema/fixtures';

import {
  describePath,
  displayValue,
  excerptValue,
  fieldChanges,
  nodeTitle,
  type Translate,
} from './diff-text.js';

/** Key-echoing translator: `page(Home)`, `fields.default`, `type:number`. */
const t: Translate = (key, options) => {
  const short = key
    .replace('designer.lifecycle.diffText.', '')
    .replace('designer.editor.componentNames.', 'component:')
    .replace('designer.variables.types.', 'type:')
    .replace('designer.flow.types.', 'step:');
  const detail = ['name', 'count', 'locale']
    .map((name) => options[name])
    .filter((value) => value !== undefined)
    .map(String);
  return detail.length ? `${short}(${detail.join(',')})` : short;
};
const document = () => ScriptDocumentSchema.parse(minimalScript());

describe('displayValue', () => {
  it('reads values as words, never as JSON', () => {
    expect(displayValue(true, t)).toBe('designer.value.yes');
    expect(displayValue(null, t)).toBe('—');
    expect(displayValue(12, t)).toBe('12');
    expect(displayValue('Ada', t)).toBe('“Ada”');
    expect(displayValue('x'.repeat(80), t)).toHaveLength(62);
    expect(displayValue(['a', 'b'], t)).toBe('items(2)');
    expect(displayValue({ $expr: 'vars.x + 1' }, t)).toBe('expression');
    expect(displayValue({ $rule: 'is-vip' }, t)).toBe('rule(is-vip)');
    expect(displayValue({ a: 1, b: 2 }, t)).toBe('settings(2)');
    expect(displayValue({ x: 1, y: 2 }, t, 'flowNode', 'position')).toBe('moved');
    expect(displayValue('tenant-datasource:crm', t, 'dataSource', 'ref')).toBe('crm');
    expect(displayValue('number', t, 'variable', 'type')).toBe('type:number');
  });
});

describe('fieldChanges', () => {
  it('lists only the fields that differ, labelled and with readable values', () => {
    const before = VariableSchema.parse({
      key: 'name',
      type: 'string',
      scope: 'session',
      default: 'old',
    });
    const after = { ...before, default: 'new', type: 'number' as const };
    expect(fieldChanges(before, after, t, 'variable')).toEqual([
      { field: 'fields.type', before: 'type:string', after: 'type:number' },
      { field: 'fields.default', before: '“old”', after: '“new”' },
    ]);
    expect(fieldChanges({ id: 'a', children: [1] }, { id: 'b', children: [] }, t)).toEqual([]);
  });
});

describe('describePath', () => {
  it('names pages, components and fields of index-based pointers', () => {
    expect(describePath('/pages/0/layout/children/0/props/labelKey', document(), t)).toBe(
      'page(Home) › component:button “btn-next” › fields.props › fields.labelKey',
    );
    expect(describePath('/pages/0/name', document(), t)).toBe('page(Home) › fields.name');
  });
  it('names items of id-keyed merge paths, with or without the document', () => {
    expect(describePath('/pages/home/layout/children/btn-next/props', document(), t)).toBe(
      'page(Home) › component:button “btn-next” › fields.props',
    );
    expect(describePath('/pages/home/layout/children/btn-next', undefined, t)).toBe(
      'page(home) › component(btn-next)',
    );
    expect(describePath('/pages/home/layout/type', undefined, t)).toBe(
      'page(home) › layout › fields.type',
    );
  });
  it('names flow steps, connections, variables, rules and texts', () => {
    const doc = document();
    doc.variables.push(
      VariableSchema.parse({ key: 'customerNo', type: 'string', scope: 'session' }),
    );
    doc.rules.push({
      id: 'vip',
      description: 'VIP customer',
      when: { fact: 'vars.x', op: 'exists' },
      then: [],
    });
    expect(describePath('/flow/nodes/0/page', doc, t)).toBe('mainFlow › Home › fields.page');
    expect(describePath('/flow/edges/e1', doc, t)).toBe('mainFlow › Home → step:end');
    expect(describePath('/flow/nodes/n-gone', doc, t)).toBe('mainFlow › step(n-gone)');
    expect(describePath('/variables/customerNo/default', doc, t)).toBe(
      'variable(customerNo) › fields.default',
    );
    expect(describePath('/variables/0', doc, t)).toBe('variable(customerNo)');
    expect(describePath('/rules/0/when', doc, t)).toBe('ruleItem(VIP customer) › fields.when');
    expect(describePath('/i18n/messages/tr/common.next', doc, t)).toBe('texts(common.locale.tr)');
    expect(describePath('/meta/name', doc, t)).toBe('fields.meta › fields.name');
    expect(describePath('not-a-pointer', doc, t)).toBe('not-a-pointer');
  });
});

describe('excerptValue and nodeTitle', () => {
  it('reads bounded JSON excerpts and node ids', () => {
    expect(excerptValue(null, t)).toBe('absent');
    expect(excerptValue('"Mainline"', t)).toBe('“Mainline”');
    expect(excerptValue('{"id":"r1","x":1', t)).toBe('longValue');
    expect(nodeTitle(document(), 'home-root', t)).toBe('page(Home)');
    expect(nodeTitle(document(), 'btn-next', t)).toBe('component:button “btn-next”');
    expect(nodeTitle(undefined, 'btn-next', t)).toBe('component(btn-next)');
  });
});
