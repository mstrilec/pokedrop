import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { APP_CONFIG, type AppConfig } from './config/index.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // The port comes from validated configuration, so this file has no opinion
  // about the environment. Helmet, CORS, the global pipe and Swagger arrive in
  // PD-14.
  const config = app.get<AppConfig>(APP_CONFIG);

  await app.listen(config.app.port);
}

await bootstrap();
