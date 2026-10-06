/**
 * Resolves `secret://<name>` references for SIEM sinks and the archive. The Secret service
 * (roadmap step 16) replaces the env-backed resolver; values never enter logs, audit or errors.
 */
export interface SecretResolver {
  resolve(tenantId: string, ref: string): Promise<string>;
}

export class MissingSecretError extends Error {
  override readonly name = 'MissingSecretError';
}

/** Dev/CI: `secret://siem-hook` → env `VERBIS_SECRET_SIEM_HOOK`. */
export class EnvSecretResolver implements SecretResolver {
  constructor(private readonly env: Readonly<Record<string, string | undefined>> = process.env) {}

  resolve(_tenantId: string, ref: string): Promise<string> {
    const match = /^secret:\/\/([a-z0-9][a-z0-9._-]{0,127})$/.exec(ref);
    if (match?.[1] === undefined)
      return Promise.reject(new MissingSecretError('invalid secret reference'));
    const value = this.env[`VERBIS_SECRET_${match[1].replace(/[.-]/g, '_').toUpperCase()}`];
    if (value === undefined || value === '')
      return Promise.reject(new MissingSecretError('secret not found'));
    return Promise.resolve(value);
  }
}
