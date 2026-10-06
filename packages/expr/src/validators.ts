import { RE2JS } from 're2js';

import { ExpressionError } from './types.js';

export function regexTest(value: string, pattern: string, flags = ''): boolean {
  if (
    pattern.length > 256 ||
    value.length > 16384 ||
    !/^[ims]*$/.test(flags) ||
    new Set(flags).size !== flags.length
  )
    throw new ExpressionError('REGEX_LIMIT');
  const bits =
    (flags.includes('i') ? RE2JS.CASE_INSENSITIVE : 0) |
    (flags.includes('m') ? RE2JS.MULTILINE : 0) |
    (flags.includes('s') ? RE2JS.DOTALL : 0);
  try {
    return RE2JS.compile(pattern, bits).test(value);
  } catch {
    throw new ExpressionError('REGEX_INVALID');
  }
}
export const isEmail = (value: string): boolean =>
  value.length <= 254 && /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(value);
export const isPhoneTR = (value: string): boolean =>
  /^(?:\+90|0090|90|0)?[2-5]\d{9}$/.test(value.replace(/[ ()-]/g, ''));
export function isTCKN(value: string): boolean {
  if (!/^[1-9]\d{10}$/.test(value)) return false;
  const digits = Array.from({ length: value.length }, (_, i) => Number(value[i]));
  let odd = 0;
  let even = 0;
  for (let i = 0; i < 9; i++) {
    if (i % 2 === 0) odd += digits[i] ?? 0;
    else even += digits[i] ?? 0;
  }
  return (
    (((odd * 7 - even) % 10) + 10) % 10 === digits[9] &&
    digits.slice(0, 10).reduce((sum, digit) => sum + digit, 0) % 10 === digits[10]
  );
}
export function isVKN(value: string): boolean {
  if (!/^\d{10}$/.test(value) || /^0+$/.test(value)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    const shifted = (Number(value[i]) + 9 - i) % 10;
    const rem = (shifted * 2 ** (9 - i)) % 9;
    sum += rem === 0 && shifted !== 0 ? 9 : rem;
  }
  return (10 - (sum % 10)) % 10 === Number(value[9]);
}
const ibanLengths: Readonly<Record<string, number>> = {
  TR: 26,
  GB: 22,
  DE: 22,
  FR: 27,
  ES: 24,
  IT: 27,
  NL: 18,
  BE: 16,
  AT: 20,
  CH: 21,
  IE: 22,
  PT: 25,
  PL: 28,
  GR: 27,
  DK: 18,
  FI: 18,
  NO: 15,
  SE: 24,
  CZ: 24,
  HU: 28,
  RO: 24,
  BG: 22,
  CY: 28,
  LU: 20,
  MT: 31,
  EE: 20,
  LV: 21,
  LT: 20,
  SK: 24,
  SI: 19,
  HR: 21,
  IS: 26,
  AE: 23,
  SA: 24,
  QA: 29,
  BH: 22,
  IL: 23,
  BR: 29,
};
export function isIBAN(value: string): boolean {
  const compact = value.replace(/ /g, '').toUpperCase();
  if (
    !/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(compact) ||
    ibanLengths[compact.slice(0, 2)] !== compact.length
  )
    return false;
  let remainder = 0;
  for (const char of compact.slice(4) + compact.slice(0, 4)) {
    const digits = /[A-Z]/.test(char) ? String(char.charCodeAt(0) - 55) : char;
    for (const digit of digits) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1;
}
export function luhn(value: string): boolean {
  if (!/^\d{2,64}$/.test(value) || /^0+$/.test(value)) return false;
  let sum = 0;
  for (let i = value.length - 1, parity = 0; i >= 0; i--, parity++) {
    let digit = Number(value[i]);
    if (parity % 2) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
}
