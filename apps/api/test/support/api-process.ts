import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

import type { ApiEnv } from '../../src/env.js';

const ReadySchema = z.object({
  port: z.number().int().positive(),
  pid: z.number().int().positive(),
});
let built = false;
export interface ApiProcess {
  readonly origin: string;
  readonly pid: number;
  kill(): Promise<NodeJS.Signals | null>;
}

/** Compiles current API sources and starts an isolated real process on a loopback-only port. */
export async function startApiProcess(env: ApiEnv): Promise<ApiProcess> {
  if (!built) {
    execFileSync(
      process.execPath,
      [
        fileURLToPath(new URL('../../node_modules/typescript/bin/tsc', import.meta.url)),
        '-b',
        'tsconfig.build.json',
      ],
      { cwd: fileURLToPath(new URL('../..', import.meta.url)), stdio: 'pipe', timeout: 120_000 },
    );
    built = true;
  }
  const child = spawn(
    process.execPath,
    [fileURLToPath(new URL('./api-process-worker.mjs', import.meta.url))],
    {
      env: { ...process.env, NODE_ENV: 'test', VERBIS_ENVIRONMENT: 'test' },
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    },
  );
  const kill = async () => {
    if (child.exitCode !== null || child.signalCode !== null) return child.signalCode;
    const exited = once(child, 'exit');
    child.kill('SIGKILL');
    await exited;
    return child.signalCode;
  };
  try {
    const ready = await new Promise<z.infer<typeof ReadySchema>>((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('API child readiness timeout'));
      }, 30_000);
      const cleanup = () => {
        clearTimeout(timeout);
        child.removeListener('message', onMessage);
        child.removeListener('exit', onExit);
        child.removeListener('error', onError);
      };
      const onMessage = (message: unknown) => {
        cleanup();
        const parsed = ReadySchema.safeParse(message);
        if (parsed.success) resolve(parsed.data);
        else reject(new Error('Invalid API readiness response'));
      };
      const onExit = () => {
        cleanup();
        reject(new Error('API child exited before readiness'));
      };
      const onError = () => {
        cleanup();
        reject(new Error('API child startup failed'));
      };
      child.once('message', onMessage);
      child.once('exit', onExit);
      child.once('error', onError);
      child.send(env);
    });
    return { origin: `http://127.0.0.1:${String(ready.port)}`, pid: ready.pid, kill };
  } catch (error) {
    await kill();
    throw error;
  }
}
