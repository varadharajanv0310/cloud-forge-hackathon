import { useEffect } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { t, tf } from '../data/strings.js';
import { formatTime, formatTimeTa } from '../utils/formatters.js';
import { playSuccessChime } from '../utils/speechUtils.js';
import { speakImperative } from '../hooks/useTTS.js';

/**
 * SuccessAnimation.
 *
 * Was a full-screen flood of #1B5E20. A success state does not need to shout,
 * and a saturated green wash is exactly the "you have been processed" register
 * this product is trying to get away from — the moment should feel like someone
 * nodding, not a machine stamping a form.
 *
 * So: the light canvas, a warm bloom (the reveal temperature — the answer has
 * arrived), and the check drawn in ink. The chime and the drawn stroke are the
 * whole celebration; both survive intact.
 */
export default function SuccessAnimation({ schemeName, elapsedSeconds, lang = 'en', onDone }) {
  const reduce = useReducedMotion();
  const ta = lang === 'ta';

  useEffect(() => {
    playSuccessChime();
    const msg = t('apply_success', lang);
    // Speak success message via ElevenLabs (fire-and-forget)
    speakImperative(msg, lang);
    const timer = setTimeout(() => onDone?.(), 2200);
    return () => clearTimeout(timer);
  }, [lang, onDone]);

  const timeLabel = ta ? formatTimeTa(elapsedSeconds) : formatTime(elapsedSeconds);

  // Translate-only. This overlay confirms that a citizen's application was
  // recorded; if a fade stalls, the confirmation is simply not there.
  const rise = (d = 0) => ({
    initial: reduce ? false : { y: 12 },
    animate: { y: 0 },
    transition: { duration: 0.32, delay: d, ease: [0.22, 1, 0.36, 1] },
  });

  return (
    <motion.div
      className="fixed inset-0 z-50 bg-page overflow-hidden"
      role="status"
      aria-live="polite"
    >
      <div className="bloom bloom-warm" aria-hidden="true" />

      <div className="relative z-10 h-full flex flex-col items-center justify-center px-6 text-center">
        {/* The drawn check. One stroke, ink, on a white plate. */}
        <motion.div
          initial={reduce ? false : { scale: 0.86 }}
          animate={{ scale: 1 }}
          transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
          className="w-[104px] h-[104px] rounded-full bg-surface shadow-e2 grid place-items-center"
          style={{ boxShadow: 'inset 0 0 0 1px var(--hairline), 0 8px 24px -12px rgba(20,19,26,.10)' }}
        >
          <svg viewBox="0 0 50 50" width="56" height="56" aria-hidden="true">
            <motion.path
              d="M13 26 L21.5 34.5 L37 17"
              fill="none"
              stroke="var(--ink)"
              strokeWidth="3.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              initial={reduce ? false : { pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 0.42, delay: reduce ? 0 : 0.18, ease: [0.22, 1, 0.36, 1] }}
            />
          </svg>
        </motion.div>

        <motion.h2
          {...rise(0.34)}
          className="u-display text-q mt-8 max-w-[16ch] text-ink"
          lang={lang}
        >
          {t('apply_success', lang)}
        </motion.h2>

        {schemeName && (
          <motion.div
            {...rise(0.42)}
            className="u-scheme-name text-scheme mt-3 max-w-[28ch] text-ink-2"
            lang={lang}
          >
            {schemeName}
          </motion.div>
        )}

        <motion.div {...rise(0.5)} className="well mt-8 px-5 py-3 text-[14px] text-muted tabular" lang={lang}>
          {tf('apply_time_taken', lang, { t: timeLabel })}
        </motion.div>
      </div>
    </motion.div>
  );
}
