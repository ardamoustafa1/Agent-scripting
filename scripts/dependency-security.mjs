import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export function unresolvedAdvisories(
  report,
  remediation,
  today = new Date().toISOString().slice(0, 10),
) {
  if (!report.metadata?.vulnerabilities || !report.advisories || report.error)
    throw new Error('Dependency audit did not return a valid report');
  const valid = today <= remediation.expires;
  return Object.values(report.advisories).filter((advisory) => {
    if (!['high', 'critical'].includes(advisory.severity)) return false;
    return !(
      valid &&
      advisory.severity === 'high' &&
      advisory.module_name === remediation.package &&
      remediation.advisories.includes(advisory.id) &&
      advisory.findings?.length > 0 &&
      advisory.findings.every((finding) => finding.version === remediation.version)
    );
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const output = process.argv[2] === '--output' ? process.argv[3] : 'npm-audit.json';
  const result = spawnSync('pnpm', ['audit', '--json'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error || ![0, 1].includes(result.status))
    throw new Error('Dependency audit execution failed');
  await writeFile(path.resolve(root, output), result.stdout);
  const report = JSON.parse(result.stdout);
  const remediation = JSON.parse(
    await readFile(new URL('../security/local-remediations.json', import.meta.url), 'utf8'),
  );
  const patch = await readFile(path.join(root, remediation.patch));
  if (createHash('sha256').update(patch).digest('hex') !== remediation.sha256)
    throw new Error('Reviewed security patch changed; renew verification');
  const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  if (
    manifest.pnpm?.patchedDependencies?.[`${remediation.package}@${remediation.version}`] !==
    remediation.patch
  )
    throw new Error('Security patch is not configured');
  const regression = spawnSync(
    process.execPath,
    ['--test', 'scripts/archive-extraction.spec.mjs'],
    { cwd: root, stdio: 'inherit' },
  );
  if (regression.status !== 0)
    throw new Error('Installed security patch failed attack regressions');
  const remaining = unresolvedAdvisories(report, remediation);
  if (remaining.length)
    throw new Error(
      `Unresolved dependency advisories: ${remaining.map((item) => `${item.module_name}:${item.id}`).join(', ')}`,
    );
  process.stdout.write(
    `Raw audit: ${report.metadata.vulnerabilities.high} high, ${report.metadata.vulnerabilities.critical} critical. No unresolved high/critical advisories; exact local patch verified, expires ${remediation.expires}.\n`,
  );
}
