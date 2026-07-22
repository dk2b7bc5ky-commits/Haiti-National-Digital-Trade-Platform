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
  /** Days-before-deadline to fire alerts (spec §1.5). Configurable per market. */
  alert_offsets_days?: number[];
  /** Channels each alert fans out to. */
  alert_channels?: ('in_app' | 'email' | 'sms')[];
  /** Extraction confidence threshold (spec §1.3 default 0.85). */
  extraction_confidence_threshold?: number;
  /** Subscription plan pricing (spec §2.2). Minor units, per plan/term. */
  subscription_plans?: Record<string, { monthly: number; annual: number }>;
}

const DEFAULT_ALERT_OFFSETS = [30, 14, 7, 3, 1, 0];
const DEFAULT_ALERT_CHANNELS: ('in_app' | 'email' | 'sms')[] = ['in_app', 'email'];
const DEFAULT_CONFIDENCE_THRESHOLD = 0.85;
const DEFAULT_SUBSCRIPTION_PLANS: Record<string, { monthly: number; annual: number }> = {
  small_broker: { monthly: 5000, annual: 50000 },
  large_broker: { monthly: 25000, annual: 250000 },
  line: { monthly: 100000, annual: 1000000 },
  terminal: { monthly: 100000, annual: 1000000 },
  trucker: { monthly: 2000, annual: 20000 },
  importer: { monthly: 3000, annual: 30000 },
};

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

  /** Deadline alert offsets (days before) — config-driven (spec §1.5). */
  async alertOffsetsDays(code?: string): Promise<number[]> {
    const tariff = await this.getTariff(code);
    return tariff.alert_offsets_days ?? DEFAULT_ALERT_OFFSETS;
  }

  async alertChannels(code?: string): Promise<('in_app' | 'email' | 'sms')[]> {
    const tariff = await this.getTariff(code);
    return tariff.alert_channels ?? DEFAULT_ALERT_CHANNELS;
  }

  /** Extraction confidence threshold (spec §1.3, default 0.85). Config-driven. */
  async confidenceThreshold(code?: string): Promise<number> {
    const tariff = await this.getTariff(code);
    return tariff.extraction_confidence_threshold ?? DEFAULT_CONFIDENCE_THRESHOLD;
  }

  /** All subscription plans + prices (spec §2.2) — config-driven, never hard-coded. */
  async subscriptionPlans(code?: string): Promise<Record<string, { monthly: number; annual: number }>> {
    const tariff = await this.getTariff(code);
    return tariff.subscription_plans ?? DEFAULT_SUBSCRIPTION_PLANS;
  }

  /** Price for one plan/term as Money (minor units of the market currency). */
  async subscriptionPrice(planKey: string, term: 'monthly' | 'annual', code?: string): Promise<Money> {
    const tariff = await this.getTariff(code);
    const plans = tariff.subscription_plans ?? DEFAULT_SUBSCRIPTION_PLANS;
    const plan = plans[planKey];
    if (!plan) throw new Error(`No subscription plan "${planKey}" configured.`);
    return { amount: plan[term], currency: tariff.currency };
  }
}
