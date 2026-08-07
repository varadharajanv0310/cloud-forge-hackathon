import { useState } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { formatBenefit, benefitToneClass } from '../utils/formatters.js';
import Thread, { matchChips } from './Thread.jsx';

/**
 * FuzzyMatchCard — a near miss.
 *
 * This card has exactly one job: say what would make the citizen eligible. So
 * the fuzzy reason is the largest thing on it, not a badge tucked beside the
 * name, and the money is deliberately quiet — this is not an entitlement yet.
 *
 * Three brief constraints land here:
 *
 *  1. Benefit kinds never look addable. Only `benefit.cash` takes the display
 *     face (and smaller than on a confirmed match); a loan sits in its own well
 *     with the ↩ glyph and repayment wording.
 *  2. The citizen can tell why they are seeing this. But a near miss is *not* a
 *     match, so the chips are labelled "what already fits" rather than borrowing
 *     MatchReason's "why this matched you" — which would be untrue here.
 *  3. Never invent a number. The gap explanation only prints a threshold that
 *     the scheme actually publishes; v1 rendered `income_max_annual || 0`, so a
 *     scheme with no published limit told the citizen the limit was ₹0.
 *
 * The dashed hairline outline (against the solid inset ring of `.card`) is the
 * whole visual difference in weight: same geometry, unfinished edge.
 */
