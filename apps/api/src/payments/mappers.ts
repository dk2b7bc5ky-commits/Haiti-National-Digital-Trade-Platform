import { PaymentRequestStatus, PaymentRoutingStatus, PaymentRouting } from '@prisma/client';
import type {
  PaymentRequestStatus as ApiReqStatus,
  PaymentRoutingStatus as ApiRoutingStatus,
  RoutingSummary,
} from '@rezo/shared-types';

export const reqStatusToApi = (s: PaymentRequestStatus): ApiReqStatus => s.toLowerCase() as ApiReqStatus;
export const routingStatusToApi = (s: PaymentRoutingStatus): ApiRoutingStatus => s.toLowerCase() as ApiRoutingStatus;

export function toRoutingSummary(r: PaymentRouting, payeeName: string): RoutingSummary {
  return {
    id: r.id,
    payee_org_id: r.payeeOrgId,
    payee_name: payeeName,
    charge_currency: r.chargeCurrency,
    charge_amount: r.chargeAmount,
    fx_rate: r.fxRate,
    settlement_amount: r.settlementAmount,
    rail: r.rail,
    rail_txn_ref: r.railTxnRef,
    status: routingStatusToApi(r.status),
    is_rezo_fee: r.isRezoFee,
  };
}
