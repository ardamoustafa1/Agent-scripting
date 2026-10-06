import { webcrypto } from 'node:crypto';

import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { DraftVault } from './vault.js';

beforeEach(async () => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.stubGlobal('crypto', webcrypto);
  const key = await webcrypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ]);
  vi.stubGlobal('CryptoKey', key.constructor);
  // Structured clone and WebCrypto use Node's binary realm in this jsdom test.
  const bytes = structuredClone(new Uint8Array(1));
  vi.stubGlobal('Uint8Array', bytes.constructor);
  vi.stubGlobal('ArrayBuffer', bytes.buffer.constructor);
});
afterEach(() => {
  vi.unstubAllGlobals();
});
async function stored<T>(
  name: string,
  work: (store: IDBObjectStore) => IDBRequest<T>,
  mode: IDBTransactionMode = 'readonly',
): Promise<T> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('verbis-agent-drafts', 1);
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      reject(request.error ?? new Error('Synthetic storage error'));
    };
  });
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(name, mode),
        request = work(tx.objectStore(name));
      let value: T;
      request.onsuccess = () => {
        value = request.result;
      };
      tx.oncomplete = () => {
        resolve(value);
      };
      tx.onerror = () => {
        reject(tx.error ?? new Error('Synthetic storage error'));
      };
      tx.onabort = () => {
        reject(tx.error ?? new Error('Synthetic storage error'));
      };
    });
  } finally {
    db.close();
  }
}
it('round-trips actual encrypted drafts, reuses a non-extractable key and never stores plaintext', async () => {
  const vault = new DraftVault('tenant:user:bff');
  expect(await vault.load('missing')).toBeNull();
  const value = { pending: { synthetic: 'Synthetic draft' }, note: 'Private synthetic note' };
  await vault.save('session', value);
  expect(await vault.load('session')).toEqual(value);
  const row: unknown = await stored('drafts', (store) => store.get('tenant:user:bff:session'));
  expect(row).toHaveProperty('ciphertext');
  expect(JSON.stringify(row)).not.toContain('Private synthetic note');
  const key: unknown = await stored('keys', (store) => store.get('tenant:user:bff'));
  expect(key).toBeInstanceOf(CryptoKey);
  expect((key as CryptoKey).extractable).toBe(false);
  await vault.save('other', { value: 'second' });
  expect(await vault.load('other')).toEqual({ value: 'second' });
  const again: unknown = await stored('keys', (store) => store.get('tenant:user:bff'));
  expect((again as CryptoKey).extractable).toBe(false);
  await vault.remove('session');
  expect(await vault.load('session')).toBeNull();
  await vault.clear();
});
it('partitions ciphertext by tenant/user/BFF and rejects ciphertext copied to another session', async () => {
  const first = new DraftVault('tenant:first:bff'),
    second = new DraftVault('tenant:second:bff');
  await first.save('session', { note: 'First partition' });
  await second.save('session', { note: 'Second partition' });
  expect(await first.load('session')).toEqual({ note: 'First partition' });
  expect(await second.load('session')).toEqual({ note: 'Second partition' });
  const copied: unknown = await stored('drafts', (store) => store.get('tenant:first:bff:session'));
  await stored('drafts', (store) => store.put(copied, 'tenant:first:bff:other'), 'readwrite');
  await expect(first.load('other')).rejects.toThrow();
  await first.clear();
  await expect(first.load('session')).rejects.toThrow('VERBIS_DRAFT_CLOSED');
  expect(await second.load('session')).toEqual({ note: 'Second partition' });
  expect(await stored('keys', (store) => store.get('tenant:first:bff'))).toBeUndefined();
  await second.clear();
});
it.each([
  'invalid',
  {},
  { iv: 'wrong', ciphertext: new ArrayBuffer(8) },
  { iv: new Uint8Array(12), ciphertext: 'wrong' },
])('rejects corrupt draft records without treating them as usable drafts', async (value) => {
  const vault = new DraftVault('synthetic');
  await vault.save('seed', {});
  await stored('drafts', (store) => store.put(value, 'synthetic:corrupt'), 'readwrite');
  await expect(vault.load('corrupt')).rejects.toThrow('VERBIS_DRAFT_CORRUPT');
  await vault.clear();
});
it('refuses storage use after clearing and allows a fresh vault to obtain a new key', async () => {
  const first = new DraftVault('synthetic');
  await first.save('session', { note: 'Old note' });
  await first.clear();
  await expect(first.save('session', { note: 'Rejected note' })).rejects.toThrow(
    'VERBIS_DRAFT_CLOSED',
  );
  await expect(first.remove('session')).rejects.toThrow('VERBIS_DRAFT_CLOSED');
  const fresh = new DraftVault('synthetic');
  expect(await fresh.load('session')).toBeNull();
  await fresh.save('session', { note: 'New note' });
  expect(await fresh.load('session')).toEqual({ note: 'New note' });
  await fresh.clear();
});
it('reuses the winning key for simultaneous encrypted saves without losing either draft', async () => {
  const vault = new DraftVault('synthetic');
  await Promise.all([
    vault.save('first', { note: 'First' }),
    vault.save('second', { note: 'Second' }),
  ]);
  expect(await vault.load('first')).toEqual({ note: 'First' });
  expect(await vault.load('second')).toEqual({ note: 'Second' });
  await vault.clear();
});
it('rejects an invalid persisted encryption key instead of overwriting it or emitting plaintext', async () => {
  const vault = new DraftVault('synthetic');
  await stored('keys', (store) => store.put({ invalid: true }, 'synthetic'), 'readwrite');
  await expect(vault.save('session', { note: 'Private synthetic' })).rejects.toThrow(
    'VERBIS_DRAFT_KEY',
  );
  expect(await stored('drafts', (store) => store.get('synthetic:session'))).toBeUndefined();
  await vault.clear();
});
it('reports actual IndexedDB transaction abortion without returning an uncommitted draft', async () => {
  const vault = new DraftVault('synthetic');
  await vault.save('session', { note: 'Synthetic' });
  const database = await new Promise<IDBDatabase>((resolve) => {
    const request = indexedDB.open('verbis-agent-drafts', 1);
    request.onsuccess = () => {
      resolve(request.result);
    };
  });
  const original = database.constructor.prototype as IDBDatabase;
  const transaction: unknown = Object.getOwnPropertyDescriptor(original, 'transaction')?.value;
  if (typeof transaction !== 'function') throw new Error('Missing IndexedDB transaction method');
  const spy = vi.spyOn(original, 'transaction').mockImplementationOnce(function (
    this: IDBDatabase,
    ...args: Parameters<IDBDatabase['transaction']>
  ) {
    const tx = Reflect.apply(transaction, this, args) as IDBTransaction;
    queueMicrotask(() => {
      tx.abort();
    });
    return tx;
  });
  await expect(vault.load('session')).rejects.toThrow('VERBIS_STORAGE_FAILED');
  spy.mockRestore();
  database.close();
  await vault.clear();
});
it('reports an incompatible database version through its storage failure boundary', async () => {
  const database = await new Promise<IDBDatabase>((resolve) => {
    const request = indexedDB.open('verbis-agent-drafts', 2);
    request.onsuccess = () => {
      resolve(request.result);
    };
  });
  database.close();
  const vault = new DraftVault('synthetic');
  await expect(vault.load('session')).rejects.toMatchObject({ name: 'VersionError' });
});
it('closes the cleared vault database so logout cannot block a future schema upgrade', async () => {
  const vault = new DraftVault('synthetic');
  await vault.save('session', { note: 'Synthetic' });
  await vault.clear();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('verbis-agent-drafts', 2);
    request.onblocked = () => {
      reject(new Error('Cleared vault still blocks database upgrade'));
    };
    request.onerror = () => {
      reject(request.error ?? new Error('Synthetic storage error'));
    };
    request.onsuccess = () => {
      request.result.close();
      resolve();
    };
  });
});
