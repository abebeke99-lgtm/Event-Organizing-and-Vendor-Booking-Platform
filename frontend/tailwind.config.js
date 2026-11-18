/** @type {import('tailwindcss').Config} */
export default {
  corePlugins: { preflight: false },
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          navy: '#1B3A78',
          navyDark: '#142e64',
          gold: '#C9A24B',
          goldSoft: '#E2C98A',
          sky: '#3074B3',
        },
        surface: {
          page: 'var(--eh-page-background, #F4F8FD)',
          card: 'var(--eh-card, #FFFFFF)',
        },
      },
      fontFamily: {
        sans: ['DM Sans', 'Noto Sans Ethiopic', 'Manrope', 'sans-serif'],
        display: ['Manrope', 'DM Sans', 'sans-serif'],
      },
      boxShadow: {
        card: '0 8px 24px rgba(16, 36, 58, 0.08)',
        elevated: '0 18px 48px rgba(20, 35, 58, 0.16)',
      },
      borderRadius: {
        xl: '1rem',
        '2xl': '1.25rem',
      },
      screens: {
        xs: '320px',
        sm375: '375px',
        sm425: '425px',
        sm: '640px',
        md: '768px',
        lg: '1024px',
        xl: '1440px',
        '2xl': '1920px',
      },
    },
  },
  plugins: [],
};
