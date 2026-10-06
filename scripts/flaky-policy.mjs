import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export function validateQuarantine(manifest, now = new Date()) {
  const errors = [],
    seen = new Set();
  if (manifest?.version !== 1 || !Array.isArray(manifest.entries))
    return ['Invalid quarantine manifest'];
  for (const entry of manifest.entries) {
    if (!entry || typeof entry !== 'object') {
      errors.push('Invalid quarantine entry');
      continue;
    }
    const id = `${entry.project}/${entry.file}/${entry.title}`;
    if (seen.has(id)) errors.push(`Duplicate quarantine: ${id}`);
    seen.add(id);
    if (
      ![entry.project, entry.file, entry.title, entry.owner, entry.reason].every(
        (v) => typeof v === 'string' && v.trim(),
      )
    )
      errors.push(`Missing quarantine metadata: ${id}`);
    if (
      typeof entry.file !== 'string' ||
      entry.file.includes('..') ||
      entry.file.startsWith('/') ||
      !entry.file.endsWith('.spec.ts')
    )
      errors.push(`Invalid test file: ${id}`);
    if (!/^https:\/\//.test(entry.issue ?? '')) errors.push(`Issue link required: ${id}`);
    const created = Date.parse(entry.createdAt),
      expires = Date.parse(entry.expiresAt);
    if (
      !Number.isFinite(created) ||
      !Number.isFinite(expires) ||
      created > now.getTime() ||
      expires <= now.getTime() ||
      expires <= created ||
      expires - created > 14 * 86400000
    )
      errors.push(`Expired or invalid quarantine window (maximum 14 days): ${id}`);
    if (/launch|security|sso|saml|keycloak|audit/i.test(`${entry.file} ${entry.title}`))
      errors.push(`Security critical tests cannot be quarantined: ${id}`);
  }
  return errors;
}
export async function loadQuarantine() {
  const manifest = JSON.parse(
    await readFile(new URL('../tests/playwright/quarantine.json', import.meta.url), 'utf8'),
  );
  const errors = validateQuarantine(manifest);
  if (errors.length) throw new Error(errors.join('\n'));
  return manifest;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await loadQuarantine();
  console.info('Quarantine policy valid');
}
