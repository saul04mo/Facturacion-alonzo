/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Semantic colors that adapt via CSS custom properties
        primary: 'var(--c-primary)',
        secondary: 'var(--c-secondary)',
        muted: 'var(--c-muted)',
        faint: 'var(--c-faint)',
        dimmed: 'var(--c-dimmed)',
        // Semantic backgrounds
        page: 'var(--bg-page)',
        card: { DEFAULT: 'var(--bg-card)', alt: 'var(--bg-card-alt)', hover: 'var(--bg-hover)' },
        // Semantic borders
        main: 'var(--border-main)',
        subtle: 'var(--border-subtle)',

        // Raw palettes (still available for explicit use)
        navy: {
          50: '#f0f4f8', 100: '#d9e2ec', 200: '#bcccdc', 300: '#9fb3c8',
          400: '#829ab1', 500: '#627d98', 600: '#486581', 700: '#334e68',
          800: '#243b53', 900: '#102a43', 950: '#0a1929',
        },
        accent: { blue: '#3b82f6', green: '#10b981', amber: '#f59e0b', red: '#ef4444', purple: '#8b5cf6', cyan: '#06b6d4' },
        surface: { 0: '#ffffff', 50: '#f8fafc', 100: '#f1f5f9', 200: '#e2e8f0', 300: '#cbd5e1' },
        dark: { 0: '#080c16', 50: '#0f1523', 100: '#1e293b', 200: '#232d42', 300: '#2d3748', 400: '#3b4b68', border: '#1e293b' },
      },
      fontFamily: {
        display: ['"Plus Jakarta Sans"', 'system-ui', 'sans-serif'],
        body: ['"DM Sans"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      boxShadow: {
        'sm': '0 1px 3px 0 rgb(0 0 0 / 0.04), 0 1px 2px -1px rgb(0 0 0 / 0.04)',
        'md': '0 4px 12px 0 rgb(0 0 0 / 0.06), 0 2px 4px -2px rgb(0 0 0 / 0.04)',
        'nav': '0 1px 2px 0 rgb(0 0 0 / 0.03)',
        'modal': '0 20px 60px -12px rgb(0 0 0 / 0.15)',
      },
    },
  },
  plugins: [],
};
