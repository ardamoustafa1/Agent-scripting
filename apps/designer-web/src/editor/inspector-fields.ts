/**
 * D-08: which property fields the inspector offers for a component. The input schema is shared by
 * ~20 input types, so the generic field list showed bounds, currency, masks, etc. on every one.
 */
const TEXT_ENTRY = ['labelKey', 'hintKey', 'placeholderKey', 'required', 'disabled'];
const CHOICE = ['labelKey', 'hintKey', 'options', 'required', 'disabled'];
const BASE = ['labelKey', 'hintKey', 'required', 'disabled'];
const INPUT_FIELDS: Record<string, { primary: readonly string[]; advanced?: readonly string[] }> = {
  textInput: { primary: TEXT_ENTRY, advanced: ['maxLength'] },
  textArea: { primary: TEXT_ENTRY, advanced: ['maxLength'] },
  emailInput: { primary: TEXT_ENTRY },
  phoneInput: { primary: TEXT_ENTRY, advanced: ['country'] },
  addressInput: { primary: TEXT_ENTRY },
  maskedInput: { primary: [...TEXT_ENTRY, 'mask'] },
  numberInput: { primary: [...TEXT_ENTRY, 'min', 'max', 'step'] },
  currencyInput: { primary: [...TEXT_ENTRY, 'currency', 'min', 'max', 'step'] },
  slider: { primary: [...BASE, 'min', 'max', 'step'] },
  rating: { primary: [...BASE, 'max'] },
  datePicker: { primary: [...BASE, 'min', 'max'] },
  timePicker: { primary: [...BASE, 'min', 'max'] },
  select: { primary: CHOICE },
  multiSelect: { primary: CHOICE },
  radioGroup: { primary: CHOICE },
  checkboxGroup: { primary: CHOICE },
  checkbox: { primary: [...BASE, 'checked'] },
  toggle: { primary: [...BASE, 'checked'] },
};
/** Returns null for non-input types (they keep the category-based grouping). */
export function inputFieldKeys(type: string, category: string | undefined) {
  if (category !== 'input') return null;
  const entry = INPUT_FIELDS[type] ?? { primary: TEXT_ENTRY };
  return { primary: entry.primary, advanced: entry.advanced ?? [] };
}
