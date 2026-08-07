import { useMemo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { QUESTIONS, nextQuestions } from '../data/profileSchema.js';
import Thread, { profileToChips } from './Thread.jsx';
import { useTTS } from '../hooks/useTTS.js';

/**
 * Onboarding — one question per screen.
 *
 * The previous version rendered as a chat log: every question and answer stayed
 * stacked on screen, so the citizen was reading a transcript of themselves
 * rather than being asked something. Here each question owns the whole screen,
 * and what persists is the Thread — their answers as chips, which will later
 * become the processing sphere and then the match reasons.
 *
 * Progress is expressed three ways on purpose:
 *   1. the bloom warms as the citizen advances (needs no literacy),
 *   2. the Thread grows,
 *   3. discrete dots — redundancy, because colour temperature alone is
 *      invisible to a colour-blind user and unreliable on a low-gamut screen.
 */

const BASE_COUNT = QUESTIONS.filter((q) => !q.askWhen).length;

export default function Onboarding({ onComplete, lang, setLang }) {
  const [profile, setProfile] = useState({});
  const [history, setHistory] = useState([]);
  const { speak, stop } = useTTS();
  const reduce = useReducedMotion();

  const pending = nextQuestions(profile);
  const q = pending[0];
  const answered = history.length;

  // Total is not fixed — branches open as answers arrive — so estimate from
  // what is already known rather than promising "3 of 12" and then changing it.
  const estimate = Math.max(BASE_COUNT, answered + pending.length);
  const progress = estimate ? answered / estimate : 0;
  const temp = progress < 0.34 ? 'bloom-cool' : progress < 0.72 ? 'bloom-neutral' : 'bloom-warm';

  const chips = useMemo(() => profileToChips(profile, lang), [profile, lang]);

  const answer = (value) => {
    stop();
    if (!q) return;
    const next = { ...profile, [q.key]: value };
    setHistory((h) => [...h, q.key]);
    setProfile(next);
    if (q.key === 'state' && !next.languages_preferred) {
      // no-op today; kept so a state-driven language default can land here
    }
    if (nextQuestions(next).length === 0) onComplete(next);
  };

  const back = () => {
    stop();
    if (!history.length) return;
    const last = history[history.length - 1];
    const next = { ...profile };
    delete next[last];
    setHistory((h) => h.slice(0, -1));
    setProfile(next);
  };

  if (!q) return null;

  const label = (o) => (lang === 'ta' ? o.ta : o.en);
  const isState = q.type === 'state';

  return (
    <div className="min-h-[100dvh] w-full bg-canvas relative overflow-hidden">
      <div className={`bloom ${temp} animate-bloom-drift transition-opacity duration-[1200ms]`} aria-hidden="true" />

      <div className="relative z-10 mx-auto w-full max-w-[1120px] px-4 sm:px-6 py-4 sm:py-6 min-h-[100dvh] flex flex-col">
        {/* ── top bar ─────────────────────────────────────────────────────── */}
        <header className="flex items-center justify-between px-2 mb-6 sm:mb-10">
          <button
            onClick={back}
            disabled={!history.length}
            className="btn-ghost compact text-[14px] disabled:opacity-0"
            aria-label={lang === 'ta' ? 'பின்செல்' : 'Back'}
            lang={lang}
          >
            ← {lang === 'ta' ? 'பின்' : 'Back'}
          </button>

          {/* discrete progress — redundant to the bloom, on purpose */}
          <div className="flex items-center gap-1.5" role="progressbar"
               aria-valuenow={answered} aria-valuemin={0} aria-valuemax={estimate}>
            {Array.from({ length: Math.min(estimate, 14) }).map((_, i) => (
              <span
                key={i}
                className={`h-1 rounded-full transition-all duration-320 ease-composed ${
                  i < answered ? 'w-4 bg-ink' : 'w-1.5 bg-ink/15'
                }`}
              />
            ))}
          </div>

          <button
            onClick={() => setLang(lang === 'ta' ? 'en' : 'ta')}
            className="btn-ghost compact text-[14px]"
            lang={lang === 'ta' ? 'en' : 'ta'}
          >
            {lang === 'ta' ? 'English' : 'தமிழ்'}
          </button>
        </header>

        {/* ── the question ────────────────────────────────────────────────── */}
        <div className="flex-1 flex flex-col justify-center">
          <div className="surface-tray">
            <div className="surface-plate px-5 sm:px-10 lg:px-14 py-9 sm:py-12">
              {/* Cross-fade, NOT mode="wait".
                  With mode="wait" AnimatePresence holds the outgoing question
                  until its exit completes — and here it never did, so the pane
                  froze on question one while the profile underneath advanced.
                  Overlapping the two is also the better motion: the next
                  question is already arriving as the last one leaves, which
                  reads as composed rather than as a pause between slides. */}
              <AnimatePresence initial={false}>
                <motion.div
                  key={q.key}
                  initial={reduce ? false : { opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                  className="grid lg:grid-cols-[minmax(0,1fr)_300px] gap-8 lg:gap-14"
                >
                  {/* question + answers */}
                  <div className="min-w-0">
                    <h2
                      lang={lang}
                      className="u-display text-q sm:text-q-md text-ink max-w-[20ch]"
                    >
                      {lang === 'ta' ? q.q.ta : q.q.en}
                    </h2>

                    {q.help && (
                      <p className="mt-3 text-[15px] text-muted max-w-[46ch]" lang={lang}>
                        {lang === 'ta' ? q.help.ta : q.help.en}
                      </p>
                    )}

                    <div
                      className={`mt-7 ${
                        isState
                          ? 'grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-[46vh] overflow-y-auto pr-1'
                          : 'grid gap-2 sm:grid-cols-2'
                      }`}
                    >
                      {(q.options || []).map((o, i) => (
                        <motion.button
                          key={String(o.value)}
                          onClick={() => answer(o.value)}
                          initial={reduce ? false : { opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.24, delay: Math.min(i * 0.02, 0.16), ease: [0.22, 1, 0.36, 1] }}
                          className="option"
                          lang={lang}
                        >
                          <span className={isState ? 'text-[15px]' : 'text-[17px] font-medium'}>
                            {label(o)}
                          </span>
                        </motion.button>
                      ))}
                    </div>

                    {q.skippable && (
                      <button
                        onClick={() => answer(null)}
                        className="btn-ghost compact mt-4 text-[14px] text-muted"
                        lang={lang}
                      >
                        {lang === 'ta' ? 'இதைத் தவிர்' : 'Skip this'}
                      </button>
                    )}
                  </div>

                  {/* the Thread — desktop rail */}
                  <aside className="hidden lg:block border-l border-hairline pl-8">
                    <div className="u-meta mb-3" lang={lang}>
                      {lang === 'ta' ? 'நீங்கள் சொன்னவை' : 'What you told us'}
                    </div>
                    {chips.length ? (
                      <Thread chips={chips} lang={lang} />
                    ) : (
                      <p className="text-[14px] text-muted" lang={lang}>
                        {lang === 'ta'
                          ? 'உங்கள் பதில்கள் இங்கே சேரும்.'
                          : 'Your answers collect here.'}
                      </p>
                    )}
                  </aside>
                </motion.div>
              </AnimatePresence>
            </div>
          </div>

          {/* the Thread — mobile strip */}
          {chips.length > 0 && (
            <div className="lg:hidden mt-4 px-2 overflow-x-auto hide-scrollbar">
              <Thread chips={chips} lang={lang} max={4} className="flex-nowrap" />
            </div>
          )}
        </div>

        <div className="h-6" />
      </div>
    </div>
  );
}
