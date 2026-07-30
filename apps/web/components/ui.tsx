import type { Money as MoneyT } from '@rezo/shared-types';
import { formatMoney } from '../lib/format';

/**
 * Shared UI primitives (one source of truth for money, status pills, counts,
 * and empty states). Keep the app's clean, light style — small focused pieces.
 */

// ---------------------------------------------------------------------------
// SECTION 1 — Money. Always 2 decimals + thousands separators, tabular-nums so
// digits line up, right-aligned by default in table cells.
// ---------------------------------------------------------------------------
export function Money({ amount, currency = 'USD', className = '' }: { amount: number; currency?: string; className?: string }) {
  return <span className={`tabular-nums ${className}`}>{formatMoney(amount, currency)}</span>;
}

/**
 * A list of Money (possibly multi-currency). When empty, renders a muted
 * fallback — "$0.00" or "Paid" — never a bare dash (SECTION 3).
 */
export function MoneyList({ items, empty = '$0.00', className = '' }: { items: MoneyT[]; empty?: string; className?: string }) {
  if (!items || items.length === 0) return <span className={`tabular-nums text-slate-400 ${className}`}>{empty}</span>;
  return <span className={`tabular-nums ${className}`}>{items.map((m) => formatMoney(m.amount, m.currency)).join(' + ')}</span>;
}

/** Muted "Paid ✓" for a settled/zero-owed money slot (SECTION 3). */
export function Paid({ className = '' }: { className?: string }) {
  return <span className={`inline-flex items-center gap-1 text-slate-400 ${className}`}><span aria-hidden>✓</span>Paid</span>;
}

// ---------------------------------------------------------------------------
// SECTION 2 — one StatusPill, one color system.
//   amber = action needed · green = done · blue = in progress
//   gray  = neutral/info  · red   = urgent/failed
// ---------------------------------------------------------------------------
export type PillTone = 'amber' | 'green' | 'blue' | 'gray' | 'red';

const TONE_CLASS: Record<PillTone, string> = {
  amber: 'bg-amber-100 text-amber-700',
  green: 'bg-green-100 text-green-700',
  blue: 'bg-blue-100 text-blue-700',
  gray: 'bg-slate-100 text-slate-600',
  red: 'bg-red-100 text-red-700',
};

// Known statuses → tone. Keys are normalized (lowercase, spaces→underscore).
const STATUS_TONE: Record<string, PillTone> = {
  // action needed
  pending: 'amber', offered: 'amber', requested: 'amber', pending_review: 'amber', needs_review: 'amber', verification_needed: 'amber', soon: 'amber',
  // done
  paid: 'green', completed: 'green', delivered: 'green', released: 'green', confirmed: 'green', sent: 'green', verified: 'green', active: 'green', settled: 'green',
  // in progress
  accepted: 'blue', in_transit: 'blue', scheduled: 'blue', routing: 'blue', processing: 'blue', partially_settled: 'blue',
  // neutral / info
  arrived: 'gray', none: 'gray', na: 'gray', info: 'gray', cancelled: 'gray', expired: 'gray',
  // urgent / failed
  overdue: 'red', failed: 'red', payment_failed: 'red', critical: 'red',
};

export function toneForStatus(status: string): PillTone {
  return STATUS_TONE[status.toLowerCase().replace(/\s+/g, '_')] ?? 'gray';
}

export function StatusPill({ status, tone, label }: { status?: string; tone?: PillTone; label?: string }) {
  const t = tone ?? (status ? toneForStatus(status) : 'gray');
  const text = (label ?? status ?? '').replace(/_/g, ' ');
  return <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${TONE_CLASS[t]}`}>{text}</span>;
}

/** Small neutral count chip that sits right after a label (SECTION 1). */
export function CountPill({ n }: { n: number }) {
  return <span className="ml-2 inline-block rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium tabular-nums text-slate-500">{n}</span>;
}

// ---------------------------------------------------------------------------
// SECTION 3 — friendly, centered empty state.
// ---------------------------------------------------------------------------
export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="p-8 text-center">
      <p className="text-sm text-slate-500">{title}</p>
      {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
    </div>
  );
}
