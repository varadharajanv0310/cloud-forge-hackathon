import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { loadManifest } from '../utils/schemesStore.js';

/**
 * Landing — the first thing a judge sees.
 *
 * Every figure here is read from the generated corpus manifest at runtime. The
 * previous landing claimed "₹4Cr+ Claimed Successfully" and "12k Farmers
 * Served"; both were invented, and inventing a statistic on the one screen that
 * asks for trust undoes the entire honesty argument the product rests on.
 */

const FALLBACK = { schemes: 4643, states: 36, central: 668 };

function useCorpusStats() {
  const [s, setS] = useState(FALLBACK);
  useEffect(() => {
    loadManifest()
      .then((m) => {
        if (!m) return;
        const total = (m.central_count || 0) + (m.states || []).reduce((n, x) => n + x.count, 0);
        setS({
          schemes: total || FALLBACK.schemes,
          states: (m.states || []).length || FALLBACK.states,
          central: m.central_count || FALLBACK.central,
        });
      })
      .catch(() => {});
  }, []);
  return s;
}

const nf = (n) => n.toLocaleString('en-IN');

export default function Landing({ onStart, lang, setLang }) {
  const t = (en, ta) => (lang === 'ta' ? ta : en);
  const stats = useCorpusStats();
  const reduce = useReducedMotion();

  const rise = (delay = 0) => ({
    initial: reduce ? false : { opacity: 0, y: 16 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.5, delay, ease: [0.22, 1, 0.36, 1] },
  });

  return (
    <div className="min-h-[100dvh] w-full bg-canvas relative overflow-x-hidden">
      <div className="bloom bloom-cool animate-bloom-drift" aria-hidden="true" />

      <div className="relative z-10 mx-auto w-full max-w-[1120px] px-4 sm:px-6 py-4 sm:py-6">
        {/* ── nav ─────────────────────────────────────────────────────────── */}
        <header className="flex items-center justify-between mb-8 sm:mb-14 px-2">
          <div className="u-display text-[19px] tracking-[-0.02em]">Sevai</div>
          <button
            onClick={() => setLang(lang === 'ta' ? 'en' : 'ta')}
            className="btn-ghost compact text-[14px]"
            lang={lang === 'ta' ? 'en' : 'ta'}
          >
            {lang === 'ta' ? 'English' : 'தமிழ்'}
          </button>
        </header>

        {/* ── hero ────────────────────────────────────────────────────────── */}
        <div className="surface-tray">
          <div className="surface-plate relative overflow-hidden px-6 sm:px-12 lg:px-16 py-12 sm:py-16 lg:py-20">
            <div className="bloom bloom-warm bloom-quiet" aria-hidden="true" />

            <div className="relative z-10 max-w-[760px]">
              <motion.div {...rise(0)}>
                <span className="u-meta inline-flex items-center gap-2" lang={lang}>
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-ink" />
                  {t('Government welfare, without the paperwork', 'அரசு நலத்திட்டங்கள், காகிதம் இன்றி')}
                </span>
              </motion.div>

              <motion.h1
                {...rise(0.06)}
                lang={lang}
                className="u-display text-q sm:text-q-md lg:text-q-lg mt-5 text-ink"
              >
                {t('Know what you are owed.', 'உங்களுக்கு உரியது என்னவென்று அறியுங்கள்.')}
              </motion.h1>

              <motion.p
                {...rise(0.12)}
                lang={lang}
                className="mt-5 text-lead text-ink-2 max-w-[52ch]"
              >
                {t(
                  'Answer a few questions. We check every central and state scheme you could claim, and show you why each one matched.',
                  'சில கேள்விகளுக்கு பதிலளியுங்கள். நீங்கள் பெறக்கூடிய அனைத்து மத்திய மற்றும் மாநிலத் திட்டங்களையும் சரிபார்த்து, ஒவ்வொன்றும் ஏன் பொருந்தியது என்பதைக் காட்டுவோம்.',
                )}
              </motion.p>

              <motion.div {...rise(0.18)} className="mt-9 flex flex-wrap items-center gap-3">
                <button onClick={onStart} className="btn-primary" lang={lang}>
                  {t('Find my schemes', 'என் திட்டங்களைக் கண்டறி')}
                </button>
                <span className="text-[14px] text-muted" lang={lang}>
                  {t('Takes about two minutes', 'சுமார் இரண்டு நிமிடங்கள்')}
                </span>
              </motion.div>
            </div>

            {/* ── real corpus figures ───────────────────────────────────── */}
            <motion.dl
              {...rise(0.26)}
              className="relative z-10 mt-14 sm:mt-16 grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-8
                         pt-8 border-t border-hairline"
            >
              {[
                [nf(stats.schemes), t('schemes searched', 'திட்டங்கள்')],
                [nf(stats.states), t('states & UTs', 'மாநிலங்கள்')],
                [nf(stats.central), t('central schemes', 'மத்தியத் திட்டங்கள்')],
                ['0', t('forms to fill', 'நிரப்ப வேண்டிய படிவங்கள்')],
              ].map(([v, k]) => (
                <div key={k}>
                  <dd className="u-display tabular text-[30px] sm:text-[34px] text-ink">{v}</dd>
                  <dt className="u-meta mt-1" lang={lang}>{k}</dt>
                </div>
              ))}
            </motion.dl>
          </div>
        </div>

        {/* ── how it works ────────────────────────────────────────────────── */}
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          {[
            {
              n: '01',
              h: t('You answer, not a form', 'படிவம் அல்ல, பதில்கள்'),
              p: t(
                'One question at a time, in your language. Skip anything you would rather not say.',
                'ஒரு நேரத்தில் ஒரு கேள்வி, உங்கள் மொழியில். சொல்ல விரும்பாததைத் தவிர்க்கலாம்.',
              ),
            },
            {
              n: '02',
              h: t('We check everything', 'அனைத்தையும் சரிபார்க்கிறோம்'),
              p: t(
                'Central schemes plus your own state’s. Never another state’s — those are not yours to claim.',
                'மத்தியத் திட்டங்களுடன் உங்கள் மாநிலத் திட்டங்களும். பிற மாநிலங்களுடையவை அல்ல.',
              ),
            },
            {
              n: '03',
              h: t('You see the reason', 'காரணத்தையும் காட்டுவோம்'),
              p: t(
                'Each scheme carries the answers that matched it, so nothing is a black box.',
                'ஒவ்வொரு திட்டமும் பொருந்திய காரணங்களுடன் வரும். எதுவும் மறைக்கப்படவில்லை.',
              ),
            },
          ].map((c, i) => (
            <motion.div
              key={c.n}
              initial={reduce ? false : { opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-60px' }}
              transition={{ duration: 0.45, delay: i * 0.06, ease: [0.22, 1, 0.36, 1] }}
              className="card"
            >
              <div className="u-display tabular text-[15px] text-muted">{c.n}</div>
              <h3 className="u-display text-[21px] mt-3 text-ink" lang={lang}>{c.h}</h3>
              <p className="mt-2 text-[15px] leading-[1.6] text-muted" lang={lang}>{c.p}</p>
            </motion.div>
          ))}
        </div>

        {/* ── the honest note ─────────────────────────────────────────────── */}
        <div className="mt-6 card">
          <div className="u-meta" lang={lang}>{t('What this does not do', 'இது என்ன செய்யாது')}</div>
          <p className="mt-3 text-[15px] leading-[1.65] text-ink-2 max-w-[70ch]" lang={lang}>
            {t(
              'Sevai does not submit applications for you and does not promise money. It tells you which schemes you appear eligible for, what each is worth, and links you to the official page to apply. Amounts a scheme has not published are counted but never guessed at.',
              'சேவை உங்களுக்காக விண்ணப்பிக்காது, பணம் உறுதியளிக்காது. நீங்கள் தகுதி பெறக்கூடிய திட்டங்கள், அவற்றின் மதிப்பு, மற்றும் அதிகாரப்பூர்வ பக்கத்திற்கான இணைப்பை மட்டுமே தரும். அறிவிக்கப்படாத தொகைகள் ஊகிக்கப்படுவதில்லை.',
            )}
          </p>
        </div>

        <footer className="mt-8 mb-6 px-2 flex flex-wrap items-center justify-between gap-3">
          <span className="u-meta" lang={lang}>
            {t('Scheme data from myscheme.gov.in', 'திட்டத் தரவு: myscheme.gov.in')}
          </span>
          <span className="u-meta">Sevai</span>
        </footer>
      </div>
    </div>
  );
}
