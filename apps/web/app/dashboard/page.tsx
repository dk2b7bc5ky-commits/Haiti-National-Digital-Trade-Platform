'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { HealthStatus, OrgSummary } from '@rezo/shared-types';
import { useAuth } from '../../lib/auth';
import { apiFetch, apiFetchEnvelope } from '../../lib/api';
import { roleConfig } from '../../lib/dashboard-config';

// Static accent classes so Tailwind's scanner keeps them (no dynamic class names).
const ACCENT: Record<string, string> = {
  violet: 'bg-violet-100 text-violet-700',
  amber: 'bg-amber-100 text-amber-700',
  sky: 'bg-sky-100 text-sky-700',
  emerald: 'bg-emerald-100 text-emerald-700',
  indigo: 'bg-indigo-100 text-indigo-700',
  orange: 'bg-orange-100 text-orange-700',
  cyan: 'bg-cyan-100 text-cyan-700',
  rose: 'bg-rose-100 text-rose-700',
  teal: 'bg-teal-100 text-teal-700',
  slate: 'bg-slate-200 text-slate-700',
};

export default function DashboardPage() {
  const { loading, token, auth, logout } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !token) router.replace('/login');
  }, [loading, token, router]);

  if (loading || !auth) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-slate-500">Loading…</p>
      </main>
    );
  }

  const cfg = roleConfig(auth.user.role);
  const accent = ACCENT[cfg.accent] ?? ACCENT.slate;

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-3">
            <span className="text-lg font-bold text-sky-600">Rezo</span>
            <span className="hidden text-sm text-slate-400 sm:inline">National Digital Trade Platform</span>
          </div>
          <div className="flex items-center gap-3">
            <SystemStatus token={token} />
            <div className="text-right">
              <p className="text-sm font-medium text-slate-800">{auth.user.name}</p>
              <p className="text-xs text-slate-500">{auth.org.legal_name}</p>
            </div>
            <button
              onClick={() => { logout(); router.replace('/login'); }}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold">{cfg.label} dashboard</h1>
          <span className={`rounded-full px-3 py-1 text-xs font-semibold ${accent}`}>{auth.user.role}</span>
        </div>
        <p className="mt-1 text-slate-600">{cfg.tagline}</p>

        <section className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cfg.modules.map((m) => {
            const available = m.step <= 2;
            return (
              <div
                key={m.title}
                className={`rounded-xl border p-5 ${available ? 'border-slate-200 bg-white shadow-sm' : 'border-dashed border-slate-300 bg-slate-50'}`}
              >
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-slate-800">{m.title}</h3>
                  {available ? (
                    <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">Available</span>
                  ) : (
                    <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-500">Step {m.step}</span>
                  )}
                </div>
                <p className="mt-2 text-sm text-slate-500">{m.description}</p>
              </div>
            );
          })}
        </section>

        <div className="mt-8 grid gap-6 lg:grid-cols-3">
          <TenantPanel token={token} auth={auth} />
          <PermissionsPanel permissions={auth.permissions} />
        </div>
      </main>
    </div>
  );
}

function SystemStatus({ token }: { token: string | null }) {
  const [ok, setOk] = useState<boolean | null>(null);
  useEffect(() => {
    apiFetch<HealthStatus>('/health', { token })
      .then((h) => setOk(h.status === 'ok'))
      .catch(() => setOk(false));
  }, [token]);
  const label = ok === null ? 'checking' : ok ? 'API ok' : 'API down';
  const cls = ok === null ? 'bg-slate-100 text-slate-500' : ok ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700';
  return <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${cls}`}>{label}</span>;
}

function PermissionsPanel({ permissions }: { permissions: string[] }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="text-sm font-semibold text-slate-500">Your permissions</h3>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {permissions.map((p) => (
          <span key={p} className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-600">{p}</span>
        ))}
      </div>
    </div>
  );
}

function TenantPanel({ token, auth }: { token: string | null; auth: { permissions: string[]; org: OrgSummary } }) {
  const crossTenant = auth.permissions.includes('tenant:read_all');
  const [orgs, setOrgs] = useState<OrgSummary[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    apiFetchEnvelope<OrgSummary[]>('/organizations?limit=50', { token })
      .then(({ json }) => {
        if (json.error) setErr(json.error.message);
        else setOrgs(json.data ?? []);
      })
      .catch(() => setErr('Could not load organizations.'));
  }, [token]);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-500">
          {crossTenant ? 'Organizations (all tenants)' : 'Your organization'}
        </h3>
        {orgs && <span className="text-xs text-slate-400">{orgs.length} shown</span>}
      </div>
      {err && <p className="mt-3 text-sm text-red-600">{err}</p>}
      {orgs && (
        <table className="mt-3 w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-xs uppercase text-slate-400">
              <th className="py-2 font-medium">Legal name</th>
              <th className="py-2 font-medium">Type</th>
              <th className="py-2 font-medium">KYC</th>
            </tr>
          </thead>
          <tbody>
            {orgs.map((o) => (
              <tr key={o.id} className="border-b border-slate-50">
                <td className="py-2 text-slate-700">{o.legal_name}</td>
                <td className="py-2 text-slate-500">{o.type}</td>
                <td className="py-2">
                  <span className={`rounded px-1.5 py-0.5 text-xs ${o.kyc_status === 'VERIFIED' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                    {o.kyc_status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
