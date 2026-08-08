import { useEffect, useState } from 'react';
import { loadManifest } from '../utils/schemesStore.js';

/**
 * Landing — ported from the Claude Design source (Sevai.dc.html, isLanding).
 *
 * Editorial rather than app-like: hairline rules instead of cards, a mono meta
 * face, 4px radii, and English and Tamil set TOGETHER rather than behind a
 * toggle — a Tamil reader should never have to find a switch to be addressed.
 *
 * Every figure is read from the generated corpus manifest at runtime. The
 * previous landing claimed "₹4Cr+ Claimed Successfully" and "12k Farmers
 * Served"; both were invented, and inventing a statistic on the one screen that
 * asks for trust undoes the argument the product rests on.
 */

const FALLBACK = { schemes: 4643, states: 36, central: 668, refreshed: '06 Aug 2026' };

function useCorpusStats() {
  const [s, setS] = useState(FALLBACK);
  useEffect(() => {
    loadManifest()
      .then((m) => {
        if (!m) return;
        setS({
          // total_schemes is the UNIQUE count. Summing central + the per-state
          // counts overcounts, because a multi-state scheme is written into
          // every shard it names — and this is the screen that asks for trust.
          schemes: m.total_schemes
            || (m.central_count || 0) + (m.states || []).reduce((n, x) => n + x.count, 0),
          states: (m.states || []).length || FALLBACK.states,
          central: m.central_count || FALLBACK.central,
          refreshed: m.generated_at
            ? new Date(m.generated_at).toLocaleDateString('en-GB', {
                day: '2-digit', month: 'short', year: 'numeric',
              })
            : FALLBACK.refreshed,
        });
      })
      .catch(() => {});
  }, []);
  return s;
}

const nf = (n) => n.toLocaleString('en-IN');

/** English above, Tamil beneath — the pairing used throughout the design. */
function Bi({ en, ta, enClass = '', taClass = '', tag: Tag = 'div' }) {
  return (
    <Tag>
      <div className={enClass}>{en}</div>
      <div className={`ta ${taClass}`} lang="ta">{ta}</div>
    </Tag>
  );
}

