import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'prisma/config';

const rootEnv = resolve(dirname(fileURLToPath(import.meta.url)), '../../.env');

if (existsSync(rootEnv)) {
  process.loadEnvFile(rootEnv);
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',

    seed: 'node prisma/seed.ts',
  },
  datasource: {
    url: process.env.DATABASE_URL,

    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
});
