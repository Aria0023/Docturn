import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));

/** @type {import('tailwindcss').Config} */
export default {
  content: [join(root, 'index.html'), join(root, 'src/**/*.{ts,tsx}')],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#2563EB',
          foreground: '#ffffff',
        },
        docturn: {
          blue: '#2563EB',
          amber: '#f59e0b',
          emerald: '#10b981',
          red: '#ef4444',
          slate: '#64748b',
        },
        border: 'hsl(214.3 31.8% 91.4%)',
        background: 'hsl(0 0% 100%)',
        foreground: 'hsl(222.2 47.4% 11.2%)',
        muted: {
          DEFAULT: 'hsl(210 40% 96.1%)',
          foreground: 'hsl(215.4 16.3% 46.9%)',
        },
      },
      borderRadius: {
        lg: '0.5rem',
        md: '0.375rem',
        sm: '0.25rem',
      },
    },
  },
  plugins: [],
};
