'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { NotificationSummary, UnreadCount } from '@rezo/shared-types';
import { useAuth } from '../lib/auth';
import { apiFetch } from '../lib/api';
import { useT } from '../lib/i18n';

const SEV_ACCENT: Record<string, string> = {
  critical: 'border-l-red-500',
  soon: 'border-l-amber-500',
  info: 'border-l-slate-300',
};

/** Top-bar bell with unread badge + a dropdown of recent unread items (§6d). */
export function NotificationBell() {
  const { token } = useAuth();
  const tr = useT();
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(0);
  const [items, setItems] = useState<NotificationSummary[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  const refresh = useCallback(() => {
    if (!token) return;
    apiFetch<UnreadCount>('/notifications/unread-count', { token }).then((r) => setCount(r.unread)).catch(() => {});
  }, [token]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 30_000);
    return () => clearInterval(t);
  }, [refresh]);

  useEffect(() => {
    if (open && token) apiFetch<NotificationSummary[]>('/notifications?unread=true&limit=8', { token }).then(setItems).catch(() => {});
  }, [open, token]);

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  async function markAll() {
    await apiFetch('/notifications/read-all', { method: 'POST', token }).catch(() => {});
    setItems([]);
    setCount(0);
  }
  async function markOne(id: string) {
    await apiFetch(`/notifications/${id}/read`, { method: 'POST', token }).catch(() => {});
    setItems((x) => x.filter((n) => n.id !== id));
    setCount((c) => Math.max(0, c - 1));
  }

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} className="relative rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label={tr('bell.title')}>
        <span className="text-lg">🔔</span>
        {count > 0 && (
          <span className="absolute right-0 top-0 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
            {count > 9 ? '9+' : count}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-2 w-80 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2">
            <span className="text-sm font-semibold text-slate-700">{tr('bell.title')}</span>
            {count > 0 && <button onClick={markAll} className="text-xs text-sky-700 hover:underline">{tr('alerts.markAllRead')}</button>}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {items.length === 0 ? (
              <p className="p-6 text-center text-sm text-slate-400">{tr('bell.caughtUp')}</p>
            ) : (
              items.map((n) => (
                <Link
                  key={n.id}
                  href={n.deep_link || '/dashboard/alerts'}
                  onClick={() => { void markOne(n.id); setOpen(false); }}
                  className={`block border-l-4 ${SEV_ACCENT[n.severity] ?? SEV_ACCENT.info} px-4 py-2 hover:bg-slate-50`}
                >
                  <p className="text-sm font-medium text-slate-800">{n.title}</p>
                  <p className="mt-0.5 text-xs text-slate-500">{n.body}</p>
                </Link>
              ))
            )}
          </div>
          <Link href="/dashboard/alerts" onClick={() => setOpen(false)} className="block border-t border-slate-100 px-4 py-2 text-center text-xs font-medium text-sky-700 hover:bg-slate-50">
            {tr('bell.seeAll')}
          </Link>
        </div>
      )}
    </div>
  );
}
