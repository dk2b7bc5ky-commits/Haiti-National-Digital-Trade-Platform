'use client';

import Link from 'next/link';
import type { OrgSummary } from '@rezo/shared-types';
import { useEffect, useState } from 'react';
import { useAuth } from '../../lib/auth';
import { apiFetchEnvelope } from '../../lib/api';
import { roleConfig, CURRENT_STEP } from '../../lib/dashboard-config';
import { Chrome, Loading, useRequireAuth } from '../../components/chrome';

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
  const { auth, ready } = useRequireAuth();
  if (!ready || !auth) return <Loading />;

  const cfg = roleConfig(auth.user.role);
  const accent = ACCENT[cfg.accent] ?? ACCENT.slate;

  return (
    <Chrome auth={auth}>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">{cfg.label} dashboard</h1>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${accent}`}>{auth.user.role}</span>
      </div>
      <p className="mt-1 text-slate-600">{cfg.tagline}</p>

      <section className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cfg.modules.map((m) => {
          const available = m.step <= CURRENT_STEP;
          const card = (
            <div
              className={`h-full rounded-xl border p-5 transition ${
                available
                  ? 'border-slate-200 bg-white shadow-sm ' + (m.href ? 'hover:border-sky-300 hover:shadow' : '')
                  : 'border-dashed border-slate-300 bg-slate-50'
              }`}
            >
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-slate-800">{m.title}</h3>
                {available ? (
                  <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                    {m.href ? 'Open →' : 'Available'}
                  </span>
                ) : (
                  <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-500">Step {m.step}</span>
                )}
              </div>
              <p className="mt-2 text-sm text-slate-500">{m.description}</p>
            </div>
          );
          return available && m.href ? (
            <Link key={m.title} href={m.href}>{card}</Link>
          ) : (
            <div key={m.title}>{card}</div>
          );
        })}
      </section>

      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        <TenantPanel />
        <PermissionsPanel permissions={auth.permissions} />
      </div>
    </Chrome>
  );
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

function TenantPanel() {
  const { token, auth } = useAuth();
  const crossTenant = auth?.permissions.includes('tenant:read_all');
  const [orgs, setOrgs] = useState<OrgSummary[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    apiFetchEnvelope<OrgSummary[]>('/organizations?limit=50', { token })
      .then(({ json }) => (json.error ? setErr(json.error.message) : setOrgs(json.data ?? [])))
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
