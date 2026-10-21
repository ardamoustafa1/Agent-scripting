import { describe, expect, it } from 'vitest';

import { NodeSchema } from '@verbis/script-schema';

import { paletteInsertIndex, variableForInput, variableKeyFromLabel } from './value-variable.js';

describe('variableKeyFromLabel', () => {
  it('turns a Turkish label into a camelCase identifier', () => {
    expect(variableKeyFromLabel('Kargo takip numarası', [])).toBe('kargoTakipNumarasi');
    expect(variableKeyFromLabel('Müşteri Şikayet Türü', [])).toBe('musteriSikayetTuru');
    expect(variableKeyFromLabel('T.C. kimlik numarası', [])).toBe('tcKimlikNumarasi');
  });
  it('keeps keys unique, valid when the label starts with a digit and non-empty', () => {
    expect(variableKeyFromLabel('Telefon', ['telefon', 'telefon2'])).toBe('telefon3');
    expect(variableKeyFromLabel('2. adres', [])).toBe('alan2Adres');
    expect(variableKeyFromLabel('***', [])).toBe('alan');
    expect(variableKeyFromLabel('a'.repeat(100), []).length).toBeLessThanOrEqual(64);
  });
});

describe('variableForInput', () => {
  it('matches the value type each component writes at runtime', () => {
    expect(variableForInput('textInput', 'a')).toMatchObject({ type: 'string', default: '' });
    expect(variableForInput('numberInput', 'a')).toMatchObject({ type: 'number', default: 0 });
    expect(variableForInput('rating', 'a').type).toBe('number');
    expect(variableForInput('toggle', 'a')).toMatchObject({ type: 'boolean', default: false });
    expect(variableForInput('checkboxGroup', 'a')).toMatchObject({ type: 'array', default: [] });
    expect(variableForInput('datePicker', 'a').type).toBe('string');
  });
  it('names the variable after the field label for empty-value placeholders', () => {
    expect(variableForInput('tcknInput', 'kimlik', ' T.C. Kimlik Numarası ').description).toBe(
      't.c. kimlik numarası',
    );
    expect(variableForInput('textInput', 'a', '   ').description).toBeUndefined();
    expect(variableForInput('textInput', 'a').description).toBeUndefined();
  });
  it('classifies personal and card data and leaves sensitive defaults empty', () => {
    const identity = variableForInput('tcknInput', 'kimlik');
    expect(identity).toMatchObject({ classification: 'pii', pii: true, type: 'string' });
    expect(identity.default).toBeUndefined();
    const address = variableForInput('addressInput', 'adres');
    expect(address).toMatchObject({ classification: 'pii', type: 'object' });
    expect(address.default).toBeUndefined();
    expect(variableForInput('creditCardInput', 'kart').classification).toBe('pci');
    expect(variableForInput('select', 'secim')).toMatchObject({
      classification: 'internal',
      pii: false,
    });
  });
});

describe('paletteInsertIndex', () => {
  const root = (children: unknown[]) => NodeSchema.parse({ id: 'root', type: 'box', children });
  const next = { id: 'btn-next', type: 'button', events: { onPress: [{ type: 'next' }] } };
  it('lands before the trailing navigation buttons', () => {
    expect(paletteInsertIndex(root([next]))).toBe(0);
    expect(
      paletteInsertIndex(
        root([{ id: 'title', type: 'heading' }, { id: 'back', type: 'backButton' }, next]),
      ),
    ).toBe(1);
  });
  it('appends when the page does not end with navigation', () => {
    expect(paletteInsertIndex(root([]))).toBeUndefined();
    expect(paletteInsertIndex(root([next, { id: 'title', type: 'heading' }]))).toBeUndefined();
    expect(
      paletteInsertIndex(
        root([{ id: 'plain', type: 'button', events: { onPress: [{ type: 'closeModal' }] } }]),
      ),
    ).toBeUndefined();
  });
});
