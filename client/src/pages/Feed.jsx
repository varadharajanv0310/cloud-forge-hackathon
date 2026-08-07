import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { useVault } from '../hooks/useVault.js';
import { useEligibility } from '../hooks/useEligibility.js';
import { useLanguage } from '../hooks/useLanguage.js';
import SchemeCard from '../components/SchemeCard.jsx';
import FuzzyMatchCard from '../components/FuzzyMatchCard.jsx';
import { formatTotals, formatMatchSummary, categoryEmoji } from '../utils/formatters.js';
import { getRelevantAlerts, requestNotificationPermission } from '../utils/alertEngine.js';

/**
 * Feed — the screen a citizen lands on after onboarding.
 *
 * Three things this screen must not do, and how it avoids them:
 *
 *  1. NO GRAND TOTAL. v1 printed one summed rupee figure built from a Rs 50,000
 *     placeholder per unparseable scheme, and labelled it "per year". Money is
 *     now rendered as formatTotals() rows: annual cash carries the display face,
 *     one-time cash sits apart and smaller, credit lives in its own well in text
 *     face with a return glyph, and schemes whose amount is unpublished are
 *     *counted* in a footnote and never valued. Nothing is added together, and
 *     no `+` or `=` appears anywhere on this surface.
 *
 *  2. NO OVERSTATED MATCH COUNT. Most of the corpus carries no eligibility
 *     restrictions at all, so a bare "390 matches" reads as far more personal
 *     than it is. formatMatchSummary() splits it honestly.
 *
 *  3. NO PHONE BOOK. A citizen can match several hundred schemes out of 4,600+.
 *     The list is windowed at 30 with an explicit "show more", and can be
 *     narrowed by category, so the first screen is a shortlist rather than a
 *     scroll with no end.
 */

const PAGE = 30;

const CATEGORY_LABELS = {
  farming:    { en: 'Farming',    ta: 'விவசாயம்'     },
  education:  { en: 'Education',  ta: 'கல்வி'         },
  health:     { en: 'Health',     ta: 'சுகாதாரம்'     },
  housing:    { en: 'Housing',    ta: 'வீட்டுவசதி'    },
  women:      { en: 'Women',      ta: 'மகளிர்'        },
  employment: { en: 'Employment', ta: 'வேலைவாய்ப்பு'  },
  business:   { en: 'Business',   ta: 'வணிகம்'        },
  elderly:    { en: 'Elderly',    ta: 'முதியோர்'      },
  disability: { en: 'Disability', ta: 'மாற்றுத்திறன்' },
  welfare:    { en: 'Welfare',    ta: 'நலன்'          },
  sports:     { en: 'Sports',     ta: 'விளையாட்டு'    },
};

const catLabel = (cat, lang) => {
  const l = CATEGORY_LABELS[cat];
  if (!l) return cat || '';
  return lang === 'ta' ? l.ta : l.en;
};

