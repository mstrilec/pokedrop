import { VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import express from 'express';
import helmet from 'helmet';
import { toNodeHandler } from 'better-auth/node';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { notFoundHandler } from './common/errors/not-found.handler.js';
import { requestIdMiddleware } from './common/request-id.js';
import { applyZodSchemas } from './common/zod-dto.js';
import { AUTH_BASE_PATH, AUTH_INSTANCE, type AuthInstance } from './auth/index.js';
import { APP_CONFIG, type AppConfig } from './config/index.js';
import { RedisThrottlerStorage, createAuthThrottleMiddleware } from './throttle/index.js';

async function bootstrap(): Promise<void> {
  // bodyParser is off because Better Auth reads the raw request body. Every
  // other route gets a parser below - after the auth handler and before
  // app.init(), because a parser registered after init sits behind the Nest
  // router and leaves every controller with an empty body.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    bodyParser: false,
  });
  app.useLogger(app.get(Logger));

  const config = app.get<AppConfig>(APP_CONFIG);

  // A hop count, never `true`: trusting every proxy lets a client send its own
  // X-Forwarded-For and so choose its own rate-limit bucket.
  app.set('trust proxy', config.app.trustProxyHops);

  app.use(helmet());

  app.use(requestIdMiddleware);

  app.enableCors({
    origin: config.app.corsOrigins,
    credentials: true,
  });

  const auth = app.get<AuthInstance>(AUTH_INSTANCE);
  const authRoute = `${AUTH_BASE_PATH}/*splat`;
  const expressApp = app.getHttpAdapter().getInstance();

  expressApp.all(authRoute, createAuthThrottleMiddleware(app.get(RedisThrottlerStorage), config));
  expressApp.all(authRoute, toNodeHandler(auth));

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  app.enableShutdownHooks();

  const openApiConfig = new DocumentBuilder()
    .setTitle('PokeDrop API')
    .setDescription('Pack opening, collection, deck building and peer-to-peer trading.')
    .setVersion('1')
    .build();

  const document = applyZodSchemas(SwaggerModule.createDocument(app, openApiConfig));
  SwaggerModule.setup('docs', app, document);

  // init() mounts the Nest router, so anything registered after it sits behind
  // every real route - which is where a not-found handler belongs.
  await app.init();
  app.use(notFoundHandler);

  await app.listen(config.app.port);
}

await bootstrap();
