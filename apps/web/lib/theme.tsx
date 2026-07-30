'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';

const THEME_KEY = 'rezo_theme';

interface ThemeState {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggle: () => void;
}

const ThemeCtx = createContext<ThemeState | null>(null);

/** Applies/removes the `dark` class on <html> so the CSS overrides take effect. */
function apply(theme: Theme) {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.toggle('dark', theme === 'dark');
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Start from whatever the pre-hydration script already set on <html> so the
  // first client render matches the DOM (no flash, no mismatch).
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof document !== 'undefined' && document.documentElement.classList.contains('dark')) return 'dark';
    return 'light';
  });

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    apply(t);
    try { localStorage.setItem(THEME_KEY, t); } catch { /* ignore */ }
  }, []);

  const toggle = useCallback(() => setTheme(theme === 'dark' ? 'light' : 'dark'), [theme, setTheme]);

  // Keep in sync if the stored value differs from the initial DOM guess.
  useEffect(() => {
    const stored = (() => { try { return localStorage.getItem(THEME_KEY) as Theme | null; } catch { return null; } })();
    if (stored === 'light' || stored === 'dark') { setTheme(stored); return; }
    const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
    setTheme(prefersDark ? 'dark' : 'light');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <ThemeCtx.Provider value={{ theme, setTheme, toggle }}>{children}</ThemeCtx.Provider>;
}

export function useTheme(): ThemeState {
  const ctx = useContext(ThemeCtx);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}

/** Inline script (runs before paint) that sets the theme class to avoid a flash. */
export const themeInitScript = `(function(){try{var t=localStorage.getItem('${THEME_KEY}');if(!t){t=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}if(t==='dark')document.documentElement.classList.add('dark');}catch(e){}})();`;
