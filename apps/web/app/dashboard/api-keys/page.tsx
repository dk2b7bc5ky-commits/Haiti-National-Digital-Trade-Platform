'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ApiKeyCreated } from '@rezo/shared-types';
import { useAuth } from '../../../lib/auth';
import { apiFetch, apiFetchEnvelope } from '../../../lib/api';
import { Chrome, Loading, useRequireAuth } from '../../../components/chrome';

interface KeyRow {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  status: string;
  created_at: string;
  last_used_at: string | null;
}

export default function ApiKeysPage() {
  const { auth, ready } = useRequireAuth();
  const { token } = useAuth();
  const [rows, setRows] = useState<KeyRow[]>([]);
  const [name, setName] = useState('');
  const [created, setCreated] = useState<ApiKeyCreated | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    if (!token) return;
    apiFetchEnvelope<KeyRow[]>('/api-keys', { token }).then(({ json }) => setRows(json.data ?? [])).catch(() => {});
  }, [token]);

  useEffect(() => { load(); }, [load]);

  async function create() {
    if (!name) return;
    setBusy(true);
    try {
      const key = await apiFetch<ApiKeyCreated>('/api-keys', { method: 'POST', token, body: { name, scopes: ['container:read', 'charge:read'] } });
      setCreated(key);
      setName('');
      load();
    } finally { setBusy(false); }
  }

  async function revoke(id: string) {
    await apiFetch(`/api-keys/${id}`, { method: 'DELETE', token }).catch(() => {});
    load();
  }

  if (!ready || !auth) return <Loading />;

  return (
    <Chrome auth={auth}>
      <h1 className="text-2xl font-bold">API keys</h1>
      <p className="mt-1 text-sm text-slate-500">
        Large partners integrate directly: exchange a key at <code className="rounded bg-slate-100 px-1">POST /api/v1/auth/token</code> for a JWT, then call the API.
      </p>

      {created && (
        <div className="mt-4 rounded-xl border border-green-200 bg-green-50 p-4">
          <p className="text-sm font-semibold text-green-800">Key created — copy it now, it won't be shown again:</p>
          <code className="mt-2 block break-all rounded bg-white px-3 py-2 font-mono text-sm text-slate-800">{created.api_key}</code>
          <button onClick={() => setCreated(null)} className="mt-2 text-xs text-slate-500 hover:underline">Dismiss</button>
        </div>
      )}

      <section className="mt-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-slate-500">Create a key</h2>
        <div className="flex flex-wrap items-center gap-3">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Key name (e.g. ERP integration)" className="flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm" />
          <button onClick={create} disabled={!name || busy} className="rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50">
            {busy ? 'Creating…' : 'Create key'}
          </button>
        </div>
      </section>

      <div className="mt-6 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-xs uppercase text-slate-400">
              <th className="px-5 py-3 font-medium">Name</th>
              <th className="px-5 py-3 font-medium">Prefix</th>
              <th className="px-5 py-3 font-medium">Scopes</th>
              <th className="px-5 py-3 font-medium">Status</th>
              <th className="px-5 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={5} className="px-5 py-6 text-center text-slate-500">No API keys yet.</td></tr>}
            {rows.map((k) => (
              <tr key={k.id} className="border-b border-slate-50">
                <td className="px-5 py-3 text-slate-700">{k.name}</td>
                <td className="px-5 py-3 font-mono text-xs text-slate-500">{k.prefix}</td>
                <td className="px-5 py-3 text-xs text-slate-500">{k.scopes.join(', ') || '—'}</td>
                <td className="px-5 py-3">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${k.status === 'ACTIVE' ? 'bg-green-100 text-green-700' : 'bg-slate-200 text-slate-600'}`}>{k.status.toLowerCase()}</span>
                </td>
                <td className="px-5 py-3 text-right">
                  {k.status === 'ACTIVE' && <button onClick={() => revoke(k.id)} className="text-xs text-red-600 hover:underline">revoke</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Chrome>
  );
}
