import { describe, expect, it } from 'vitest';

import { inputFields, outputId, responseFields, suggestInput } from './source-binding.js';

const response = {
  type: 'object',
  required: ['status'],
  properties: {
    status: { type: 'string' },
    eta: { type: 'string', format: 'date' },
    attempts: { type: 'integer' },
    delivered: { type: ['boolean', 'null'] },
    events: { type: 'array', items: { type: 'object' } },
    courier: { type: 'object', properties: { full_name: { type: 'string' } } },
    'bad-key': { type: 'string' },
  },
};

describe('responseFields', () => {
  it('flattens nested objects into JSONPaths with variable types', () => {
    expect(responseFields(response)).toEqual([
      { path: '$.status', name: 'status', type: 'string', required: true },
      { path: '$.eta', name: 'eta', type: 'date', required: false },
      { path: '$.attempts', name: 'attempts', type: 'number', required: false },
      { path: '$.delivered', name: 'delivered', type: 'boolean', required: false },
      { path: '$.events', name: 'events', type: 'array', required: false },
      { path: '$.courier.full_name', name: 'full_name', type: 'string', required: false },
    ]);
    expect(responseFields({})).toEqual([]);
    expect(responseFields(null)).toEqual([]);
  });
});

describe('inputs', () => {
  it('keeps identifier inputs and suggests the same-named variable', () => {
    expect(
      inputFields({
        required: ['trackingNo'],
        properties: { trackingNo: { type: 'string' }, 'x-id': { type: 'string' } },
      }),
    ).toEqual([{ path: 'trackingNo', name: 'trackingNo', type: 'string', required: true }]);
    expect(suggestInput('tracking_no', ['takip', 'trackingNo'])).toEqual({
      $expr: 'vars.trackingNo',
    });
    expect(suggestInput('unknown', ['trackingNo'])).toBeUndefined();
  });
});

describe('outputId', () => {
  it('derives a unique camelCase id from the last path segment', () => {
    expect(outputId('$.courier.full_name', [])).toBe('fullName');
    expect(outputId('$.status', ['status'])).toBe('status2');
    expect(outputId('$.2fa', [])).toBe('field2fa');
  });
});
