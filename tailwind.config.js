/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './public/static/**/*.js',
    './src/**/*.{ts,tsx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand: {
          50:  '#eef2ff', 100: '#e0e7ff', 200: '#c7d2fe', 300: '#a5b4fc',
          400: '#818cf8', 500: '#6366f1', 600: '#4f46e5', 700: '#4338ca',
          800: '#3730a3', 900: '#312e81',
        },
        surface: {
          DEFAULT: '#0a0a1a', card: '#111128', border: '#1e1e45',
          hover: '#1a1a38', sidebar: '#0d0d24',
        },
        accent: {
          cyan: '#06b6d4', green: '#10b981', amber: '#f59e0b',
          rose:  '#f43f5e', violet: '#8b5cf6',
        },
      },
      fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'] },
      boxShadow: {
        card: '0 0 0 1px rgba(99,102,241,.12), 0 4px 24px rgba(0,0,0,.4)',
        glow: '0 0 20px rgba(99,102,241,.3)',
      },
    },
  },
  plugins: [],
}
