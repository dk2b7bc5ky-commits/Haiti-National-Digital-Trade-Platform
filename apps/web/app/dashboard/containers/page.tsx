'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { ContainerSummary } from '@rezo/shared-types';
import { useAuth } from '../../../lib/auth';
import { apiFetchEnvelope } from '../../../lib/api';
import { Chrome, Loading, useRequireAuth } from '../../../components/chrome';

const SIZE_LABEL: Record<string, string> = { '20': "20'", '40': "40'", reefer: 'Reefer' };
const STATUS_STYLE: Record<string, string> = {
  arrived: 'bg-sky-100 text-sky-700',
  cleared: 'bg-indigo-100 text-indigo-700',
  released: 'bg-emerald-100 text-emerald-700',
  gated_out: 'bg-slate-200 text-slate-700',
};

export default function ContainersPage() {
  const { auth, ready } = useRequireAuth();
  const { token } = useAuth();
  const [rows, setRows] = useState<ContainerSummary[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    apiFetchEnvelope<ContainerSummary[]>('/containers?limit=100', { token })
      .then(({ json }) => (json.error ? setErr(json.error.message) : setRows(json.data ?? [])))
      .catch(() => setErr('Could not load containers.'));
  }, [token]);

  if (!ready || !auth) return <Loading />;

  return (
    <Chrome auth={auth}>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Containers</h1>
        {auth.permissions.includes('manifest:submit') && (
          <Link href="/dashboard/manifests/new" className="rounded-lg bg-sky-600 px-3 py-2 text-sm font-semibold text-white hover:bg-sky-700">
            + Submit manifest
          </Link>
        )}
      </div>
      <p className="mt-1 text-sm text-slate-500">
        Shared from the manifest — entered once by the shipping line, read here without re-entry.
      </p>

      <div className="mt-6 rounded-xl border border-slate-200 bg-white shadow-sm">
        {err && <p className="p-5 text-sm text-red-600">{err}</p>}
        {rows && rows.length === 0 && (
          <p className="p-8 text-center text-sm text-slate-500">
            No containers visible for your organization yet.
          </p>
        )}
        {rows && rows.length > 0 && (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-xs uppercase text-slate-400">
                <th className="px-5 py-3 font-medium">Container</th>
                <th className="px-5 py-3 font-medium">Size</th>
                <th className="px-5 py-3 font-medium">Vessel / Voyage</th>
                <th className="px-5 py-3 font-medium">BL</th>
                <th className="px-5 py-3 font-medium">Arrival</th>
                <th className="px-5 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className="border-b border-slate-50 hover:bg-slate-50">
                  <td className="px-5 py-3">
                    <Link href={`/dashboard/containers/${c.id}`} className="font-mono font-medium text-sky-700 hover:underline">
                      {c.container_number}
                    </Link>
                  </td>
                  <td className="px-5 py-3 text-slate-600">{SIZE_LABEL[c.size_type] ?? c.size_type}</td>
                  <td className="px-5 py-3 text-slate-600">
                    {c.voyage.vessel.name} <span className="text-slate-400">· {c.voyage.voyage_number}</span>
                  </td>
                  <td className="px-5 py-3 font-mono text-xs text-slate-500">{c.bl_number}</td>
                  <td className="px-5 py-3 text-slate-500">
                    {c.arrival_date ? new Date(c.arrival_date).toLocaleDateString() : '—'}
                  </td>
                  <td className="px-5 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[c.status] ?? 'bg-slate-100 text-slate-600'}`}>
                      {c.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Chrome>
  );
}
