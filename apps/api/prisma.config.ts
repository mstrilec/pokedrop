import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'prisma/config';

/**
 * Connection settings for the Prisma CLI (generate, migrate, studio).
 *
 * Prisma 7 removed `url` from the datasource block and no longer loads .env on
 * its own, so this file does both jobs: it finds the repository-root .env that
 * Docker Compose also reads, and hands the URL to the CLI. Without the explicit
 * load, `prisma migrate` fails with "datasource.url property is required".
 *
 * The application does not read this file — PrismaService builds a driver
 * adapter from the validated config in src/config instead.
 */
const rootEnv = resolve(dirname(fileURLToPath(import.meta.url)), '../../.env');

if (existsSync(rootEnv)) {
  process.loadEnvFile(rootEnv);
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env.DATABASE_URL,

    /**
     * Only `prisma migrate diff --from-migrations` needs this: replaying a
     * migration history to compare it against the schema requires somewhere to
     * replay it. Unset locally, where the check is not run; CI points it at a
     * throwaway database on its own Postgres service.
     */
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
});
