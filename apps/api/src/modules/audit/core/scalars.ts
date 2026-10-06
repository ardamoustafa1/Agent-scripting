/**
 * Driver-agnostic scalars: depending on the adapter, PostgreSQL BIGINT/INTEGER arrive as bigint,
 * number or string. Normalize at the boundary instead of trusting the declared row type.
 */
export function toBigInt(value: unknown): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' && Number.isInteger(value)) return BigInt(value);
  if (typeof value === 'string' && /^-?\d+$/.test(value)) return BigInt(value);
  throw new TypeError('not an integer');
}

export function toInt(value: unknown): number {
  const big = toBigInt(value);
  if (big > BigInt(Number.MAX_SAFE_INTEGER) || big < BigInt(Number.MIN_SAFE_INTEGER))
    throw new RangeError('integer out of range');
  return Number(big);
}
