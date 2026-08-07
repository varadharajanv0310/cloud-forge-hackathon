import { fileURLToPath } from 'url';
import path from 'path';

// Content globs are resolved against process.cwd(), not this file — so a dev
// server started from anywhere other than client/ silently generates NO
// utilities and the whole app renders unstyled. Anchor them to this file.
const here = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('tailwindcss').Config} */
// Tokens mirror DESIGN.md. Change a value here, change it there — that file
// carries the rationale, this one only carries the number.
export default {
  content: [path.join(here, 'index.html'), path.join(here, 'src/**/*.{js,jsx}')],
  theme: {
    extend: {
      colors: {
        canvas: '#FBFAFC',
        surface: '#FFFFFF',
        'surface-sub': '#F6F5F9',
        ink: '#14131A',
        'ink-2': '#3D3A47',
        muted: '#6E6B78',
        hairline: 'rgba(20,19,26,0.08)',
        bloom: {
          lavender: '#C9BEEF',
          sky: '#B8D4F0',
          mint: '#BEEBD8',
          peach: '#FBD9B5',
          blush: '#F3C7DC',
        },
        // The legacy `brand-*` aliases are gone. Every screen is on the new
        // tokens; keeping the old names alive would let the previous green /
        // saffron / electric-blue language creep back in unnoticed.
      },
      fontFamily: {
        // Latin display, falling through to Noto Sans Tamil so a Tamil headline
        // still lands on a designed face rather than a system fallback.
        display: ['"Bricolage Grotesque"', '"Noto Sans Tamil"', '"Noto Sans"', 'system-ui', 'sans-serif'],
        // Text + every Indian script on one harmonised metric.
        sans: [
          '"Noto Sans"', '"Noto Sans Tamil"', '"Noto Sans Devanagari"',
          '"Noto Sans Telugu"', '"Noto Sans Bengali"', '"Noto Sans Kannada"',
          '"Noto Sans Malayalam"', '"Noto Sans Gujarati"', '"Noto Sans Gurmukhi"',
          '"Noto Sans Oriya"', 'system-ui', 'sans-serif',
        ],
      },
      fontSize: {
        meta: ['11px', { lineHeight: '1.2', letterSpacing: '0.09em' }],
        body: ['16px', { lineHeight: '1.6' }],
        lead: ['19px', { lineHeight: '1.5', letterSpacing: '-0.01em' }],
        scheme: ['19px', { lineHeight: '1.35', letterSpacing: '-0.01em' }],
        q: ['34px', { lineHeight: '1.12', letterSpacing: '-0.03em' }],
        'q-md': ['44px', { lineHeight: '1.1', letterSpacing: '-0.03em' }],
        'q-lg': ['56px', { lineHeight: '1.08', letterSpacing: '-0.03em' }],
        figure: ['72px', { lineHeight: '1', letterSpacing: '-0.04em' }],
        'figure-lg': ['104px', { lineHeight: '0.95', letterSpacing: '-0.045em' }],
      },
      borderRadius: { surface: '28px', well: '18px', bento: '24px' },
      boxShadow: {
        e1: '0 1px 2px rgba(20,19,26,.04)',
        e2: '0 8px 24px -12px rgba(20,19,26,.10)',
        e3: '0 24px 64px -24px rgba(20,19,26,.16)',
        card: '0 1px 2px rgba(20,19,26,.04)',
        cardHover: '0 8px 24px -12px rgba(20,19,26,.10)',
      },
      transitionTimingFunction: { composed: 'cubic-bezier(.22,1,.36,1)' },
      transitionDuration: { 240: '240ms', 320: '320ms' },
      keyframes: {
        'bloom-drift': {
          '0%,100%': { transform: 'translate3d(0,0,0) scale(1)' },
          '50%': { transform: 'translate3d(2%,-2%,0) scale(1.06)' },
        },
        'sphere-pulse': {
          '0%,100%': { transform: 'scale(1)', opacity: '.92' },
          '50%': { transform: 'scale(1.035)', opacity: '1' },
        },
        rise: {
          from: { opacity: '0', transform: 'translate3d(0,14px,0)' },
          to: { opacity: '1', transform: 'translate3d(0,0,0)' },
        },
        wave: { '0%,100%': { transform: 'scaleY(0.4)' }, '50%': { transform: 'scaleY(1)' } },
      },
      animation: {
        'bloom-drift': 'bloom-drift 18s ease-in-out infinite',
        'sphere-pulse': 'sphere-pulse 2.4s ease-in-out infinite',
        rise: 'rise .32s cubic-bezier(.22,1,.36,1) both',
        'pulse-slow': 'pulse 2.2s ease-in-out infinite',
        wave: 'wave 1s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
