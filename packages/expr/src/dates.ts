import { ExpressionError } from './types.js';

const DAY = 86400000;
/** Date-only or explicit UTC ISO: reject local-time strings and normalized invalid dates. */
export function dateMillis(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z)?$/.test(value))
    throw new ExpressionError('DATE_INVALID');
  const ms = Date.parse(value);
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== value.slice(0, 10))
    throw new ExpressionError('DATE_INVALID');
  return ms;
}
export function isoDate(ms: number): string {
  if (!Number.isFinite(ms) || Math.abs(ms) > 8640000000000000)
    throw new ExpressionError('DATE_INVALID');
  return new Date(ms).toISOString();
}
export function addDays(value: string, days: number): string {
  return isoDate(dateMillis(value) + days * DAY);
}
export function diff(left: string, right: string, unit: string): number {
  const divisor: Record<string, number> = {
    milliseconds: 1,
    seconds: 1000,
    minutes: 60000,
    hours: 3600000,
    days: DAY,
  };
  if (!Object.hasOwn(divisor, unit)) throw new ExpressionError('DATE_UNIT_INVALID');
  return (dateMillis(left) - dateMillis(right)) / (divisor[unit] ?? 1);
}
export function formatDate(value: string, pattern = 'yyyy-MM-dd'): string {
  const date = new Date(dateMillis(value));
  const pad = (n: number) => String(n).padStart(2, '0');
  const parts: Record<string, string> = {
    yyyy: String(date.getUTCFullYear()).padStart(4, '0'),
    MM: pad(date.getUTCMonth() + 1),
    dd: pad(date.getUTCDate()),
    HH: pad(date.getUTCHours()),
    mm: pad(date.getUTCMinutes()),
    ss: pad(date.getUTCSeconds()),
  };
  return pattern.replace(/yyyy|MM|dd|HH|mm|ss/g, (token) => parts[token] ?? token);
}
export function isBusinessDay(value: string, holidays: readonly string[] = []): boolean {
  const date = new Date(dateMillis(value));
  const day = date.getUTCDay();
  return day !== 0 && day !== 6 && !holidays.includes(date.toISOString().slice(0, 10));
}
export function age(birth: string, at: number): number {
  const born = new Date(dateMillis(birth));
  const today = new Date(at);
  if (!Number.isFinite(at) || at < born.getTime()) throw new ExpressionError('DATE_INVALID');
  return (
    today.getUTCFullYear() -
    born.getUTCFullYear() -
    (today.getUTCMonth() < born.getUTCMonth() ||
    (today.getUTCMonth() === born.getUTCMonth() && today.getUTCDate() < born.getUTCDate())
      ? 1
      : 0)
  );
}
export function formatCurrency(value: number, locale: 'tr' | 'en', currency = 'TRY'): string {
  if (!/^[A-Z]{3}$/.test(currency) || Math.abs(value) >= 1e15)
    throw new ExpressionError('CURRENCY_INVALID');
  const [integer = '0', fraction = '00'] = Math.abs(value).toFixed(2).split('.');
  const grouping = locale === 'tr' ? '.' : ',';
  const decimal = locale === 'tr' ? ',' : '.';
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, grouping);
  const sign = value < 0 ? '-' : '';
  const symbols: Record<string, string> = { TRY: '₺', USD: '$', EUR: '€', GBP: '£' };
  const symbol = symbols[currency] ?? currency;
  return locale === 'tr'
    ? `${sign}${grouped}${decimal}${fraction} ${symbol}`
    : `${sign}${symbol}${grouped}${decimal}${fraction}`;
}
