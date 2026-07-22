import { Injectable, NotFoundException } from '@nestjs/common';
import { Market, ContainerSize } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { Money } from '@rezo/shared-types';

/**
 * Shape of a market's `tariff` JSON. All amounts are integer minor units of
 * the market currency (spec §15). This is the ONLY source of fee amounts —
 * nothing in the codebase hard-codes a price (spec §14: pricing is config so a
 * government concession can index/approve rates).
 */
export interface Tariff {
  currency: string;
  rezo_fee: { flat: number };
  customs_fee: { flat: number };
  port_dues: { flat: number };
  scanning: { flat: number };
  terminal_handling: Record<ContainerSize, number>;
  storage_per_day: Record<ContainerSize, number>;
}

const DEFAULT_MARKET_CODE = process.env.MARKET_CODE ?? 'HT';

@Injectable()
export class MarketConfigService {
  private cache = new Map<string, Market>();

  constructor(private readonly prisma: PrismaService) {}

  /** Clears the in-memory cache (call after a market is updated). */
  invalidate(): void {
    this.cache.clear();
  }

  async getMarket(code: string = DEFAULT_MARKET_CODE): Promise<Market> {
    const cached = this.cache.get(code);
    if (cached) return cached;
    const market = await this.prisma.market.findUnique({ where: { code } });
    if (!market) throw new NotFoundException(`Market "${code}" is not configured.`);
    this.cache.set(code, market);
    return market;
  }

  async getTariff(code?: string): Promise<Tariff> {
    const market = await this.getMarket(code);
    return market.tariff as unknown as Tariff;
  }

  /** Flat config fee (rezo_fee, customs_fee, port_dues, scanning). */
  async flatFee(kind: 'rezo_fee' | 'customs_fee' | 'port_dues' | 'scanning', code?: string): Promise<Money> {
    const tariff = await this.getTariff(code);
    return { amount: tariff[kind].flat, currency: tariff.currency };
  }

  /** Size-dependent terminal handling fee. */
  async terminalHandling(size: ContainerSize, code?: string): Promise<Money> {
    const tariff = await this.getTariff(code);
    return { amount: tariff.terminal_handling[size], currency: tariff.currency };
  }

  /** Size-dependent daily storage rate (per free-day overrun). */
  async storagePerDay(size: ContainerSize, code?: string): Promise<Money> {
    const tariff = await this.getTariff(code);
    return { amount: tariff.storage_per_day[size], currency: tariff.currency };
  }
}
