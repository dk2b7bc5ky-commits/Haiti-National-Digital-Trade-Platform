'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { BrokerClientSummary, DirectoryOrg } from '@rezo/shared-types';
import { useAuth } from '../../../../lib/auth';
import { apiFetch, apiFetchEnvelope } from '../../../../lib/api';
import { Chrome, Loading, useRequireAuth } from '../../../../components/chrome';

export default function BrokerClientsPage() {
  const { auth, ready } = useRequireAuth();
  const { token } = useAuth();
  const [clients, setClients] = useState<BrokerClientSummary[]>([]);
  const [importers, setImporters] = useState<DirectoryOrg[]>([]);
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!token) return;
    apiFetchEnvelope<BrokerClientSummary[]>('/broker/clients', { token }).then(({ json }) => setClients(json.data ?? [])).catch(() => {});
    apiFetch<DirectoryOrg[]>('/organizations/directory?type=IMPORTER', { token }).then(setImporters).catch(() => {});
  }, [token]);

  useEffect(() => { load(); }, [load]);

  async function add() {
    if (!pick) return;
    setBusy(true); setErr(null);
    try {
      await apiFetch('/broker/clients', { method: 'POST', token, body: { importer_org_id: pick } });
      setPick('');
      load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not add client.');
    } finally { setBusy(false); }
  }

  async function remove(id: string) {
    await apiFetch(`/broker/clients/${id}`, { method: 'DELETE', token }).catch(() => {});
    load();
  }

  if (!ready || !auth) return <Loading />;
  const clientIds = new Set(clients.map((c) => c.importer_org_id));
  const addable = importers.filter((o) => !clientIds.has(o.id));

  return (
    <Chrome auth={auth}>
      <h1 className="text-2xl font-bold">My importers</h1>
      <p className="mt-1 text-sm text-slate-500">
        One login clears for many importers. You can see and pay every container consigned to the importers you represent.
      </p>

      <section className="mt-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-slate-500">Add an importer you clear for</h2>
        <div className="flex flex-wrap items-center gap-3">
          <select value={pick} onChange={(e) => setPick(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm">
            <option value="">Select importer…</option>
            {addable.map((o) => <option key={o.id} value={o.id}>{o.legal_name}</option>)}
          </select>
          <button onClick={add} disabled={!pick || busy} className="rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50">
            {busy ? 'Adding…' : 'Add client'}
          </button>
          {err && <span className="text-sm text-red-600">{err}</span>}
        </div>
      </section>

      <div className="mt-6 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-xs uppercase text-slate-400">
              <th className="px-5 py-3 font-medium">Importer</th>
              <th className="px-5 py-3 font-medium">Containers</th>
              <th className="px-5 py-3 font-medium">Since</th>
              <th className="px-5 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {clients.length === 0 && <tr><td colSpan={4} className="px-5 py-6 text-center text-slate-500">No importers yet — add one above.</td></tr>}
            {clients.map((c) => (
              <tr key={c.id} className="border-b border-slate-50">
                <td className="px-5 py-3 text-slate-700">{c.importer_name}</td>
                <td className="px-5 py-3 text-slate-600">{c.container_count}</td>
                <td className="px-5 py-3 text-slate-500">{new Date(c.created_at).toLocaleDateString()}</td>
                <td className="px-5 py-3 text-right">
                  <button onClick={() => remove(c.id)} className="text-xs text-red-600 hover:underline">remove</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-4 text-sm text-slate-500">
        View and pay their containers under <Link href="/dashboard/containers" className="text-sky-700 hover:underline">Containers</Link>.
      </p>
    </Chrome>
  );
}
