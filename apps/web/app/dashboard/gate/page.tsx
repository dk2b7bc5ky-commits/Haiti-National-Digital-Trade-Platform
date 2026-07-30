'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { GateAppointmentSummary } from '@rezo/shared-types';
import { useAuth } from '../../../lib/auth';
import { apiFetch, apiFetchEnvelope } from '../../../lib/api';
import { Chrome, Loading, useRequireAuth } from '../../../components/chrome';
import { StatusPill, EmptyState } from '../../../components/ui';

export default function GatePage() {
  const { auth, ready } = useRequireAuth();
  const { token } = useAuth();
  const [rows, setRows] = useState<GateAppointmentSummary[]>([]);
  const canManage = auth?.permissions.includes('gate:manage');

  const load = useCallback(() => {
    if (!token) return;
    apiFetchEnvelope<GateAppointmentSummary[]>('/gate-appointments', { token }).then(({ json }) => setRows(json.data ?? [])).catch(() => {});
  }, [token]);
  useEffect(() => { load(); }, [load]);

  async function act(id: string, action: 'confirm' | 'complete' | 'cancel') {
    await apiFetch(`/gate-appointments/${id}/${action}`, { method: 'POST', token, body: {} }).catch(() => {});
    load();
  }

  if (!ready || !auth) return <Loading />;

  return (
    <Chrome auth={auth}>
      <h1 className="text-2xl font-bold">Gate appointments</h1>
      <p className="mt-1 text-sm text-slate-500">Terminal confirms and completes booked slots; a completed slot gates the container out.</p>
      <div className="mt-6 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-xs uppercase text-slate-400">
              <th className="px-5 py-3 font-medium">Container</th>
              <th className="px-5 py-3 font-medium">Slot</th>
              <th className="px-5 py-3 font-medium">Status</th>
              {canManage && <th className="px-5 py-3 font-medium">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={4}><EmptyState title="No gate appointments yet." hint="A trucker books a slot; the terminal confirms and completes it." /></td></tr>}
            {rows.map((a) => (
              <tr key={a.id} className="border-b border-slate-50">
                <td className="px-5 py-3">
                  <Link href={`/dashboard/containers/${a.container_id}`} className="font-mono text-sky-700 hover:underline">{a.container_number}</Link>
                </td>
                <td className="px-5 py-3 text-slate-600">{new Date(a.slot_time).toLocaleString()}</td>
                <td className="px-5 py-3"><StatusPill status={a.status} /></td>
                {canManage && (
                  <td className="px-5 py-3 text-xs">
                    {a.status === 'requested' && <button onClick={() => act(a.id, 'confirm')} className="mr-3 text-sky-700 hover:underline">confirm</button>}
                    {a.status === 'confirmed' && <button onClick={() => act(a.id, 'complete')} className="mr-3 text-green-700 hover:underline">complete</button>}
                    {a.status !== 'completed' && a.status !== 'cancelled' && <button onClick={() => act(a.id, 'cancel')} className="text-red-600 hover:underline">cancel</button>}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Chrome>
  );
}
