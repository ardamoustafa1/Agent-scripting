/** Non-extractable AES-GCM keys and ciphertext only; partitioned by tenant/user/BFF. No PCI or credentials. */
export class DraftVault {
  private cleared = false;
  private connection: Promise<IDBDatabase>;
  constructor(readonly partition: string) {
    this.connection = new Promise((resolve, reject) => {
      const request = indexedDB.open('verbis-agent-drafts', 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore('keys');
        request.result.createObjectStore('drafts');
      };
      request.onsuccess = () => {
        resolve(request.result);
      };
      request.onerror = () => {
        reject(request.error ?? new Error('VERBIS_STORAGE_FAILED'));
      };
    });
  }
  private async request<T>(
    store: string,
    mode: IDBTransactionMode,
    work: (object: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    if (this.cleared) throw new Error('VERBIS_DRAFT_CLOSED');
    const db = await this.connection;
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(store, mode),
        request = work(transaction.objectStore(store));
      let value: T;
      request.onsuccess = () => {
        value = request.result;
      };
      transaction.oncomplete = () => {
        resolve(value);
      };
      transaction.onerror = () => {
        reject(transaction.error ?? new Error('VERBIS_STORAGE_FAILED'));
      };
      transaction.onabort = () => {
        reject(transaction.error ?? new Error('VERBIS_STORAGE_FAILED'));
      };
    });
  }
  private async key() {
    const existing = await this.request<unknown>('keys', 'readonly', (s) => s.get(this.partition));
    if (existing instanceof CryptoKey) return existing;
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
      'encrypt',
      'decrypt',
    ]);
    await this.request('keys', 'readwrite', (s) => s.add(key, this.partition)).catch(
      () => undefined,
    );
    const selected: unknown = await this.request('keys', 'readonly', (s) => s.get(this.partition));
    if (!(selected instanceof CryptoKey)) throw Error('VERBIS_DRAFT_KEY');
    return selected;
  }
  async save(id: string, value: unknown) {
    const iv = crypto.getRandomValues(new Uint8Array(12)),
      aad = new TextEncoder().encode(`${this.partition}:${id}`),
      bytes = new TextEncoder().encode(JSON.stringify(value));
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: aad },
      await this.key(),
      bytes,
    );
    await this.request('drafts', 'readwrite', (s) =>
      s.put({ iv, ciphertext }, `${this.partition}:${id}`),
    );
  }
  async load(id: string): Promise<unknown> {
    const row: unknown = await this.request('drafts', 'readonly', (s) =>
      s.get(`${this.partition}:${id}`),
    );
    if (!row) return null;
    if (
      typeof row !== 'object' ||
      !('iv' in row) ||
      !('ciphertext' in row) ||
      !(row.iv instanceof Uint8Array) ||
      !(row.ciphertext instanceof ArrayBuffer)
    )
      throw Error('VERBIS_DRAFT_CORRUPT');
    const plaintext = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: new Uint8Array(row.iv),
        additionalData: new TextEncoder().encode(`${this.partition}:${id}`),
      },
      await this.key(),
      row.ciphertext,
    );
    return JSON.parse(new TextDecoder().decode(plaintext)) as unknown;
  }
  async remove(id: string) {
    await this.request('drafts', 'readwrite', (s) => s.delete(`${this.partition}:${id}`));
  }
  async clear() {
    this.cleared = true;
    const db = await this.connection;
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(['drafts', 'keys'], 'readwrite'),
          store = tx.objectStore('drafts'),
          cursor = store.openCursor();
        cursor.onsuccess = () => {
          const item = cursor.result;
          if (!item) return;
          if (typeof item.key === 'string' && item.key.startsWith(`${this.partition}:`))
            item.delete();
          item.continue();
        };
        tx.objectStore('keys').delete(this.partition);
        tx.oncomplete = () => {
          resolve();
        };
        tx.onerror = () => {
          reject(tx.error ?? new Error('VERBIS_STORAGE_FAILED'));
        };
      });
    } finally {
      db.close();
    }
  }
}
