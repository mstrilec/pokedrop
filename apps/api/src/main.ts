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

async function bootstrap(): Promise<void> {
  // bufferLogs holds everything Nest emits during startup until useLogger
  // swaps in pino, so the boot sequence is not split across two formats.
  //
  // bodyParser is off because Better Auth reads the raw request body and Nest's
  // parser would consume it first. Everything else gets a parser below, after
  // the auth handler and before the router — an express.json() registered after
  // app.init() would sit behind the router and leave every controller with an
  // empty body.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    bodyParser: false,
  });
  app.useLogger(app.get(Logger));

  const config = app.get<AppConfig>(APP_CONFIG);

  // Decides what req.ip is, and therefore what the rate limiter keys on.
  //
  // Unset behind a proxy, every request appears to come from the proxy: one key
  // for every user, and the first few requests exhaust the limit for everybody.
  // Set to `true`, any client can send its own X-Forwarded-For and pick its own
  // key. A hop count is the only answer that is wrong in neither direction, and
  // it differs per environment.
  app.set('trust proxy', config.app.trustProxyHops);

  app.use(helmet());

  // Before the router, so that every request carries a correlation id by the
  // time anything can fail — including requests that match no route.
  app.use(requestIdMiddleware);

  // An array origin makes Express reflect only allowlisted values. Note that a
  // disallowed origin is not refused: the response simply carries no
  // Access-Control-Allow-Origin header and the browser blocks it.
  app.enableCors({
    origin: config.app.corsOrigins,
    credentials: true,
  });

  // Registered as a route rather than with app.use(AUTH_BASE_PATH, ...):
  // mounting strips the prefix from req.url, and Better Auth routes on the full
  // path. Deliberately outside the versioned prefix — these are Better Auth's
  // own URLs, and versioning them would mean versioning someone else's
  // contract.
  const auth = app.get<AuthInstance>(AUTH_INSTANCE);
  const authRoute = `${AUTH_BASE_PATH}/*splat`;
  app.getHttpAdapter().getInstance().all(authRoute, toNodeHandler(auth));

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  // Lets Nest run onModuleDestroy hooks on SIGTERM, which the BullMQ workers in
  // PD-41 need in order to finish the job in flight before the process exits.
  app.enableShutdownHooks();

  const openApiConfig = new DocumentBuilder()
    .setTitle('PokeDrop API')
    .setDescription('Pack opening, collection, deck building and peer-to-peer trading.')
    .setVersion('1')
    .build();

  const document = applyZodSchemas(SwaggerModule.createDocument(app, openApiConfig));
  SwaggerModule.setup('docs', app, document);

  // init() mounts the Nest router; anything registered after it sits behind
  // every real route, which is precisely where a not-found handler belongs.
  await app.init();
  app.use(notFoundHandler);

  await app.listen(config.app.port);
}

await bootstrap();
