import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from './prisma/prisma.module';
import { AuditModule } from './audit/audit.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { UsersModule } from './users/users.module';
import { ApiKeysModule } from './api-keys/api-keys.module';
import { DataHubModule } from './data-hub/data-hub.module';
import { MarketConfigModule } from './config/config.module';
import { IntegrationModule } from './integration/integration.module';
import { BillingModule } from './billing/billing.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { PermissionsGuard } from './auth/permissions.guard';

@Module({
  imports: [
    // Loads the repo-root .env so API and infra share one source of config.
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['../../.env', '.env'] }),
    PrismaModule,
    AuditModule,
    AuthModule,
    HealthModule,
    OrganizationsModule,
    UsersModule,
    ApiKeysModule,
    MarketConfigModule,
    IntegrationModule,
    DataHubModule,
    BillingModule,
  ],
  providers: [
    // Global auth: every route requires a valid JWT unless marked @Public().
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // Global RBAC: enforces @RequirePermissions() (runs after JwtAuthGuard).
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}
