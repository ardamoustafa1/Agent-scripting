/** Loopback-only development mTLS edge. The API trusts only its replaced certificate header. */
import { X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { createServer } from 'node:https';
import { pathToFileURL } from 'node:url';

export function createDevMtlsProxy(env) {
  if (env.NODE_ENV !== 'development') throw new Error('Dev mTLS proxy is development only');
  const target = new URL(env.API_INTERNAL_URL);
  if (target.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname))
    throw new Error('Dev mTLS upstream must be loopback HTTP');
  const header = env.MTLS_CLIENT_CERT_HEADER;
  if (!header || !/^[a-z0-9-]+$/.test(header))
    throw new Error('Configure dev mTLS with pnpm dev:bootstrap');
  return createServer(
    {
      key: readFileSync(env.DEV_MTLS_KEY_FILE),
      cert: readFileSync(env.DEV_MTLS_CERT_FILE),
      ca: readFileSync(env.HUB_CA_FILE),
      requestCert: true,
      rejectUnauthorized: true,
      minVersion: 'TLSv1.2',
    },
    (request, response) => {
      const peer = request.socket.getPeerCertificate();
      if (!request.socket.authorized || !peer.raw) {
        response.writeHead(403).end();
        return;
      }
      // Keep the upstream origin fixed; authenticated callers cannot turn this into an open proxy.
      if (!request.url?.startsWith('/') || request.url.startsWith('//')) {
        response.writeHead(400).end();
        return;
      }
      const headers = {
        ...request.headers,
        host: target.host,
        [header]: encodeURIComponent(new X509Certificate(peer.raw).toString()),
      };
      delete headers.connection;
      delete headers['proxy-authorization'];
      const upstream = httpRequest(
        target,
        { method: request.method, path: request.url, headers, timeout: 15000 },
        (result) => {
          response.writeHead(result.statusCode ?? 502, result.headers);
          result.pipe(response);
        },
      );
      upstream.on('timeout', () => upstream.destroy());
      upstream.on('error', () => {
        if (!response.headersSent) response.writeHead(502);
        response.end();
      });
      request.on('aborted', () => upstream.destroy());
      response.on('close', () => upstream.destroy());
      request.pipe(upstream);
    },
  );
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const server = createDevMtlsProxy(process.env);
    server.listen(Number(process.env.DEV_MTLS_PORT), '127.0.0.1', () =>
      console.log('[verbis] Dev mTLS edge ready on loopback'),
    );
    server.on('error', () => {
      console.error('[verbis] Dev mTLS listener failed');
      process.exitCode = 1;
    });
    for (const signal of ['SIGINT', 'SIGTERM'])
      process.once(signal, () => server.close(() => process.exit(0)));
  } catch {
    console.error('[verbis] Dev mTLS unavailable; run pnpm dev:bootstrap');
    process.exitCode = 1;
  }
}
