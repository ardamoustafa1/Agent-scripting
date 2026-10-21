import { VariableSchema, type Variable } from '@verbis/script-schema';

import { jsonDefault } from '../flow/variables.js';

/**
 * Quick "store this field in a variable" support for the inspector. The variable type must match
 * what the component writes at runtime, because the runtime store rejects mismatched values.
 */
const NUMBER_INPUTS = new Set(['numberInput', 'currencyInput', 'slider', 'rating']);
const BOOLEAN_INPUTS = new Set(['checkbox', 'toggle']);
const ARRAY_INPUTS = new Set(['multiSelect', 'checkboxGroup']);
const OBJECT_INPUTS = new Set(['addressInput']);
const PII_INPUTS = new Set([
  'tcknInput',
  'vknInput',
  'ibanInput',
  'phoneInput',
  'emailInput',
  'addressInput',
]);
const PCI_INPUTS = new Set(['creditCardInput']);

const TURKISH: Record<string, string> = {
  ç: 'c',
  ğ: 'g',
  ı: 'i',
  ö: 'o',
  ş: 's',
  ü: 'u',
  â: 'a',
  î: 'i',
  û: 'u',
};

/** `Kargo takip numarası` → `kargoTakipNumarasi`; unique against `taken`, ≤ 64 chars. */
export function variableKeyFromLabel(label: string, taken: Iterable<string>): string {
  const words = label
    .toLocaleLowerCase('tr')
    .replace(/[çğıöşüâîû]/g, (char) => TURKISH[char] ?? char)
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    // Abbreviations such as "T.C." become one word ("tc") instead of "tC".
    .reduce<string[]>((merged, word) => {
      const last = merged.at(-1);
      if (last && word.length === 1 && /^[a-z]+$/.test(last) && last.length <= 2)
        merged[merged.length - 1] = last + word;
      else merged.push(word);
      return merged;
    }, []);
  let base = words
    .map((word, index) => (index === 0 ? word : word.charAt(0).toUpperCase() + word.slice(1)))
    .join('');
  if (!/^[a-z]/.test(base)) base = `alan${base.charAt(0).toUpperCase()}${base.slice(1)}`;
  base = base.slice(0, 60);
  const used = new Set(taken);
  let key = base,
    suffix = 2;
  while (used.has(key)) key = `${base}${suffix++}`;
  return key;
}

/**
 * A session variable shaped for the given input type, with the matching classification. The
 * field's label becomes its display name, so a text that needs the value before the agent typed
 * it reads "[t.c. kimlik numarası]" rather than the variable's code name.
 */
export function variableForInput(type: string, key: string, label?: string): Variable {
  const variableType = NUMBER_INPUTS.has(type)
    ? 'number'
    : BOOLEAN_INPUTS.has(type)
      ? 'boolean'
      : ARRAY_INPUTS.has(type)
        ? 'array'
        : OBJECT_INPUTS.has(type)
          ? 'object'
          : 'string';
  const classification = PCI_INPUTS.has(type) ? 'pci' : PII_INPUTS.has(type) ? 'pii' : 'internal';
  const sensitive = classification !== 'internal';
  return VariableSchema.parse({
    key,
    type: variableType,
    scope: 'session',
    classification,
    pii: sensitive,
    ...(label?.trim() ? { description: label.trim().slice(0, 60).toLocaleLowerCase('tr') } : {}),
    // Sensitive defaults must stay empty; the agent or a protected source fills them.
    ...(sensitive ? {} : { default: jsonDefault(variableType) }),
  });
}

const NAVIGATION_TYPES = new Set(['nextButton', 'backButton', 'buttonGroup', 'outcomeSubmit']);
const NAVIGATION_ACTIONS = new Set(['next', 'back', 'navigate', 'submitOutcome']);

function isNavigation(node: unknown): boolean {
  if (typeof node !== 'object' || node === null) return false;
  const { type, events } = node as { type?: unknown; events?: unknown };
  if (typeof type !== 'string') return false;
  if (NAVIGATION_TYPES.has(type)) return true;
  if (type !== 'button' && type !== 'actionButton') return false;
  const press: unknown =
    typeof events === 'object' && events !== null ? Reflect.get(events, 'onPress') : undefined;
  return (
    Array.isArray(press) &&
    press.some(
      (action: unknown) =>
        typeof action === 'object' &&
        action !== null &&
        NAVIGATION_ACTIONS.has(String(Reflect.get(action, 'type'))),
    )
  );
}

/**
 * Where a palette click lands in a page root: before the trailing run of navigation buttons, so
 * "Next"/"Back" stay at the bottom of the page. `undefined` appends.
 */
export function paletteInsertIndex(container: {
  children?: readonly unknown[] | undefined;
}): number | undefined {
  const children = container.children ?? [];
  let index = children.length;
  while (index > 0 && isNavigation(children[index - 1])) index--;
  return index === children.length ? undefined : index;
}
