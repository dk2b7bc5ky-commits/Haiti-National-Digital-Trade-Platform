import { Injectable } from '@nestjs/common';
import { MarketConfigService } from '../config/market-config.service';
import {
  TerminalAdapter,
  TerminalLookupInput,
  TerminalContainerInfo,
  TerminalChargeLine,
} from './terminal-adapter';

/**
 * Mock terminal operating system (stands in for Octopi/CPS in the beta).
 *
 * Returns realistic terminal charges computed FROM MARKET CONFIG (never
 * hard-coded amounts): terminal handling (size-based), port dues, and a
 * scanning fee. It also sets a plausible last-free-day so the deadline engine
 * (build step 6) has something to track. Values are deterministic per
 * container number so demos are stable.
 */
@Injectable()
export class MockTerminalAdapter implements TerminalAdapter {
  /** Everything below is invented from config — never let it bill a real box. */
  readonly isMock = true;

  constructor(private readonly config: MarketConfigService) {}

  async getContainerInfo(input: TerminalLookupInput): Promise<TerminalContainerInfo> {
    const handling = await this.config.terminalHandling(input.sizeType);
    const portDues = await this.config.flatFee('port_dues');
    const scanning = await this.config.flatFee('scanning');

    // Deterministic free-day window: base arrival + 5 days (+/- by container).
    const base = input.arrivalDate ?? new Date();
    const extraDays = this.stableInt(input.containerNumber, 0, 3); // 0..3
    const lastFreeDay = new Date(base.getTime());
    lastFreeDay.setUTCDate(lastFreeDay.getUTCDate() + 5 + extraDays);
    const lfd = lastFreeDay.toISOString();

    const charges: TerminalChargeLine[] = [
      { type: 'TERMINAL_HANDLING', amount: handling.amount, currency: handling.currency, dueDate: lfd, lastFreeDay: lfd },
      { type: 'PORT_DUES', amount: portDues.amount, currency: portDues.currency, dueDate: lfd },
      { type: 'SCANNING', amount: scanning.amount, currency: scanning.currency, dueDate: lfd },
    ];

    return { terminalOrgId: input.terminalOrgId, charges };
  }

  /** Deterministic pseudo-value in [min,max] from a string (no Math.random). */
  private stableInt(seed: string, min: number, max: number): number {
    let h = 0;
    for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
    return min + (h % (max - min + 1));
  }
}
