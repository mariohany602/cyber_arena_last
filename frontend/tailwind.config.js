/** @type {import('tailwindcss').Config} */
//
// Cyber Arena — "Midnight Ops" design tokens.
// Existing class names (`bg-ui-bg`, `text-brand-primary`, `text-neon-*`, …)
// are preserved and remapped, so every existing page picks up the new look
// automatically. Semantic intent of each token is documented inline.
//
module.exports = {
  content: [
    "./index.html",
    "./src/**/*.{js,jsx,ts,tsx}"
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      colors: {
        // Primary brand = mint accent. Secondary = indigo (used on SOC chrome).
        brand: {
          primary: '#00E5A8',
          'primary-bright': '#1FF2BB',
          secondary: '#7C8CFF',
          'secondary-bright': '#9BA8FF',
          accent: '#7C8CFF',
        },
        // App chrome neutrals — dark first.
        ui: {
          bg: '#0A0B0F',
          'bg-soft': '#0E1016',
          surface: '#11141B',
          'surface-2': '#161A23',
          panel: '#1B2030',
          border: '#1F2430',
          'border-bright': '#2A3142',
          muted: '#8A93A6',
          subtle: '#6B7385',
        },
        // Semantic "neon" palette. Hues are preserved so existing usage keeps
        // its meaning (red = danger, green = success, etc.) but each value is
        // tuned for the new Midnight Ops base.
        neon: {
          green:   '#00E5A8', // success / brand alt
          cyan:    '#5BC0EB', // info / low-sev
          blue:    '#7C8CFF', // accent-2
          purple:  '#A78BFA', // accent-3
          magenta: '#E879F9', // highlight
          yellow:  '#F5C84B', // medium-sev / warning
          red:     '#FF3B6B', // critical-sev / danger
        }
      },
      backgroundImage: {
        'gradient-main':        'linear-gradient(135deg, #0A0B0F 0%, #11141B 100%)',
        'gradient-brand':       'linear-gradient(135deg, #00E5A8 0%, #7C8CFF 100%)',
        'gradient-brand-soft':  'linear-gradient(135deg, rgba(0,229,168,0.14) 0%, rgba(124,140,255,0.14) 100%)',
        'gradient-surface':     'linear-gradient(180deg, rgba(27,32,48,0.7) 0%, rgba(17,20,27,0.7) 100%)',
        'gradient-glow':        'radial-gradient(ellipse 80% 60% at 50% -10%, rgba(0,229,168,0.18), transparent 70%)',
        'gradient-mesh':        'radial-gradient(at 20% 0%, rgba(0,229,168,0.10) 0%, transparent 50%), radial-gradient(at 80% 100%, rgba(124,140,255,0.10) 0%, transparent 50%)',
        'gradient-aurora':      'conic-gradient(from 180deg at 50% 50%, #00E5A8 0deg, #7C8CFF 120deg, #A78BFA 240deg, #00E5A8 360deg)',
      },
      boxShadow: {
        'glow-primary':   '0 0 0 1px rgba(0,229,168,0.25), 0 8px 32px -8px rgba(0,229,168,0.45)',
        'glow-secondary': '0 0 0 1px rgba(124,140,255,0.25), 0 8px 32px -8px rgba(124,140,255,0.45)',
        'glow-cyan':      '0 0 0 1px rgba(91,192,235,0.25), 0 8px 32px -8px rgba(91,192,235,0.45)',
        'glow-magenta':   '0 0 0 1px rgba(232,121,249,0.25), 0 8px 32px -8px rgba(232,121,249,0.45)',
        'glow-yellow':    '0 0 0 1px rgba(245,200,75,0.25), 0 8px 32px -8px rgba(245,200,75,0.45)',
        'glow-green':     '0 0 0 1px rgba(0,229,168,0.25), 0 8px 32px -8px rgba(0,229,168,0.45)',
        'glow-red':       '0 0 0 1px rgba(255,59,107,0.25), 0 8px 32px -8px rgba(255,59,107,0.45)',
        'glow-blue':      '0 0 0 1px rgba(124,140,255,0.25), 0 8px 32px -8px rgba(124,140,255,0.45)',
        'glass':          '0 8px 32px -4px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04) inset',
        'glass-lg':       '0 24px 48px -8px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.05) inset',
        'inner-glow':     'inset 0 1px 0 rgba(255,255,255,0.05), inset 0 0 24px rgba(0,229,168,0.04)',
        'card-hover':     '0 16px 48px -12px rgba(0,229,168,0.30), 0 0 0 1px rgba(0,229,168,0.18) inset',
      },
      animation: {
        'scanline': 'scanline 6s linear infinite',
        'float': 'float 6s ease-in-out infinite',
        'pulse-glow': 'pulse-glow 4s ease-in-out infinite',
        'pulse-slow': 'pulse-slow 6s ease-in-out infinite',
        'slide-up': 'slide-up 0.5s ease-out forwards',
        'fade-in': 'fade-in 0.6s ease-out forwards',
        'shimmer': 'shimmer 2.5s linear infinite',
        'gradient-shift': 'gradient-shift 8s ease infinite',
        'spin-slow': 'spin 12s linear infinite',
      },
      keyframes: {
        scanline: {
          '0%': { transform: 'translateY(-100%)' },
          '100%': { transform: 'translateY(100vh)' }
        },
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-12px)' }
        },
        'pulse-glow': {
          '0%, 100%': { opacity: 0.6, transform: 'scale(1)' },
          '50%': { opacity: 1, transform: 'scale(1.02)' }
        },
        'pulse-slow': {
          '0%, 100%': { opacity: 0.4 },
          '50%': { opacity: 0.8 }
        },
        'slide-up': {
          '0%': { opacity: 0, transform: 'translateY(12px)' },
          '100%': { opacity: 1, transform: 'translateY(0)' }
        },
        'fade-in': {
          '0%': { opacity: 0 },
          '100%': { opacity: 1 }
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' }
        },
        'gradient-shift': {
          '0%, 100%': { backgroundPosition: '0% 50%' },
          '50%': { backgroundPosition: '100% 50%' }
        },
      },
      backdropBlur: {
        xs: '2px',
      },
      transitionTimingFunction: {
        'out-expo': 'cubic-bezier(0.16, 1, 0.3, 1)',
        'out-back': 'cubic-bezier(0.34, 1.56, 0.64, 1)',
      },
    },
  },
  plugins: [],
}
