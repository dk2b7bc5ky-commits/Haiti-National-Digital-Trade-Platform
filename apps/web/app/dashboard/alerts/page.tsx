'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { NotificationSummary, NotificationPreferences, NotificationSeverity, NotificationType } from '@rezo/shared-types';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';
import { useT } from '../../../lib/i18n';
import { Chrome, Loading, useRequireAuth } from '../../../components/chrome';
import { Money, EmptyState } from '../../../components/ui';

const TYPE_META: Record<string, { icon: string; label: string }> = {
  deadline_reminder: { icon: '⏰', label: 'Deadline' },
  payment_confirmed: { icon: '✅', label: 'Payment' },
  payment_failed: { icon: '❌', label: 'Payment' },
  container_released: { icon: '📦', label: 'Release' },
  gate_appointment_confirmed: { icon: '🚪', label: 'Gate' },
  gate_reminder: { icon: '🚪', label: 'Gate' },
  verification_needed: { icon: '🔍', label: 'Verification' },
  charge_added: { icon: '🧾', label: 'Charge' },
  document_required: { icon: '📄', label: 'Document' },
  trucking_job_offered: { icon: '🚚', label: 'Trucking' },
  trucking_job_accepted: { icon: '🚚', label: 'Trucking' },
  trucking_job_delivered: { icon: '🚚', label: 'Trucking' },
};

const SEV: Record<NotificationSeverity, { title: string; accent: string; dot: string }> = {
  critical: { title: 'Critical', accent: 'border-l-red-500', dot: 'bg-red-500' },
  soon: { title: 'Soon', accent: 'border-l-amber-500', dot: 'bg-amber-500' },
  info: { title: 'Info', accent: 'border-l-slate-300', dot: 'bg-slate-300' },
};
const SEV_ORDER: NotificationSeverity[] = ['critical', 'soon', 'info'];

