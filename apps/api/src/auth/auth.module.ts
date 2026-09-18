import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/index.js';
import { WelcomeGrantService } from '../economy/index.js';
import { MailService } from '../mail/index.js';
import { PrismaService } from '../prisma/index.js';
import { RedisService } from '../redis/index.js';
import { AUTH_INSTANCE } from './auth.constants.js';
import { buildAuth } from './auth.factory.js';

@Global()
@Module({
  providers: [
    {
      provide: AUTH_INSTANCE,
      inject: [APP_CONFIG, PrismaService, MailService, WelcomeGrantService, RedisService],
      useFactory: (
        config: AppConfig,
        prisma: PrismaService,
        mail: MailService,
        welcomeGrant: WelcomeGrantService,
        redis: RedisService,
      ) => buildAuth(config, { prisma, mail, welcomeGrant, redis }),
    },
  ],
  exports: [AUTH_INSTANCE],
})
export class AuthModule {}
