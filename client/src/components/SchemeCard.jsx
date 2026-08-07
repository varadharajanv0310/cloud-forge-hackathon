import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { formatBenefit, benefitToneClass } from '../utils/formatters.js';
import { MatchReason } from './Thread.jsx';
import DeadlineVisualizer from './DeadlineVisualizer.jsx';

/**
 * SchemeCard.
 *
 * Two constraints from the brief land here:
 *
 *  1. Benefit kinds must never look addable. Only cash takes the display face;
 *     a loan is rendered in an outlined well, text face, muted, with a ↩ glyph.
 *     Kinds never share a row.
 *  2. A citizen must be able to tell why a scheme matched. The Thread chips
 *     that caused the match are echoed on the card itself.
 */
export default function SchemeCard({ scheme, vault, lang = 'en', compact = false }) {
  const nav = useNavigate();
  const ta = lang === 'ta';
  const b = scheme.benefit || {};
  const money = formatBenefit(b, lang);

  const outbound = scheme.official_url || scheme.application_link;
  const isOfficial = Boolean(scheme.official_url);

  return (
    <motion.article
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
      onClick={() => nav(`/scheme/${scheme.id}`)}
      className="card cursor-pointer transition-shadow duration-240 ease-composed hover:shadow-e2"
    >
      {/* scope + category */}
      <div className="flex items-center gap-2 mb-3">
        <span className="u-meta" lang={lang}>
          {scheme.nationwide
            ? ta ? 'மத்தியம்' : 'Central'
            : (scheme.state || (scheme.states || [])[0] || '')}
        </span>
        <span className="w-1 h-1 rounded-full bg-ink/20" />
        <span className="u-meta" lang={lang}>{scheme.category}</span>
      </div>

      <div className="flex items-start justify-between gap-5">
        <div className="min-w-0 flex-1">
          <h3 className="u-scheme-name text-scheme font-semibold text-ink" lang={lang}>
            {scheme.name_ta && ta ? scheme.name_ta : scheme.name_plain}
          </h3>
        </div>

        {/* Cash is the ONLY kind allowed the display face. */}
        {b.cash ? (
          <div className="shrink-0 text-right">
            <div className="u-display tabular text-[24px] leading-none text-ink">
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

      {/* A loan gets its own row and its own container. It can never be read as
          part of the cash figure above it. */}
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

      {scheme.deadline && <DeadlineVisualizer scheme={scheme} vault={vault} lang={lang} />}

      {/* Why this matched — the Thread, echoed back. */}
      {vault && <MatchReason scheme={scheme} profile={vault} lang={lang} className="mt-4" />}

      {!compact && (
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <a
            href={outbound}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="btn-primary compact !py-2.5 !px-5 !text-[15px]"
            lang={lang}
          >
            {isOfficial
              ? ta ? 'அரசு தளத்தில் விண்ணப்பி' : 'Apply on official site'
              : ta ? 'திட்டப் பக்கத்தைப் பார்' : 'View scheme page'}
            <span aria-hidden="true"> ↗</span>
          </a>
          <button
            onClick={(e) => { e.stopPropagation(); nav(`/apply/${scheme.id}`); }}
            className="btn-ghost compact text-[15px]"
            lang={lang}
          >
            {ta ? 'விவரங்கள்' : 'Details'}
          </button>
        </div>
      )}
    </motion.article>
  );
}