export default function AlertsPage() {
  const { auth, ready } = useRequireAuth();
  const { token } = useAuth();
  const t = useT();
  const [rows, setRows] = useState<NotificationSummary[] | null>(null);
  const [container, setContainer] = useState('');
  const [type, setType] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [showPrefs, setShowPrefs] = useState(false);

  const load = useCallback(() => {
    if (!token) return;
    apiFetch<NotificationSummary[]>('/notifications?limit=200', { token }).then(setRows).catch(() => setRows([]));
  }, [token]);
  useEffect(() => { load(); }, [load]);

  const containers = useMemo(() => [...new Set((rows ?? []).map((r) => r.container_number).filter(Boolean))] as string[], [rows]);
  const types = useMemo(() => [...new Set((rows ?? []).map((r) => r.type))], [rows]);

  const filtered = (rows ?? []).filter(
    (r) => (!container || r.container_number === container) && (!type || r.type === type) && (!unreadOnly || !r.read_at),
  );
  const bySeverity = (s: NotificationSeverity) => filtered.filter((r) => r.severity === s);

  async function markAll() {
    await apiFetch('/notifications/read-all', { method: 'POST', token }).catch(() => {});
    load();
  }
  async function markOne(id: string) {
    await apiFetch(`/notifications/${id}/read`, { method: 'POST', token }).catch(() => {});
    load();
  }

  if (!ready || !auth) return <Loading />;

  return (
    <Chrome auth={auth}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t('nav.alerts')}</h1>
          <p className="mt-1 text-sm text-slate-500">{t('alerts.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowPrefs((s) => !s)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100">
            {showPrefs ? t('alerts.hidePreferences') : t('alerts.preferences')}
          </button>
          <button onClick={markAll} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100">{t('alerts.markAllRead')}</button>
        </div>
      </div>

      {showPrefs && <PreferencesPanel token={token} />}

      {/* Filters */}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <select value={container} onChange={(e) => setContainer(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm">
          <option value="">{t('alerts.allContainers')}</option>
          {containers.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={type} onChange={(e) => setType(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm">
          <option value="">{t('alerts.allEventTypes')}</option>
          {types.map((ty) => <option key={ty} value={ty}>{TYPE_META[ty]?.label ?? ty} — {ty.replace(/_/g, ' ')}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-sm text-slate-600">
          <input type="checkbox" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} /> {t('alerts.unreadOnly')}
        </label>
      </div>

      {rows && filtered.length === 0 && (
        <div className="mt-6 rounded-xl border border-slate-200 bg-white shadow-sm">
          <EmptyState title={t('alerts.nothingHere')} hint={t('alerts.noMatch')} />
        </div>
      )}

      {SEV_ORDER.map((s) => {
        const items = bySeverity(s);
        if (items.length === 0) return null;
        return (
          <section key={s} className="mt-6">
            <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
              <span className={`inline-block h-2 w-2 rounded-full ${SEV[s].dot}`} /> {t(`sev.${s}`)} <span className="text-slate-400">({items.length})</span>
            </h2>
            <div className="space-y-2">
              {items.map((n) => <NotificationRow key={n.id} n={n} accent={SEV[s].accent} onRead={markOne} />)}
            </div>
          </section>
        );
      })}
    </Chrome>
  );
}

function NotificationRow({ n, accent, onRead }: { n: NotificationSummary; accent: string; onRead: (id: string) => void }) {
  const t = useT();
  const meta = TYPE_META[n.type] ?? { icon: '•', label: n.type };
  const unread = !n.read_at;
  return (
    <div className={`flex items-start gap-3 rounded-xl border border-slate-200 border-l-4 ${accent} bg-white p-4 shadow-sm ${unread ? '' : 'opacity-70'}`}>
      <span className="mt-0.5 text-lg" title={meta.label}>{meta.icon}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold text-slate-800">{n.title}</p>
          {n.container_number && (
            <Link href={n.deep_link || `/dashboard/containers/${n.container_id}`} className="font-mono text-xs text-sky-700 hover:underline">{n.container_number}</Link>
          )}
        </div>
        <p className="mt-0.5 text-sm text-slate-500">{n.body}</p>
        <p className="mt-1 text-xs text-slate-400">
          <span className="rounded bg-slate-100 px-1.5 py-0.5">{meta.label}</span>
          {' · '}{n.channel === 'email' ? t('alerts.emailed') : t('alerts.inApp')}
          {' · '}{new Date(n.created_at).toLocaleString()}
        </p>
      </div>
      <div className="flex flex-col items-end gap-1">
        {n.amount_at_risk && (
          <span className="whitespace-nowrap text-sm font-semibold text-red-600">
            <Money amount={n.amount_at_risk.amount} currency={n.amount_at_risk.currency} /> {t('alerts.atRisk')}
          </span>
        )}
        {unread && <button onClick={() => onRead(n.id)} className="text-xs text-sky-700 hover:underline">{t('alerts.markRead')}</button>}
      </div>
    </div>
  );
}

function PreferencesPanel({ token }: { token: string | null }) {
  const t = useT();
  const [prefs, setPrefs] = useState<NotificationPreferences | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!token) return;
    apiFetch<NotificationPreferences>('/notifications/preferences', { token }).then(setPrefs).catch(() => {});
  }, [token]);

  if (!prefs) return <div className="mt-4 rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-400 shadow-sm">{t('alerts.loadingPrefs')}</div>;

  const setChannel = (type: NotificationType, key: 'in_app' | 'email', val: boolean) =>
    setPrefs({ ...prefs, preferences: prefs.preferences.map((p) => (p.type === type ? { ...p, [key]: val } : p)) });

  async function save() {
    setSaved(false);
    const body = {
      preferences: prefs!.preferences,
      quiet_start: prefs!.quiet_hours.start,
      quiet_end: prefs!.quiet_hours.end,
    };
    await apiFetch('/notifications/preferences', { method: 'PUT', token, body }).catch(() => {});
    setSaved(true);
  }

  return (
    <div className="mt-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="mb-3 text-sm font-semibold text-slate-500">{t('alerts.prefTitle')}</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-xs uppercase text-slate-400">
              <th className="py-2 font-medium">{t('alerts.event')}</th>
              <th className="py-2 text-center font-medium">{t('alerts.inAppCol')}</th>
              <th className="py-2 text-center font-medium">{t('alerts.emailCol')}</th>
            </tr>
          </thead>
          <tbody>
            {prefs.preferences.map((p) => (
              <tr key={p.type} className="border-b border-slate-50">
                <td className="py-2 capitalize text-slate-700">{p.type.replace(/_/g, ' ')}</td>
                <td className="py-2 text-center"><input type="checkbox" checked={p.in_app} onChange={(e) => setChannel(p.type, 'in_app', e.target.checked)} /></td>
                <td className="py-2 text-center"><input type="checkbox" checked={p.email} onChange={(e) => setChannel(p.type, 'email', e.target.checked)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4">
        <span className="text-sm text-slate-600">{t('alerts.quietHours')}</span>
        <HourSelect value={prefs.quiet_hours.start} onChange={(v) => setPrefs({ ...prefs, quiet_hours: { ...prefs.quiet_hours, start: v } })} label={t('alerts.from')} />
        <HourSelect value={prefs.quiet_hours.end} onChange={(v) => setPrefs({ ...prefs, quiet_hours: { ...prefs.quiet_hours, end: v } })} label={t('alerts.to')} />
        <button onClick={save} className="rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-sky-700">{t('alerts.savePrefs')}</button>
        {saved && <span className="text-sm text-green-700">{t('alerts.saved')}</span>}
      </div>
    </div>
  );
}

function HourSelect({ value, onChange, label }: { value: number | null; onChange: (v: number | null) => void; label: string }) {
  return (
    <label className="flex items-center gap-1 text-sm text-slate-500">
      {label}
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        className="rounded-lg border border-slate-300 px-2 py-1 text-sm"
      >
        <option value="">—</option>
        {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
      </select>
    </label>
  );
}
