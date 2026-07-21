import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { ResponseInterceptor } from './common/response.interceptor';
import { AllExceptionsFilter } from './common/all-exceptions.filter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  // Spec §15: every endpoint lives under /api/v1.
  app.setGlobalPrefix('api/v1');

  // Standard Rezo response envelope, applied globally.
  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  // Allow the Next.js web app (and later partner clients) to call the API.
  app.enableCors({ origin: true, credentials: true });

  const port = Number(process.env.API_PORT ?? 4000);
  await app.listen(port);
  new Logger('Bootstrap').log(`Rezo API listening on http://localhost:${port}/api/v1`);
}

void bootstrap();
