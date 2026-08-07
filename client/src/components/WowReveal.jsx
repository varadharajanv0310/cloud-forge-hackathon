import { useEffect, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import { formatRupees, formatMatchSummary } from '../utils/formatters.js';
import { speakImperative } from '../hooks/useTTS.js';

/**
 * WowReveal — what the sphere resolves into.
 *
 * The old version counted up to a single "total value" labelled "per year". That
 * figure summed grants, one-time payments and loan ceilings, and invented
 * ₹50,000 for every scheme whose amount could not be parsed. It is gone.
 *
 * Each benefit kind now gets its own row and its own grammar. Cash is the only
 * kind set in the display face; a loan sits in an outlined well, text face,
 * muted ink, carrying a repayment glyph. They are not merely different colours —
 * they are different objects, so the eye cannot add them.
 *
 * Entrances use the CSS `.enter` class, not framer-motion. Nothing on this
 * screen may depend on JS animation to become visible: rAF is suspended when the
 * renderer treats the surface as non-visible, and this is the one screen where a
 * blank result is unforgivable.
 */
export default function WowReveal({ count = 0, totals, profile, lang = 'en', onContinue }) {
  const [n, setN] = useState(0);
  const reduce = useReducedMotion();
  const t = totals || {};
  const ta = lang === 'ta';

  useEffect(() => {
    if (reduce) { setN(count); return; }
    // Interval, not requestAnimationFrame — see the note above.
    const start = Date.now();
    const id = setInterval(() => {
      const p = Math.min(1, (Date.now() - start) / 1100);
      setN(Math.round(count * (1 - Math.pow(1 - p, 3))));
      if (p >= 1) clearInterval(id);
    }, 16);
    speakImperative(
      ta ? `${count} திட்டங்கள் உங்களுக்கு பொருந்துகின்றன` : `${count} schemes match you`,
      lang,
    );
    return () => clearInterval(id);
  }, [count, lang, reduce, ta]);

  // Delay only shifts WHEN the translate runs; the element is visible regardless.
  const enter = (d = 0) => ({
    className: 'enter',
    style: reduce ? undefined : { animationDelay: `${d}s` },
  });

  const hasFocusCash = (t.focusCashAnnual || 0) > 0 || (t.focusCashOneTime || 0) > 0;

  return (
    <div className="fixed inset-0 z-50 bg-canvas overflow-y-auto">
      <div className="bloom bloom-warm animate-bloom-drift" aria-hidden="true" />

      <div className="relative z-10 min-h-[100dvh] flex flex-col justify-center mx-auto w-full max-w-[860px] px-5 sm:px-8 py-12">
        <div {...enter(0)}>
          <span className="u-meta" lang={lang}>{ta ? 'உங்கள் முடிவு' : 'Your result'}</span>
        </div>

        <h1 {...enter(0.05)} className="enter mt-4 flex items-baseline gap-4 flex-wrap">
          <span className="u-display tabular text-figure sm:text-figure-lg text-ink">{n}</span>
          <span className="u-display text-q text-ink-2" lang={lang}>
            {ta ? 'திட்டங்கள் பொருந்துகின்றன' : 'schemes match you'}
          </span>
        </h1>

        <p {...enter(0.1)} className="enter mt-4 text-[15px] text-muted max-w-[60ch]" lang={lang}>
          {formatMatchSummary(t, lang)}
        </p>

        {/* ── the money, by kind, never summed ─────────────────────────── */}
        <div {...enter(0.16)} className="enter mt-10 space-y-3">
          {hasFocusCash && (
            <div className="card">
              <div className="u-meta" lang={lang}>
                {ta
                  ? `உங்கள் சிறந்த ${t.focusCount} திட்டங்களில்`
                  : `From your ${t.focusCount} strongest matches`}
              </div>
              <div className="mt-3 flex flex-wrap items-end gap-x-8 gap-y-4">
                {(t.focusCashAnnual || 0) > 0 && (
                  <div>
                    <div className="u-display tabular text-[44px] sm:text-[52px] text-ink leading-none">
                      {formatRupees(t.focusCashAnnual)}
                    </div>
                    <div className="u-meta mt-1.5" lang={lang}>{ta ? 'ஆண்டுக்கு' : 'per year'}</div>
                  </div>
                )}
                {(t.focusCashOneTime || 0) > 0 && (
                  <div>
                    <div className="u-display tabular text-[34px] sm:text-[40px] text-ink leading-none">
                      {formatRupees(t.focusCashOneTime)}
                    </div>
                    <div className="u-meta mt-1.5" lang={lang}>{ta ? 'ஒரு முறை' : 'one-time'}</div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* A loan is borrowing capacity, not money received. Different face,
              weight and container — it cannot read as part of the cash above. */}
          {(t.loanCeiling || 0) > 0 && (
            <div className="well px-5 py-4 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="text-[14px] text-ink-2 font-medium" lang={lang}>
                  ↩ {ta ? 'கடன் வசதி' : 'Credit available'}
                </div>
                <div className="text-[13px] text-muted mt-0.5" lang={lang}>
                  {ta ? 'திருப்பிச் செலுத்த வேண்டியது — வருமானம் அல்ல' : 'to be repaid — not income'}
                </div>
              </div>
              <div className="tabular text-[20px] font-medium text-muted shrink-0">
                {formatRupees(t.loanCeiling)}
              </div>
            </div>
          )}

          {(t.unvaluedCount || 0) > 0 && (
            <p className="text-[14px] text-muted px-1" lang={lang}>
              {ta
                ? `மேலும் ${t.unvaluedCount} திட்டங்கள் — தொகை அறிவிக்கப்படவில்லை, அதனால் ஊகிக்கவில்லை.`
                : `${t.unvaluedCount} more schemes matched but have not published an amount, so we have not guessed one.`}
            </p>
          )}
        </div>

        <div {...enter(0.22)} className="enter mt-10">
          <button onClick={onContinue} className="btn-primary" lang={lang}>
            {ta ? 'என் திட்டங்களைப் பார்' : 'See my schemes'}
          </button>
        </div>
      </div>
    </div>
  );
}
