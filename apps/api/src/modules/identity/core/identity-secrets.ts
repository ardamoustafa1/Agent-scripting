import { Inject, Injectable } from '@nestjs/common';

import { currentActor } from '../../../common/actor.js';

import { IDENTITY_KEYRING } from './identity.tokens.js';

import type { TransactionClient } from '../../../infra/database/prisma.service.js';
import type { Keyring } from '../crypto/keyring.js';

/**
 * IdP secrets (OIDC client secrets, SAML SP private keys) in the `secrets` table, sealed with the
 * identity keyring. Write-only through the API: values are only opened server-side for protocol
 * use. The integration engine's Secret service (step 16) will take over with KMS envelope keys.
 */
@Injectable()
export class IdentitySecrets {
  constructor(@Inject(IDENTITY_KEYRING) private readonly keyring: Keyring) {}

  private aad(tenantId: string, name: string): string {
    return `secret:${tenantId}:${name}`;
  }

  /** Creates or replaces the named secret; returns its id. */
  async put(
    tx: TransactionClient,
    tenantId: string,
    name: string,
    kind: 'oauth_client' | 'certificate',
    value: string,
  ): Promise<string> {
    const ciphertext = Buffer.from(this.keyring.seal(value, this.aad(tenantId, name)), 'utf8');
    const actor = currentActor();
    const existing = await tx.secret.findFirst({
      where: { tenantId, name, deletedAt: null },
      select: { id: true, keyVersion: true },
    });
    if (existing !== null) {
      await tx.secret.update({
        where: { id: existing.id },
        data: {
          ciphertext,
          keyVersion: existing.keyVersion + 1,
          rotatedAt: new Date(),
          updatedBy: actor,
          version: { increment: 1 },
        },
      });
      return existing.id;
    }
    const row = await tx.secret.create({
      data: { tenantId, name, kind, ciphertext, createdBy: actor, updatedBy: actor },
      select: { id: true },
    });
    return row.id;
  }

  async reveal(tx: TransactionClient, tenantId: string, id: string): Promise<string | undefined> {
    const row = await tx.secret.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: { name: true, ciphertext: true },
    });
    if (row === null) return undefined;
    return this.keyring.openString(
      Buffer.from(row.ciphertext).toString('utf8'),
      this.aad(tenantId, row.name),
    );
  }

  async remove(tx: TransactionClient, tenantId: string, id: string): Promise<void> {
    await tx.secret.updateMany({
      where: { id, tenantId, deletedAt: null },
      data: { deletedAt: new Date(), updatedBy: currentActor(), version: { increment: 1 } },
    });
  }
}
