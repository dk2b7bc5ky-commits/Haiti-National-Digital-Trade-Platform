'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ContainerSummary } from '@rezo/shared-types';
import { apiFetchEnvelope } from '../lib/api';
import { useT } from '../lib/i18n';

interface Result {
  key: string;
  label: string;
  sub?: string;
  href: string;
  kind: 'nav' | 'container';
}

/** ⌘K quick search: jump to a page or a container by number/B/L (Linear-style). */
export function CommandPalette({
  open, onClose, navItems, token,
}: {
  open: boolean; onClose: () => void; navItems: { href: string; label: string }[]; token: string | null;
}) {
  const router = useRouter();
  const t = useT();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const [containers, setContainers] = useState<ContainerSummary[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  // Load containers once (on first open) for search.
  useEffect(() => {
    if (open && token && containers.length === 0) {
      apiFetchEnvelope<ContainerSummary[]>('/containers?limit=200', { token }).then(({ json }) => setContainers(json.data ?? [])).catch(() => {});
    }
  }, [open, token, containers.length]);

  useEffect(() => {
    if (open) { setQ(''); setSel(0); setTimeout(() => inputRef.current?.focus(), 0); }
  }, [open]);

  const results = useMemo<Result[]>(() => {
    const needle = q.trim().toLowerCase();
    const nav = navItems
      .filter((n) => !needle || n.label.toLowerCase().includes(needle))
      .map((n) => ({ key: `nav:${n.href}`, label: n.label, href: n.href, kind: 'nav' as const }));
    const cons = needle
      ? containers
          .filter((c) => `${c.container_number} ${c.bl_number}`.toLowerCase().includes(needle))
          .slice(0, 6)
          .map((c) => ({ key: `c:${c.id}`, label: c.container_number, sub: c.bl_number, href: `/dashboard/containers/${c.id}`, kind: 'container' as const }))
      : [];
    return [...cons, ...nav];
  }, [q, navItems, containers]);

  if (!open) return null;

  const go = (r?: Result) => { const t = r ?? results[sel]; if (t) { router.push(t.href); onClose(); } };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[12vh]" role="dialog" aria-modal="true" aria-label="Quick search">
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} />
      <div className="relative w-full max-w-lg overflow-hidden rounded-xl border border-slate-200 bg-white shadow-soft">
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => { setQ(e.target.value); setSel(0); }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, results.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
            else if (e.key === 'Enter') { e.preventDefault(); go(); }
            else if (e.key === 'Escape') onClose();
          }}
          placeholder={t('cmd.placeholder')}
          className="w-full border-b border-slate-100 px-4 py-3 text-sm outline-none placeholder:text-slate-400"
        />
        <ul className="max-h-80 overflow-y-auto p-1.5">
          {results.length === 0 && <li className="px-3 py-6 text-center text-sm text-slate-400">{t('cmd.noMatches')}</li>}
          {results.map((r, i) => (
            <li key={r.key}>
              <button
                onMouseEnter={() => setSel(i)}
                onClick={() => go(r)}
                className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm ${i === sel ? 'bg-sky-50 text-sky-800' : 'text-slate-700 hover:bg-slate-50'}`}
              >
                <span className="flex items-center gap-2">
                  <span className="text-xs text-slate-400">{r.kind === 'container' ? t('cmd.container') : t('cmd.goTo')}</span>
                  <span className={r.kind === 'container' ? 'font-mono font-medium' : 'font-medium'}>{r.label}</span>
                  {r.sub && <span className="text-xs text-slate-400">{r.sub}</span>}
                </span>
                <span className="text-xs text-slate-300">↵</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="border-t border-slate-100 px-3 py-1.5 text-[11px] text-slate-400">{t('cmd.hint')}</div>
      </div>
    </div>
  );
}
