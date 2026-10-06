// File-type policy and mandatory gitleaks inspect the staged index.
// Credential detection uses the reviewed gitleaks rules, including narrow source exceptions.
import { execFileSync, spawnSync } from 'node:child_process';

const FORBIDDEN_FILES = [/(^|\/)\.env$/, /(^|\/)\.env\.(?!example$)[^/]+$/, /\.(pem|p12|pfx|key)$/];

const staged = execFileSync('git', ['diff', '--cached', '--name-only', '-z', '--diff-filter=ACM'], {
  encoding: 'utf8',
})
  .split('\0')
  .filter(Boolean);

const findings = [];
for (const file of staged) {
  if (FORBIDDEN_FILES.some((re) => re.test(file))) {
    findings.push(`${file}: file type must never be committed`);
    continue;
  }
}

if (findings.length > 0) {
  console.error('[verbis] Secret scan blocked the commit (CLAUDE.md rule 3):');
  for (const finding of findings) console.error(`  - ${finding}`);
  process.exit(1);
}
const available = spawnSync('gitleaks', ['version'], { stdio: 'ignore' });
if (available.status !== 0) {
  console.error(
    '[verbis] gitleaks is required; install it before committing. No weaker fallback is allowed.',
  );
  process.exit(1);
}
const result = spawnSync(
  'gitleaks',
  ['git', '--pre-commit', '--staged', '--redact', '--no-banner'],
  { stdio: 'inherit' },
);
process.exit(result.status ?? 1);
