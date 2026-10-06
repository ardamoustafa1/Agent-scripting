import { readFileSync } from 'node:fs';

import {
  GatewayWorkerConfigSchema,
  runGatewayWorker,
} from '../src/modules/integrations/gateway/worker.js';

const file = process.argv[2];
if (!file?.startsWith('/')) throw new Error('Pass an absolute path to a gateway config file');
const config = GatewayWorkerConfigSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
const stop = new AbortController();
for (const event of ['SIGINT', 'SIGTERM'])
  process.once(event, () => {
    stop.abort();
  });
process.stdout.write('[verbis] Private egress worker starting\n');
await runGatewayWorker(config, stop.signal).catch(() => {
  if (!stop.signal.aborted) {
    process.stderr.write('[verbis] Private egress worker stopped\n');
    process.exitCode = 1;
  }
});
