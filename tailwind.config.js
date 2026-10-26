/** @type {import('tailwindcss').Config} */
const v = (name) => `var(--${name})`

module.exports = {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: [
          'Pretendard Variable',
          'Pretendard',
          '-apple-system',
          'BlinkMacSystemFont',
          'Apple SD Gothic Neo',
          'Malgun Gothic',
          'sans-serif',
        ],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'D2Coding', 'monospace'],
      },
      // Every colour is a CSS variable from index.css, so one class set themes light
      // and dark. Translucency comes from the glass component classes, not alpha
      // modifiers, so these are plain var() references.
      colors: {
        ink: { 1: v('ink-1'), 2: v('ink-2'), 3: v('ink-3'), 4: v('ink-4') },
        brand: { DEFAULT: v('brand'), hi: v('brand-hi'), lo: v('brand-lo'), ink: v('brand-ink') },
        line: { DEFAULT: v('line'), strong: v('line-strong') },
        well: v('well'),
        tone: {
          green: v('tone-green'),
          amber: v('tone-amber'),
          blue: v('tone-blue'),
          orange: v('tone-orange'),
          violet: v('tone-violet'),
          rose: v('tone-rose'),
          gray: v('tone-gray'),
        },
      },
      transitionTimingFunction: {
        out: 'cubic-bezier(.16,1,.3,1)',
      },
    },
  },
  plugins: [],
}
