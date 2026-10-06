import { constants } from 'node:fs';
import { open } from 'node:fs/promises';

import { z } from 'zod';

import { DomainError } from '../../../common/errors/domain-errors.js';

import { VaultTransitAdapter } from './vault.js';

import type { ApiEnv } from '../../../env.js';

const KeyMetadata = z.object({
  data: z.object({
    derived: z.literal(true),
    type: z.literal('aes256-gcm96'),
    exportable: z.literal(false),
    allow_plaintext_backup: z.literal(false),
  }),
});
const Encrypted = z.object({
  data: z.object({
    ciphertext: z
      .string()
      .regex(/^vault:v[1-9]\d*:[A-Za-z0-9+/=]+$/)
      .max(4096),
  }),
});
const Decrypted = z.object({
  data: z.object({ plaintext: z.string().regex(/^[A-Za-z0-9+/]{43}=$/) }),
});
const StreamResult = z.discriminatedUnion('done', [
  z.object({ done: z.literal(false), value: z.instanceof(Uint8Array) }),
  z.object({ done: z.literal(true), value: z.instanceof(Uint8Array).optional() }),
]);
const MAX_RESPONSE = 65536;
type Settings = Pick<
  ApiEnv,
  | 'INTEGRATION_VAULT_ADDRESS'
  | 'INTEGRATION_VAULT_MOUNT'
  | 'INTEGRATION_VAULT_KEY'
  | 'INTEGRATION_VAULT_TOKEN_FILE'
  | 'INTEGRATION_VAULT_NAMESPACE'
  | 'INTEGRATION_VAULT_TIMEOUT_MS'
>;

/** Operator-owned fixed endpoint; credentials and provider error bodies never escape this boundary. */
export class VaultTransitClient {
  private metadata: Promise<void> | undefined;
  constructor(private readonly settings: Settings) {}

  private async token(): Promise<string> {
    const file = await open(
      this.settings.INTEGRATION_VAULT_TOKEN_FILE ?? '',
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > 16384 || (stat.mode & 0o077) !== 0)
        throw new Error('Invalid token sink');
      const buffer = Buffer.alloc(16385);
      try {
        const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
        const token = buffer.subarray(0, bytesRead).toString('utf8').trim();
        if (bytesRead > 16384 || !/^[A-Za-z0-9._-]{1,16384}$/.test(token))
          throw new Error('Invalid token');
        return token;
      } finally {
        buffer.fill(0);
      }
    } finally {
      await file.close();
    }
  }

  private async request(operation: string, body?: Record<string, string>): Promise<unknown> {
    const deadline = new AbortController();
    const timer = setTimeout(() => {
      deadline.abort();
    }, this.settings.INTEGRATION_VAULT_TIMEOUT_MS);
    try {
      const token = await this.token(); // Agent atomically replaces the sink when its token renews.
      const headers: Record<string, string> = {
        'X-Vault-Token': token,
        Accept: 'application/json',
      };
      if (this.settings.INTEGRATION_VAULT_NAMESPACE)
        headers['X-Vault-Namespace'] = this.settings.INTEGRATION_VAULT_NAMESPACE;
      if (body) headers['Content-Type'] = 'application/json';
      const url = new URL(
        `/v1/${this.settings.INTEGRATION_VAULT_MOUNT}/${operation}/${this.settings.INTEGRATION_VAULT_KEY}`,
        this.settings.INTEGRATION_VAULT_ADDRESS,
      );
      const response = await fetch(url, {
        method: body ? 'POST' : 'GET',
        headers,
        ...(body ? { body: JSON.stringify(body) } : {}),
        redirect: 'error',
        signal: deadline.signal,
      });
      if (!response.ok || !response.body) {
        await response.body?.cancel();
        throw new Error('Unavailable');
      }
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const chunk = StreamResult.parse((await reader.read()) as unknown);
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > MAX_RESPONSE) throw new Error('Oversized response');
          chunks.push(chunk.value);
        }
        return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
      } finally {
        await reader.cancel().catch(() => undefined);
        reader.releaseLock();
      }
    } catch {
      throw new DomainError('VERBIS_INTEGRATION_UNAVAILABLE');
    } finally {
      clearTimeout(timer);
    }
  }

  private async ensureKey(): Promise<void> {
    this.metadata ??= this.request('keys')
      .then((value) => {
        KeyMetadata.parse(value);
      })
      .catch(() => {
        this.metadata = undefined;
        throw new DomainError('VERBIS_INTEGRATION_UNAVAILABLE');
      });
    await this.metadata;
  }

  adapter(): VaultTransitAdapter {
    return new VaultTransitAdapter(
      async (plaintext, context) => {
        await this.ensureKey();
        try {
          return Encrypted.parse(await this.request('encrypt', { plaintext, context })).data
            .ciphertext;
        } catch {
          throw new DomainError('VERBIS_INTEGRATION_UNAVAILABLE');
        }
      },
      async (ciphertext, context) => {
        try {
          Encrypted.parse({ data: { ciphertext } });
          await this.ensureKey();
          return Decrypted.parse(await this.request('decrypt', { ciphertext, context })).data
            .plaintext;
        } catch {
          throw new DomainError('VERBIS_INTEGRATION_UNAVAILABLE');
        }
      },
    );
  }
}
