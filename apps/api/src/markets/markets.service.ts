import { Injectable } from '@nestjs/common';
import { Market, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { MarketConfigService } from '../config/market-config.service';
import { AuthPrincipal } from '../auth/auth-principal';
import { UpdateMarketDto } from './dto';
import type { MarketConfig } from '@rezo/shared-types';

@Injectable()
export class MarketsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: MarketConfigService,
    private readonly audit: AuditService,
  ) {}

  private toConfig(m: Market): MarketConfig {
    return {
      code: m.code,
      name: m.name,
      base_currency: m.baseCurrency,
      currencies: m.currencies,
      languages: m.languages,
      enabled_modules: m.enabledModules,
      tariff: m.tariff as Record<string, unknown>,
    };
  }

  async list(): Promise<MarketConfig[]> {
    const rows = await this.prisma.market.findMany({ orderBy: { code: 'asc' } });
    return rows.map((m) => this.toConfig(m));
  }

  async get(code: string): Promise<MarketConfig> {
    return this.toConfig(await this.config.getMarket(code));
  }

  /** Update tariff / currencies / modules (config-driven pricing, spec §14). */
  async update(principal: AuthPrincipal, code: string, dto: UpdateMarketDto): Promise<MarketConfig> {
    const before = await this.config.getMarket(code);
    const updated = await this.prisma.market.update({
      where: { code },
      data: {
        ...(dto.tariff !== undefined ? { tariff: dto.tariff as Prisma.InputJsonValue } : {}),
        ...(dto.currencies !== undefined ? { currencies: dto.currencies } : {}),
        ...(dto.languages !== undefined ? { languages: dto.languages } : {}),
        ...(dto.enabled_modules !== undefined ? { enabledModules: dto.enabled_modules } : {}),
      },
    });
    this.config.invalidate();
    await this.audit.record({
      actorUserId: principal.userId,
      actorOrgId: principal.orgId,
      action: 'market.update',
      entity: 'Market',
      entityId: updated.id,
      before: { tariff: before.tariff as object },
      after: { tariff: updated.tariff as object },
    });
    return this.toConfig(updated);
  }
}
