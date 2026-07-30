import { Deadline, DeadlineAlert, DeadlineType, AlertChannel, AlertStatus, Container } from '@prisma/client';
import type {
  DeadlineSummary,
  AlertSummary,
  DeadlineType as ApiDeadlineType,
  AlertChannel as ApiAlertChannel,
  AlertStatus as ApiAlertStatus,
} from '@rezo/shared-types';

const lc = (s: string): string => s.toLowerCase();
export const deadlineTypeToApi = (t: DeadlineType): ApiDeadlineType => lc(t) as ApiDeadlineType;
export const alertChannelToApi = (c: AlertChannel): ApiAlertChannel => lc(c) as ApiAlertChannel;
export const alertStatusToApi = (s: AlertStatus): ApiAlertStatus => lc(s) as ApiAlertStatus;

export function toDeadlineSummary(d: Deadline, payeeName: string): DeadlineSummary {
  return {
    id: d.id,
    container_id: d.containerId,
    payee_org_id: d.payeeOrgId,
    payee_name: payeeName,
    type: deadlineTypeToApi(d.type),
    datetime: d.datetime.toISOString(),
    alert_schedule: d.alertSchedule,
  };
}

type AlertRow = DeadlineAlert & { deadline: Deadline; container: Pick<Container, 'containerNumber'> };

export function toAlertSummary(a: AlertRow): AlertSummary {
  return {
    id: a.id,
    container_id: a.containerId,
    container_number: a.container.containerNumber,
    deadline_type: deadlineTypeToApi(a.deadline.type),
    channel: alertChannelToApi(a.channel),
    status: alertStatusToApi(a.status),
    offset_days: a.offsetDays,
    scheduled_for: a.scheduledFor.toISOString(),
    sent_at: a.sentAt?.toISOString() ?? null,
    read_at: a.readAt?.toISOString() ?? null,
    message: a.message,
  };
}
