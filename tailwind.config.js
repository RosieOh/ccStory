/** @type {import('tailwindcss').Config} */
const z = (n) => `rgb(var(--z-${n}) / <alpha-value>)`

module.exports = {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          'Pretendard',
          'Inter',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Malgun Gothic',
          'sans-serif',
        ],
      },
      // The neutral scale and brand roles are CSS variables (see index.css), so
      // the same class set themes light and dark. Accent hues stay untouched.
      colors: {
        white: 'rgb(var(--white) / <alpha-value>)',
        zinc: {
          50: z(50),
          100: z(100),
          200: z(200),
          300: z(300),
          400: z(400),
          500: z(500),
          600: z(600),
          700: z(700),
          800: z(800),
          900: z(900),
          950: z(950),
        },
        brand: {
          DEFAULT: 'rgb(var(--brand) / <alpha-value>)',
          hover: 'rgb(var(--brand-hover) / <alpha-value>)',
          fg: 'rgb(var(--brand-fg) / <alpha-value>)',
          soft: 'rgb(var(--brand-soft) / <alpha-value>)',
          line: 'rgb(var(--brand-line) / <alpha-value>)',
          text: 'rgb(var(--brand-text) / <alpha-value>)',
        },
        bubble: {
          user: 'rgb(var(--bubble-user) / <alpha-value>)',
          'user-line': 'rgb(var(--bubble-user-line) / <alpha-value>)',
          ai: 'rgb(var(--bubble-ai) / <alpha-value>)',
          'ai-line': 'rgb(var(--bubble-ai-line) / <alpha-value>)',
        },
        plan: {
          bg: 'rgb(var(--plan-bg) / <alpha-value>)',
          line: 'rgb(var(--plan-line) / <alpha-value>)',
          text: 'rgb(var(--plan-text) / <alpha-value>)',
        },
        snippet: 'rgb(var(--snippet) / <alpha-value>)',
        scrim: 'rgb(var(--scrim) / var(--scrim-alpha))',
      },
      boxShadow: {
        e1: 'var(--shadow-e1)',
        e2: 'var(--shadow-e2)',
        e3: 'var(--shadow-e3)',
      },
      borderRadius: {
        xl: '0.875rem',
        '2xl': '1.125rem',
      },
      transitionTimingFunction: {
        out: 'cubic-bezier(.22,.61,.36,1)',
      },
    },
  },
  plugins: [],
}
