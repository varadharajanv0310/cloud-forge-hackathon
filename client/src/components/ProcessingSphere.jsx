import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { profileToChips } from './Thread.jsx';

/**
 * ProcessingSphere — the moment before someone finds out what they are owed.
 *
 * This is the emotional peak of the product, so it is built to do one specific
 * thing: show its work. A spinner says "wait"; this says "I am reading what you
 * told me, and here is how much I am looking through." Trust is the product's
 * whole proposition, and this is where it is either earned or lost.
 *
 * The sphere is literally made of the citizen's own answers — the Thread chips
 * collapse inward and become it — so the number that comes out the other side
 * visibly came from what they said.
 *
 * PRIVACY: the narration names *categories*, never values. This is frequently a
 * shared phone. "Checking community schemes" is safe on a screen someone else
 * can see; rendering the citizen's caste in 40px type is not.
 */

const DURATION = 4200; // ms — long enough to feel considered, short enough to respect

export default function ProcessingSphere({ profile, lang = 'en', schemeCount = 0, onDone }) {
  const reduce = useReducedMotion();
  const [t, setT] = useState(0); // 0 → 1
  const raf = useRef(0);
  const started = useRef(0);

  const chips = useMemo(() => profileToChips(profile, lang).slice(0, 7), [profile, lang]);

  const steps = useMemo(() => {
    const ta = lang === 'ta';
    const s = [
      { at: 0.00, en: 'Reading your answers', ta: 'உங்கள் பதில்களைப் படிக்கிறோம்' },
      { at: 0.18, en: 'Central schemes', ta: 'மத்தியத் திட்டங்கள்' },
      {
        at: 0.36,
        en: profile?.state ? `${profile.state} schemes` : 'State schemes',
        ta: profile?.state ? `${profile.state} திட்டங்கள்` : 'மாநிலத் திட்டங்கள்',
      },
      { at: 0.54, en: 'Matching your work and age', ta: 'வேலை மற்றும் வயதைப் பொருத்துகிறோம்' },
      { at: 0.70, en: 'Community and income schemes', ta: 'சமூக மற்றும் வருமானத் திட்டங்கள்' },
      { at: 0.86, en: 'Checking what each one is worth', ta: 'ஒவ்வொன்றின் மதிப்பைச் சரிபார்க்கிறோம்' },
    ];
    return s.map((x) => ({ ...x, label: ta ? x.ta : x.en }));
  }, [profile, lang]);

  // `onDone` is a fresh closure on every parent render, so depending on it here
  // restarted the countdown on each re-render — the sphere spun forever and
  // never handed off to the reveal. Hold it in a ref and run the timeline once.
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => {
    if (reduce) {
      setT(1);
      const id = setTimeout(() => doneRef.current?.(), 700);
      return () => clearTimeout(id);
    }
    // Driven by an interval rather than requestAnimationFrame. rAF is throttled
    // or suspended whenever the renderer considers the surface non-visible
    // (backgrounded tab, some embedded/preview webviews), and when that happens
    // the countdown silently never advances and the reveal is never reached.
    // A ~60fps interval degrades gracefully instead of stopping dead.
    let settle;
    started.current = Date.now();
    const id = setInterval(() => {
      const p = Math.min(1, (Date.now() - started.current) / DURATION);
      // ease-out so the count decelerates into its final value rather than
      // stopping dead — the arrival should feel like settling, not snapping.
      setT(1 - Math.pow(1 - p, 3));
      if (p >= 1) {
        clearInterval(id);
        settle = setTimeout(() => doneRef.current?.(), 520);
      }
    }, 16);
    return () => {
      clearInterval(id);
      clearTimeout(settle);
    };
  }, [reduce]);

  const counted = Math.round(t * schemeCount);
  const active = steps.reduce((acc, s, i) => (t >= s.at ? i : acc), 0);

  // Ring geometry
  const R = 132;
  const C = 2 * Math.PI * R;

  return (
    <div className="fixed inset-0 z-50 bg-canvas overflow-hidden">
      <div
        className={`bloom ${t < 0.6 ? 'bloom-cool' : 'bloom-warm'} transition-opacity duration-[1400ms]`}
        aria-hidden="true"
      />

      <div className="relative z-10 h-full flex flex-col items-center justify-center px-6">
        {/* ── the sphere ─────────────────────────────────────────────────── */}
        <div className="relative" style={{ width: 320, height: 320 }}>
          {/* chips collapsing inward — the sphere is made of their answers */}
          {!reduce &&
            chips.map((c, i) => {
              const angle = (i / Math.max(1, chips.length)) * Math.PI * 2 - Math.PI / 2;
              const start = 190;
              const d = start * (1 - Math.min(1, t * 1.5));
              return (
                <motion.span
                  key={c.key}
                  className="chip absolute left-1/2 top-1/2 pointer-events-none"
                  style={{
                    transform: `translate(-50%,-50%) translate(${Math.cos(angle) * d}px, ${
                      Math.sin(angle) * d
                    }px) scale(${Math.max(0, 1 - t * 1.5)})`,
                    opacity: Math.max(0, 1 - t * 1.6),
                  }}
                  lang={lang}
                >
                  {c.label}
                </motion.span>
              );
            })}

          {/* orb — layered radial gradients, no filter:blur (see DESIGN.md §6) */}
          <motion.div
            className="absolute inset-8 rounded-full animate-sphere-pulse"
            style={{
              background: `
                radial-gradient(60% 60% at 32% 30%, var(--bloom-peach) 0%, transparent 62%),
                radial-gradient(58% 58% at 72% 34%, var(--bloom-blush) 0%, transparent 60%),
                radial-gradient(64% 64% at 50% 74%, var(--bloom-lavender) 0%, transparent 66%),
                radial-gradient(circle at 50% 50%, #fff 0%, rgba(255,255,255,0) 70%)`,
              boxShadow: '0 24px 64px -24px rgba(20,19,26,.18)',
              transform: `scale(${0.86 + t * 0.16})`,
            }}
            aria-hidden="true"
          />

          {/* progress ring */}
          <svg className="absolute inset-0 -rotate-90" width="320" height="320" aria-hidden="true">
            <circle cx="160" cy="160" r={R} fill="none" stroke="rgba(20,19,26,.07)" strokeWidth="1.5" />
            <circle
              cx="160" cy="160" r={R} fill="none"
              stroke="var(--ink)" strokeWidth="1.5" strokeLinecap="round"
              strokeDasharray={C} strokeDashoffset={C * (1 - t)}
            />
          </svg>

          {/* the count */}
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <div className="u-display tabular text-[46px] text-ink leading-none">
              {counted.toLocaleString('en-IN')}
            </div>
            <div className="u-meta mt-2" lang={lang}>
              {lang === 'ta' ? 'திட்டங்கள் சரிபார்க்கப்பட்டன' : 'schemes checked'}
            </div>
          </div>
        </div>

        {/* ── narration ──────────────────────────────────────────────────── */}
        <div className="mt-12 h-7 relative w-full max-w-[420px] text-center">
          {steps.map((s, i) => (
            <motion.div
              key={s.en}
              className="absolute inset-x-0 text-[16px] text-ink-2"
              initial={false}
              animate={{
                opacity: i === active ? 1 : 0,
                y: i === active ? 0 : i < active ? -8 : 8,
              }}
              transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
              lang={lang}
            >
              {s.label}
            </motion.div>
          ))}
        </div>

        <p className="mt-3 text-[13px] text-muted text-center max-w-[38ch]" lang={lang}>
          {lang === 'ta'
            ? 'உங்கள் விவரங்கள் இந்த சாதனத்திலேயே உள்ளன.'
            : 'Your details stay on this device.'}
        </p>
      </div>
    </div>
  );
}
