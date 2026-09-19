/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        bg:      'rgb(var(--tw-bg) / <alpha-value>)',
        surface: 'rgb(var(--tw-surface) / <alpha-value>)',
        border:  'rgb(var(--tw-border) / <alpha-value>)',
        cyan:    'rgb(var(--tw-cyan) / <alpha-value>)',
        green:   'rgb(var(--tw-green) / <alpha-value>)',
        red:     'rgb(var(--tw-red) / <alpha-value>)',
        amber:   'rgb(var(--tw-amber) / <alpha-value>)',
        muted:   'rgb(var(--tw-muted) / <alpha-value>)',
        purple:  'rgb(var(--tw-purple) / <alpha-value>)',
      },
      fontFamily: {
        sans:  ['Inter', 'system-ui', 'sans-serif'],
        mono:  ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      boxShadow: {
        'glow':    '0 0 20px rgb(var(--tw-cyan) / 0.15)',
        'glow-sm': '0 0 8px rgb(var(--tw-cyan) / 0.25)',
        'card':    '0 4px 24px rgb(0 0 0 / 0.3)',
        'card-sm': '0 2px 8px rgb(0 0 0 / 0.2)',
      },
      borderRadius: {
        'xl': '0.875rem',
        '2xl': '1.25rem',
      },
      animation: {
        'fade-in':   'fade-in 0.25s ease forwards',
        'slide-up':  'slide-up 0.3s ease forwards',
      },
    },
  },
  plugins: [],
}
