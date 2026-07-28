'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { HealthStatus, AuthContext } from '@rezo/shared-types';
import { useAuth } from '../lib/auth';
import { apiFetch } from '../lib/api';
import { NotificationBell } from './notification-bell';
import { CommandPalette } from './command-palette';

/** Redirects to /login when not authenticated; returns the resolved auth state. */
export function useRequireAuth() {
  const { loading, token, auth, logout } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (!loading && !token) router.replace('/login');
  }, [loading, token, router]);
  return { loading, token, auth, logout, ready: !loading && !!token && !!auth };
}

interface NavItem {
  href: string;
  label: string;
  icon: string;
  permission?: string;
}

const NAV: NavItem[] = [
  { href: '/dashboard/insights', label: 'Dashboard', icon: 'chart', permission: 'dashboard:view' },
  { href: '/dashboard/containers', label: 'Containers', icon: 'box', permission: 'container:read' },
  { href: '/dashboard/alerts', label: 'Alerts', icon: 'bell', permission: 'container:read' },
  { href: '/dashboard/ops/verification', label: 'Verification', icon: 'check', permission: 'verification:read' },
  { href: '/dashboard/broker/clients', label: 'My importers', icon: 'users', permission: 'broker:manage' },
  { href: '/dashboard/jobs', label: 'Trucking', icon: 'truck', permission: 'transport:drive' },
  { href: '/dashboard/gate', label: 'Gate', icon: 'gate', permission: 'gate:manage' },
  { href: '/dashboard/api-keys', label: 'API keys', icon: 'key', permission: 'apikey:manage' },
  { href: '/dashboard/billing', label: 'Billing', icon: 'receipt', permission: 'org:read' },
  { href: '/dashboard/manifests/new', label: 'Submit manifest', icon: 'doc', permission: 'manifest:submit' },
];

function NavIcon({ name }: { name: string }) {
  const p: Record<string, React.ReactNode> = {
    home: <><path d="M4 11l8-7 8 7" /><path d="M6 10v10h12V10" /></>,
    chart: <><path d="M4 19V5M4 19h16" /><path d="M8 15l3-3 3 2 4-5" /></>,
    box: <><rect x="4" y="7" width="16" height="12" rx="1.5" /><path d="M4 11h16" /></>,
    bell: <><path d="M6 9a6 6 0 1 1 12 0c0 4 2 5 2 5H4s2-1 2-5Z" /><path d="M10 20a2 2 0 0 0 4 0" /></>,
    check: <><circle cx="11" cy="11" r="6" /><path d="M20 20l-3-3" /></>,
    users: <><circle cx="9" cy="8" r="3" /><path d="M3.5 20a5.5 5.5 0 0 1 11 0" /><path d="M16 5.5a3 3 0 0 1 0 6" /></>,
    truck: <><rect x="3" y="7" width="11" height="9" rx="1" /><path d="M14 10h3.5L21 13v3h-7" /><circle cx="7" cy="18" r="1.6" /><circle cx="17" cy="18" r="1.6" /></>,
    gate: <><path d="M6 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16" /><path d="M4 21h16" /><path d="M14 12h.01" /></>,
    key: <><circle cx="8" cy="8" r="4" /><path d="M11 11l9 9" /><path d="M18 18l1.5-1.5" /></>,
    receipt: <><path d="M6 3h12v18l-3-2-3 2-3-2-3 2Z" /><path d="M9 8h6M9 12h6" /></>,
    doc: <><path d="M7 3h7l5 5v13H7Z" /><path d="M14 3v5h5" /><path d="M12 12v4M10 14h4" /></>,
  };
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      {p[name] ?? <circle cx="12" cy="12" r="3" />}
    </svg>
  );
}

/** Rezo wordmark + minimal node-link glyph (network, per the brief). */
function Wordmark() {
  return (
    <Link href="/dashboard" className="flex items-center gap-2">
      <svg viewBox="0 0 24 24" width="22" height="22" className="shrink-0" aria-hidden>
        <line x1="6" y1="7" x2="17" y2="6" stroke="#20808E" strokeWidth="1.5" />
        <line x1="6" y1="7" x2="9" y2="18" stroke="#20808E" strokeWidth="1.5" />
        <line x1="9" y1="18" x2="17" y2="6" stroke="#20808E" strokeWidth="1.5" />
        <circle cx="6" cy="7" r="2.4" fill="#20808E" />
        <circle cx="17" cy="6" r="2.4" fill="#20808E" />
        <circle cx="9" cy="18" r="2.4" fill="#3E9BA4" />
      </svg>
      <span className="text-lg font-bold tracking-tight text-slate-900">Rezo</span>
    </Link>
  );
}

