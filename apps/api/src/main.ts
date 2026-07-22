import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { configureApp } from './common/configure-app';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  // Shared middleware stack (prefix, security headers, envelope, validation).
  configureApp(app);

  // Allow the web app (and later partner clients) to call the API. Restrict to
  // an explicit allowlist via CORS_ORIGINS (comma-separated) when set; otherwise
  // reflect the request origin (convenient for local dev).
  const origins = process.env.CORS_ORIGINS?.split(',').map((o) => o.trim()).filter(Boolean);
  app.enableCors({ origin: origins && origins.length > 0 ? origins : true, credentials: true });

  const port = Number(process.env.API_PORT ?? 4000);
  await app.listen(port);
  new Logger('Bootstrap').log(`Rezo API listening on http://localhost:${port}/api/v1`);
}

void bootstrap();
