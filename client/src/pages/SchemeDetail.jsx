import { useParams, useNavigate } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { useSchemes, getSchemeById } from '../utils/schemesStore.js';
import { useVault } from '../hooks/useVault.js';
import { useLanguage } from '../hooks/useLanguage.js';
import { categoryEmoji, formatBenefit, benefitToneClass } from '../utils/formatters.js';
import { MatchReason } from '../components/Thread.jsx';
import SamjhaoButton from '../components/SamjhaoButton.jsx';
import DeadlineVisualizer from '../components/DeadlineVisualizer.jsx';
import CrossSchemeChain from '../components/CrossSchemeChain.jsx';

/**
 * SchemeDetail — the full picture of one scheme.
 *
 * Three things this screen exists to get right:
 *
 *  1. **Kinds are never addable.** Every benefit kind the scheme publishes gets
 *     its own labelled row and its own grammar. Only `benefit.cash` is set in
 *     the display face; a loan sits in an outlined well in muted text with a
 *     repayment glyph, a subsidy in a mint well, insurance in a sky well
 *     prefixed "if". No `+`, no `=`, no combined figure anywhere on the page.
 *  2. **The citizen can tell why it matched.** MatchReason sits directly under
 *     the name, above the money — before the number, not as a footnote.
 *  3. **Nothing is invented.** Sparse fields (documents, deadline, official
 *     portal, ministry) are either rendered from real data or explicitly named
 *     as unpublished. A scheme with no published amount renders no numeral.
 */

// ── data plumbing ───────────────────────────────────────────────────────────
// getSchemeById() is synchronous but only meaningful once a shard has resolved,
// so the fetch is driven by useSchemes() and the lookup is retried on each
// render. A scheme already in the module cache appears with no loading frame.
function useScheme(id, stateName) {
  const { loading, error } = useSchemes(stateName);
  return { scheme: getSchemeById(id), loading, error };
}

