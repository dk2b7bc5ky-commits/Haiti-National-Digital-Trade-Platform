'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { DirectoryOrg, ContainerSize, ManifestSubmitResult } from '@rezo/shared-types';
import { useAuth } from '../../../../lib/auth';
import { apiFetch, ApiClientError } from '../../../../lib/api';
import { Chrome, Loading, useRequireAuth } from '../../../../components/chrome';

interface ContainerRow { container_number: string; size_type: ContainerSize }
interface BlRow {
  bl_number: string;
  shipper: string;
  consignee_org_id: string;
  description: string;
  containers: ContainerRow[];
}

const emptyContainer = (): ContainerRow => ({ container_number: '', size_type: '40' });
const emptyBl = (): BlRow => ({ bl_number: '', shipper: '', consignee_org_id: '', description: '', containers: [emptyContainer()] });

export default function NewManifestPage() {
  const { auth, ready } = useRequireAuth();
  const { token } = useAuth();

  const [importers, setImporters] = useState<DirectoryOrg[]>([]);
  const [voyage, setVoyage] = useState({ vessel_imo: '', vessel_name: '', voyage_number: '', eta: '', port: 'Port-au-Prince' });
  const [bls, setBls] = useState<BlRow[]>([emptyBl()]);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ManifestSubmitResult | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) return;
    apiFetch<DirectoryOrg[]>('/organizations/directory?type=IMPORTER', { token })
      .then(setImporters)
      .catch(() => setImporters([]));
  }, [token]);

  if (!ready || !auth) return <Loading />;

  function setBl(i: number, patch: Partial<BlRow>) {
    setBls((prev) => prev.map((b, idx) => (idx === i ? { ...b, ...patch } : b)));
  }
  function setContainer(bi: number, ci: number, patch: Partial<ContainerRow>) {
    setBls((prev) =>
      prev.map((b, idx) =>
        idx === bi ? { ...b, containers: b.containers.map((c, j) => (j === ci ? { ...c, ...patch } : c)) } : b,
      ),
    );
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await apiFetch<ManifestSubmitResult>('/manifests', {
        method: 'POST',
        token,
        body: {
          voyage: { ...voyage, eta: new Date(voyage.eta).toISOString() },
          bills_of_lading: bls.map((b) => ({
            bl_number: b.bl_number,
            shipper: b.shipper,
            consignee_org_id: b.consignee_org_id,
            description: b.description || undefined,
            containers: b.containers,
          })),
        },
      });
      setResult(res);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Submission failed.');
    } finally {
      setSubmitting(false);
    }
  }

  if (result) {
    return (
      <Chrome auth={auth}>
        <div className="mx-auto max-w-lg rounded-xl border border-green-200 bg-green-50 p-6 text-center">
          <h1 className="text-xl font-bold text-green-800">Manifest submitted</h1>
          <p className="mt-2 text-sm text-green-700">
            Created <strong>{result.container_ids.length}</strong> container(s). They are now visible to the
            consignee(s) and other authorized parties — entered once, no retyping.
          </p>
          <div className="mt-5 flex justify-center gap-3">
            <Link href="/dashboard/containers" className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700">
              View containers
            </Link>
            <button
              onClick={() => { setResult(null); setBls([emptyBl()]); setVoyage({ vessel_imo: '', vessel_name: '', voyage_number: '', eta: '', port: 'Port-au-Prince' }); }}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-white"
            >
              Submit another
            </button>
          </div>
        </div>
      </Chrome>
    );
  }

  return (
    <Chrome auth={auth}>
      <h1 className="text-2xl font-bold">Submit manifest</h1>
      <p className="mt-1 text-sm text-slate-500">Enter the voyage once; Rezo creates the bills of lading and containers everyone reads.</p>

      <form onSubmit={onSubmit} className="mt-6 space-y-6">
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold text-slate-500">Voyage</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Vessel name" value={voyage.vessel_name} onChange={(v) => setVoyage({ ...voyage, vessel_name: v })} required />
            <Input label="Vessel IMO" value={voyage.vessel_imo} onChange={(v) => setVoyage({ ...voyage, vessel_imo: v })} required />
            <Input label="Voyage number" value={voyage.voyage_number} onChange={(v) => setVoyage({ ...voyage, voyage_number: v })} required />
            <Input label="Port" value={voyage.port} onChange={(v) => setVoyage({ ...voyage, port: v })} required />
            <Input label="ETA" type="datetime-local" value={voyage.eta} onChange={(v) => setVoyage({ ...voyage, eta: v })} required />
          </div>
        </section>

        {bls.map((bl, bi) => (
          <section key={bi} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-500">Bill of lading {bi + 1}</h2>
              {bls.length > 1 && (
                <button type="button" onClick={() => setBls(bls.filter((_, i) => i !== bi))} className="text-xs text-red-600 hover:underline">
                  Remove
                </button>
              )}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Input label="BL number" value={bl.bl_number} onChange={(v) => setBl(bi, { bl_number: v })} required />
              <Input label="Shipper" value={bl.shipper} onChange={(v) => setBl(bi, { shipper: v })} required />
              <div>
                <label className="block text-sm font-medium text-slate-700">Consignee (importer)</label>
                <select
                  value={bl.consignee_org_id}
                  onChange={(e) => setBl(bi, { consignee_org_id: e.target.value })}
                  required
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none"
                >
                  <option value="">Select importer…</option>
                  {importers.map((o) => <option key={o.id} value={o.id}>{o.legal_name}</option>)}
                </select>
              </div>
              <Input label="Description" value={bl.description} onChange={(v) => setBl(bi, { description: v })} />
            </div>

            <div className="mt-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Containers</p>
              <div className="space-y-2">
                {bl.containers.map((c, ci) => (
                  <div key={ci} className="flex items-center gap-2">
                    <input
                      placeholder="Container number"
                      value={c.container_number}
                      onChange={(e) => setContainer(bi, ci, { container_number: e.target.value })}
                      required
                      className="flex-1 rounded-lg border border-slate-300 px-3 py-1.5 font-mono text-sm focus:border-sky-500 focus:outline-none"
                    />
                    <select
                      value={c.size_type}
                      onChange={(e) => setContainer(bi, ci, { size_type: e.target.value as ContainerSize })}
                      className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm focus:border-sky-500 focus:outline-none"
                    >
                      <option value="20">20&apos;</option>
                      <option value="40">40&apos;</option>
                      <option value="reefer">Reefer</option>
                    </select>
                    {bl.containers.length > 1 && (
                      <button type="button" onClick={() => setBl(bi, { containers: bl.containers.filter((_, j) => j !== ci) })} className="text-slate-400 hover:text-red-600">✕</button>
                    )}
                  </div>
                ))}
              </div>
              <button type="button" onClick={() => setBl(bi, { containers: [...bl.containers, emptyContainer()] })} className="mt-2 text-xs font-medium text-sky-700 hover:underline">
                + Add container
              </button>
            </div>
          </section>
        ))}

        <button type="button" onClick={() => setBls([...bls, emptyBl()])} className="text-sm font-medium text-sky-700 hover:underline">
          + Add bill of lading
        </button>

        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        <div>
          <button type="submit" disabled={submitting} className="rounded-lg bg-sky-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50">
            {submitting ? 'Submitting…' : 'Submit manifest'}
          </button>
        </div>
      </form>
    </Chrome>
  );
}

function Input({ label, value, onChange, type = 'text', required }: { label: string; value: string; onChange: (v: string) => void; type?: string; required?: boolean }) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
      />
    </div>
  );
}
