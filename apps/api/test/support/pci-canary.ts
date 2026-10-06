import { expect } from 'vitest';

import type { PrismaClient } from '../../src/generated/prisma/client.js';
import type { Redis } from 'ioredis';

/** Public synthetic PAN only. Scan normalized, plain and encoded forms; never print store contents. */
export function assertNoPciCanary(value: unknown, pan: string) {
  const text =
    typeof value === 'string'
      ? value
      : JSON.stringify(value, (_key, item: unknown) =>
          typeof item === 'bigint' ? item.toString() : item,
        );
  for (const needle of [pan, Buffer.from(pan).toString('base64'), Buffer.from(pan).toString('hex')])
    expect(text.replace(/[\s-]/g, '').includes(needle)).toBe(false);
}
export async function scanPciStores(owner: PrismaClient, redis: Redis, pan: string) {
  const tables = await owner.$queryRaw<
    { table_name: string }[]
  >`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'`;
  let rows = 0,
    keys = 0;
  for (const { table_name: name } of tables) {
    if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error('Unexpected test table identifier');
    const values = await owner.$queryRawUnsafe<{ value: string }[]>(
      `SELECT row_to_json(t)::text AS value FROM public."${name}" t`,
    );
    rows += values.length;
    for (const value of values) assertNoPciCanary(value.value, pan);
  }
  let cursor = '0';
  do {
    const [next, found] = await redis.scan(cursor, 'COUNT', 100);
    cursor = next;
    for (const key of found) {
      keys++;
      const type = await redis.type(key);
      const value =
        type === 'string'
          ? await redis.get(key)
          : type === 'list'
            ? await redis.lrange(key, 0, -1)
            : type === 'hash'
              ? await redis.hgetall(key)
              : type === 'set'
                ? await redis.smembers(key)
                : type === 'zset'
                  ? await redis.zrange(key, '0', '-1', 'WITHSCORES')
                  : type === 'stream'
                    ? await redis.xrange(key, '-', '+')
                    : null;
      if (type !== 'none' && value === null) throw new Error('Unscanned Redis data type');
      assertNoPciCanary(value, pan);
    }
  } while (cursor !== '0');
  expect(rows).toBeGreaterThan(0);
  expect(keys).toBeGreaterThan(0);
  return { tables: tables.length, rows, keys };
}