function SidebarNav({ items, pathname, onNavigate }: { items: NavItem[]; pathname: string; onNavigate?: () => void }) {
  return (
    <nav className="flex-1 space-y-0.5 overflow-y-auto p-3">
      {items.map((n) => {
        const active = pathname === n.href || (n.href !== '/dashboard' && pathname.startsWith(n.href));
        return (
          <Link
            key={n.href}
            href={n.href}
            onClick={onNavigate}
            className={`relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
              active ? 'bg-sky-50 font-semibold text-sky-800' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            {active && <span className="absolute inset-y-1.5 left-0 w-[3px] rounded-r bg-sky-600" />}
            <span className={active ? 'text-sky-700' : 'text-slate-400'}><NavIcon name={n.icon} /></span>
            {n.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** Shared page shell: left sidebar (desktop) + slide-over (mobile), sticky top bar. */
export function Chrome({ auth, children }: { auth: AuthContext; children: React.ReactNode }) {
  const { logout, token } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const items = NAV.filter((n) => !n.permission || auth.permissions.includes(n.permission as never));
  const signOut = () => { logout(); router.replace('/login'); };

  // ⌘K / Ctrl+K opens the command palette.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPaletteOpen((o) => !o); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  return (
    <div className="min-h-screen bg-[#fafaf8]">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-slate-200 bg-white md:flex">
        <div className="flex h-14 items-center border-b border-slate-200 px-5"><Wordmark /></div>
        <SidebarNav items={items} pathname={pathname} />
        <div className="border-t border-slate-200 p-3">
          <button onClick={signOut} className="w-full rounded-lg px-3 py-2 text-left text-sm text-slate-500 hover:bg-slate-100 hover:text-slate-900">
            Sign out
          </button>
        </div>
      </aside>

      {/* Mobile slide-over */}
      {open && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-64 flex-col bg-white shadow-soft">
            <div className="flex h-14 items-center justify-between border-b border-slate-200 px-5">
              <Wordmark />
              <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-700" aria-label="Close menu">✕</button>
            </div>
            <SidebarNav items={items} pathname={pathname} onNavigate={() => setOpen(false)} />
            <div className="border-t border-slate-200 p-3">
              <button onClick={signOut} className="w-full rounded-lg px-3 py-2 text-left text-sm text-slate-500 hover:bg-slate-100">Sign out</button>
            </div>
          </aside>
        </div>
      )}

      {/* Main column */}
      <div className="md:pl-60">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-slate-200 bg-white/80 px-4 backdrop-blur md:px-6">
          <div className="flex items-center gap-3">
            <button onClick={() => setOpen(true)} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 md:hidden" aria-label="Open menu">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
            </button>
            <SectorChip />
            <button
              onClick={() => setPaletteOpen(true)}
              className="hidden items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-400 hover:bg-slate-50 sm:flex"
              aria-label="Search"
            >
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" /></svg>
              Search
              <kbd className="rounded border border-slate-200 bg-slate-50 px-1.5 text-[11px] font-medium text-slate-400">⌘K</kbd>
            </button>
          </div>
          <div className="flex items-center gap-3">
            <NotificationBell />
            <SystemStatus />
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} navItems={items} token={token} />
    </div>
  );
}

/** Static sector indicator (the national vision: Trade live, others on the roadmap). */
function SectorChip() {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-sm font-medium text-slate-700">
      <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
      Trade &amp; Customs
    </span>
  );
}

export function SystemStatus() {
  const { token } = useAuth();
  const [ok, setOk] = useState<boolean | null>(null);
  useEffect(() => {
    apiFetch<HealthStatus>('/health', { token })
      .then((h) => setOk(h.status === 'ok'))
      .catch(() => setOk(false));
  }, [token]);
  const label = ok === null ? 'checking' : ok ? 'API ok' : 'API down';
  const cls = ok === null ? 'bg-slate-100 text-slate-500' : ok ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700';
  return <span className={`hidden rounded-full px-2.5 py-1 text-xs font-medium sm:inline ${cls}`}>{label}</span>;
}

export function Loading() {
  return (
    <main className="flex min-h-screen items-center justify-center">
      <p className="text-sm text-slate-500">Loading…</p>
    </main>
  );
}
