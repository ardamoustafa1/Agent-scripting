import { Worker } from 'node:worker_threads';

import { z } from 'zod';

import type { AiRequest } from '@verbis/shared-types';

export function extractText(file: NonNullable<AiRequest['file']>): Promise<string> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./import-worker.js', import.meta.url), {
      workerData: file,
      resourceLimits: { maxOldGenerationSizeMb: 256, maxYoungGenerationSizeMb: 32 },
    });
    const timer = setTimeout(() => {
      void worker.terminate();
      reject(new Error('IMPORT_TIMEOUT'));
    }, 5000);
    worker.once('message', (raw: unknown) => {
      clearTimeout(timer);
      void worker.terminate();
      const result = z.object({ text: z.string().min(1).max(64000) }).safeParse(raw);
      if (result.success) resolve(result.data.text);
      else reject(new Error('IMPORT_FAILED'));
    });
    worker.once('error', () => {
      clearTimeout(timer);
      reject(new Error('IMPORT_FAILED'));
    });
    worker.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(code === 0 ? 'IMPORT_EMPTY' : 'IMPORT_FAILED'));
    });
  });
}
