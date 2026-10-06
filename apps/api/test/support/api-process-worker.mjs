// Integration-test-only worker. Compiled application; synthetic config arrives through IPC.
import { createApp } from '../../dist/bootstrap.js';
import { createLogger } from '../../dist/common/logging/logger.js';

process.on('disconnect', () => process.exit(0));
process.once('message', async (env) => {
  try {
    const app = await createApp(env, { logger: createLogger('fatal') });
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address();
    if (!address || typeof address === 'string') throw new Error('No loopback listener');
    process.send?.({ port: address.port, pid: process.pid });
  } catch {
    // Do not emit config, URLs, tokens or connection credentials on startup failure.
    process.exit(1);
  }
});
