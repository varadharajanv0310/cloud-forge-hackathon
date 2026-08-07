import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { relatedEligible } from '../utils/eligibilityEngine.js';
import { useSchemes } from '../utils/schemesStore.js';
import { formatBenefit, benefitToneClass } from '../utils/formatters.js';
import { MatchReason } from './Thread.jsx';
import { t } from '../data/strings.js';

/**
 * CrossSchemeChain — "you also qualify for these".
 *
 * v2 notes:
 *  - The pool comes from useSchemes(vault.state) and is passed explicitly to
 *    relatedEligible, so this renders nothing rather than a wrong nothing while
 *    the shards are still in flight, and re-renders once they land.
 *  - No amount is ever concatenated into a button label. The old code wrote
 *    `Apply Now · ₹10L` from `benefit_amount`, which put a loan ceiling on a
 *    call-to-action as though it were money about to arrive. The figure now sits
 *    in its own row with its own grammar, and the button just says apply.
 *  - Every scheme here is a real match, so each carries its MatchReason chips.
 */
export default function CrossSchemeChain({ schemeId, vault, lang = 'en', variant = 'list' }) {
  const { schemes } = useSchemes(vault?.state);
  const nav = useNavigate();

  const related = useMemo(
    () => (vault ? relatedEligible(schemeId, vault, schemes) : []),
    [schemeId, vault, schemes],
  );

  if (related.length === 0) return null;
  const ta = lang === 'ta';

  // ── Single: the application-confirmation nudge ────────────────────────────
  if (variant === 'single') {
    const { scheme } = related[0];
    const b = scheme.benefit || {};
    const money = formatBenefit(b, lang);

    return (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.32, delay: 0.4, ease: [0.22, 1, 0.36, 1] }}
        className="card"
      >
        <div className="u-meta" lang={lang}>
          {ta ? 'இன்னும் ஒன்று' : 'One more you qualify for'}
        </div>

        <h3 className="u-scheme-name text-scheme font-semibold text-ink mt-2" lang={lang}>
          {ta && scheme.name_ta ? scheme.name_ta : scheme.name_plain}
        </h3>

        {/* Cash is the only kind that gets the display face. */}
        {b.cash ? (
          <div className="mt-3">
            <div className="u-display tabular text-[28px] leading-none text-ink">
              {money.primary}
            </div>
            <div className="u-meta mt-1.5" lang={lang}>{money.secondary}</div>
          </div>
        ) : (
          <div className={`mt-3 text-[14px] ${benefitToneClass(money.tone)}`}>
            <span className="font-medium">{money.primary}</span>
            <span className="text-muted"> · {money.secondary}</span>
          </div>
        )}

        {/* A loan gets its own row, its own container, and repayment wording. */}
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

        <MatchReason scheme={scheme} profile={vault} lang={lang} className="mt-4" />

        <button
          onClick={() => nav(`/apply/${scheme.id}`)}
          className="btn-primary w-full mt-5"
          lang={lang}
        >
          {ta ? 'இதற்கும் விண்ணப்பி' : 'Apply for this too'}
        </button>
      </motion.div>
    );
  }

  // ── List: a horizontal strip under a scheme ───────────────────────────────
  return (
    <div className="mt-8">
      <h3 className="u-meta mb-3" lang={lang}>
        {t('you_also_qualify', lang)}
      </h3>

      <div className="flex gap-3 overflow-x-auto hide-scrollbar -mx-1 px-1 pb-1">
        {related.map(({ scheme }, i) => {
          const b = scheme.benefit || {};
          const money = formatBenefit(b, lang);

          return (
            <motion.article
              key={scheme.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.32, delay: i * 0.06, ease: [0.22, 1, 0.36, 1] }}
              onClick={() => nav(`/scheme/${scheme.id}`)}
              className="card shrink-0 w-[262px] p-5 cursor-pointer
                         transition-shadow duration-240 ease-composed hover:shadow-e2"
            >
              <div className="u-meta" lang={lang}>
                {scheme.nationwide
                  ? ta ? 'மத்தியம்' : 'Central'
                  : (scheme.state || (scheme.states || [])[0] || '')}
              </div>

              <h4 className="u-scheme-name text-[17px] leading-[1.35] font-semibold text-ink mt-2" lang={lang}>
                {ta && scheme.name_ta ? scheme.name_ta : scheme.name_plain}
              </h4>

              {b.cash ? (
                <div className="mt-3">
                  <div className="u-display tabular text-[22px] leading-none text-ink">
                    {money.primary}
                  </div>
                  <div className="u-meta mt-1" lang={lang}>{money.secondary}</div>
                </div>
              ) : (
                <div className={`mt-3 text-[13px] ${benefitToneClass(money.tone)}`}>
                  <div className="font-medium">{money.primary}</div>
                  <div className="text-muted">{money.secondary}</div>
                </div>
              )}

              {b.cash && b.loan_ceiling ? (
                <div className="well mt-3 px-3 py-2 flex items-center justify-between gap-2">
                  <span className="text-[12px] text-muted" lang={lang}>
                    ↩ {ta ? 'கடன்' : 'credit'}
                  </span>
                  <span className="tabular text-[13px] font-medium text-muted shrink-0">
                    {formatBenefit({ loan_ceiling: b.loan_ceiling }, lang).primary}
                  </span>
                </div>
              ) : null}

              <MatchReason scheme={scheme} profile={vault} lang={lang} className="mt-4" />
            </motion.article>
          );
        })}
      </div>
    </div>
  );
}
