import { INestApplication, ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { ResponseInterceptor } from './response.interceptor';
import { AllExceptionsFilter } from './all-exceptions.filter';

/**
 * Shared Rezo application configuration — global prefix, baseline security
 * headers, the standard response envelope (interceptor + exception filter), and
 * the validation pipe. Used by both the runtime bootstrap (main.ts) and the e2e
 * suite so tests exercise the exact same middleware stack as production.
 *
 * CORS is intentionally left to the bootstrap (it is irrelevant to in-process
 * supertest requests).
 */
export function configureApp(app: INestApplication): void {
  // Spec §15: every endpoint lives under /api/v1.
  app.setGlobalPrefix('api/v1');

  // Baseline security headers (HSTS, no-sniff, frameguard, etc.).
  app.use(helmet());

  // Standard Rezo response envelope, applied globally.
  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useGlobalFilters(new AllExceptionsFilter());

  // whitelist strips unknown properties; forbidNonWhitelisted rejects them with
  // a 400 so typo'd/unexpected fields fail loudly (guards against mass-assignment).
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
}
