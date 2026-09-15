import { VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module.js';
import { notFoundHandler } from './common/errors/not-found.handler.js';
import { requestIdMiddleware } from './common/request-id.js';
import { applyZodSchemas } from './common/zod-dto.js';
import { APP_CONFIG, type AppConfig } from './config/index.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const config = app.get<AppConfig>(APP_CONFIG);

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
