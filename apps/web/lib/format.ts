import type { Money } from '@rezo/shared-types';

/**
 * Formats integer minor units + ISO currency as a human string.
 * Money is always minor units on the wire (spec §15); we divide by 100 for
 * display only. USD 156000 -> "$1,560.00".
 */
export function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount / 100);
  } catch {
    return `${(amount / 100).toFixed(2)} ${currency}`;
  }
}

export function formatMoneyList(list: Money[]): string {
  if (list.length === 0) return '—';
  return list.map((m) => formatMoney(m.amount, m.currency)).join(' + ');
}

export interface Countdown {
  label: string;
  days: number;
  tone: 'ok' | 'soon' | 'overdue';
}

/** Days until a last-free-day, with a display label and urgency tone. */
export function countdown(lastFreeDay: string | null, now: Date = new Date()): Countdown | null {
  if (!lastFreeDay) return null;
  const target = new Date(lastFreeDay);
  const ms = target.getTime() - now.getTime();
  const days = Math.ceil(ms / 86_400_000);
  if (days < 0) return { label: `overdue ${Math.abs(days)}d`, days, tone: 'overdue' };
  if (days === 0) return { label: 'due today', days, tone: 'overdue' };
  return { label: `${days}d left`, days, tone: days <= 3 ? 'soon' : 'ok' };
}

export const PAYMENT_STATUS_STYLE: Record<string, string> = {
  none: 'bg-slate-100 text-slate-500',
  pending: 'bg-amber-100 text-amber-700',
  paid: 'bg-green-100 text-green-700',
  overdue: 'bg-red-100 text-red-700',
};

export const COUNTDOWN_STYLE: Record<string, string> = {
  ok: 'bg-slate-100 text-slate-600',
  soon: 'bg-amber-100 text-amber-700',
  overdue: 'bg-red-100 text-red-700',
};
