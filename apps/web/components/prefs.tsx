'use client';

import { useEffect, useRef, useState } from 'react';
import { useTheme } from '../lib/theme';
import { useI18n, LOCALES, type Locale } from '../lib/i18n';

/** Sun/moon toggle for light↔dark. */
export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const { t } = useI18n();
  const dark = theme === 'dark';
  return (
    <button
      onClick={toggle}
      className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
      aria-label={dark ? t('ui.light') : t('ui.dark')}
      title={dark ? t('ui.light') : t('ui.dark')}
    >
      {dark ? (
        // sun
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" />
        </svg>
      ) : (
        // moon
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
        </svg>
      )}
    </button>
  );
}

/** Compact language menu (FR / HT / EN). */
export function LanguageSwitcher() {
  const { locale, setLocale, t } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = LOCALES.find((l) => l.code === locale) ?? LOCALES[0];

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('mousedown', h);
    return () => window.removeEventListener('mousedown', h);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-900"
        aria-label={t('ui.language')}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.7">
          <circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.6 2.5 15.4 0 18M12 3c-2.5 2.6-2.5 15.4 0 18" />
        </svg>
        <span>{current.short}</span>
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-50 mt-1 w-40 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-soft">
          {LOCALES.map((l) => (
            <button
              key={l.code}
              role="menuitemradio"
              aria-checked={l.code === locale}
              onClick={() => { setLocale(l.code as Locale); setOpen(false); }}
              className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-sm ${l.code === locale ? 'bg-sky-50 font-semibold text-sky-800' : 'text-slate-700 hover:bg-slate-50'}`}
            >
              {l.label}
              <span className="text-xs text-slate-400">{l.short}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
