import { useEffect, useMemo, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import { profileToChips } from './Thread.jsx';

/**
 * ProcessingSphere — ported from the Claude Design source (Sevai.dc.html, isProc).
 *
 * The moment before someone finds out what they are owed. It is built to show
 * its work rather than to entertain: a real count of the schemes being checked,
 * and a step list that names what is happening. A spinner says "wait"; this says
 * "I am reading what you told me, and here is how much I am looking through."
 *
 * PRIVACY: the steps name *categories*, never values. This is frequently a
 * shared phone — "community schemes" is safe on a screen someone else can see,
 * the citizen's actual caste in 15px type is not.
 */

const DURATION = 4200;
const R = 122;
const CIRC = 2 * Math.PI * R; // 766.5, matching the source

export default function ProcessingSphere({ profile, lang = 'en', schemeCount = 0, onDone }) {
  const reduce = useReducedMotion();
  const [t, setT] = useState(0);
  const started = useRef(0);

  // onDone is a fresh closure on every parent render; depending on it here
  // restarted the countdown each time and the sphere never handed off.
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  const chips = useMemo(() => profileToChips(profile, lang).slice(0, 6), [profile, lang]);

  const steps = useMemo(() => ([
    { at: .00, en: 'Reading your answers', ta: 'உங்கள் பதில்களைப் படிக்கிறோம்' },
    { at: .20, en: 'Central schemes', ta: 'மத்தியத் திட்டங்கள்' },
    { at: .40, en: `${profile?.state || 'State'} schemes`, ta: 'மாநிலத் திட்டங்கள்' },
    { at: .58, en: 'Matching your work and age', ta: 'வேலை மற்றும் வயதைப் பொருத்துகிறோம்' },
    { at: .76, en: 'Community and income schemes', ta: 'சமூக மற்றும் வருமானத் திட்டங்கள்' },
    { at: .90, en: 'Checking what each one is worth', ta: 'ஒவ்வொன்றின் மதிப்பைச் சரிபார்க்கிறோம்' },
  ]), [profile]);

  useEffect(() => {
    if (reduce) {
      setT(1);
      const id = setTimeout(() => doneRef.current?.(), 700);
      return () => clearTimeout(id);
    }
    // Interval, not requestAnimationFrame — rAF is suspended when the renderer
    // treats the surface as non-visible, and the countdown would never advance.
    let settle;
    started.current = Date.now();
    const id = setInterval(() => {
      const pr = Math.min(1, (Date.now() - started.current) / DURATION);
      setT(1 - Math.pow(1 - pr, 3));
      if (pr >= 1) {
        clearInterval(id);
        settle = setTimeout(() => doneRef.current?.(), 520);
      }
    }, 16);
    return () => { clearInterval(id); clearTimeout(settle); };
  }, [reduce]);

  const counted = Math.round(t * schemeCount);
  const active = steps.reduce((acc, s, i) => (t >= s.at ? i : acc), 0);

  return (
    <div className="fixed inset-0 z-50 bg-page overflow-hidden">
      <div
        className="absolute inset-0 pointer-events-none"
        aria-hidden="true"
        style={{
          background:
            'radial-gradient(58% 34% at 22% 4%,rgba(132,212,221,.5) 0%,rgba(132,212,221,.22) 40%,rgba(132,212,221,0) 74%),' +
            'radial-gradient(70% 40% at 60% 104%,rgba(248,201,156,.6) 0%,rgba(248,201,156,.26) 42%,rgba(248,201,156,0) 76%)',
        }}
      />

      <div className="relative flex flex-col h-full mx-auto w-full max-w-[520px] px-5 pt-6 pb-7">
        <div className="mono text-[10.5px] tracking-[.14em] text-ink-55">Checking your schemes</div>

        {/* ── the sphere ─────────────────────────────────────────────────
            The citizen's answers collapse inward and become it. */}
        <div className="flex-none h-[308px] relative mt-2 flex items-center justify-center">
          <div
            className="absolute rounded-full animate-svDrift"
            style={{
              width: 236, height: 236,
              background:
                'radial-gradient(48% 48% at 34% 30%,rgba(192,172,240,.95) 0%,rgba(192,172,240,.5) 44%,rgba(192,172,240,0) 74%),' +
                'radial-gradient(46% 46% at 72% 40%,rgba(132,212,221,.9) 0%,rgba(132,212,221,.44) 46%,rgba(132,212,221,0) 76%),' +
                'radial-gradient(52% 52% at 52% 78%,rgba(248,201,156,.92) 0%,rgba(248,201,156,.46) 46%,rgba(248,201,156,0) 76%),' +
                'radial-gradient(40% 40% at 24% 68%,rgba(240,180,201,.75) 0%,rgba(240,180,201,0) 70%)',
            }}
          />

          <svg width="270" height="270" viewBox="0 0 270 270" className="absolute" style={{ transform: 'rotate(-90deg)' }} aria-hidden="true">
            <circle cx="135" cy="135" r={R} fill="none" stroke="rgba(20,20,26,.10)" strokeWidth="1.5" />
            <circle cx="135" cy="135" r={R} fill="none" stroke="#14141A" strokeWidth="1.5"
                    strokeLinecap="round" strokeDasharray={CIRC} strokeDashoffset={CIRC * (1 - t)} />
          </svg>

          {!reduce && chips.map((c, i) => {
            const a = (i / Math.max(1, chips.length)) * Math.PI * 2 - Math.PI / 2;
            const d = 165 * (1 - Math.min(1, t * 1.5));
            return (
              <span
                key={c.key}
                className="chip absolute left-1/2 top-1/2 pointer-events-none"
                style={{
                  transform: `translate(-50%,-50%) translate(${Math.cos(a) * d}px, ${Math.sin(a) * d}px) scale(${Math.max(0, 1 - t * 1.5)})`,
                  opacity: Math.max(0, 1 - t * 1.6),
                }}
              >
                {c.label}
              </span>
            );
          })}

          <div className="relative text-center">
            <div className="tabular" style={{ fontSize: 46, fontWeight: 700, letterSpacing: '-.04em', lineHeight: 1 }}>
              {counted.toLocaleString('en-IN')}
            </div>
            <div className="mono text-[10px] tracking-[.13em] text-ink-70 mt-[7px]">
              of {schemeCount.toLocaleString('en-IN')} checked
            </div>
          </div>
        </div>

        {/* ── steps ──────────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-[9px] mt-1.5">
          {steps.map((s, i) => {
            const done = i < active, now = i === active;
            return (
              <div key={s.en} className="flex items-center gap-3">
                <div
                  className="w-[9px] h-[9px] rounded-[2px] flex-none transition-colors duration-300"
                  style={{ background: done || now ? '#14141A' : 'rgba(20,20,26,.16)' }}
                />
                <div className="min-w-0">
                  <div
                    className="text-[14.5px] leading-[1.35] transition-colors duration-300"
                    style={{ color: now ? '#14141A' : done ? '#6C6C78' : '#B0B0BA', fontWeight: now ? 600 : 400 }}
                  >
                    {s.en}
                  </div>
                  <div className="ta text-[12.5px] leading-[1.45]" lang="ta"
                       style={{ color: now ? '#6C6C78' : '#B0B0BA' }}>
                    {s.ta}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex-1" />

        <div className="border-t border-rule-12 pt-3.5 flex gap-3 items-start">
          <div className="w-[9px] h-[9px] rounded-[2px] bg-ink mt-1.5 flex-none" />
          <div>
            <div className="text-[13.5px] leading-[1.5] text-ink-90">
              Nothing leaves this phone. The schemes are checked here, on the device.
            </div>
            <div className="ta text-[12.5px] text-ink-40 mt-1" lang="ta">
              எதுவும் இந்த ஃபோனை விட்டு வெளியே செல்லாது.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
