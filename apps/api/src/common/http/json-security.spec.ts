import Fastify from 'fastify';
import { expect, it } from 'vitest';

import { registerJsonSecurity } from './json-security.js';

it('marks JSON as non-cacheable attachment data without replacing export filenames', async () => {
  const app = Fastify();
  try {
    registerJsonSecurity(app);
    app.get('/v1/data', () => Promise.resolve({ value: 'synthetic' }));
    app.get('/v1/export', (_request, reply) =>
      reply.header('content-disposition', 'attachment; filename="subject.json"').send({ ok: true }),
    );
    const response = await app.inject('/v1/data');
    expect(response.headers['content-disposition']).toBe('attachment; filename="api.json"');
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect((await app.inject('/v1/export')).headers['content-disposition']).toBe(
      'attachment; filename="subject.json"',
    );
  } finally {
    await app.close();
  }
});