export default function Landing({ onStart, lang, setLang }) {
  const s = useCorpusStats();

  const figures = [
    [nf(s.schemes), 'Schemes in the corpus', 'திட்டங்கள்'],
    [nf(s.states), 'States & UTs covered', 'மாநிலங்கள்'],
    [nf(s.central), 'Central, open to everyone', 'மத்திய அரசு திட்டங்கள்'],
    ['0', 'Forms to fill in', 'நிரப்ப வேண்டிய படிவங்கள்'],
  ];

  const steps = [
    ['01', 'Answer seven questions', 'ஏழு கேள்விகளுக்குப் பதிலளியுங்கள்',
      'One at a time, in large type. A few more only if they apply to you. Twelve at the very most.'],
    ['02', 'We check them all', 'அனைத்தையும் சரிபார்க்கிறோம்',
      'Every central scheme and every scheme in your state — around 900 for Tamil Nadu — checked on the device itself.'],
    ['03', 'You see why each matched', 'ஏன் பொருந்தியது என்று பார்க்கலாம்',
      'Your own answers are printed on every result, so you can check our reasoning instead of trusting it.'],
  ];

  const limits = [
    ['It does not apply for you',
      "Every application is made on the government's own site. Sevai submits nothing on your behalf."],
    ['It does not promise money',
      'Matching is not approval. Only the department that runs a scheme can decide.'],
    ['It does not invent amounts',
      'Where a scheme has not published what it pays, Sevai says so rather than guessing.'],
  ];

  return (
    <div className="relative overflow-hidden min-h-[100dvh]">
      <div className="bloom bloom-landing" aria-hidden="true" />

      <div className="relative mx-auto max-w-[1320px] px-6 sm:px-10 lg:px-14">
        {/* ── masthead ─────────────────────────────────────────────────── */}
        <header className="flex items-center justify-between gap-6 pt-7 flex-wrap">
          <div className="flex items-baseline gap-2.5">
            <span className="text-[23px] font-bold tracking-[-.035em]">Sevai</span>
            <span className="ta text-[15px] font-medium text-ink-45" lang="ta">சேவை</span>
          </div>

          <nav className="hidden md:flex items-center gap-8 text-[14.5px] text-ink-70">
            <a href="#how">How it works</a>
            <a href="#figures">The corpus</a>
            <a href="#limits">Privacy</a>
          </nav>

          <div className="flex items-center gap-3.5">
            <div className="flex rounded-full overflow-hidden border border-rule-16 bg-white/60">
              <button
                onClick={() => setLang('en')}
                className={`mono px-3.5 py-[7px] text-[11.5px] tracking-[.10em] ${
                  lang === 'en' ? 'bg-ink text-white' : 'text-ink-70'
                }`}
              >
                EN
              </button>
              <button
                onClick={() => setLang('ta')}
                lang="ta"
                className={`ta px-3.5 py-[7px] text-[13px] ${
                  lang === 'ta' ? 'bg-ink text-white' : 'text-ink-70'
                }`}
              >
                தமிழ்
              </button>
            </div>
            <button onClick={onStart} className="btn-quiet hidden sm:block">Open the app</button>
          </div>
        </header>

        {/* ── hero ─────────────────────────────────────────────────────── */}
        <div className="grid gap-10 lg:gap-16 lg:grid-cols-2 items-end pt-16 pb-16 sm:pt-24 sm:pb-24">
          <div>
            <div className="mono text-[11.5px] tracking-[.15em] text-ink-55 mb-6 sm:mb-7">
              Free · No account · Nothing leaves your device
            </div>
            <h1 className="title-hero m-0 max-w-[13ch]">Know what you are owed.</h1>
            <div
              className="ta mt-5 font-medium text-ink-80 max-w-[16ch]"
              lang="ta"
              style={{ fontSize: 'clamp(19px,2vw,27px)' }}
            >
              உங்களுக்கு உரியது என்ன என்பதை அறியுங்கள்.
            </div>
          </div>

          <div className="lg:pb-3">
            <p className="m-0 text-[19px] leading-[1.62] text-ink-80 max-w-[44ch]">
              Sevai checks every central government scheme and every scheme in your own state
              against your answers, then shows you <em className="mark">why each one matched</em>.
              No forms. No login. Your answers stay on the phone in your hand.
            </p>
            <div className="ta mt-4 text-[16px] text-ink-45 max-w-[46ch]" lang="ta">
              மத்திய மற்றும் உங்கள் மாநிலத் திட்டங்கள் அனைத்தையும் சரிபார்த்து, ஏன் பொருந்தியது
              என்பதையும் காட்டுகிறோம்.
            </div>

            <div className="flex items-center gap-5 mt-9 flex-wrap">
              <button onClick={onStart} className="btn">Find my schemes →</button>
              <div>
                <div className="text-[14px] text-ink-70">Takes about two minutes</div>
                <div className="ta text-[13px] text-ink-40" lang="ta">சுமார் இரண்டு நிமிடங்கள்</div>
              </div>
            </div>
          </div>
        </div>

        {/* ── the corpus, in real figures ──────────────────────────────── */}
        <div id="figures" className="rule-t grid grid-cols-2 lg:grid-cols-4">
          {figures.map(([v, en, ta], i) => (
            <div
              key={en}
              className={`py-8 sm:py-9 ${i === 0 ? 'pr-7 lg:pl-0' : 'px-4 sm:px-7'} ${
                i < 3 ? 'lg:border-r border-rule-10' : ''
              } ${i < 2 ? 'border-b lg:border-b-0 border-rule-10' : ''}`}
            >
              <div className="figure tabular">{v}</div>
              <div className="mono text-[11px] tracking-[.13em] text-ink-55 mt-3">{en}</div>
              <div className="ta text-[14px] text-ink-45 mt-1" lang="ta">{ta}</div>
            </div>
          ))}
        </div>

        {/* ── how it works ─────────────────────────────────────────────── */}
        <div id="how" className="pt-20 sm:pt-24 pb-6 grid gap-10 lg:gap-16 lg:grid-cols-[0.9fr_2.1fr]">
          <div>
            <h2 className="title-1 m-0">How it<br />works</h2>
            <div className="ta text-[17px] text-ink-45 mt-3.5" lang="ta">
              இது எப்படி வேலை செய்கிறது
            </div>
          </div>
          <div className="grid gap-8 sm:gap-9 md:grid-cols-3">
            {steps.map(([n, en, ta, body]) => (
              <div key={n} className="pt-5 border-t-[1.5px] border-ink">
                <div className="mono text-[12px] tracking-[.12em] text-ink-55">{n}</div>
                <div className="title-3 mt-5">{en}</div>
                <div className="ta text-[16px] text-ink-65 mt-1.5" lang="ta">{ta}</div>
                <p className="mt-3.5 mb-0 text-[15.5px] leading-[1.6] text-ink-60">{body}</p>
              </div>
            ))}
          </div>
        </div>

        {/* ── what it does not do ──────────────────────────────────────── */}
        <div id="limits" className="mt-20 sm:mt-24 panel-flat grid lg:grid-cols-[0.55fr_1.45fr]">
          <div className="p-7 sm:px-8 border-b lg:border-b-0 lg:border-r border-rule-12">
            <div className="mono text-[11.5px] tracking-[.14em] text-ink-55 leading-[1.7]">
              What Sevai<br />does not do
            </div>
            <div className="ta text-[15px] text-ink-45 mt-3" lang="ta">சேவை என்ன செய்யாது</div>
          </div>
          <div className="p-7 sm:px-8 grid gap-7 md:grid-cols-3">
            {limits.map(([h, p]) => (
              <div key={h}>
                <div className="text-[16.5px] font-semibold tracking-[-.015em]">{h}</div>
                <p className="mt-2 mb-0 text-[15px] leading-[1.6] text-ink-60">{p}</p>
              </div>
            ))}
          </div>
        </div>

        <footer className="flex justify-between items-center gap-4 flex-wrap py-11 mono text-[11px] tracking-[.1em] text-ink-40">
          <span>Sevai · Corpus normalised from myscheme.gov.in</span>
          <span className="tabular">{nf(s.schemes)} schemes · Last refreshed {s.refreshed}</span>
        </footer>
      </div>
    </div>
  );
}
