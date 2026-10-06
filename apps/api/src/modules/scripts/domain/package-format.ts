import { createPrivateKey, createPublicKey, sign, verify, type KeyObject } from 'node:crypto';

import { z } from 'zod';

import { IntegrationDefinitionSchema, IntegrationPolicySchema } from '@verbis/shared-types';

import { canonicalJson, sha256Hex } from '../../../common/crypto/canonical-json.js';

/**
 * `.verbis` package (ADR-0015): one JSON file = manifest + payload + checksums + Ed25519 signature.
 * The signature covers canonical JSON of {manifest, checksums}; checksums cover the canonical
 * payload and every document. Packages carry content only — never secrets, users or tenant ids.
 */
export const PACKAGE_FORMAT = 'verbis-package';
export const PACKAGE_FORMAT_VERSION = 2;

const Sha = z.string().regex(/^[0-9a-f]{64}$/);

export const PackageScriptSchema = z.strictObject({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).nullable(),
  tags: z.array(z.string().max(40)).max(20),
  semver: z.string().max(64),
  changeNote: z.string().max(4000).nullable(),
  document: z.record(z.string(), z.unknown()),
  checksum: Sha,
  sharedScreens: z
    .array(
      z.strictObject({ key: z.string(), semver: z.string(), mode: z.enum(['linked', 'detached']) }),
    )
    .max(50)
    .default([]),
});

export const PackageSharedScreenSchema = z.strictObject({
  key: z
    .string()
    .regex(/^[a-z][a-z0-9-]*$/)
    .max(64),
  name: z.string().min(1).max(120),
  semver: z.string().max(64),
  fragment: z.record(z.string(), z.unknown()),
  checksum: Sha,
});

export const PackageManifestSchema = z.strictObject({
  packageId: z.string().min(1).max(64),
  createdAt: z.iso.datetime({ offset: true }),
  createdBy: z.string().max(128),
  sourceEnvironment: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/),
  targetEnvironments: z
    .array(z.string().regex(/^[a-z][a-z0-9-]{0,31}$/))
    .max(10)
    .default([]),
  items: z
    .array(
      z.strictObject({
        kind: z.enum(['script', 'sharedScreen']),
        name: z.string(),
        semver: z.string(),
        checksum: Sha,
      }),
    )
    .min(1)
    .max(200),
});

export const PackageSchema = z
  .strictObject({
    format: z.literal(PACKAGE_FORMAT),
    formatVersion: z.union([z.literal(1), z.literal(2)]),
    manifest: PackageManifestSchema,
    payload: z.strictObject({
      integrations: z
        .array(
          z.strictObject({
            key: z.string().regex(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/),
            version: z.number().int().positive(),
            protocol: z.enum(['rest', 'soap', 'graphql']),
            definition: IntegrationDefinitionSchema,
            policy: IntegrationPolicySchema,
            secretRefs: z.array(z.uuid()).max(20),
          }),
        )
        .max(100)
        .optional(),
      scripts: z.array(PackageScriptSchema).max(100),
      sharedScreens: z.array(PackageSharedScreenSchema).max(100).default([]),
    }),
    checksums: z.strictObject({ payload: Sha }),
    signature: z.strictObject({
      alg: z.literal('EdDSA'),
      kid: z.string().min(1).max(64),
      value: z.string().min(1),
    }),
  })
  .meta({ id: 'VerbisPackage' });
export type VerbisPackage = z.output<typeof PackageSchema>;
export type PackagePayload = VerbisPackage['payload'];
export type PackageManifest = z.output<typeof PackageManifestSchema>;

export class PackageVerificationError extends Error {
  override readonly name = 'PackageVerificationError';
  constructor(
    readonly reason: 'format' | 'checksum' | 'signature' | 'untrusted_key' | 'environment',
    message: string,
  ) {
    super(message);
  }
}

const Jwk = z.object({
  kty: z.literal('OKP'),
  crv: z.literal('Ed25519'),
  kid: z.string().min(1).max(64),
  x: z.string(),
  d: z.string().optional(),
});

export class PackageKeys {
  private constructor(
    private readonly signing: { kid: string; key: KeyObject } | undefined,
    private readonly trusted: ReadonlyMap<string, KeyObject>,
  ) {}

  /** `signingJwk`: this environment's private key; `trustedJwks`: keys of environments we accept. */
  static from(signingJwk: string | undefined, trustedJwks: string | undefined): PackageKeys {
    const signing = signingJwk === undefined ? undefined : Jwk.parse(JSON.parse(signingJwk));
    if (signing !== undefined && signing.d === undefined)
      throw new Error('package signing key must be private');
    const trusted = new Map<string, KeyObject>();
    const list =
      trustedJwks === undefined
        ? []
        : z.object({ keys: z.array(Jwk) }).parse(JSON.parse(trustedJwks)).keys;
    for (const jwk of list)
      trusted.set(
        jwk.kid,
        createPublicKey({ key: { kty: jwk.kty, crv: jwk.crv, x: jwk.x }, format: 'jwk' }),
      );
    if (signing !== undefined && !trusted.has(signing.kid)) {
      trusted.set(
        signing.kid,
        createPublicKey({
          key: { kty: signing.kty, crv: signing.crv, x: signing.x },
          format: 'jwk',
        }),
      );
    }
    return new PackageKeys(
      signing === undefined
        ? undefined
        : {
            kid: signing.kid,
            key: createPrivateKey({
              key: { kty: signing.kty, crv: signing.crv, x: signing.x, d: signing.d ?? '' },
              format: 'jwk',
            }),
          },
      trusted,
    );
  }

