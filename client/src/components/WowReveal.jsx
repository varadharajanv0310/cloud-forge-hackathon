import { useEffect, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import { formatRupees } from '../utils/formatters.js';
import { speakImperative } from '../hooks/useTTS.js';

/**
 * WowReveal — ported from the Claude Design source (Sevai.dc.html, isReveal).
 *
 * This screen carries the hardest constraint in the product: five kinds of help
 * that must never look addable. The design solves it by giving each kind its own
 * *grammar*, not merely its own colour —
 *
 *   cash / year      44px, weight 800, ink            the only figure at full weight
 *   one-time         31px, weight 700, + a mono guard reading NOT A YEARLY AMOUNT
 *   insurance        26px, weight 500, teal well      "not money you receive"
 *   subsidy          16.5px, weight 600               "a discount, not a payment"
 *   in kind          prose, no numeral at all
 *   credit           dashed box, figure set in MONO   typographically incapable
 *                                                     of reading as the cash line
 *
 * and then says it outright: they are not added together, and Sevai will never
 * show a single total.
 */

const Rule = () => <div className="h-px bg-rule-12" />;

/** A mono label + optional Tamil gloss, baseline-aligned across the row. */
function KindLabel({ en, ta, guard, tone = 'ink' }) {
  return (
    <div className="flex items-baseline justify-between gap-2.5">
      <span className={`mono text-[10.5px] tracking-[.13em] ${tone === 'ink' ? 'text-ink' : 'text-ink-80'}`}>
        {en}
      </span>
      {guard && <span className="mono text-[10px] tracking-[.08em] text-ink-30">{guard}</span>}
      {ta && <span className="ta text-[12.5px] text-ink-40" lang="ta">{ta}</span>}
    </div>
  );
}

export default function WowReveal({ count = 0, totals, profile, lang = 'en', onContinue }) {
  const [n, setN] = useState(0);
  const reduce = useReducedMotion();
  const t = totals || {};

  useEffect(() => {
    if (reduce) { setN(count); return; }
    // Interval, not requestAnimationFrame: rAF is suspended whenever the
    // renderer treats the surface as non-visible, and a headline stuck at zero
    // is unacceptable on this screen in particular.
    const start = Date.now();
    const id = setInterval(() => {
      const p = Math.min(1, (Date.now() - start) / 1100);
      setN(Math.round(count * (1 - Math.pow(1 - p, 3))));
      if (p >= 1) clearInterval(id);
    }, 16);
    speakImperative(`${count} schemes match you`, lang);
    return () => clearInterval(id);
  }, [count, lang, reduce]);

  const name = profile?.name ? ` · ${profile.name}` : '';

  return (
    <div className="fixed inset-0 z-50 bg-page overflow-y-auto">
      <div
        className="bloom"
        aria-hidden="true"
        style={{
          inset: 0,
          background:
            'radial-gradient(62% 26% at 30% 0%,rgba(192,172,240,.52) 0%,rgba(192,172,240,.22) 42%,rgba(192,172,240,0) 76%),' +
            'radial-gradient(58% 22% at 82% 12%,rgba(132,212,221,.4) 0%,rgba(132,212,221,0) 70%)',
        }}
      />

      <div className="relative mx-auto w-full max-w-[640px] px-5 sm:px-7 py-7 pb-12">
        <div className="mono text-[10.5px] tracking-[.14em] text-ink-55 enter">
          Your result{name}
        </div>

        <div className="flex items-baseline gap-3 mt-3.5 enter" style={{ animationDelay: '.04s' }}>
          <div
            className="tabular"
            style={{ fontSize: 82, fontWeight: 700, letterSpacing: '-.05em', lineHeight: .9 }}
          >
            {n}
          </div>
          <div className="text-[21px] font-semibold tracking-[-.02em] pb-1.5 leading-tight">
            schemes<br />match you
          </div>
        </div>
        <div className="ta text-[17px] text-ink-80 mt-3 enter" lang="ta" style={{ animationDelay: '.08s' }}>
          திட்டங்கள் உங்களுக்குப் பொருந்துகின்றன
        </div>

        {/* targeted vs open — the honest framing of what a "match" means */}
        <div className="flex mt-5 border-t border-b border-rule-14 enter" style={{ animationDelay: '.12s' }}>
          <div className="flex-1 py-3.5 pr-3.5 border-r border-rule-10">
            <div className="text-[25px] font-bold tracking-[-.03em] tabular">{t.targetedCount ?? 0}</div>
            <div className="text-[13px] leading-[1.4] text-ink-60 mt-1">written for someone like you</div>
            <div className="ta text-[12px] text-ink-30 mt-0.5" lang="ta">உங்களைப் போன்றவர்களுக்காக</div>
          </div>
          <div className="flex-1 py-3.5 pl-3.5">
            <div className="text-[25px] font-bold tracking-[-.03em] text-ink-60 tabular">{t.openCount ?? 0}</div>
            <div className="text-[13px] leading-[1.4] text-ink-60 mt-1">more open to all citizens</div>
            <div className="ta text-[12px] text-ink-30 mt-0.5" lang="ta">அனைவருக்கும் திறந்தவை</div>
          </div>
        </div>

        <div className="mono text-[10.5px] tracking-[.13em] text-ink-55 mt-6 mb-2.5">
          From your {t.focusCount || 5} strongest matches
        </div>

        {/* ── the five kinds, each with its own grammar ──────────────────── */}
        <div className="bg-white border border-rule-14 rounded-[5px] overflow-hidden enter"
             style={{ animationDelay: '.16s' }}>

          {(t.focusCashAnnual || 0) > 0 && (
            <>
              <div className="px-4 pt-[17px] pb-[18px]">
                <KindLabel en="Cash · every year" ta="ஆண்டுக்கு பணம்" />
                <div className="tabular mt-2" style={{ fontSize: 44, fontWeight: 800, letterSpacing: '-.045em', lineHeight: 1.05 }}>
                  {formatRupees(t.focusCashAnnual)}
                </div>
                <div className="text-[13.5px] leading-[1.55] text-ink-60 mt-2">
                  Money paid to you every year, while you remain eligible.
                </div>
              </div>
              <Rule />
            </>
          )}

          {(t.focusCashOneTime || 0) > 0 && (
            <>
              <div className="p-4">
                <KindLabel en="One-time payment" guard="NOT A YEARLY AMOUNT" />
                <div className="tabular mt-1.5" style={{ fontSize: 31, fontWeight: 700, letterSpacing: '-.035em', lineHeight: 1.1 }}>
                  {formatRupees(t.focusCashOneTime)}
                </div>
                <div className="ta text-[12.5px] text-ink-40 mt-1" lang="ta">ஒரு முறை மட்டும்</div>
                <div className="text-[13.5px] leading-[1.55] text-ink-60 mt-1.5">
                  Paid once, not every year. Often in stages.
                </div>
              </div>
              <Rule />
            </>
          )}

          {(t.insuranceCover || 0) > 0 && (
            <>
              <div className="p-4" style={{ background: 'rgba(132,212,221,.13)' }}>
                <KindLabel en="Insurance cover" ta="காப்பீட்டுத் தொகை" tone="soft" />
                <div className="tabular mt-1.5 text-ink-80" style={{ fontSize: 26, fontWeight: 500, letterSpacing: '-.025em', lineHeight: 1.15 }}>
                  {formatRupees(t.insuranceCover)}
                </div>
                <div className="text-[13.5px] leading-[1.55] text-ink-60 mt-1.5">
                  Not money you receive. It is the most a claim can be worth if you need it.
                </div>
              </div>
              <Rule />
            </>
          )}

          {(t.subsidyTotal || 0) > 0 && (
            <>
              <div className="p-4">
                <div className="mono text-[10.5px] tracking-[.13em] text-ink-80">
                  Subsidy · a discount, not a payment
                </div>
                <div className="text-[16.5px] font-semibold tracking-[-.015em] mt-1.5 tabular">
                  {formatRupees(t.subsidyTotal)} off what you would otherwise pay
                </div>
                <div className="text-[13.5px] leading-[1.55] text-ink-60 mt-1.5">You still pay the rest.</div>
              </div>
              <Rule />
            </>
          )}

          {/* In kind never renders a numeral. */}
          <div className="p-4">
            <div className="mono text-[10.5px] tracking-[.13em] text-ink-80">In kind · goods and training</div>
            <div className="text-[15px] leading-[1.55] text-ink-90 mt-1.5">
              Equipment, seed, training and other help given directly. No cash value published.
            </div>
          </div>
        </div>

        {/* Credit sits OUTSIDE the panel, dashed, and its figure is set in the
            mono face — it cannot be read as part of the cash above it. */}
        {(t.loanCeiling || 0) > 0 && (
          <div className="mt-[18px] rounded-[5px] p-4 border border-dashed" style={{ borderColor: 'rgba(20,20,26,.34)' }}>
            <div className="mono text-[10.5px] tracking-[.13em] text-ink-45">
              Credit available — to be repaid
            </div>
            <div className="mono tabular text-ink-45 mt-2" style={{ fontSize: 24, fontWeight: 400, letterSpacing: '-.02em', textTransform: 'none' }}>
              {formatRupees(t.loanCeiling)}
            </div>
            <div className="ta text-[12.5px] text-ink-30 mt-1" lang="ta">
              திருப்பிச் செலுத்த வேண்டியது — வருமானம் அல்ல
            </div>
            <div className="text-[13.5px] leading-[1.55] text-ink-45 mt-2">
              This is a borrowing limit, not income. Interest is charged, and it must be paid back.
            </div>
          </div>
        )}

        <div className="mt-4 pt-3.5 border-t border-rule-12 text-[13px] leading-[1.6] text-ink-45">
          These are different kinds of help. They are not added together, and Sevai will never show
          you a single total.
          {(t.unvaluedCount || 0) > 0 && (
            <>
              <br />
              <span className="text-ink-30">
                {t.unvaluedCount} more schemes matched you but have not published what they pay.
              </span>
            </>
          )}
        </div>

        <button
          onClick={onContinue}
          className="w-full mt-5 bg-ink text-white rounded-[4px] min-h-[58px] flex flex-col items-center justify-center gap-0.5 transition-transform hover:-translate-y-px"
        >
          <span className="text-[16.5px] font-semibold tracking-[-.01em]">See all {count} schemes</span>
          <span className="ta text-[12.5px] opacity-[.72]" lang="ta">அனைத்து திட்டங்களையும் பார்க்க</span>
        </button>
      </div>
    </div>
  );
}
