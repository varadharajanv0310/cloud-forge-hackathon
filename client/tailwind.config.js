import { fileURLToPath } from 'url';
import path from 'path';

// Content globs resolve against process.cwd(), not this file — a dev server
// started from anywhere other than client/ would silently generate NO utilities
// and the whole app would render unstyled. Anchor them to this file.
const here = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('tailwindcss').Config} */
// Ported from the Claude Design source (Sevai.dc.html). Values live here;
// the rationale lives in DESIGN.md and in the comments in src/index.css.
export default {
  content: [path.join(here, 'index.html'), path.join(here, 'src/**/*.{js,jsx}')],
  theme: {
    extend: {
      colors: {
        page: '#FBFBFD',
        shell: '#F4F4F7',

        // ── Compatibility layer ────────────────────────────────────────────
        // The components are written against the token names in DESIGN.md
        // (canvas / surface / muted / hairline / ink-2); index.css shipped the
        // later Sevai.dc.html vocabulary (page / white / ink ramp / rule).
        // Neither name set was wrong — they were simply never reconciled, and
        // Tailwind emits nothing for an unknown utility without warning, so
        // every one of these silently resolved to no CSS at all.
        //
        // These map the DESIGN.md names onto the SHIPPED values rather than
        // reintroducing DESIGN.md's palette. Landing and the result screen
        // already look correct against the shipped ramp; pulling in a second
        // set of near-miss greys would make one app look like two.
        canvas: '#FBFBFD',                     // = --page
        surface: { DEFAULT: '#FFFFFF', sub: '#F4F4F7' },
        muted: '#6C6C78',                      // = --ink-45
        hairline: 'rgba(20,20,26,0.12)',       // = --rule-12

        ink: {
          DEFAULT: '#14141A',
          2: '#3B3B46',                        // body ink; = --ink-80
          90: '#25252E',
          80: '#3B3B46',
          70: '#44444F',
          65: '#4A4A56',
          60: '#55555F',
          55: '#5C5C68',
          45: '#6C6C78',
          40: '#7A7A86',
          30: '#8A8A95',
          25: '#9A9AA6',
          15: '#B0B0BA',
        },
        rule: {
          10: 'rgba(20,20,26,0.10)',
          12: 'rgba(20,20,26,0.12)',
          14: 'rgba(20,20,26,0.14)',
          16: 'rgba(20,20,26,0.16)',
          20: 'rgba(20,20,26,0.20)',
          22: 'rgba(20,20,26,0.22)',
        },
        violet: { DEFAULT: '#5B45A8', sel: '#DCCDF7', mark: 'rgba(192,172,240,0.45)' },
        sah: { ink: '#7A5410', ink2: '#9E7A2E', rule: 'rgba(158,110,26,0.45)' },
        bloom: {
          teal: '#84D4DD',
          lav: '#C0ACF0',
          peach: '#F8C99C',
          pink: '#F0B4C9',
        },
      },
      fontFamily: {
        sans: ['Archivo', 'Helvetica', 'Arial', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
        ta: ['"Noto Sans Tamil"', 'Archivo', 'sans-serif'],
      },
      // Sizes the components ask for by name. Values come off the shipped scale
      // in index.css: `scheme` mirrors .scheme-name, `q-md` mirrors .h-2.
      fontSize: {
        q: ['26px', { lineHeight: '1.14', letterSpacing: '-0.03em' }],
        'q-md': ['34px', { lineHeight: '1.08', letterSpacing: '-0.035em' }],
        scheme: ['17px', { lineHeight: '1.35', letterSpacing: '-0.015em' }],
        lead: ['19px', { lineHeight: '1.3', letterSpacing: '-0.02em' }],
        body: ['16px', { lineHeight: '1.55' }],
      },
      borderRadius: { panel: '6px', flat: '4px', shell: '8px', well: '4px', surface: '6px' },
      boxShadow: {
        lift: '0 14px 30px -12px rgba(20,20,26,.55)',
        liftHover: '0 20px 38px -12px rgba(20,20,26,.6)',
        shell: '0 40px 90px -30px rgba(20,20,26,.28)',
        e1: '0 4px 12px -6px rgba(20,20,26,.22)',
        e2: '0 10px 26px -12px rgba(20,20,26,.30)',
      },
      transitionDuration: { 240: '240ms', 320: '320ms' },
      transitionTimingFunction: { composed: 'cubic-bezier(.22,1,.36,1)' },
      keyframes: {
        svDrift: {
          '0%,100%': { transform: 'translate3d(0,0,0) scale(1)' },
          '50%': { transform: 'translate3d(0,-16px,0) scale(1.05)' },
        },
        svSpin: { to: { transform: 'rotate(360deg)' } },
        svPulse: { '0%,100%': { opacity: '.55' }, '50%': { opacity: '1' } },
        // The speaking indicator on SamjhaoButton and the listening dot on
        // DocumentScanner. Both were referenced by name and never defined.
        svWave: { '0%,100%': { transform: 'scaleY(.35)' }, '50%': { transform: 'scaleY(1)' } },
        svPulseSlow: { '0%,100%': { opacity: '.35' }, '50%': { opacity: '1' } },
      },
      animation: {
        svDrift: 'svDrift 22s ease-in-out infinite',
        svSpin: 'svSpin 1.1s linear infinite',
        svPulse: 'svPulse 2.4s ease-in-out infinite',
        wave: 'svWave .9s ease-in-out infinite',
        'pulse-slow': 'svPulseSlow 2.8s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