  canSign(): boolean {
    return this.signing !== undefined;
  }

  sign(message: Buffer): { kid: string; value: string } {
    if (this.signing === undefined) throw new Error('no package signing key configured');
    return {
      kid: this.signing.kid,
      value: sign(null, message, this.signing.key).toString('base64url'),
    };
  }

  verify(kid: string, message: Buffer, signature: string): 'ok' | 'untrusted_key' | 'invalid' {
    const key = this.trusted.get(kid);
    if (key === undefined) return 'untrusted_key';
    try {
      return verify(null, message, key, Buffer.from(signature, 'base64url')) ? 'ok' : 'invalid';
    } catch {
      return 'invalid';
    }
  }
}

function signedPart(
  manifest: PackageManifest,
  checksums: { payload: string },
  formatVersion: number = PACKAGE_FORMAT_VERSION,
): Buffer {
  return Buffer.from(
    canonicalJson({
      format: PACKAGE_FORMAT,
      formatVersion,
      manifest,
      checksums,
    }),
    'utf8',
  );
}

export function buildPackage(
  manifest: Omit<PackageManifest, 'items'>,
  payload: PackagePayload,
  keys: PackageKeys,
): VerbisPackage {
  const items: PackageManifest['items'] = [
    ...payload.sharedScreens.map((s) => ({
      kind: 'sharedScreen' as const,
      name: s.key,
      semver: s.semver,
      checksum: s.checksum,
    })),
    ...payload.scripts.map((s) => ({
      kind: 'script' as const,
      name: s.name,
      semver: s.semver,
      checksum: s.checksum,
    })),
  ];
  const full: PackageManifest = { ...manifest, items };
  const checksums = { payload: sha256Hex(canonicalJson(payload)) };
  const signature = keys.sign(signedPart(full, checksums));
  return {
    format: PACKAGE_FORMAT,
    formatVersion: PACKAGE_FORMAT_VERSION,
    manifest: full,
    payload,
    checksums,
    signature: { alg: 'EdDSA', ...signature },
  };
}

/**
 * Verifies structure, signature (trusted key), payload checksum, manifest ↔ payload consistency
 * and every item checksum via `itemChecksum` (documents use the script checksum algorithm).
 */
export function verifyPackage(
  input: unknown,
  keys: PackageKeys,
  itemChecksum: (kind: 'script' | 'sharedScreen', content: Record<string, unknown>) => string,
  targetEnvironment?: string,
): VerbisPackage {
  const parsed = PackageSchema.safeParse(input);
  if (!parsed.success) throw new PackageVerificationError('format', 'not a valid .verbis package');
  const pkg = parsed.data;
  const check = keys.verify(
    pkg.signature.kid,
    signedPart(pkg.manifest, pkg.checksums, pkg.formatVersion),
    pkg.signature.value,
  );
  if (check === 'untrusted_key')
    throw new PackageVerificationError('untrusted_key', 'package signed by an untrusted key');
  if (check === 'invalid')
    throw new PackageVerificationError('signature', 'package signature is invalid');
  if (sha256Hex(canonicalJson(pkg.payload)) !== pkg.checksums.payload) {
    throw new PackageVerificationError('checksum', 'payload checksum mismatch');
  }
  const expected = [
    ...pkg.payload.sharedScreens.map((s) => `sharedScreen:${s.key}:${s.semver}:${s.checksum}`),
    ...pkg.payload.scripts.map((s) => `script:${s.name}:${s.semver}:${s.checksum}`),
  ].sort();
  const listed = pkg.manifest.items
    .map((i) => `${i.kind}:${i.name}:${i.semver}:${i.checksum}`)
    .sort();
  if (JSON.stringify(expected) !== JSON.stringify(listed))
    throw new PackageVerificationError('checksum', 'manifest does not match payload');
  for (const s of pkg.payload.scripts) {
    if (itemChecksum('script', s.document) !== s.checksum)
      throw new PackageVerificationError('checksum', `document checksum mismatch: ${s.name}`);
  }
  for (const s of pkg.payload.sharedScreens) {
    if (itemChecksum('sharedScreen', s.fragment) !== s.checksum)
      throw new PackageVerificationError('checksum', `fragment checksum mismatch: ${s.key}`);
  }
  if (
    targetEnvironment !== undefined &&
    pkg.manifest.targetEnvironments.length > 0 &&
    !pkg.manifest.targetEnvironments.includes(targetEnvironment)
  ) {
    throw new PackageVerificationError(
      'environment',
      `package is not meant for ${targetEnvironment}`,
    );
  }
  return pkg;
}
