import path from 'node:path';

import { config as loadDotenv } from 'dotenv';
import { defineConfig } from 'prisma/config';

// Local development reads the repository-root .env; CI/containers inject real env vars.
loadDotenv({ path: path.resolve(import.meta.dirname, '../../.env'), quiet: true });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    // `prisma generate` does not need a database; migrate/seed fail clearly if this is empty.
    url: process.env['DATABASE_URL'] ?? '',
  },
});
