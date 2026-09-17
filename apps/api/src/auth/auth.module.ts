import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/index.js';
import { PrismaService } from '../prisma/index.js';
import { AUTH_INSTANCE } from './auth.constants.js';
import { buildAuth } from './auth.factory.js';

/**
 * Global because the guard in PD-33 needs the instance on every request, and
 * making each feature module import this one would be noise.
 */
@Global()
@Module({
  providers: [
    {
      provide: AUTH_INSTANCE,
      inject: [PrismaService, APP_CONFIG],
      useFactory: (prisma: PrismaService, config: AppConfig) => buildAuth(prisma, config),
    },
  ],
  exports: [AUTH_INSTANCE],
})
export class AuthModule {}
