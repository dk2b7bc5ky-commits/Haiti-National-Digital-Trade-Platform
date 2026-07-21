'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { HealthStatus, AuthContext } from '@rezo/shared-types';
import { useAuth } from '../lib/auth';
import { apiFetch } from '../lib/api';

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
  permission?: string;
}

const NAV: NavItem[] = [
  { href: '/dashboard', label: 'Overview' },
  { href: '/dashboard/containers', label: 'Containers', permission: 'container:read' },
  { href: '/dashboard/manifests/new', label: 'Submit manifest', permission: 'manifest:submit' },
];

/** Shared page shell: header, role-aware nav, health chip, sign-out. */
export function Chrome({ auth, children }: { auth: AuthContext; children: React.ReactNode }) {
  const { logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const items = NAV.filter((n) => !n.permission || auth.permissions.includes(n.permission as never));

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-6">
            <Link href="/dashboard" className="text-lg font-bold text-sky-600">Rezo</Link>
            <nav className="hidden gap-1 sm:flex">
              {items.map((n) => {
                const active = pathname === n.href;
                return (
                  <Link
                    key={n.href}
                    href={n.href}
                    className={`rounded-lg px-3 py-1.5 text-sm ${active ? 'bg-slate-100 font-medium text-slate-900' : 'text-slate-600 hover:bg-slate-50'}`}
                  >
                    {n.label}
                  </Link>
                );
              })}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <SystemStatus />
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
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
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
  return <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${cls}`}>{label}</span>;
}

export function Loading() {
  return (
    <main className="flex min-h-screen items-center justify-center">
      <p className="text-sm text-slate-500">Loading…</p>
    </main>
  );
}
