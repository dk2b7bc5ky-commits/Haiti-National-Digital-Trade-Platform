import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * FX rates for converting a charge's currency → the payer's settlement currency
 * (spec §7 FxRate, Flow C). The latest effective rate is used at authorization
 * and then FROZEN onto each routing; changing rates afterwards must not affect
 * an already-authorized request.
 */
@Injectable()
export class FxService {
  constructor(private readonly prisma: PrismaService) {}

  /** Latest rate: 1 `base` unit = N `quote` units. Same currency → 1. */
  async rate(base: string, quote: string): Promise<number> {
    if (base === quote) return 1;
    const row = await this.prisma.fxRate.findFirst({
      where: { baseCurrency: base, quoteCurrency: quote },
      orderBy: { effectiveAt: 'desc' },
    });
    if (row) return row.rate;
    // Fall back to the inverse of the reverse pair if only that is configured.
    const inverse = await this.prisma.fxRate.findFirst({
      where: { baseCurrency: quote, quoteCurrency: base },
      orderBy: { effectiveAt: 'desc' },
    });
    if (inverse && inverse.rate !== 0) return 1 / inverse.rate;
    throw new Error(`No FX rate configured for ${base}->${quote}.`);
  }

  /** Converts a minor-unit amount using a (frozen) rate; rounds to minor units. */
  convert(amountMinor: number, rate: number): number {
    return Math.round(amountMinor * rate);
  }

  async setRate(base: string, quote: string, rate: number, source = 'manual'): Promise<void> {
    await this.prisma.fxRate.create({
      data: { baseCurrency: base, quoteCurrency: quote, rate, source },
    });
  }

  async list(): Promise<{ base: string; quote: string; rate: number; source: string; effective_at: string }[]> {
    const rows = await this.prisma.fxRate.findMany({ orderBy: { effectiveAt: 'desc' }, take: 100 });
    return rows.map((r) => ({
      base: r.baseCurrency,
      quote: r.quoteCurrency,
      rate: r.rate,
      source: r.source,
      effective_at: r.effectiveAt.toISOString(),
    }));
  }
}
