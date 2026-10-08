import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { expect, it } from 'vitest';

import { AUDIT_ACTION } from './core/audit-event.js';

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'generated' ? [] : walk(path);
    return path.endsWith('.ts') && !path.includes('.spec.') ? [path] : [];
  });

// AuditService throws on a malformed action, which surfaces as an HTTP 500 at runtime
// (`runtime.sessions.labels.read` once broke the agent's live session list). Names follow
// `<domain>.<entity>.<verb>` (CLAUDE.md §5): two or three lowerCamel segments.
it('uses only well-formed audit action names in source literals', () => {
  const bad: string[] = [];
  for (const file of walk(join(import.meta.dirname, '../..')))
    for (const match of readFileSync(file, 'utf8').matchAll(/\baction:\s*'([A-Za-z0-9_.-]+)'/g)) {
      const action = match[1] ?? '';
      if (action.includes('.') && !AUDIT_ACTION.test(action)) bad.push(`${file}: ${action}`);
    }
  expect(bad).toEqual([]);
});
