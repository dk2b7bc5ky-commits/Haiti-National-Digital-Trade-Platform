/**
 * PaymentRail — the seam to real settlement rails: card/PSP, local bank, mobile
 * money (spec §2.1/§6). NO REAL RAIL IN THE BETA — a MockPaymentRail ships so
 * end-to-end flows work without a live bank. A real rail later implements this
 * interface and is swapped in via the token below; the orchestrator is unchanged.
 *
 * CRITICAL: the rail moves money DIRECTLY from payer to payee. Rezo never
 * receives or holds the funds — it only asks the rail to move them and records
 * the confirmation. There is no Rezo balance anywhere in this flow.
 */
export const PAYMENT_RAIL = Symbol('PAYMENT_RAIL');

export type RailOutcome = 'settled' | 'failed' | 'pending';

export interface RailPayInput {
  /** Per-routing idempotency token — the rail must not double-charge on retry. */
  idempotencyToken: string;
  rail: string;
  /** Opaque payee settlement routing token (from the Payee registry). */
  payeeSettlementRef: string;
  amount: number; // minor units
  currency: string;
  /** Beta/mock only: force an outcome so partial-failure can be tested. */
  simulate?: RailOutcome;
}

export interface RailResult {
  status: RailOutcome;
  txnRef: string | null;
  error?: string;
}

export interface PaymentRail {
  pay(input: RailPayInput): Promise<RailResult>;
}
