import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_CONFIG, buildAppConfig, type AppConfig } from './app.config.js';
import { parseEnv } from './env.schema.js';

/**
 * The only place in apps/api allowed to touch `process.env`.
 *
 * `ConfigModule.forRoot` loads the root .env into the process environment and
 * runs `validate` during module construction, so a malformed environment aborts
 * the boot before any other provider is built. The factory then reads the same
 * environment to produce the typed, namespaced object everything else injects.
 */
@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      // Relative to the working directory, which is apps/api for both
      // `nest start` and `node dist/main`. The root file is the one Docker
      // Compose also reads, so the credentials cannot drift.
      envFilePath: ['../../.env', '.env'],
      // Deployed environments inject variables directly; there is no file.
      ignoreEnvFile: process.env.NODE_ENV === 'production',
      validate: parseEnv,
    }),
  ],
  providers: [
    {
      provide: APP_CONFIG,
      useFactory: (): AppConfig => buildAppConfig(parseEnv(process.env)),
    },
  ],
  exports: [APP_CONFIG],
})
export class AppConfigModule {}