export default function Feed({ onAlertsChange }) {
  const { vault } = useVault();
  const { lang, setLang } = useLanguage();
  const { confirmed, fuzzy, totals, topCategory, loading, error } = useEligibility(vault);
  const reduce = useReducedMotion();

  const ta = lang === 'ta';
  const t = (en, taStr) => (ta ? taStr : en);

  const [category, setCategory] = useState(null);   // null = all
  const [shown, setShown] = useState(PAGE);
  const [alerts, setAlerts] = useState([]);
  const [alertDismissed, setAlertDismissed] = useState(false);
  const schemeRefs = useRef({});

  // Alerts run over the schemes this citizen actually matched. getRelevantAlerts
  // re-applies hardFilter, so this is the same set it would find over the whole
  // corpus — at a fraction of the work — and it only fires once the shards have
  // landed. Schemes without a deadline simply produce no expiry alert; myScheme
  // publishes a close date on about five of them.
  useEffect(() => {
    if (!vault || loading) return;
    const lastChecked = new Date(vault.alerts_last_checked || 0);
    const found = getRelevantAlerts(confirmed.map((c) => c.scheme), vault, lastChecked);
    setAlerts(found);
    onAlertsChange?.(found.length);
    if (found.length > 0) requestNotificationPermission();
  }, [loading, vault, confirmed]);

  // Categories present in this citizen's own matches, most common first.
  const categories = useMemo(() => {
    const counts = new Map();
    for (const { scheme } of confirmed) {
      if (!scheme.category) continue;
      counts.set(scheme.category, (counts.get(scheme.category) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [confirmed]);

  const filtered = useMemo(
    () => (category ? confirmed.filter((c) => c.scheme.category === category) : confirmed),
    [confirmed, category],
  );

  const visible = filtered.slice(0, shown);
  const remaining = filtered.length - visible.length;

  const rows = formatTotals(totals, lang);
  const cashRows = rows.filter((r) => r.tone === 'cash');
  const loanRow = rows.find((r) => r.key === 'loan');
  const unvaluedRow = rows.find((r) => r.key === 'unvalued');

  const expiring = alerts.filter((a) => a.type === 'expiring');
  const greeting = vault?.name
    ? t(`Hello, ${vault.name}`, `வணக்கம், ${vault.name}`)
    : t('Hello', 'வணக்கம்');

  const rise = (delay = 0) => ({
    initial: reduce ? false : { opacity: 0, y: 14 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.32, delay, ease: [0.22, 1, 0.36, 1] },
  });

  return (
    <div className="min-h-[100dvh] w-full bg-canvas relative overflow-x-hidden pb-28">
      <div className="bloom bloom-cool bloom-quiet" aria-hidden="true" />

      <div className="relative z-10 mx-auto w-full max-w-[1120px] px-4 sm:px-6 py-4 sm:py-6">
        {/* ── nav ───────────────────────────────────────────────────────────── */}
        <header className="flex items-center justify-between mb-5 px-2">
          <div className="u-display text-[19px] tracking-[-0.02em]">Sevai</div>
          <button
            onClick={() => setLang(ta ? 'en' : 'ta')}
            className="btn-ghost compact text-[14px]"
            lang={ta ? 'en' : 'ta'}
          >
            {ta ? 'English' : 'தமிழ்'}
          </button>
        </header>

        {/* ── the one surface: who you are, and what was found ──────────────── */}
        <div className="surface-tray">
          <div className="surface-plate relative overflow-hidden px-6 sm:px-10 lg:px-12 py-9 sm:py-12">
            <div className="bloom bloom-warm bloom-quiet" aria-hidden="true" />

            <div className="relative z-10">
              {vault?.state && (
                <motion.div {...rise(0)}>
                  <span className="u-meta" lang={lang}>{vault.state}</span>
                </motion.div>
              )}

              <motion.h1
                {...rise(0.04)}
                lang={lang}
                className="u-display text-q sm:text-q-md mt-3 text-ink"
              >
                {greeting}
              </motion.h1>

              {/* The honest framing. Not "390 matches". */}
              <motion.p
                {...rise(0.1)}
                lang={lang}
                className="mt-4 text-[15px] sm:text-body leading-[1.6] text-ink-2 max-w-[56ch]"
              >
                {loading
                  ? t('Checking every central and state scheme you could claim…',
                       'நீங்கள் பெறக்கூடிய அனைத்து மத்திய, மாநிலத் திட்டங்களையும் சரிபார்க்கிறோம்…')
                  : confirmed.length === 0
                    ? t('Nothing has matched your answers yet.',
                         'உங்கள் பதில்களுக்கு இதுவரை எதுவும் பொருந்தவில்லை.')
                    : formatMatchSummary(totals, lang)}
              </motion.p>

              {/* ── money ────────────────────────────────────────────────────
                  Each kind gets its own row and its own grammar. Cash is the
                  only kind allowed the display face; credit is text face, muted
                  and contained; an unpublished amount never renders a numeral. */}
              {!loading && (cashRows.length > 0 || loanRow || unvaluedRow) && (
                <motion.div {...rise(0.16)} className="mt-9 pt-8 border-t border-hairline">
                  {cashRows.map((r) => (
                    <div key={r.key} className={r.emphasis ? '' : 'mt-7'}>
                      <div
                        className={`u-display tabular text-ink ${
                          r.emphasis ? 'text-[40px] sm:text-[52px]' : 'text-[26px] sm:text-[30px]'
                        }`}
                      >
                        {r.value}
                      </div>
                      <div className="u-meta mt-2" lang={lang}>{r.label}</div>
                    </div>
                  ))}

                  {loanRow && (
                    <div className="well mt-7 px-4 py-3 flex items-center justify-between gap-4">
                      <span className="text-[13px] leading-[1.5] text-muted" lang={lang}>
                        <span aria-hidden="true">↩ </span>{loanRow.label}
                      </span>
                      <span className="tabular text-[15px] font-medium text-muted shrink-0">
                        {loanRow.value}
                      </span>
                    </div>
                  )}

                  {unvaluedRow && (
                    <p className="mt-5 text-[13px] leading-[1.5] text-muted" lang={lang}>
                      {unvaluedRow.label}
                    </p>
                  )}

                  {cashRows.length === 0 && !loanRow && (
                    <p className="text-[15px] leading-[1.6] text-muted max-w-[56ch]" lang={lang}>
                      {t(
                        'None of your matches publish an amount. We will not guess at one — open a scheme to see what it offers.',
                        'உங்கள் திட்டங்கள் எதுவும் தொகையை அறிவிக்கவில்லை. நாங்கள் ஊகிக்க மாட்டோம் — திட்டத்தைத் திறந்து பாருங்கள்.',
                      )}
                    </p>
                  )}
                </motion.div>
              )}

              {/* Where this citizen's entitlements are concentrated. */}
              {!loading && topCategory && confirmed.length > 0 && (
                <motion.div {...rise(0.22)} className="mt-7">
                  <span className="chip" lang={lang}>
                    <span aria-hidden="true">{categoryEmoji(topCategory)}</span>
                    {t(
                      `Most of yours are in ${catLabel(topCategory, 'en')}`,
                      `உங்கள் திட்டங்களில் பெரும்பாலானவை ${catLabel(topCategory, 'ta')} துறையில்`,
                    )}
                  </span>
                </motion.div>
              )}
            </div>
          </div>
        </div>

        {/* ── alerts ───────────────────────────────────────────────────────── */}
        {alerts.length > 0 && !alertDismissed && (
          <motion.div
            initial={reduce ? false : { opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
            className="amber-banner mt-4 flex items-start gap-3"
          >
            <div className="flex-1 min-w-0" lang={lang}>
              <span className="font-semibold">
                {expiring.length > 0
                  ? t(
                      `${expiring.length} scheme${expiring.length > 1 ? 's' : ''} closing soon`,
                      `${expiring.length} திட்டம் விரைவில் முடிவடைகிறது`,
                    )
                  : t(
                      `${alerts.length} new scheme${alerts.length > 1 ? 's' : ''} for you`,
                      `உங்களுக்கு ${alerts.length} புதிய திட்டம்`,
                    )}
              </span>
              {' — '}
              <button
                className="compact !min-h-0 underline font-semibold"
                lang={lang}
                onClick={() => {
                  const firstId = alerts[0]?.scheme?.id;
                  const node = firstId && schemeRefs.current[firstId];
                  if (node) node.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
                }}
              >
                {t('take a look', 'பார்க்க')}
              </button>
            </div>
            <button
              className="compact !min-h-0 text-muted text-[15px] leading-none px-1"
              aria-label={t('Dismiss', 'மூடு')}
              onClick={() => { setAlertDismissed(true); onAlertsChange?.(0); }}
            >
              ✕
            </button>
          </motion.div>
        )}

        {/* ── shard failure ────────────────────────────────────────────────── */}
        {error && !loading && (
          <div className="card mt-4">
            <div className="u-meta" lang={lang}>{t('Could not load schemes', 'திட்டங்களை ஏற்ற முடியவில்லை')}</div>
            <p className="mt-2 text-[15px] leading-[1.6] text-muted" lang={lang}>
              {t(
                'The scheme list could not be reached. It will load again when you are back online.',
                'திட்டப் பட்டியலை அடைய முடியவில்லை. இணையம் திரும்பியதும் மீண்டும் ஏற்றப்படும்.',
              )}
            </p>
          </div>
        )}

        {/* ── category filter ──────────────────────────────────────────────── */}
        {!loading && categories.length > 1 && (
          <div className="mt-6 -mx-1 px-1 flex gap-2 overflow-x-auto hide-scrollbar py-1">
            <button
              onClick={() => { setCategory(null); setShown(PAGE); }}
              className={`chip compact !min-h-0 ${category === null ? 'chip-active' : ''}`}
              lang={lang}
            >
              {t('All', 'அனைத்தும்')}
              <span className="tabular opacity-60">{confirmed.length}</span>
            </button>
            {categories.map(([cat, n]) => (
              <button
                key={cat}
                onClick={() => { setCategory(cat === category ? null : cat); setShown(PAGE); }}
                className={`chip compact !min-h-0 ${category === cat ? 'chip-active' : ''}`}
                lang={lang}
              >
                <span aria-hidden="true">{categoryEmoji(cat)}</span>
                {catLabel(cat, lang)}
                <span className="tabular opacity-60">{n}</span>
              </button>
            ))}
          </div>
        )}

        {/* ── the schemes ──────────────────────────────────────────────────── */}
        <section className="mt-6">
          <h2 className="u-meta px-2" lang={lang}>
            {t('Schemes you appear eligible for', 'நீங்கள் தகுதி பெறும் திட்டங்கள்')}
          </h2>

          {loading ? (
            <div className="mt-3 space-y-3" aria-busy="true">
              {[0, 1, 2].map((i) => (
                <div key={i} className="card">
                  <div className="h-[11px] w-24 rounded-full bg-surface-sub" />
                  <div className="mt-4 h-[19px] w-3/4 rounded-full bg-surface-sub" />
                  <div className="mt-3 h-[19px] w-1/2 rounded-full bg-surface-sub" />
                  <div className="mt-6 h-[30px] w-40 rounded-full bg-surface-sub" />
                </div>
              ))}
              <p className="sr-only" lang={lang}>{t('Loading schemes', 'ஏற்றப்படுகிறது')}</p>
            </div>
          ) : (
            <>
              {filtered.length === 0 && (
                <div className="card mt-3">
                  <p className="text-[15px] leading-[1.6] text-ink-2 max-w-[56ch]" lang={lang}>
                    {confirmed.length === 0
                      ? t(
                          'No scheme matched your answers yet. Adding a detail you skipped in onboarding often opens several up.',
                          'உங்கள் பதில்களுக்கு இதுவரை எந்தத் திட்டமும் பொருந்தவில்லை. தவிர்த்த ஒரு கேள்விக்குப் பதிலளித்தால் பல திட்டங்கள் திறக்கலாம்.',
                        )
                      : t('No schemes in this category.', 'இந்தப் பிரிவில் திட்டங்கள் இல்லை.')}
                  </p>
                </div>
              )}

              <div className="mt-3 space-y-3">
                {visible.map(({ scheme }) => (
                  <div key={scheme.id} ref={(el) => { schemeRefs.current[scheme.id] = el; }}>
                    <SchemeCard scheme={scheme} vault={vault} lang={lang} />
                  </div>
                ))}
              </div>

              {/* Windowing. 4,600+ schemes in the corpus; a citizen can match
                  several hundred, and no one scrolls a phone book. */}
              {remaining > 0 && (
                <div className="mt-6 flex flex-col items-center gap-2">
                  <button
                    onClick={() => setShown((s) => s + PAGE)}
                    className="btn-secondary"
                    lang={lang}
                  >
                    {t('Show more', 'மேலும் காட்டு')}
                  </button>
                  <span className="u-meta" lang={lang}>
                    {t(
                      `${visible.length} of ${filtered.length} shown`,
                      `${filtered.length} இல் ${visible.length} காட்டப்படுகிறது`,
                    )}
                  </span>
                </div>
              )}
            </>
          )}
        </section>

        {/* ── near misses ──────────────────────────────────────────────────── */}
        {!loading && fuzzy.length > 0 && (
          <section className="mt-10">
            <h2 className="u-meta px-2" lang={lang}>
              {t('You might also qualify', 'நீங்களும் தகுதியடையலாம்')}
            </h2>
            <p className="mt-2 px-2 text-[14px] leading-[1.6] text-muted max-w-[56ch]" lang={lang}>
              {t(
                'These did not match outright, but only just. Each one says what stood in the way.',
                'இவை முழுமையாகப் பொருந்தவில்லை, ஆனால் சற்றே தவறியவை. எது தடையாக இருந்தது என்பதை ஒவ்வொன்றும் சொல்கிறது.',
              )}
            </p>
            <div className="mt-3 space-y-3">
              {fuzzy.map(({ scheme, fuzzy: f }) => (
                <FuzzyMatchCard key={scheme.id} entry={{ scheme, fuzzy: f }} vault={vault} lang={lang} />
              ))}
            </div>
          </section>
        )}

        <footer className="mt-10 px-2">
          <span className="u-meta" lang={lang}>
            {t('Scheme data from myscheme.gov.in', 'திட்டத் தரவு: myscheme.gov.in')}
          </span>
        </footer>
      </div>
    </div>
  );
}
