import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Keep each CI/local acceptance run separate from dated historical evidence. */
export function evidenceFile(name: string): string {
  const directory =
    process.env['VERIFICATION_EVIDENCE_DIR'] ??
    fileURLToPath(new URL('../../reports/verification/observations', import.meta.url));
  mkdirSync(directory, { recursive: true });
  return path.join(directory, name);
}
