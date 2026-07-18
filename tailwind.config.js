/** @type {import('tailwindcss').Config} */
const z = (n) => `rgb(var(--z-${n}) / <alpha-value>)`

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      // The neutral scale is driven by CSS variables so the whole UI can flip
      // between dark (default) and light by swapping the `--z-*` / `--white`
      // values on `<html>` — see index.css. Accent colors are left untouched.
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
      },
    },
  },
  plugins: [],
}
