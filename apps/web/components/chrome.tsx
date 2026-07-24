'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { HealthStatus, AuthContext } from '@rezo/shared-types';
import { useAuth } from '../lib/auth';
import { apiFetch } from '../lib/api';
import { NotificationBell } from './notification-bell';

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
  { href: '/dashboard/insights', label: 'Dashboards', permission: 'dashboard:view' },
  { href: '/dashboard/containers', label: 'Containers', permission: 'container:read' },
  { href: '/dashboard/alerts', label: 'Alerts', permission: 'container:read' },
  { href: '/dashboard/ops/verification', label: 'Verification', permission: 'verification:read' },
  { href: '/dashboard/broker/clients', label: 'My importers', permission: 'broker:manage' },
  { href: '/dashboard/jobs', label: 'Trucking', permission: 'transport:drive' },
  { href: '/dashboard/gate', label: 'Gate', permission: 'gate:manage' },
  { href: '/dashboard/api-keys', label: 'API keys', permission: 'apikey:manage' },
  { href: '/dashboard/billing', label: 'Billing', permission: 'org:read' },
  { href: '/dashboard/manifests/new', label: 'Submit manifest', permission: 'manifest:submit' },
];

/** Shared page shell: header, role-aware nav, health chip, sign-out. */
export function Chrome({ auth, children }: { auth: AuthContext; children: React.ReactNode }) {
  const { logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const items = NAV.filter((n) => !n.permission || auth.permissions.includes(n.permission as never));

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/80 backdrop-blur">
        <div className="mx-auto max-w-6xl px-6">
          {/* Top row: brand + system status + sign out */}
          <div className="flex items-center justify-between py-3">
            <Link href="/dashboard" className="flex items-center gap-2">
              <span className="grid h-7 w-7 place-items-center rounded-lg bg-sky-600 text-sm font-bold text-white">R</span>
              <span className="text-lg font-bold tracking-tight text-slate-900">Rezo</span>
            </Link>
            <div className="flex items-center gap-3">
              <NotificationBell />
              <SystemStatus />
              <button
                onClick={() => { logout(); router.replace('/login'); }}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
              >
                Sign out
              </button>
            </div>
          </div>
          {/* Nav row: scrollable pill tabs */}
          <nav className="-mb-px flex gap-1 overflow-x-auto pb-2">
            {items.map((n) => {
              const active = pathname === n.href;
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  className={`shrink-0 whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm transition-colors ${
                    active
                      ? 'bg-sky-600 font-medium text-white shadow-sm'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                  }`}
                >
                  {n.label}
                </Link>
              );
            })}
          </nav>
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
