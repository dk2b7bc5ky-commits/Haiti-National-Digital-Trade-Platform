import { Charge, ChargeType, ChargeStatus, ChargeSource, Organization, PayeeType } from '@prisma/client';
import type {
  ChargeSummary,
  PayeeChargeGroup,
  Money,
  ChargeType as ApiChargeType,
  ChargeStatus as ApiChargeStatus,
  ChargeSource as ApiChargeSource,
  PayeeType as ApiPayeeType,
} from '@rezo/shared-types';

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
export function groupByPayee(charges: ChargeWithPayee[]): PayeeChargeGroup[] {
  const groups = new Map<string, ChargeWithPayee[]>();
  for (const c of charges) {
    const arr = groups.get(c.payeeOrgId) ?? [];
    arr.push(c);
    groups.set(c.payeeOrgId, arr);
  }
  return [...groups.values()].map((list) => ({
    payee_org_id: list[0].payeeOrgId,
    payee_name: list[0].payeeOrg.legalName,
    charges: list.map(toChargeSummary),
    subtotals: sumByCurrency(list),
  }));
}

/** total_owed is a single Money only when all payable charges share a currency. */
export function totalOwed(charges: ChargeWithPayee[]): Money | null {
  const totals = sumByCurrency(charges);
  return totals.length === 1 ? totals[0] : null;
}
