import { Charge, ChargeType, ChargeStatus, ChargeSource, Organization, PayeeType } from '@prisma/client';
import type {
  ChargeSummary,
  PayeeChargeGroup,
  Money,
  PaymentStatus,
  ChargeType as ApiChargeType,
  ChargeStatus as ApiChargeStatus,
  ChargeSource as ApiChargeSource,
  PayeeType as ApiPayeeType,
} from '@rezo/shared-types';

/** Minimal payee registry info used to render "who you pay". */
export interface PayeeInfo {
  type: PayeeType;
  settlementRef: string;
}
export type PayeeMap = Map<string, PayeeInfo>;

/** Masks an opaque settlement token for display (keeps prefix + last 2). */
export function maskSettlement(ref: string): string {
  if (ref.length <= 6) return '••••';
  return `${ref.slice(0, 5)}…${ref.slice(-2)}`;
}

const lc = (s: string): string => s.toLowerCase();

export const chargeTypeToApi = (t: ChargeType): ApiChargeType => lc(t) as ApiChargeType;
export const chargeStatusToApi = (s: ChargeStatus): ApiChargeStatus => lc(s) as ApiChargeStatus;
export const chargeSourceToApi = (s: ChargeSource): ApiChargeSource => lc(s) as ApiChargeSource;
export const payeeTypeToApi = (t: PayeeType): ApiPayeeType => lc(t) as ApiPayeeType;

export function apiToChargeType(t: string): ChargeType | null {
  const up = t.toUpperCase();
  return (Object.values(ChargeType) as string[]).includes(up) ? (up as ChargeType) : null;
}

type ChargeWithPayee = Charge & { payeeOrg: Pick<Organization, 'id' | 'legalName'> };

/** Statuses that count toward the payable total (spec §1.3/§1.4). */
const PAYABLE: ChargeStatus[] = ['PENDING', 'REQUESTED', 'OVERDUE'];

export function isPayable(status: ChargeStatus): boolean {
  return PAYABLE.includes(status);
}

export function toChargeSummary(c: ChargeWithPayee): ChargeSummary {
  return {
    id: c.id,
    container_id: c.containerId,
    payee_org_id: c.payeeOrgId,
    payee_name: c.payeeOrg.legalName,
    type: chargeTypeToApi(c.type),
    amount: c.amount,
    currency: c.currency,
    status: chargeStatusToApi(c.status),
    source: chargeSourceToApi(c.source),
    due_date: c.dueDate?.toISOString() ?? null,
    last_free_day: c.lastFreeDay?.toISOString() ?? null,
  };
}

/** Sums payable charges by currency into a list of Money. */
export function sumByCurrency(charges: ChargeWithPayee[]): Money[] {
  const totals = new Map<string, number>();
  for (const c of charges) {
    if (!isPayable(c.status)) continue;
    totals.set(c.currency, (totals.get(c.currency) ?? 0) + c.amount);
  }
  return [...totals.entries()].map(([currency, amount]) => ({ amount, currency }));
}

/** Groups charges by payee, each with payable subtotals per currency (spec §1.4). */
export function groupByPayee(charges: ChargeWithPayee[], payees?: PayeeMap): PayeeChargeGroup[] {
  const groups = new Map<string, ChargeWithPayee[]>();
  for (const c of charges) {
    const arr = groups.get(c.payeeOrgId) ?? [];
    arr.push(c);
    groups.set(c.payeeOrgId, arr);
  }
  return [...groups.values()].map((list) => {
    const info = payees?.get(list[0].payeeOrgId);
    return {
      payee_org_id: list[0].payeeOrgId,
      payee_name: list[0].payeeOrg.legalName,
      payee_type: info ? payeeTypeToApi(info.type) : null,
      settlement_hint: info ? maskSettlement(info.settlementRef) : null,
      charges: list.map(toChargeSummary),
      subtotals: sumByCurrency(list),
    };
  });
}

/** total_owed is a single Money only when all payable charges share a currency. */
export function totalOwed(charges: ChargeWithPayee[]): Money | null {
  const totals = sumByCurrency(charges);
  return totals.length === 1 ? totals[0] : null;
}

/** Minimal charge shape needed for container-level rollups. */
export interface RollupCharge {
  amount: number;
  currency: string;
  status: ChargeStatus;
  lastFreeDay: Date | null;
}

/** Container payment status derived from its charges (spec §1.4). */
export function paymentStatus(charges: RollupCharge[]): PaymentStatus {
  if (charges.length === 0) return 'none';
  if (charges.some((c) => c.status === 'OVERDUE')) return 'overdue';
  if (charges.some((c) => isPayable(c.status))) return 'pending';
  if (charges.some((c) => c.status === 'PAID')) return 'paid';
  return 'none';
}

/** Single-currency payable total (list rollup); null if mixed or empty. */
export function totalOwedFrom(charges: RollupCharge[]): Money | null {
  const totals = new Map<string, number>();
  for (const c of charges) {
    if (!isPayable(c.status)) continue;
    totals.set(c.currency, (totals.get(c.currency) ?? 0) + c.amount);
  }
  const entries = [...totals.entries()];
  return entries.length === 1 ? { amount: entries[0][1], currency: entries[0][0] } : null;
}

/** Earliest last-free-day across payable charges (the binding deadline). */
export function earliestLastFreeDay(charges: RollupCharge[]): string | null {
  const days = charges
    .filter((c) => isPayable(c.status) && c.lastFreeDay)
    .map((c) => c.lastFreeDay as Date);
  if (days.length === 0) return null;
  return new Date(Math.min(...days.map((d) => d.getTime()))).toISOString();
}
