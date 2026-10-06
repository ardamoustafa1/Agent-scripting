// Creates .env from .env.example on first run so a clean clone works out of the box, adds keys
// introduced later (without touching existing values) and generates a local dev key pair for
// internal JWTs. .env is git-ignored (CLAUDE.md rule 3).
import { generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function ensureEnv(root = resolve(dirname(fileURLToPath(import.meta.url)), '..')) {
  const target = resolve(root, '.env');
  const example = resolve(root, '.env.example');

  const KEY_LINE = /^([A-Z][A-Z0-9_]*)=(.*)$/;
  const parse = (text) =>
    new Map(
      text
        .split('\n')
        .map((line) => KEY_LINE.exec(line))
        .filter((match) => match !== null)
        .map((match) => [match[1], match[2]]),
    );

  const exampleText = readFileSync(example, 'utf8');
  let envText = existsSync(target) ? readFileSync(target, 'utf8') : exampleText;
  const created = !existsSync(target);

  // Append keys added to .env.example since this .env was created.
  const present = parse(envText);
  const missing = [...parse(exampleText).entries()].filter(([key]) => !present.has(key));
  if (!created && missing.length > 0) {
    envText = `${envText.replace(/\n*$/, '\n')}\n# Added by scripts/ensure-env.mjs\n${missing.map(([key, value]) => `${key}=${value}`).join('\n')}\n`;
    console.log(
      `[verbis] Added ${missing.length} new variable(s) to .env: ${missing.map(([key]) => key).join(', ')}`,
    );
  }

  // Local Ed25519 key pair for internal tokens (dev only; production uses the BFF's keys).
  const values = parse(envText);
  if (
    (values.get('INTERNAL_JWT_JWKS') ?? '') === '' ||
    (values.get('INTERNAL_JWT_DEV_PRIVATE_JWK') ?? '') === ''
  ) {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const kid = `dev-${randomUUID().slice(0, 8)}`;
    const publicJwk = { ...publicKey.export({ format: 'jwk' }), kid, alg: 'EdDSA', use: 'sig' };
    const privateJwk = { ...privateKey.export({ format: 'jwk' }), kid, alg: 'EdDSA' };
    envText = envText
      .replace(
        /^INTERNAL_JWT_JWKS=.*$/m,
        `INTERNAL_JWT_JWKS=${JSON.stringify({ keys: [publicJwk] })}`,
      )
      .replace(
        /^INTERNAL_JWT_DEV_PRIVATE_JWK=.*$/m,
        `INTERNAL_JWT_DEV_PRIVATE_JWK=${JSON.stringify(privateJwk)}`,
      );
    console.log('[verbis] Generated a local Ed25519 key pair for internal JWTs (dev only).');
  }

  if ((parse(envText).get('IDENTITY_ENCRYPTION_KEYS') ?? '') === '') {
    envText = envText.replace(
      /^IDENTITY_ENCRYPTION_KEYS=.*$/m,
      `IDENTITY_ENCRYPTION_KEYS=dev:${randomBytes(32).toString('base64')}`,
    );
    console.log('[verbis] Generated a local identity sealing key (dev only).');
  }
  if ((parse(envText).get('INTERNAL_JWT_SIGNING_JWK') ?? '') === '') {
    const developmentKey = parse(envText).get('INTERNAL_JWT_DEV_PRIVATE_JWK');
    if (developmentKey) {
      envText = envText.replace(
        /^INTERNAL_JWT_SIGNING_JWK=.*$/m,
        `INTERNAL_JWT_SIGNING_JWK=${developmentKey}`,
      );
    }
  }

  // Audit checkpoint signing key (ADR-0014): Ed25519, dev only. Production keys live in KMS/Vault.
  if ((parse(envText).get('AUDIT_CHECKPOINT_SIGNING_JWK') ?? '') === '') {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const kid = `audit-dev-${randomUUID().slice(0, 8)}`;
    const publicJwk = { ...publicKey.export({ format: 'jwk' }), kid };
    const privateJwk = { ...privateKey.export({ format: 'jwk' }), kid };
    const set = (name, value) => {
      const line = `${name}=${value}`;
      envText = new RegExp(`^${name}=.*$`, 'm').test(envText)
        ? envText.replace(new RegExp(`^${name}=.*$`, 'm'), line)
        : `${envText.trimEnd()}\n${line}\n`;
    };
    set('AUDIT_CHECKPOINT_SIGNING_JWK', JSON.stringify(privateJwk));
    set('AUDIT_CHECKPOINT_JWKS', JSON.stringify({ keys: [publicJwk] }));
    console.log('[verbis] Generated a local Ed25519 audit checkpoint key (dev only).');
  }

  if (created || envText !== (existsSync(target) ? readFileSync(target, 'utf8') : '')) {
    writeFileSync(target, envText, { mode: 0o600 });
    chmodSync(target, 0o600);
    if (created) console.log('[verbis] Created .env from .env.example (development defaults).');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) ensureEnv();
