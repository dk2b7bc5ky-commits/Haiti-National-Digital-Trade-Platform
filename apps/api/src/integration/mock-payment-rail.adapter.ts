import { Injectable, Logger } from '@nestjs/common';
import { PaymentRail, RailPayInput, RailResult } from './payment-rail';

/**
 * Mock settlement rail. Moves nothing real; returns a settlement reference so
 * the orchestrator can record a confirmed direct payer→payee movement. Honors
 * the per-routing `simulate` directive (settled | failed | pending) so
 * partial-failure and timeout handling are testable (spec §2.1). Idempotent by
 * token: the same idempotencyToken returns the same reference, never re-paying.
 */
@Injectable()
export class MockPaymentRail implements PaymentRail {
  private readonly logger = new Logger('MockPaymentRail');
  private readonly seen = new Map<string, RailResult>();

  async pay(input: RailPayInput): Promise<RailResult> {
    const existing = this.seen.get(input.idempotencyToken);
    if (existing) return existing; // idempotent — never double-pay on retry

    const outcome = input.simulate ?? 'settled';
    let result: RailResult;
    if (outcome === 'failed') {
      result = { status: 'failed', txnRef: null, error: 'Mock rail: simulated failure' };
    } else if (outcome === 'pending') {
      // Unknown/timeout: do NOT assume success; reconciliation re-checks later.
      result = { status: 'pending', txnRef: null };
    } else {
      result = { status: 'settled', txnRef: `mock-${input.rail}-${input.idempotencyToken.slice(0, 8)}` };
    }

    // Only cache terminal outcomes; pending should be re-attempted.
    if (result.status !== 'pending') this.seen.set(input.idempotencyToken, result);
    this.logger.log(`[${input.rail}] ${input.amount} ${input.currency} → ${input.payeeSettlementRef}: ${result.status}`);
    return result;
  }
}
