import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { HealthStatus } from '@rezo/shared-types';

/**
 * GET /api/v1/health
 *
 * Proves the full round-trip: the API is up AND can reach Postgres.
 * Returns the plain payload; the global ResponseInterceptor wraps it as
 * { data: { status: "ok" }, error: null }.
 */
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check(): Promise<HealthStatus> {
    try {
      await this.prisma.ping();
    } catch {
      throw new ServiceUnavailableException('Database connection is not available.');
    }
    return { status: 'ok' };
  }
}