// myScheme prose arrives HTML-escaped ("&quot;PM Kisan&quot; is a …").
const decode = (s) =>
  String(s || '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, '’')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .trim();

const CATEGORY_LABEL = {
  farming:    { en: 'Farming',    ta: 'விவசாயம்' },
  education:  { en: 'Education',  ta: 'கல்வி' },
  housing:    { en: 'Housing',    ta: 'வீடு' },
  health:     { en: 'Health',     ta: 'உடல்நலம்' },
  women:      { en: 'Women',      ta: 'பெண்கள்' },
  employment: { en: 'Employment', ta: 'வேலைவாய்ப்பு' },
  business:   { en: 'Business',   ta: 'தொழில்' },
  elderly:    { en: 'Elderly',    ta: 'மூத்தோர்' },
  disability: { en: 'Disability', ta: 'மாற்றுத்திறனாளி' },
  welfare:    { en: 'Welfare',    ta: 'சமூக நலன்' },
  sports:     { en: 'Sports',     ta: 'விளையாட்டு' },
};

const MODE_LABEL = {
  Online:  { en: 'Apply online',  ta: 'இணையவழி' },
  Offline: { en: 'Apply offline', ta: 'நேரடியாக' },
};

const rupees = (n) => `₹${Number(n).toLocaleString('en-IN')}`;

// ── eligibility facts ───────────────────────────────────────────────────────
// Returns only the facts this scheme actually publishes. Nulls are skipped
// silently — an empty row would read as "no restriction" when it means
// "not recorded", and those are not the same claim.
function eligibilityFacts(scheme, lang) {
  const e = scheme.eligibility || {};
  const ta = lang === 'ta';
  const rows = [];
  const add = (label, value) => rows.push({ label, value });
  const list = (a) => (a || []).join(ta ? ', ' : ', ');

  if (e.min_age != null && e.max_age != null)
    add(ta ? 'வயது' : 'Age', `${e.min_age} – ${e.max_age}`);
  else if (e.min_age != null)
    add(ta ? 'வயது' : 'Age', ta ? `${e.min_age} மற்றும் அதற்கு மேல்` : `${e.min_age} and above`);
  else if (e.max_age != null)
    add(ta ? 'வயது' : 'Age', ta ? `${e.max_age} வயது வரை` : `Up to ${e.max_age}`);

  if (e.gender && e.gender !== 'any') {
    const g = { female: { en: 'Women only', ta: 'பெண்களுக்கு மட்டும்' },
                male: { en: 'Men only', ta: 'ஆண்களுக்கு மட்டும்' },
                transgender: { en: 'Transgender applicants', ta: 'திருநங்கையருக்கு' } }[e.gender];
    if (g) add(ta ? 'பாலினம்' : 'Gender', ta ? g.ta : g.en);
  }

  if ((e.caste_required || []).length)
    add(ta ? 'சமூகம்' : 'Community', list(e.caste_required));

  if (e.income_max_annual != null)
    add(
      ta ? 'ஆண்டு வருமான வரம்பு' : 'Household income',
      ta ? `${rupees(e.income_max_annual)} வரை` : `up to ${rupees(e.income_max_annual)} a year`,
    );

  if ((e.occupation_raw || []).length) add(ta ? 'தொழில்' : 'Occupation', list(e.occupation_raw));
  else if ((e.occupation || []).length) add(ta ? 'தொழில்' : 'Occupation', list(e.occupation));

  if (e.residence && e.residence !== 'any')
    add(ta ? 'வசிப்பிடம்' : 'Residence',
      e.residence === 'rural'
        ? (ta ? 'கிராமப்புறம்' : 'Rural areas')
        : (ta ? 'நகர்ப்புறம்' : 'Urban areas'));

  if (e.bpl_required)
    add(ta ? 'குடும்ப அட்டை' : 'Ration card',
      ta ? 'வறுமைக் கோட்டுக்குக் கீழ்' : 'Below Poverty Line households');

  if ((e.ration_card_required || []).length)
    add(ta ? 'குடும்ப அட்டை' : 'Ration card', list(e.ration_card_required).toUpperCase());

  if (e.disability_required)
    add(ta ? 'மாற்றுத்திறன்' : 'Disability',
      e.disability_min_pct != null
        ? (ta ? `${e.disability_min_pct}% அல்லது அதற்கு மேல்` : `${e.disability_min_pct}% or more`)
        : (ta ? 'தேவை' : 'Required'));

  if (e.minority_required)
    add(ta ? 'சிறுபான்மையினர்' : 'Minority', ta ? 'சிறுபான்மைச் சமூகம்' : 'Minority community');

  if (e.student_required) {
    const lv = (e.student_levels || []).length
      ? list(e.student_levels).replace(/_/g, ' ')
      : (ta ? 'மாணவர்' : 'Students');
    add(ta ? 'படிப்பு' : 'Studying', lv);
  }
  if (e.marks_min_pct != null)
    add(ta ? 'மதிப்பெண்' : 'Marks',
      ta ? `${e.marks_min_pct}% அல்லது அதற்கு மேல்` : `${e.marks_min_pct}% or more`);
  if (e.institution_type)
    add(ta ? 'கல்வி நிறுவனம்' : 'Institution', e.institution_type);

  if ((e.land_tenure || []).length)
    add(ta ? 'நில உரிமை' : 'Land', list(e.land_tenure));
  if (e.land_max_acres != null)
    add(ta ? 'நில அளவு' : 'Land size',
      ta ? `${e.land_max_acres} ஏக்கர் வரை` : `up to ${e.land_max_acres} acres`);
  if (e.livestock_required)
    add(ta ? 'கால்நடை' : 'Livestock', ta ? 'கால்நடை வளர்ப்பவர்' : 'Keeps livestock');
  if (e.fisher_required)
    add(ta ? 'மீன்பிடி' : 'Fishing', ta ? 'மீனவர்' : 'Fishing households');

  if (e.welfare_board_required)
    add(ta ? 'நல வாரியம்' : 'Welfare board',
      ta ? 'வாரியப் பதிவு தேவை' : 'Board registration required');
  if (e.unemployed_required || (e.employment_status || []).includes('unemployed'))
    add(ta ? 'வேலைநிலை' : 'Employment', ta ? 'வேலையில்லாதவர்' : 'Unemployed');
  if ((e.marital_status || []).length)
    add(ta ? 'திருமண நிலை' : 'Marital status', list(e.marital_status));
  if (e.pension_excluded)
    add(ta ? 'ஓய்வூதியம்' : 'Pension',
      ta ? 'ஓய்வூதியம் பெறுபவர்கள் அல்ல' : 'Not for pension recipients');
  if (e.chronic_illness_required)
    add(ta ? 'நோய் நிலை' : 'Health', ta ? 'நீண்டகால நோய்' : 'Long-term illness');
  if (e.housing_status_required)
    add(ta ? 'வீட்டு நிலை' : 'Housing', String(e.housing_status_required).replace(/_/g, ' '));
  if (e.maternity_required)
    add(ta ? 'தாய்மை' : 'Maternity', String(e.maternity_required).replace(/_/g, ' '));
  if (e.first_child_only)
    add(ta ? 'குழந்தை' : 'Child', ta ? 'முதல் குழந்தைக்கு மட்டும்' : 'First child only');

  if (scheme.beneficiary_type && scheme.beneficiary_type !== 'individual')
    add(ta ? 'யாருக்கு' : 'Applies to',
      scheme.beneficiary_type === 'family'
        ? (ta ? 'குடும்பம்' : 'The household')
        : (ta ? 'நிறுவனம்' : 'Institutions'));

  return rows;
}

// ── one benefit kind, one row ───────────────────────────────────────────────
/** A non-cash kind. Text face, muted, in its own container — never summable. */
function KindRow({ meta, body, figure, tone, tint, lang }) {
  return (
    <div
      className="well px-5 py-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1"
      style={tint ? { background: tint } : undefined}
    >
      <div className="min-w-0">
        <div className="u-meta" lang={lang}>{meta}</div>
        <div className="mt-1 text-[15px] leading-[1.5] text-ink-2" lang={lang}>{body}</div>
      </div>
      {figure && (
        <div className={`tabular text-[19px] font-medium shrink-0 ${benefitToneClass(tone)}`}>
          {figure}
        </div>
      )}
    </div>
  );
}

function BenefitBreakdown({ benefit, lang }) {
  const ta = lang === 'ta';
  const b = benefit || {};
  const cash = b.cash ? formatBenefit({ ...b }, lang) : null;

  const anyKind = Boolean(b.cash || b.loan_ceiling || b.subsidy || b.insurance_cover || b.in_kind);

  return (
    <section className="card">
      <div className="u-meta" lang={lang}>{ta ? 'இத்திட்டம் தருவது' : 'What this scheme gives'}</div>

      {!anyKind && (
        // Never a placeholder numeral. If it is not published, say so.
        <p className="mt-4 text-[16px] leading-[1.6] text-muted max-w-[56ch]" lang={lang}>
          {ta
            ? 'இத்திட்டம் தொகையை வெளியிடவில்லை. அரசு பக்கத்தில் விவரம் இருக்கலாம் — நாங்கள் ஊகிக்க மாட்டோம்.'
            : 'This scheme has not published an amount. The official page may say more — we will not guess a figure.'}
        </p>
      )}

      <div className="mt-4 space-y-3">
        {/* Cash is the only kind ever set in the display face. */}
        {cash && (
          <div>
            <div className="u-meta" lang={lang}>
              {ta ? 'உங்கள் கைக்கு வரும் பணம்' : 'Money you receive'}
            </div>
            <div className="mt-2 u-display tabular text-[44px] sm:text-[56px] leading-none text-ink">
              {cash.primary}
            </div>
            <div className="mt-2 text-[15px] text-muted" lang={lang}>{cash.secondary}</div>
          </div>
        )}

        {b.loan_ceiling != null && b.loan_ceiling > 0 && (
          <KindRow
            lang={lang}
            tone="loan"
            meta={ta ? 'கடன் வசதி' : 'Credit available'}
            body={
              <>
                <span aria-hidden="true">↩ </span>
                {ta
                  ? 'கடனாகக் கிடைக்கும் — திருப்பிச் செலுத்த வேண்டும். இது உங்களுக்குத் தரப்படும் பணம் அல்ல.'
                  : 'borrowing you can take up — to be repaid. This is not money given to you.'}
              </>
            }
            figure={formatBenefit({ loan_ceiling: b.loan_ceiling }, lang).primary}
          />
        )}

        {b.subsidy != null && b.subsidy > 0 && (
          <KindRow
            lang={lang}
            tone="subsidy"
            tint="rgba(190,235,216,0.30)"
            meta={ta ? 'மானியம்' : 'Subsidy'}
            body={
              ta
                ? 'நீங்கள் செலவழிக்கும் தொகையில் அரசு ஏற்கும் பங்கு — அதிகபட்சம்.'
                : 'a share of what you spend, paid by the government — up to this ceiling.'
            }
            figure={formatBenefit({ subsidy: b.subsidy }, lang).primary}
          />
        )}

        {b.insurance_cover != null && b.insurance_cover > 0 && (
          <KindRow
            lang={lang}
            tone="insurance"
            tint="rgba(184,212,240,0.30)"
            meta={ta ? 'காப்பீட்டுத் தொகை' : 'Insurance cover'}
            body={
              ta
                ? 'உரிமைகோர வேண்டிய நிலை ஏற்பட்டால் மட்டும் — இந்தத் தொகை வரை காப்பீடு.'
                : 'if something covered happens — and only then — you are covered up to this.'
            }
            figure={formatBenefit({ insurance_cover: b.insurance_cover }, lang).primary}
          />
        )}

        {b.in_kind && (
          <KindRow
            lang={lang}
            tone="inkind"
            meta={ta ? 'பொருள் உதவி' : 'Given in kind'}
            body={decode(b.in_kind)}
          />
        )}
      </div>

      {anyKind && (
        <p className="mt-4 pt-4 border-t border-hairline text-[13px] leading-[1.6] text-muted max-w-[62ch]" lang={lang}>
          {ta
            ? 'ஒவ்வொரு வகையும் தனித்தனியே காட்டப்படுகிறது. இவை கூட்டப்படுவதில்லை — கடன், மானியம், காப்பீடு ஆகியவை கையில் வரும் பணம் அல்ல.'
            : 'Each kind is listed on its own. They are not added together — a loan, a subsidy and an insurance cover are not cash in hand.'}
        </p>
      )}
    </section>
  );
}

// ── page ────────────────────────────────────────────────────────────────────
export default function SchemeDetail() {
  const { id } = useParams();
  const { vault } = useVault();
  const { lang } = useLanguage();
  const nav = useNavigate();
  const reduce = useReducedMotion();
  const { scheme, loading } = useScheme(id, vault?.state);
  const ta = lang === 'ta';

  const shell = (children, bloom = 'bloom-neutral') => (
    <div className="min-h-[100dvh] w-full bg-canvas relative overflow-x-hidden pb-28">
      <div className={`bloom ${bloom} bloom-quiet`} aria-hidden="true" />
      <div className="relative z-10 mx-auto w-full max-w-[860px] px-4 sm:px-6 py-4 sm:py-6">
        <header className="flex items-center justify-between mb-4 sm:mb-6">
          <button onClick={() => nav(-1)} className="btn-ghost compact text-[15px]" lang={lang}>
            <span aria-hidden="true">←</span> {ta ? 'பின்' : 'Back'}
          </button>
          <span className="u-meta">Sevai</span>
        </header>
        {children}
      </div>
    </div>
  );

  // Calm loading: the shape of the page, not a spinner dropped in the middle.
  if (!scheme && loading) {
    return shell(
      <div className="card" aria-busy="true">
        <div className="u-meta" lang={lang}>
          {ta ? 'திட்டம் ஏற்றப்படுகிறது' : 'Loading this scheme'}
        </div>
        <div className="mt-5 space-y-3 animate-pulse" aria-hidden="true">
          <div className="h-6 w-4/5 rounded-full bg-surface-sub" />
          <div className="h-6 w-3/5 rounded-full bg-surface-sub" />
          <div className="h-24 w-full rounded-well bg-surface-sub mt-6" />
          <div className="h-4 w-2/5 rounded-full bg-surface-sub" />
        </div>
      </div>,
      'bloom-cool',
    );
  }

  if (!scheme) {
    return shell(
      <div className="card">
        <h1 className="u-display text-q text-ink" lang={lang}>
          {ta ? 'இந்தத் திட்டம் கிடைக்கவில்லை' : 'We could not find this scheme'}
        </h1>
        <p className="mt-3 text-[16px] text-muted max-w-[52ch]" lang={lang}>
          {ta
            ? 'இணைப்பு பழையதாக இருக்கலாம், அல்லது இத்திட்டம் உங்கள் மாநிலத்திற்கானது அல்ல.'
            : 'The link may be out of date, or this scheme may not be offered in your state.'}
        </p>
        <button onClick={() => nav('/feed')} className="btn-primary mt-6" lang={lang}>
          {ta ? 'என் திட்டங்களுக்குத் திரும்பு' : 'Back to my schemes'}
        </button>
      </div>,
    );
  }

  const name = ta && scheme.name_ta ? scheme.name_ta : scheme.name_plain;
  const bullets = (ta && scheme.description_simple_ta) || scheme.description_simple || [];
  const docs = scheme.documents_required || [];
  const facts = eligibilityFacts(scheme, lang);
  const modes = scheme.application_modes || [];
  const outbound = scheme.official_url || scheme.application_link;
  const isOfficial = Boolean(scheme.official_url);
  const cat = CATEGORY_LABEL[scheme.category];
  const conditions = decode(scheme.eligibility?.additional_conditions || '');

  const rise = (d = 0) => ({
    initial: reduce ? false : { opacity: 0, y: 14 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.32, delay: d, ease: [0.22, 1, 0.36, 1] },
  });

  return shell(
    <div className="space-y-4">
      {/* ── identity ──────────────────────────────────────────────────────── */}
      <motion.div {...rise(0)} className="surface-tray">
        <div className="surface-plate relative overflow-hidden px-6 sm:px-10 py-8 sm:py-10">
          <div className="bloom bloom-warm bloom-quiet" aria-hidden="true" />
          <div className="relative z-10">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[22px] leading-none" aria-hidden="true">
                {categoryEmoji(scheme.category)}
              </span>
              <span className="u-meta" lang={lang}>
                {scheme.nationwide
                  ? ta ? 'மத்தியத் திட்டம்' : 'Central scheme'
                  : (scheme.state || (scheme.states || [])[0] || (ta ? 'மாநிலத் திட்டம்' : 'State scheme'))}
              </span>
              {cat && (
                <>
                  <span className="w-1 h-1 rounded-full bg-ink/20" aria-hidden="true" />
                  <span className="u-meta" lang={lang}>{ta ? cat.ta : cat.en}</span>
                </>
              )}
            </div>

            {/* Long names, and longer again in Tamil — text face, balanced wrap. */}
            <h1
              className="u-scheme-name mt-4 text-[26px] sm:text-[30px] leading-[1.35] font-semibold text-ink max-w-[24ch]"
              lang={lang}
            >
              {name}
            </h1>

            {scheme.name_official && scheme.name_official !== scheme.name_plain && (
              <p className="u-scheme-name mt-2 text-[14px] leading-[1.5] text-muted max-w-[60ch]" lang="en">
                {scheme.name_official}
              </p>
            )}

            {/* Why this citizen is looking at it — before the money, not after. */}
            {vault && <MatchReason scheme={scheme} profile={vault} lang={lang} className="mt-6" />}

            {scheme.deadline && (
              <DeadlineVisualizer scheme={scheme} vault={vault} lang={lang} />
            )}
          </div>
        </div>
      </motion.div>

      {/* ── the money, kind by kind ───────────────────────────────────────── */}
      <motion.div {...rise(0.05)}>
        <BenefitBreakdown benefit={scheme.benefit} lang={lang} />
      </motion.div>

      {/* ── act ───────────────────────────────────────────────────────────── */}
      <motion.section {...rise(0.09)} className="card">
        <div className="u-meta" lang={lang}>{ta ? 'விண்ணப்பிக்க' : 'Applying'}</div>

        {modes.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {modes.map((m) => (
              <span key={m} className="chip" lang={lang}>
                {MODE_LABEL[m] ? (ta ? MODE_LABEL[m].ta : MODE_LABEL[m].en) : m}
              </span>
            ))}
          </div>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <a
            href={outbound}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-primary inline-flex items-center"
            lang={lang}
          >
            {isOfficial
              ? ta ? 'அரசு தளத்தில் விண்ணப்பி' : 'Apply on the official site'
              : ta ? 'திட்டப் பக்கத்தைப் பார்' : 'Open the scheme page'}
            <span aria-hidden="true"> ↗</span>
          </a>
          <button
            onClick={() => nav(`/apply/${scheme.id}`)}
            className="btn-secondary"
            lang={lang}
          >
            {ta ? 'ஆவணங்களைத் தயார் செய்' : 'Prepare my documents'}
          </button>
        </div>

        {/* One line, both languages, always — a citizen should never be
            surprised by leaving the app they trusted. */}
        <p className="mt-4 text-[13px] leading-[1.6] text-muted max-w-[62ch]">
          <span lang="en">
            You are leaving Sevai for {isOfficial ? 'the official government site' : 'myscheme.gov.in'}. Sevai does not submit anything for you.
          </span>
          <br />
          <span lang="ta">
            நீங்கள் சேவையிலிருந்து {isOfficial ? 'அரசு இணையதளத்திற்கு' : 'myscheme.gov.in தளத்திற்கு'} செல்கிறீர்கள். சேவை உங்களுக்காக விண்ணப்பிக்காது.
          </span>
        </p>

        <div className="mt-5 pt-5 border-t border-hairline">
          <SamjhaoButton scheme={scheme} lang={lang} />
        </div>
      </motion.section>

      {/* ── documents ─────────────────────────────────────────────────────── */}
      <motion.section {...rise(0.12)} className="card">
        <div className="u-meta" lang={lang}>
          {ta ? 'தேவையான ஆவணங்கள்' : 'Documents you will need'}
        </div>
        {docs.length > 0 ? (
          <ul className="mt-4 space-y-2">
            {docs.map((d) => (
              <li key={d} className="well px-4 py-3 text-[15px] text-ink-2" lang={lang}>
                {d}
              </li>
            ))}
          </ul>
        ) : (
          // ~19% of the corpus publishes a document list. Inventing the usual
          // suspects would be a guess a citizen could act on.
          <p className="mt-3 text-[15px] leading-[1.6] text-muted max-w-[56ch]" lang={lang}>
            {ta
              ? 'இத்திட்டம் ஆவணப் பட்டியலை வெளியிடவில்லை. வழக்கமான ஆவணங்களை நாங்கள் ஊகித்துச் சொல்ல மாட்டோம் — அரசு பக்கத்தில் சரிபாருங்கள்.'
              : 'This scheme has not published a document list. We will not guess at the usual ones — check the official page before you go.'}
          </p>
        )}
      </motion.section>

      {/* ── who it is for ─────────────────────────────────────────────────── */}
      {facts.length > 0 && (
        <motion.section {...rise(0.15)} className="card">
          <div className="u-meta" lang={lang}>{ta ? 'யாருக்கானது' : 'Who it is for'}</div>
          <dl className="mt-4 divide-y divide-hairline">
            {facts.map((f) => (
              <div key={f.label} className="py-3 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
                <dt className="text-[14px] text-muted shrink-0" lang={lang}>{f.label}</dt>
                <dd className="text-[15px] text-ink text-right max-w-[62%]" lang={lang}>{f.value}</dd>
              </div>
            ))}
          </dl>
          {conditions && (
            <div className="mt-4 pt-4 border-t border-hairline">
              <div className="u-meta" lang={lang}>{ta ? 'கூடுதல் நிபந்தனைகள்' : 'Also on the record'}</div>
              <p className="mt-2 text-[14px] leading-[1.65] text-muted" lang="en">{conditions}</p>
            </div>
          )}
        </motion.section>
      )}

      {/* ── what it is ────────────────────────────────────────────────────── */}
      <motion.section {...rise(0.18)} className="card">
        <div className="u-meta" lang={lang}>{ta ? 'இது என்ன' : 'What this is'}</div>
        {bullets.length > 0 && (
          <ul className="mt-4 space-y-2.5">
            {bullets.map((b, i) => (
              <li key={i} className="flex gap-3 text-[16px] leading-[1.6] text-ink-2" lang={lang}>
                <span className="mt-2.5 w-1.5 h-1.5 rounded-full bg-ink/25 shrink-0" aria-hidden="true" />
                <span>{decode(b)}</span>
              </li>
            ))}
          </ul>
        )}
        {scheme.description_long && (
          <p className="mt-5 text-[15px] leading-[1.7] text-muted max-w-[70ch]" lang="en">
            {decode(scheme.description_long)}
          </p>
        )}
      </motion.section>

      <CrossSchemeChain schemeId={scheme.id} vault={vault} lang={lang} />

      {/* ── provenance ────────────────────────────────────────────────────── */}
      <footer className="card">
        <div className="u-meta" lang={lang}>{ta ? 'இந்தத் தகவல் எங்கிருந்து' : 'Where this came from'}</div>
        <p className="mt-3 text-[14px] leading-[1.65] text-ink-2 max-w-[64ch]" lang={lang}>
          {ta
            ? 'திட்ட விவரங்கள் myscheme.gov.in இலிருந்து எடுக்கப்பட்டவை.'
            : 'Scheme details are read from myscheme.gov.in.'}
          {scheme.ministry ? ' ' : ''}
          {scheme.ministry && (
            <span lang="en">
              {ta ? 'நிர்வகிப்பது: ' : 'Administered by '}
              {scheme.ministry}.
            </span>
          )}
        </p>
        <p className="mt-2 text-[13px] leading-[1.6] text-muted max-w-[64ch]" lang={lang}>
          {ta
            ? 'இறுதி முடிவு அரசுத் துறையினுடையது. சேவை தகுதியை உறுதி செய்யாது.'
            : 'The final decision rests with the department. Sevai does not confirm eligibility.'}
        </p>
      </footer>
    </div>,
  );
}