export default function FuzzyMatchCard({ entry, vault, lang = 'en' }) {
  const { scheme, fuzzy } = entry || {};
  const [openDetail, setOpenDetail] = useState(false);
  const nav = useNavigate();

  if (!scheme) return null;

  const ta = lang === 'ta';
  const b = scheme.benefit || {};
  const e = scheme.eligibility || {};
  const money = formatBenefit(b, lang);
  const chips = vault ? matchChips(scheme, vault, lang) : [];

  // The engine already phrases the gap in both languages. Prefer its words.
  const reason =
    (ta ? fuzzy?.reason_ta : fuzzy?.reason) ||
    (ta
      ? 'ஒரு நிபந்தனை மட்டும் பொருந்தவில்லை'
      : 'One condition does not fit yet');

  // What would close the gap. Every branch prints a figure ONLY when the scheme
  // publishes one; otherwise it says so and stops.
  const detail = (() => {
    if (fuzzy?.type === 'age') {
      if (e.min_age == null) return null;
      return ta
        ? `இந்தத் திட்டத்திற்கான குறைந்தபட்ச வயது ${e.min_age}. அது வரை உங்கள் ஆவணங்களைத் தயார் செய்து வைத்துக் கொள்ளுங்கள்.`
        : `The minimum age for this scheme is ${e.min_age}. Nothing else is missing — keep your documents ready until then.`;
    }
    if (fuzzy?.type === 'income') {
      if (e.income_max_annual == null) {
        return ta
          ? 'வருமான வரம்பு வெளியிடப்படவில்லை. ஊராட்சி அலுவலகத்தில் சரிபார்க்கவும்.'
          : 'The income limit is not published for this scheme. Ask at your Panchayat office.';
      }
      const limit = `₹${e.income_max_annual.toLocaleString('en-IN')}`;
      return ta
        ? `வரம்பு ஆண்டுக்கு ${limit}. VAO வழங்கும் நடப்பு வருமானச் சான்றிதழுடன் மறுபரிசீலனை கோரலாம்.`
        : `The limit is ${limit} a year. With a current income certificate from your VAO you can still ask to be considered.`;
    }
    if (fuzzy?.type === 'occupation') {
      const list = (e.occupation || []).join(', ').replace(/_/g, ' ');
      if (!list) return null;
      return ta
        ? `இத்திட்டம் ${list} பணியில் உள்ளவர்களுக்கானது. உங்கள் பணி நெருங்கியது — ஊராட்சி அலுவலகத்தில் கேளுங்கள்.`
        : `This scheme is written for: ${list}. Your work is adjacent, so it is worth asking at your Panchayat office.`;
    }
    return null;
  })();

  const outbound = scheme.official_url || scheme.application_link;

  return (
    <motion.article
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
      onClick={() => nav(`/scheme/${scheme.id}`)}
      className="bg-surface rounded-surface p-6 border border-dashed border-hairline
                 cursor-pointer transition-colors duration-240 ease-composed
                 hover:border-ink/20"
    >
      <div className="flex items-center gap-2 mb-3">
        <span className="u-meta" lang={lang}>
          {ta ? 'கிட்டத்தட்ட' : 'Near match'}
        </span>
        <span className="w-1 h-1 rounded-full bg-ink/20" />
        <span className="u-meta" lang={lang}>
          {scheme.nationwide
            ? ta ? 'மத்தியம்' : 'Central'
            : (scheme.state || (scheme.states || [])[0] || '')}
        </span>
      </div>

      <div className="flex items-start justify-between gap-5">
        <div className="min-w-0 flex-1">
          <h3 className="u-scheme-name text-scheme font-semibold text-ink-2" lang={lang}>
            {ta && scheme.name_ta ? scheme.name_ta : scheme.name_plain}
          </h3>
        </div>

        {/* Money is held back here — nothing on this card is owed yet. Cash is
            still the only kind allowed the display face. */}
        {b.cash ? (
          <div className="shrink-0 text-right">
            <div className="u-display tabular text-[20px] leading-none text-ink-2">
              {money.primary}
            </div>
            <div className="u-meta mt-1" lang={lang}>{money.secondary}</div>
          </div>
        ) : (
          <div className={`shrink-0 text-right text-[13px] ${benefitToneClass(money.tone)}`}>
            <div className="font-medium">{money.primary}</div>
            <div className="text-muted">{money.secondary}</div>
          </div>
        )}
      </div>

      {/* A loan never shares a row with cash, and never joins a total. */}
      {b.cash && b.loan_ceiling ? (
        <div className="well mt-3 px-4 py-2.5 flex items-center justify-between gap-3">
          <span className="text-[13px] text-muted" lang={lang}>
            ↩ {ta ? 'கடன் வசதி — திருப்பிச் செலுத்த வேண்டும்' : 'credit available — to be repaid'}
          </span>
          <span className="tabular text-[14px] font-medium text-muted shrink-0">
            {formatBenefit({ loan_ceiling: b.loan_ceiling }, lang).primary}
          </span>
        </div>
      ) : null}

      {/* The reason is the point of the card, so it is the loudest thing on it. */}
      <div className="well mt-4 px-5 py-4">
        <div className="u-meta" lang={lang}>
          {ta ? 'என்ன குறைகிறது' : 'What is missing'}
        </div>
        <p className="mt-1.5 text-lead text-ink" lang={lang}>
          {reason}
        </p>

        {detail && (
          <>
            <button
              onClick={(e2) => { e2.stopPropagation(); setOpenDetail((s) => !s); }}
              className="btn-ghost compact mt-2 -ml-4 text-[14px] text-muted"
              aria-expanded={openDetail}
              lang={lang}
            >
              {openDetail
                ? ta ? 'மறை' : 'Hide'
                : ta ? 'என்ன செய்யலாம்?' : 'What can I do?'}
            </button>

            {openDetail && (
              <motion.p
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
                className="text-[14px] text-ink-2 leading-relaxed"
                lang={lang}
              >
                {detail}
              </motion.p>
            )}
          </>
        )}
      </div>

      {/* Deliberately not MatchReason: this scheme did NOT match, and the label
          "why this matched you" would be a false statement. These are the parts
          that already fit — the rest of the answer is in the well above. */}
      {chips.length > 0 && (
        <div className="mt-4">
          <div className="u-meta mb-1.5" lang={lang}>
            {ta ? 'ஏற்கனவே பொருந்துவது' : 'What already fits'}
          </div>
          <Thread chips={chips} lang={lang} tone="match" />
        </div>
      )}

      <div className="mt-5">
        <a
          href={outbound}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e2) => e2.stopPropagation()}
          className="btn-ghost compact -ml-4 text-[15px]"
          lang={lang}
        >
          {ta ? 'திட்ட விவரங்களைப் பார்' : 'Read the scheme rules'}
          <span aria-hidden="true"> ↗</span>
        </a>
      </div>
    </motion.article>
  );
}
