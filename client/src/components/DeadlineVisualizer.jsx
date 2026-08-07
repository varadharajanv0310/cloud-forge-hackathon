import { useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { daysUntil } from '../utils/eligibilityEngine.js';
import { saveReminder, hasReminder } from '../utils/applications.js';
import { t } from '../data/strings.js';

/**
 * DeadlineVisualizer.
 *
 * `deadline` is null for all but ~5 schemes in the corpus. The old version
 * still drew a track for those — an "∞" glyph over an empty bar — which
 * manufactured the impression of a countdown where the government has
 * published no date at all. A fabricated progress bar is worse than no bar, so
 * this renders **nothing** unless a real date exists.
 *
 * When one does exist it is a hairline track with an ink fill. Urgency is
 * carried by the figure and the wording, not by a red bar: the palette has no
 * saturated colour outside the bloom, and a citizen reading slowly parses
 * "9 days left" faster than they decode a hue.
 */

// The window the track represents. Beyond 60 days out, the track sits empty —
// there is nothing to hurry about yet.
const WINDOW_DAYS = 60;

export default function DeadlineVisualizer({ scheme, lang = 'en', className = '' }) {
  const reduce = useReducedMotion();
  const [reminded, setReminded] = useState(() => hasReminder(scheme?.id));

  const ta = lang === 'ta';
  const deadline = scheme?.deadline;
  const days = deadline ? daysUntil(deadline) : Infinity;

  // No published date → no UI at all. Never draw a countdown we cannot defend.
  if (!deadline || !Number.isFinite(days)) return null;

  const closed = days <= 0;
  const clamped = Math.max(0, Math.min(WINDOW_DAYS, days));
  const pct = closed ? 1 : (WINDOW_DAYS - clamped) / WINDOW_DAYS;
  const urgent = !closed && days <= 7;

  let dateLabel = '';
  const parsed = new Date(deadline);
  if (!Number.isNaN(parsed.getTime())) {
    dateLabel = parsed.toLocaleDateString(ta ? 'ta-IN' : 'en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  }

  const handleBell = (e) => {
    e.stopPropagation();
    saveReminder(scheme.id);
    setReminded(true);
  };

  return (
    <div className={`mt-4 ${className}`}>
      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="u-meta" lang={lang}>
            {closed
              ? ta ? 'காலக்கெடு முடிந்தது' : 'Closed'
              : ta ? 'விண்ணப்பிக்க கடைசி நாள்' : 'Last date to apply'}
          </div>

          {closed ? (
            <div className="mt-1.5 text-[15px] text-muted" lang={lang}>
              {dateLabel}
            </div>
          ) : (
            <div className="mt-1.5 flex items-baseline gap-2 flex-wrap">
              <span className="u-display tabular text-[26px] leading-none text-ink">
                {days}
              </span>
              <span className="text-[14px] text-muted" lang={lang}>
                {t('days_left', lang)}
              </span>
              {dateLabel && (
                <span className="text-[13px] text-muted tabular">· {dateLabel}</span>
              )}
            </div>
          )}
        </div>

        {!closed && (
          <button
            onClick={handleBell}
            className="btn-ghost compact shrink-0 !px-3 !py-2 text-[13px] flex items-center gap-1.5"
            aria-label={
              reminded
                ? ta ? 'நினைவூட்டல் சேமிக்கப்பட்டது' : 'Reminder saved'
                : ta ? 'நினைவூட்டல் சேமி' : 'Save a reminder'
            }
            aria-pressed={reminded}
            lang={lang}
          >
            <svg
              viewBox="0 0 24 24"
              width="16"
              height="16"
              aria-hidden="true"
              fill={reminded ? 'currentColor' : 'none'}
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M18 16v-5a6 6 0 10-12 0v5l-2 2h16l-2-2zM9 20a3 3 0 006 0" />
            </svg>
            <span>
              {reminded
                ? ta ? 'சேமித்தாகிவிட்டது' : 'Saved'
                : ta ? 'நினைவூட்டு' : 'Remind me'}
            </span>
          </button>
        )}
      </div>

      {/* Hairline track, ink fill. Filling = time spent, so a nearly-full bar
          reads as "almost gone" without needing a colour to say so. */}
      <div
        className="mt-3 h-[3px] w-full rounded-full bg-surface-sub overflow-hidden"
        style={{ boxShadow: 'inset 0 0 0 1px var(--hairline)' }}
        role="presentation"
      >
        <motion.div
          initial={reduce ? false : { width: 0 }}
          animate={{ width: `${Math.round(pct * 100)}%` }}
          transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
          className={`h-full rounded-full ${closed ? 'bg-muted/40' : 'bg-ink'}`}
        />
      </div>

      {urgent && (
        <div className="amber-banner mt-3 !py-2 text-[13px]" lang={lang}>
          {ta
            ? 'விரைவில் மூடப்படும் — இந்த வாரமே விண்ணப்பியுங்கள்'
            : 'Closing soon — apply this week'}
        </div>
      )}

      {reminded && (
        <div className="mt-2 text-[13px] text-muted" lang={lang}>
          {t('reminder_saved', lang)}
        </div>
      )}
    </div>
  );
}
