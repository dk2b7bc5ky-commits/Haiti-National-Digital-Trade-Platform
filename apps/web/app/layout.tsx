import type { Metadata } from 'next';
import './globals.css';
import { AuthProvider } from '../lib/auth';
import { ThemeProvider, themeInitScript } from '../lib/theme';
import { I18nProvider } from '../lib/i18n';

export const metadata: Metadata = {
  title: 'Rezo — National Digital Trade Platform',
  description: 'Rezo — Haiti.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <head>
        {/* Sets the theme class before first paint to avoid a light→dark flash. */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-screen antialiased">
        <ThemeProvider>
          <I18nProvider>
            <AuthProvider>{children}</AuthProvider>
          </I18nProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
