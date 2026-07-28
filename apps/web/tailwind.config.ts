import type { Config } from 'tailwindcss';

// Rezo design tokens (per the design brief): one calm accent — deep Caribbean
// teal — plus warm neutrals. We remap Tailwind's `sky` scale onto the teal ramp
// so the existing accent classes (sky-600 buttons, sky-700 links, sky-50/100
// tints) become the brand teal app-wide without touching every screen.
const teal = {
  50: '#EAF5F5',
  100: '#D2EAEA',
  200: '#A9D6DA',
  300: '#74BBC1',
  400: '#3E9BA4',
  500: '#20808E',
  600: '#1A6B77',
  700: '#175862',
  800: '#154951',
  900: '#123C43',
};

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  // Dark mode is driven by a `dark` class on <html> (set by ThemeProvider).
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        sky: teal,
        brand: teal,
        accent: { DEFAULT: '#20808E', weak: '#EAF5F5', hover: '#1A6B77' },
      },
      boxShadow: {
        // The brief's single soft elevation for raised surfaces.
        soft: '0 1px 2px rgba(15,46,44,.04), 0 8px 24px rgba(15,46,44,.06)',
      },
    },
  },
  plugins: [],
};

export default config;
