import { useEffect, useMemo, useRef, useState } from 'react';
import { useVault } from '../hooks/useVault.js';
import { useEligibility } from '../hooks/useEligibility.js';
import { useLanguage } from '../hooks/useLanguage.js';
import { useSchemes } from '../utils/schemesStore.js';
import SchemeCard from '../components/SchemeCard.jsx';
import FuzzyMatchCard from '../components/FuzzyMatchCard.jsx';
import { formatRupees } from '../utils/formatters.js';
import { getRelevantAlerts, requestNotificationPermission } from '../utils/alertEngine.js';
import LangToggle from '../components/LangToggle.jsx';

/**
 * Feed — ported from the Claude Design source (Sevai.dc.html: the mobile feed,
 * lines 1260-1383, and the desktop feed, lines 251-367). One layout: the mobile
 * arrangement below `lg`, the desktop arrangement above it.
 *
 * Four things this screen must not do, and how it avoids them:
 *
 *  1. NO GRAND TOTAL, EVER. The money summary is a panel of columns, one per
 *     kind of help, separated by hairline rules — cash per year, one-time,
 *     insurance cover, subsidy. Credit sits OUTSIDE that panel in a dashed box
 *     with its figure in the mono face, so it cannot be read as part of the
 *     money beside it. No `+` and no `=` appears on this surface, and the
 *     footnote says outright that the kinds are not added together.
 *
 *  2. NO OVERSTATED MATCH COUNT. Most of the corpus carries no eligibility
 *     restrictions at all, so a bare "301 matches" reads as far more personal
 *     than it is. The sentence splits it: written for someone like you, versus
 *     open to every citizen.
 *
 *  3. NO INVENTED FIGURE. Schemes that have not published an amount are
 *     *counted* in the footnote and never valued.
 *
 *  4. NO PHONE BOOK. A citizen can match several hundred schemes. The list is
 *     windowed at 30 behind an explicit "show more" and can be narrowed by
 *     category, with the counts read from this citizen's own matches.
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

const nf = (n) => Number(n || 0).toLocaleString('en-IN');

function greetings() {
  const h = new Date().getHours();
  if (h < 12) return { en: 'Good morning', ta: 'காலை வணக்கம்' };
  if (h < 17) return { en: 'Good afternoon', ta: 'மதிய வணக்கம்' };
  return { en: 'Good evening', ta: 'மாலை வணக்கம்' };
}

/* Tailwind cannot see a class built at runtime, so the column counts are
   written out literally here. */
const COL_CLASS = {
  1: 'grid-cols-1',
  2: 'grid-cols-2',
  3: 'grid-cols-3',
  4: 'grid-cols-2 lg:grid-cols-4',
};

