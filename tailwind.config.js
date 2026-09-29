/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'Segoe UI', 'system-ui', 'sans-serif'],
        display: ['Arial Narrow', 'Inter', 'Segoe UI', 'sans-serif'],
      },
      colors: {
        ink: '#070b14',
      },
      boxShadow: {
        glow: '0 0 40px rgba(54, 211, 153, 0.08)',
      },
    },
  },
  plugins: [],
};
