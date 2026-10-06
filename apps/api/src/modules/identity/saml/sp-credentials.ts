// @peculiar/x509 resolves its providers through tsyringe, which needs the Reflect polyfill.
import 'reflect-metadata';

import { webcrypto } from 'node:crypto';

import * as x509 from '@peculiar/x509';

x509.cryptoProvider.set(webcrypto as never);

export interface GeneratedCredential {
  readonly certificate: string;
  readonly privateKey: string;
  readonly notAfter: Date;
}

const ALGORITHM = {
  name: 'RSASSA-PKCS1-v1_5',
  hash: 'SHA-256',
  publicExponent: new Uint8Array([1, 0, 1]),
  modulusLength: 3072,
} as const;

/**
 * Self-signed SP certificate + RSA-3072 key for SAML signing or encryption. SAML trust is the
 * certificate pinned in each party's metadata, so a CA is not needed; rotation publishes the
 * `next` certificate in metadata before it becomes active.
 */
export async function generateSpCredential(
  subject: string,
  now: Date = new Date(),
  validityDays = 730,
): Promise<GeneratedCredential> {
  const keys = await webcrypto.subtle.generateKey(ALGORITHM, true, ['sign', 'verify']);
  const notAfter = new Date(now.getTime() + validityDays * 86_400_000);
  const serial = Buffer.from(webcrypto.getRandomValues(new Uint8Array(16)));
  serial[0] = (serial[0] ?? 0) & 0x7f;
  const certificate = await x509.X509CertificateGenerator.createSelfSigned({
    serialNumber: serial.toString('hex'),
    name: `CN=${subject.replace(/[,=+<>#;"\\]/g, '_').slice(0, 64)}`,
    notBefore: new Date(now.getTime() - 60_000),
    notAfter,
    keys: keys as never,
    signingAlgorithm: ALGORITHM,
    extensions: [
      new x509.KeyUsagesExtension(
        x509.KeyUsageFlags.digitalSignature | x509.KeyUsageFlags.keyEncipherment,
        true,
      ),
    ],
  });
  const pkcs8 = await webcrypto.subtle.exportKey('pkcs8', keys.privateKey);
  const privateKey = `-----BEGIN PRIVATE KEY-----\n${
    Buffer.from(pkcs8)
      .toString('base64')
      .match(/.{1,64}/g)
      ?.join('\n') ?? ''
  }\n-----END PRIVATE KEY-----\n`;
  return { certificate: certificate.toString('pem'), privateKey, notAfter };
}

/** Base64 body of a PEM certificate (as used in metadata KeyInfo). */
export function pemBody(pem: string): string {
  return pem.replace(/-----(BEGIN|END) CERTIFICATE-----/g, '').replace(/\s+/g, '');
}
