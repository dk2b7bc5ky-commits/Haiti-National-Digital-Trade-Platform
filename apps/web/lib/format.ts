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