export default function Feed({ onAlertsChange }) {
  const { vault } = useVault();
  const { lang, setLang } = useLanguage();
  const { confirmed, fuzzy, totals, loading, error } = useEligibility(vault);
  const { schemes } = useSchemes(vault?.state);

  const ta = lang === 'ta';
  const t = (en, taStr) => (ta ? taStr : en);

  const [category, setCategory] = useState(null); // null = all
  const [shown, setShown] = useState(PAGE);
  const [alerts, setAlerts] = useState([]);
  const [alertDismissed, setAlertDismissed] = useState(false);
  const schemeRefs = useRef({});

  // Alerts run over the schemes this citizen actually matched, once the shards
  // have landed. Schemes without a deadline simply produce no expiry alert;
  // myScheme publishes a close date on four of them.
  useEffect(() => {
    if (!vault || loading) return;
    const lastChecked = new Date(vault.alerts_last_checked || 0);
    const found = getRelevantAlerts(confirmed.map((c) => c.scheme), vault, lastChecked);
    setAlerts(found);
    onAlertsChange?.(found.length);
    if (found.length > 0) requestNotificationPermission();
  }, [loading, vault, confirmed]);

  // Categories present in this citizen's OWN matches, most common first.
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

  const featured = filtered[0]?.scheme || null;
  const rest = filtered.slice(1, shown);
  const remaining = Math.max(0, filtered.length - 1 - rest.length);

  const tot = totals || {};
  const checked = schemes?.length || 0;

  // One column per kind of help. Nothing here is ever summed across columns.
  // `short` is the phone label. On a 390px screen a two-line eyebrow drops its
  // own figure below the neighbouring ones, and three money figures that do not
  // share a baseline read as a ranking rather than as three separate kinds.
  const columns = [];
  if (tot.focusCashAnnual > 0) {
    columns.push({
      key: 'annual',
      en: 'Cash · every year',
      short: 'Cash / year',
      taLabel: 'ஆண்டுக்கு பணம்',
      value: formatRupees(tot.focusCashAnnual),
      cls: 'tabular figure-sm text-[21px] lg:text-[36px]',
      note: `From your ${tot.focusCount || 0} strongest matches. Paid while you stay eligible.`,
    });
  }
  if (tot.focusCashOneTime > 0) {
    columns.push({
      key: 'onetime',
      en: 'One-time',
      taLabel: 'ஒரு முறை',
      value: formatRupees(tot.focusCashOneTime),
      cls: 'tabular text-[21px] lg:text-[29px] font-bold tracking-[-.038em] leading-[1.1]',
      guard: 'NOT A YEARLY AMOUNT',
    });
  }
  if (tot.insuranceCover > 0) {
    columns.push({
      key: 'cover',
      en: 'Insurance cover',
      short: 'Cover',
      taLabel: 'காப்பீட்டுத் தொகை',
      value: formatRupees(tot.insuranceCover),
      cls: 'tabular text-[21px] lg:text-[26px] font-medium tracking-[-.03em] leading-[1.15] text-ink-80',
      tint: true,
      note: 'Paid only on a claim. Not money in hand.',
    });
  }
  if (tot.subsidyTotal > 0) {
    columns.push({
      key: 'subsidy',
      en: 'Subsidy',
      taLabel: 'மானியம்',
      value: formatRupees(tot.subsidyTotal),
      cls: 'tabular text-[21px] lg:text-[26px] font-semibold tracking-[-.03em] leading-[1.15] text-ink-80',
      note: 'A discount on what you would otherwise pay. You still pay the rest.',
    });
  }
  const hasLoan = (tot.loanCeiling || 0) > 0;
  const hasMoney = columns.length > 0 || hasLoan;

  const greet = greetings();
  const greetLine = vault?.name ? `${greet.en}, ${vault.name}` : greet.en;
  const taGreet = vault?.state ? `${greet.ta} · ${vault.state}` : greet.ta;
  const expiring = alerts.filter((a) => a.type === 'expiring');

  return (
    <div className="relative min-h-[100dvh] overflow-x-hidden pb-24">
      <div className="bloom bloom-header" aria-hidden="true" />

      <div className="relative mx-auto w-full max-w-[1180px] px-5 lg:px-11 pt-[18px] lg:pt-[38px] pb-6 lg:pb-[52px]">
        {/* ── greeting ─────────────────────────────────────────────────────── */}
        <div className="flex items-start lg:items-end justify-between gap-4 lg:gap-[30px] flex-wrap">
          <div>
            {/* Sized in place rather than with `.title-2`: the greeting steps
                down on a phone, and the display roles are fixed sizes. */}
            <h1 className="m-0 text-[23px] lg:text-[34px] font-bold tracking-[-.035em] leading-[1.1]">
              {greetLine}
            </h1>
            <div className="ta text-[14px] lg:text-[17px] text-ink-60 mt-1.5" lang="ta">
              {taGreet}
            </div>
          </div>

          <div className="flex flex-col items-end gap-3 shrink-0">
            {/* The desktop chrome carries its own language switch; this one is
                the phone's, and only the phone's. */}
            <LangToggle size="sm" className="bg-white/70" />

            {!loading && checked > 0 && (
              <div className="hidden lg:block mono text-[10.5px] tracking-[.12em] text-ink-40 text-right leading-[1.8]">
                <span className="tabular">{nf(checked)}</span> schemes checked
                <br />
                <span className="tabular">{nf(tot.targetedCount || 0)}</span> for someone like you
              </div>
            )}
          </div>
        </div>

        {/* ── the honest framing of what a match means ─────────────────────── */}
        <p className="mt-4 mb-0 text-[15px] lg:text-[17px] leading-[1.6] text-ink-90 max-w-[70ch]">
          {loading ? (
            t(
              'Checking every central scheme and every scheme in your state…',
              'மத்திய மற்றும் உங்கள் மாநிலத் திட்டங்கள் அனைத்தையும் சரிபார்க்கிறோம்…',
            )
          ) : confirmed.length === 0 ? (
            t(
              'Nothing has matched your answers yet.',
              'உங்கள் பதில்களுக்கு இதுவரை எதுவும் பொருந்தவில்லை.',
            )
          ) : (
            <>
              You match <strong className="font-bold tabular">{nf(confirmed.length)} schemes</strong>
              {' — '}
              <span className="tabular">{nf(tot.targetedCount || 0)}</span> written for someone like
              you, and <span className="tabular">{nf(tot.openCount || 0)}</span> open to every
              citizen. Each one below shows the answers that caused the match.
            </>
          )}
        </p>
        {!loading && confirmed.length > 0 && (
          <div className="ta text-[13px] lg:text-[14.5px] text-ink-45 mt-1.5 max-w-[60ch]" lang="ta">
            {nf(tot.targetedCount || 0)} திட்டங்கள் உங்களைப் போன்றவர்களுக்கானவை ·{' '}
            {nf(tot.openCount || 0)} அனைவருக்கும் திறந்தவை
          </div>
        )}

        {/* ── money, one column per kind — never a combined total ──────────── */}
        {!loading && hasMoney && (
          <div
            className={`mt-4 lg:mt-7 grid gap-2 lg:gap-[22px] items-stretch ${
              hasLoan && columns.length > 0
                ? 'lg:grid-cols-[minmax(0,2.1fr)_minmax(0,1fr)]'
                : ''
            }`}
          >
            {columns.length > 0 && (
              <div className="panel overflow-hidden">
                <div className={`grid ${COL_CLASS[columns.length] || 'grid-cols-3'} -mt-px -ml-px`}>
                  {columns.map((c) => (
                    <div
                      key={c.key}
                      className={`border-t border-l border-rule-10 px-3 py-3.5 lg:px-[22px] lg:py-5 ${
                        c.tint ? 'bg-[rgba(132,212,221,0.13)]' : ''
                      }`}
                    >
                      <div
                        className={`mono text-[9px] lg:text-[10px] tracking-[.11em] lg:tracking-[.12em] ${
                          c.tint ? 'text-ink-80' : 'text-ink'
                        }`}
                      >
                        <span className="lg:hidden">{c.short || c.en}</span>
                        <span className="hidden lg:inline">{c.en}</span>
                      </div>
                      <div className={`${c.cls} mt-1.5 lg:mt-2`}>{c.value}</div>
                      <div className="ta text-[11px] text-ink-30 mt-1 hidden lg:block" lang="ta">
                        {c.taLabel}
                      </div>
                      {c.guard && (
                        <div className="mono text-[9.5px] tracking-[.08em] text-ink-30 mt-2 hidden lg:block">
                          {c.guard}
                        </div>
                      )}
                      {c.note && (
                        <div className="text-[13px] leading-[1.5] text-ink-60 mt-1.5 hidden lg:block">
                          {c.note}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Credit is outside the panel, dashed, and its figure is set in the
                MONO face — typographically incapable of reading as cash. */}
            {hasLoan && (
              <div className="border border-dashed border-[rgba(20,20,26,0.32)] rounded-[6px] px-3 py-3 lg:px-[22px] lg:py-5 flex items-center lg:flex-col lg:items-start lg:justify-center justify-between gap-3">
                <div>
                  <div className="mono text-[9px] lg:text-[10px] tracking-[.11em] lg:tracking-[.12em] text-ink-45">
                    Credit available — to be repaid
                  </div>
                  <div className="ta text-[11.5px] lg:text-[12px] text-ink-25 mt-0.5 lg:mt-1" lang="ta">
                    வருமானம் அல்ல
                  </div>
                </div>
                <div className="mono tabular normal-case font-normal text-ink-45 text-[18px] lg:text-[27px] tracking-[-.02em] shrink-0 lg:mt-2">
                  {formatRupees(tot.loanCeiling)}
                </div>
                <div className="mono text-[9.5px] tracking-[.09em] text-ink-25 mt-2 hidden lg:block">
                  To be repaid — not income
                </div>
              </div>
            )}
          </div>
        )}

        {!loading && hasMoney && (
          <div className="text-[12px] lg:text-[13px] leading-[1.55] lg:leading-[1.6] text-ink-30 mt-2 lg:mt-3">
            These are different kinds of help and are never added together.
            {(tot.unvaluedCount || 0) > 0 && (
              <>
                {' '}
                <span className="tabular">{nf(tot.unvaluedCount)}</span> more matched schemes have
                not published an amount.
              </>
            )}
            <span className="ta block text-ink-25 mt-0.5" lang="ta">
              இவை ஒன்றாகக் கூட்டப்படுவதில்லை
            </span>
          </div>
        )}

        {!loading && !hasMoney && confirmed.length > 0 && (
          <p className="mt-4 mb-0 text-[14px] leading-[1.6] text-ink-45 max-w-[60ch]">
            {t(
              'None of your matches publish an amount. We will not guess at one — open a scheme to see what it offers.',
              'உங்கள் திட்டங்கள் எதுவும் தொகையை அறிவிக்கவில்லை. நாங்கள் ஊகிக்க மாட்டோம் — திட்டத்தைத் திறந்து பாருங்கள்.',
            )}
          </p>
        )}

        {/* ── alerts ───────────────────────────────────────────────────────── */}
        {alerts.length > 0 && !alertDismissed && (
          <div className="sahayak mt-4 px-4 py-3 flex items-start gap-3">
            <div className="flex-1 min-w-0 text-[14px] leading-[1.55]" lang={lang}>
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
                className="underline font-semibold"
                lang={lang}
                onClick={() => {
                  const firstId = alerts[0]?.scheme?.id;
                  const node = firstId && schemeRefs.current[firstId];
                  if (node) node.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }}
              >
                {t('take a look', 'பார்க்க')}
              </button>
            </div>
            <button
              className="text-[15px] leading-none px-1"
              aria-label={t('Dismiss', 'மூடு')}
              onClick={() => { setAlertDismissed(true); onAlertsChange?.(0); }}
            >
              ✕
            </button>
          </div>
        )}

        {/* ── the shards did not arrive ────────────────────────────────────── */}
        {error && !loading && (
          <div className="panel mt-4 p-4 lg:p-5">
            <div className="mono text-[10px] tracking-[.13em] text-ink-55">
              Scheme list unavailable
            </div>
            <p className="mt-2 mb-0 text-[14.5px] leading-[1.6] text-ink-60 max-w-[60ch]">
              {t(
                'The scheme list could not be reached. Your answers are safe on this phone — the list will load again when you are back online.',
                'திட்டப் பட்டியலை அடைய முடியவில்லை. உங்கள் பதில்கள் இந்த ஃபோனிலேயே பாதுகாப்பாக உள்ளன — இணையம் திரும்பியதும் மீண்டும் ஏற்றப்படும்.',
              )}
            </p>
          </div>
        )}

        {/* ── category filter, counted from this citizen's own matches ─────── */}
        {!loading && categories.length > 1 && (
          <div className="flex gap-[7px] overflow-x-auto hide-scrollbar lg:flex-wrap lg:overflow-visible mt-5 lg:mt-[30px] -mx-5 px-5 lg:mx-0 lg:px-0 pb-1 lg:pb-[26px] lg:rule-b">
            <button
              onClick={() => { setCategory(null); setShown(PAGE); }}
              className={`chip shrink-0 ${category === null ? 'bg-ink text-white border-ink' : ''}`}
              lang={lang}
            >
              {t('All', 'அனைத்தும்')}
              <span className="mono tabular text-[9.5px] tracking-[.08em] opacity-60">
                {confirmed.length}
              </span>
            </button>
            {categories.map(([cat, n]) => (
              <button
                key={cat}
                onClick={() => { setCategory(cat === category ? null : cat); setShown(PAGE); }}
                className={`chip shrink-0 ${category === cat ? 'bg-ink text-white border-ink' : ''}`}
                lang={lang}
              >
                <span className={ta ? 'ta' : ''}>{catLabel(cat, lang)}</span>
                <span className="mono tabular text-[9.5px] tracking-[.08em] opacity-60">{n}</span>
              </button>
            ))}
          </div>
        )}

        {/* ── loading ──────────────────────────────────────────────────────── */}
        {loading && (
          <div className="mt-6 grid gap-2.5 lg:gap-3.5 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="panel p-4 animate-svPulse">
                <div className="h-[11px] w-20 rounded-[2px] bg-rule-10" />
                <div className="mt-4 h-[15px] w-3/4 rounded-[2px] bg-rule-10" />
                <div className="mt-2 h-[15px] w-1/2 rounded-[2px] bg-rule-10" />
                <div className="mt-6 h-[26px] w-28 rounded-[2px] bg-rule-10" />
              </div>
            ))}
            <p className="sr-only" lang={lang}>{t('Loading schemes', 'ஏற்றப்படுகிறது')}</p>
          </div>
        )}

        {/* ── the strongest match ──────────────────────────────────────────── */}
        {!loading && featured && (
          <>
            <div className="flex items-baseline justify-between gap-3 mt-6 lg:mt-[30px] mb-2.5 lg:mb-3">
              <div>
                <div className="mono text-[10.5px] tracking-[.13em] text-ink-55">
                  Your strongest match
                </div>
                <div className="ta text-[12px] text-ink-30" lang="ta">சிறந்த பொருத்தம்</div>
              </div>
              <div className="mono tabular text-[10px] tracking-[.08em] text-ink-25 shrink-0">
                1 of {nf(filtered.length)}
              </div>
            </div>
            <div ref={(el) => { schemeRefs.current[featured.id] = el; }}>
              <SchemeCard scheme={featured} vault={vault} lang={lang} variant="featured" />
            </div>
          </>
        )}

        {/* ── the rest ─────────────────────────────────────────────────────── */}
        {!loading && (
          <>
            {filtered.length === 0 && (
              <div className="panel mt-6 p-4 lg:p-5">
                <p className="m-0 text-[15px] leading-[1.6] text-ink-90 max-w-[56ch]">
                  {confirmed.length === 0
                    ? t(
                        'No scheme matched your answers yet. Adding a detail you skipped in onboarding often opens several up.',
                        'உங்கள் பதில்களுக்கு இதுவரை எந்தத் திட்டமும் பொருந்தவில்லை. தவிர்த்த ஒரு கேள்விக்குப் பதிலளித்தால் பல திட்டங்கள் திறக்கலாம்.',
                      )
                    : t('No schemes in this category.', 'இந்தப் பிரிவில் திட்டங்கள் இல்லை.')}
                </p>
              </div>
            )}

            {rest.length > 0 && (
              <>
                <div className="flex items-baseline justify-between gap-3 mt-7 lg:mt-9 mb-2.5 lg:mb-3">
                  <div>
                    <div className="mono text-[10.5px] tracking-[.13em] text-ink-55">
                      {category ? `The rest in ${catLabel(category, 'en')}` : 'The rest of your matches'}
                    </div>
                    <div className="ta text-[12px] text-ink-30" lang="ta">மற்ற திட்டங்கள்</div>
                  </div>
                  <div className="mono text-[10px] tracking-[.09em] text-ink-25 text-right shrink-0 hidden sm:block">
                    Sorted by how well they fit you
                  </div>
                </div>

                <div className="grid gap-2.5 lg:gap-3.5 sm:grid-cols-2 xl:grid-cols-3">
                  {rest.map(({ scheme }) => (
                    <div
                      key={scheme.id}
                      ref={(el) => { schemeRefs.current[scheme.id] = el; }}
                      className="h-full"
                    >
                      <SchemeCard scheme={scheme} vault={vault} lang={lang} />
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* Windowing. A citizen can match several hundred schemes, and no one
                scrolls a phone book. */}
            {remaining > 0 && (
              <div className="mt-4 lg:mt-[22px] flex flex-col lg:flex-row lg:items-center gap-3 lg:gap-[18px]">
                <button
                  onClick={() => setShown((s) => s + PAGE)}
                  className="w-full lg:w-auto min-h-[52px] lg:px-[26px] rounded-[4px] border border-rule-20 flex flex-col items-center justify-center gap-px hover:border-ink hover:bg-white transition-colors"
                >
                  <span className="text-[15px] font-medium">
                    Show {Math.min(PAGE, remaining)} more
                  </span>
                  <span className="ta text-[11.5px] text-ink-30" lang="ta">மேலும் காட்டு</span>
                </button>
                <div className="text-[12px] lg:text-[13px] leading-[1.6] text-ink-30 text-center lg:text-left">
                  <span className="tabular">{rest.length + 1}</span> of{' '}
                  <span className="tabular">{nf(filtered.length)}</span> shown. Closed schemes stay
                  in the list, greyed out with the date they closed — never shown as if they were
                  open.
                </div>
              </div>
            )}
          </>
        )}

        {/* ── near misses ──────────────────────────────────────────────────── */}
        {!loading && fuzzy.length > 0 && (
          <section className="mt-10 lg:mt-14">
            <div className="mono text-[10.5px] tracking-[.13em] text-ink-55">
              You might also qualify
            </div>
            <div className="ta text-[12.5px] text-ink-30 mt-0.5" lang="ta">
              நீங்களும் தகுதியடையலாம்
            </div>
            <p className="mt-2 mb-0 text-[14px] leading-[1.6] text-ink-45 max-w-[60ch]">
              {t(
                'These did not match outright, but only just. Each one says what stood in the way.',
                'இவை முழுமையாகப் பொருந்தவில்லை, ஆனால் சற்றே தவறியவை. எது தடையாக இருந்தது என்பதை ஒவ்வொன்றும் சொல்கிறது.',
              )}
            </p>
            <div className="mt-3 grid gap-2.5 lg:gap-3.5 sm:grid-cols-2">
              {fuzzy.map(({ scheme, fuzzy: f }) => (
                <FuzzyMatchCard key={scheme.id} entry={{ scheme, fuzzy: f }} vault={vault} lang={lang} />
              ))}
            </div>
          </section>
        )}

        <footer className="mt-10 lg:mt-14 pt-5 rule-t flex justify-between items-center gap-4 flex-wrap mono text-[10px] tracking-[.1em] text-ink-30">
          <span>Sevai · Scheme data normalised from myscheme.gov.in</span>
          {checked > 0 && <span className="tabular">{nf(checked)} schemes checked for you</span>}
        </footer>
      </div>
    </div>
  );
}
