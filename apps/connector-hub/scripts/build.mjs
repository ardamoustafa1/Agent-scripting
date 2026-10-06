import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
// Excluded helpers from older builds must not survive into a production image.
rmSync(new URL('../dist', import.meta.url), { recursive: true, force: true });
const build = spawnSync('pnpm', ['exec', 'tsc', '-b', 'tsconfig.build.json'], { stdio: 'inherit' });
if (build.error) throw build.error;
process.exitCode = build.status ?? 1;
