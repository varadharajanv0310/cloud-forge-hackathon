import { useParams, useNavigate } from 'react-router-dom';
import { useSchemes, getSchemeById } from '../utils/schemesStore.js';
import { isTargeted } from '../utils/eligibilityEngine.js';
import { useVault } from '../hooks/useVault.js';
import { useLanguage } from '../hooks/useLanguage.js';
import { formatBenefit } from '../utils/formatters.js';
import { MatchReason } from '../components/Thread.jsx';
import { QUESTIONS } from '../data/profileSchema.js';

/**
 * SchemeDetail — ported from the Claude Design source (Sevai.dc.html:
 * isDetail, lines 1384-1462 for the phone; isWDetail, lines 459-548 for the
 * desktop). One responsive page rather than two implementations: the phone
 * column is the base, and at `lg` it becomes a 1.55fr / 1fr grid with the
 * apply column sticky beside the reading column.
 *
 * Three things this screen exists to get right.
 *
 *  1. **Benefit kinds must never look addable.** Every kind the scheme
 *     publishes gets its own labelled row, its own face and its own container,
 *     with a line of copy saying what that kind actually is. Cash is the only
 *     kind set in the display face. A loan ceiling is set in the MONO face
 *     inside a DASHED box, because a dashed outline is not a payment. There is
 *     no combined total anywhere on the page, and there never can be — the
 *     kinds are not the same unit.
 *  2. **The citizen can see why it matched**, above the money rather than
 *     under it, in their own words (MatchReason).
 *  3. **Nothing is invented.** A scheme with no published amount renders no
 *     numeral; a scheme with no published document list says so instead of
 *     listing the usual suspects (myScheme publishes documents for only about
 *     19% of the corpus). Null eligibility facts are skipped in silence — an
 *     empty row reads as "no restriction" when it means "not recorded".
 */

// ── ink-safe helpers ────────────────────────────────────────────────────────

// myScheme prose arrives HTML-escaped ("&quot;PM Kisan&quot; is a …").
/**
 * myScheme's prose fields carry entity-escaped markup. Decoding alone turns
 * `&lt;br&gt;` into a visible `<br>`, and the corpus also contains unclosed
 * fragments (a trailing `<br` with no bracket), so the tags are stripped after
 * decoding rather than before — and the unclosed tail is stripped explicitly,
 * because no tag regex will match it.
 */
const decode = (s) =>
  String(s || '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, '’')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/<[^>]*>/g, ' ')   // complete tags
    .replace(/<\/?[a-z][a-z0-9]*\s*$/i, '')  // an unclosed tag at the very end
    .replace(/\s+/g, ' ')
    .trim();

const rupees = (n) => `₹${Number(n).toLocaleString('en-IN')}`;

const fmtDate = (v) => {
  const d = new Date(v);
  return Number.isNaN(d.getTime())
    ? null
    : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

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
  Online:  { en: 'Apply online', ta: 'இணையவழி விண்ணப்பம்' },
  Offline: { en: 'Apply in person', ta: 'நேரடியாக விண்ணப்பிக்கலாம்' },
};

// ── small type pieces ───────────────────────────────────────────────────────

/** A mono section label with its Tamil beneath. The mono face is Latin only. */
function Eyebrow({ en, ta, className = '' }) {
  return (
    <div className={className}>
      <div className="mono text-[10.5px] tracking-[.13em] text-ink-55">{en}</div>
      {ta && <div className="ta text-[13px] text-ink-40 mt-[3px]" lang="ta">{ta}</div>}
    </div>
  );
}

/** Small pill in the tag row. */
function Tag({ children, tone = 'quiet' }) {
  const base =
    'mono text-[9.5px] tracking-[.12em] rounded-[2px] whitespace-nowrap';
  if (tone === 'solid') return <span className={`${base} bg-ink text-white px-[9px] py-[4px]`}>{children}</span>;
  if (tone === 'open')
    return (
      <span
        className={`${base} px-[9px] py-[3px] border text-[#2F6B4F] border-[#2F6B4F]/30 bg-[#2F6B4F]/10`}
      >
        {children}
      </span>
    );
  return <span className={`${base} px-[9px] py-[3px] border border-rule-20 text-ink-55`}>{children}</span>;
}

// ── eligibility facts ───────────────────────────────────────────────────────
// Only what this scheme actually publishes. Caste, disability, marital and
// maternity criteria are deliberately never rendered: this is often a shared
// phone, and someone reading over a shoulder should not learn them.
/** Resolve a stored enum back to the wording the citizen was offered. */
const OPTION_LABEL = new Map(
  QUESTIONS.flatMap((q) => (q.options || []).map((o) => [`${q.key}:${o.value}`, o.en])),
);
const humanise = (s) =>
  String(s).replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
const labelFor = (qKey, v) => OPTION_LABEL.get(`${qKey}:${v}`) || humanise(v);

function eligibilityFacts(scheme) {
  const e = scheme.eligibility || {};
  const rows = [];
  const add = (en, ta, value) => rows.push({ en, ta, value });
  const list = (a) => (a || []).join(', ');
  /** Enum arrays are stored as codes; a citizen must never be shown one. */
  const listAs = (qKey, a) => (a || []).map((v) => labelFor(qKey, v)).join(', ');

  // `min_age: 0` is how the corpus records "no lower bound". Printing it as
  // "0 and above" invents a criterion out of the absence of one.
  const minAge = e.min_age > 0 ? e.min_age : null;
  if (minAge != null && e.max_age != null) add('Age', 'வயது', `${minAge} – ${e.max_age}`);
  else if (minAge != null) add('Age', 'வயது', `${minAge} and above`);
  else if (e.max_age != null) add('Age', 'வயது', `Up to ${e.max_age}`);

  if (e.gender && e.gender !== 'any') {
    const g = { female: 'Women', male: 'Men', transgender: 'Transgender applicants' }[e.gender];
    if (g) add('Who it is for', 'யாருக்கானது', g);
  }

  if (e.income_max_annual != null)
    add('Household income', 'ஆண்டு வருமான வரம்பு', `Up to ${rupees(e.income_max_annual)} a year`);

  if ((e.occupation_raw || []).length) add('Occupation', 'தொழில்', list(e.occupation_raw));
  else if ((e.occupation || []).length)
    add('Occupation', 'தொழில்', listAs('occupation', e.occupation));

  if (e.residence && e.residence !== 'any')
    add('Where you live', 'வசிப்பிடம்', e.residence === 'rural' ? 'Rural areas' : 'Urban areas');

  if (e.bpl_required) add('Ration card', 'குடும்ப அட்டை', 'Below Poverty Line households');
  if ((e.ration_card_required || []).length)
    add('Ration card', 'குடும்ப அட்டை', list(e.ration_card_required).toUpperCase());

  if (e.student_required) {
    const lv = (e.student_levels || []).length
      ? list(e.student_levels).replace(/_/g, ' ')
      : 'Students';
    add('Studying', 'படிப்பு', lv);
  }
  if (e.marks_min_pct != null) add('Marks', 'மதிப்பெண்', `${e.marks_min_pct}% or more`);
  if (e.institution_type) add('Institution', 'கல்வி நிறுவனம்', e.institution_type);

  if ((e.land_tenure || []).length) add('Land', 'நில உரிமை', listAs('land_tenure', e.land_tenure));
  if (e.land_max_acres != null) add('Land size', 'நில அளவு', `Up to ${e.land_max_acres} acres`);
  if (e.livestock_required) add('Livestock', 'கால்நடை', 'Keeps livestock');
  if (e.fisher_required) add('Fishing', 'மீன்பிடி', 'Fishing households');

  if (e.welfare_board_required)
    add('Welfare board', 'நல வாரியம்', 'Board registration required');
  if (e.unemployed_required || (e.employment_status || []).includes('unemployed'))
    add('Work', 'வேலைநிலை', 'Currently without work');
  if (e.pension_excluded) add('Pension', 'ஓய்வூதியம்', 'Not for pension recipients');
  if (e.housing_status_required)
    add('Housing', 'வீட்டு நிலை', String(e.housing_status_required).replace(/_/g, ' '));

  if (scheme.beneficiary_type && scheme.beneficiary_type !== 'individual')
    add('Applies to', 'யாருக்கு',
      scheme.beneficiary_type === 'family' ? 'The household' : 'Institutions');

  return rows;
}

// ── the benefit breakdown ───────────────────────────────────────────────────
// The most important block on the page. One row per kind, each with its own
// weight, face and container, each saying in words what that kind is.

/** A non-cash kind. Never the display face, never at full ink. */
function KindRow({ en, ta, body, bodyTa, figure, figureMono }) {
  return (
    <div className="rule-t px-4 py-4 sm:px-6 sm:py-5">
      <div className="mono text-[9.5px] tracking-[.12em] text-ink-55">{en}</div>
      {ta && <div className="ta text-[12.5px] text-ink-40 mt-[3px]" lang="ta">{ta}</div>}
      <div className="mt-2.5 flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 max-w-[54ch]">
          <p className="m-0 text-[13.5px] sm:text-[14.5px] leading-[1.6] text-ink-60">{body}</p>
          {bodyTa && (
            <p className="ta m-0 mt-1 text-[12.5px] leading-[1.55] text-ink-40" lang="ta">{bodyTa}</p>
          )}
        </div>
        {figure && (
          figureMono ? (
            // A dashed outline and the mono face. Deliberately unlike the cash
            // figure above it: this is credit, and it cannot read as a payment.
            <span className="mono tabular shrink-0 text-[14px] tracking-[.06em] text-ink-45
                             border border-dashed border-rule-22 rounded-[3px] px-3 py-2">
              {figure}
            </span>
          ) : (
            <span className="tabular shrink-0 text-[18px] font-medium text-ink-45">{figure}</span>
          )
        )}
      </div>
    </div>
  );
}

function BenefitBreakdown({ benefit }) {
  const b = benefit || {};
  const hasCash = Boolean(b.cash);
  const hasLoan = b.loan_ceiling > 0;
  const hasSubsidy = b.subsidy > 0;
  const hasInsurance = b.insurance_cover > 0;
  const hasInKind = Boolean(b.in_kind);
  const any = hasCash || hasLoan || hasSubsidy || hasInsurance || hasInKind;

  const cashEn = hasCash ? formatBenefit(b, 'en') : null;
  const cashTa = hasCash ? formatBenefit(b, 'ta') : null;
  const cashMeta =
    b.cash_frequency === 'monthly' ? 'Cash · every month'
      : b.cash_frequency === 'annual' ? 'Cash · every year'
      : 'Cash · one payment';

  // Kinds this scheme does not carry, named plainly so the absence is a fact
  // rather than a gap. Phone: one line. Desktop: the source's four columns.
  const absent = [
    !hasLoan && { en: 'Loan ceiling', ta: 'கடன் வரம்பு' },
    !hasSubsidy && { en: 'Subsidy', ta: 'மானியம்' },
    !hasInsurance && { en: 'Insurance', ta: 'காப்பீடு' },
    !hasInKind && { en: 'In kind', ta: 'பொருள் உதவி' },
  ].filter(Boolean);

  return (
    <>
      <div className="panel overflow-hidden">
        {hasCash && (
          <div className="px-4 py-4 sm:px-6 sm:py-6">
            <div className="mono text-[9.5px] sm:text-[10.5px] tracking-[.13em] text-ink">{cashMeta}</div>
            <div className="tabular mt-2 text-[34px] lg:text-[52px] font-extrabold leading-[1.05] tracking-[-.045em]">
              {cashEn.primary}
            </div>
            <div className="ta mt-1 text-[12.5px] sm:text-[13.5px] text-ink-40" lang="ta">
              {`${cashTa.secondary} ${cashTa.primary}`}
            </div>
            <p className="mt-2.5 mb-0 max-w-[56ch] text-[13.5px] sm:text-[14.5px] leading-[1.6] text-ink-60">
              Paid into your own bank account. This is money you receive — there is nothing to
              repay.
            </p>
            <p className="ta mt-1 mb-0 text-[12.5px] leading-[1.55] text-ink-40" lang="ta">
              உங்கள் வங்கிக் கணக்கில் நேரடியாக வரும். திருப்பிச் செலுத்த வேண்டியதில்லை.
            </p>
          </div>
        )}

        {!any && (
          // No numeral, not even a zero. If the department has not published an
          // amount, the honest thing on screen is the sentence, not a figure.
          <div className="px-4 py-5 sm:px-6 sm:py-6">
            <div className="mono text-[10.5px] tracking-[.13em] text-ink-55">Amount not published</div>
            <p className="mt-2.5 mb-0 max-w-[56ch] text-[14.5px] leading-[1.6] text-ink-60">
              This scheme has not published what it pays. The official page may say more. Sevai
              will not put a number here that the government has not printed.
            </p>
            <p className="ta mt-1 mb-0 text-[12.5px] leading-[1.55] text-ink-40" lang="ta">
              இத்திட்டம் தொகையை அறிவிக்கவில்லை. நாங்கள் ஊகித்துச் சொல்ல மாட்டோம்.
            </p>
          </div>
        )}

        {hasLoan && (
          <KindRow
            en="Credit ceiling · to be repaid"
            ta="கடன் வரம்பு · திருப்பிச் செலுத்த வேண்டும்"
            body="The most you may borrow under this scheme. It is a loan, with interest, and it must be repaid. It is not money you receive."
            bodyTa="இது கடன் — வட்டியுடன் திருப்பிச் செலுத்த வேண்டும். இது உங்களுக்குத் தரப்படும் பணம் அல்ல."
            figure={formatBenefit({ loan_ceiling: b.loan_ceiling }, 'en').primary}
            figureMono
          />
        )}

        {hasSubsidy && (
          <KindRow
            en="Subsidy · a discount, not a payment"
            ta="மானியம் · விலைக் குறைப்பு, பணம் அல்ல"
            body="The government pays a share of what something costs, up to this ceiling. You still pay the rest. No money reaches your account."
            bodyTa="நீங்கள் வாங்கும் பொருளின் விலையில் ஒரு பங்கை அரசு ஏற்கும். மீதியை நீங்கள் செலுத்த வேண்டும்."
            figure={formatBenefit({ subsidy: b.subsidy }, 'en').primary}
          />
        )}

        {hasInsurance && (
          <KindRow
            en="Insurance cover · only if you claim"
            ta="காப்பீட்டுத் தொகை · உரிமைகோரினால் மட்டும்"
            body="Cover, not cash. Nothing is paid unless something the policy covers actually happens, and then only up to this amount."
            bodyTa="இது கையில் வரும் பணம் அல்ல. காப்பீடு பொருந்தும் நிலை ஏற்பட்டால் மட்டுமே இத்தொகை வரை கிடைக்கும்."
            figure={formatBenefit({ insurance_cover: b.insurance_cover }, 'en').primary}
          />
        )}

        {hasInKind && (
          <KindRow
            en="Given in kind · goods or a service"
            ta="பொருள் உதவி · பொருள் அல்லது சேவை"
            body={decode(b.in_kind)}
            bodyTa="இது பணமாக அல்ல, பொருளாக அல்லது சேவையாகக் கிடைக்கும்."
          />
        )}

        {any && absent.length > 0 && (
          <div className="rule-t px-4 py-4 sm:px-6 sm:py-5">
            <div className="lg:hidden">
              <div className="mono text-[9.5px] tracking-[.12em] text-ink-30">
                {absent.map((k) => k.en).join(' · ')}
              </div>
              <div className="mt-1.5 text-[14px] leading-[1.55] text-ink-45">
                None. This scheme does not carry {absent.length === 1 ? 'this' : 'these'}.
              </div>
            </div>
            <div className="hidden lg:grid grid-cols-4 gap-5">
              {absent.map((k) => (
                <div key={k.en}>
                  <div className="mono text-[9.5px] tracking-[.11em] text-ink-25">{k.en}</div>
                  <div className="ta text-[12px] text-ink-25 mt-[2px]" lang="ta">{k.ta}</div>
                  <div className="text-[14px] text-ink-45 mt-1.5">None</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <p className="mt-2.5 mb-0 max-w-[64ch] text-[12.5px] sm:text-[13.5px] leading-[1.6] text-ink-30">
        Each kind of benefit is listed on its own line. Sevai never adds them together, because
        they are not the same thing.
      </p>
      <p className="ta mt-1 mb-0 text-[12.5px] leading-[1.55] text-ink-30" lang="ta">
        ஒவ்வொரு வகையும் தனித்தனியாகக் காட்டப்படுகிறது. அவை ஒன்றாகக் கூட்டப்படுவதில்லை.
      </p>
    </>
  );
}

// ── page chrome ─────────────────────────────────────────────────────────────

function Frame({ children, onBack, backLabel }) {
  return (
    <div className="relative min-h-[100dvh] bg-page pb-28" lang="en">
      <div className="bloom bloom-shell" aria-hidden="true" />

      {/* Phone: the sticky bar from the source. Desktop: a quiet mono back link. */}
      <div className="sticky top-0 z-20 rule-b bg-page/95 backdrop-blur-sm lg:hidden">
        <div className="flex items-center gap-3 px-4 py-3">
          <button onClick={onBack} className="btn-icon w-10 h-10 text-[16px]" aria-label="Back">
            ←
          </button>
          <div>
            <div className="mono text-[10.5px] tracking-[.13em] text-ink-55">Scheme detail</div>
            <div className="ta text-[12px] text-ink-40 leading-tight" lang="ta">திட்ட விவரம்</div>
          </div>
        </div>
      </div>

      <div className="relative mx-auto w-full max-w-[1180px] px-5 pt-5 pb-10 lg:px-11 lg:pt-9 lg:pb-16">
        <button
          onClick={onBack}
          className="mono hidden lg:inline-flex items-center gap-2.5 text-[10.5px] tracking-[.12em]
                     text-ink-55 hover:text-ink mb-7"
        >
          ← {backLabel}
        </button>
        {children}
      </div>
    </div>
  );
}

// ── page ────────────────────────────────────────────────────────────────────

export default function SchemeDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { vault } = useVault();
  const { lang } = useLanguage();
  // getSchemeById() is a synchronous read of a cache that useSchemes() fills,
  // so the lookup is simply retried on each render. A scheme already in the
  // cache — the usual case, arriving from the feed — shows no loading frame.
  const { schemes, manifest, loading } = useSchemes(vault?.state);
  const scheme = getSchemeById(id);
  const back = () => nav(-1);
  const backLabel = schemes?.length ? `Back to all ${schemes.length} schemes` : 'Back to all schemes';

  // Calm loading: the shape of the page in hairlines. No spinner — a spinner in
  // the middle of a document says "broken" on a slow connection.
  if (!scheme && loading) {
    return (
      <Frame onBack={back} backLabel={backLabel}>
        <div aria-busy="true" className="max-w-[720px]">
          <Eyebrow en="Opening this scheme" ta="திட்டம் திறக்கப்படுகிறது" />
          <div className="mt-6 space-y-3 animate-svPulse" aria-hidden="true">
            <div className="h-7 w-4/5 rounded-[3px] bg-ink/5" />
            <div className="h-7 w-3/5 rounded-[3px] bg-ink/5" />
          </div>
          <div className="mt-8 panel h-[168px] animate-svPulse" aria-hidden="true" />
          <div className="mt-4 panel h-[120px] animate-svPulse" aria-hidden="true" />
        </div>
      </Frame>
    );
  }

  if (!scheme) {
    return (
      <Frame onBack={back} backLabel={backLabel}>
        <div className="max-w-[46ch]">
          {/* Sized in place rather than with `.title-2`: this steps down on a
              phone, and the display roles are fixed sizes. */}
          <h1 className="m-0 text-[30px] lg:text-[34px] font-bold leading-[1.1] tracking-[-.035em]">
            We could not find this scheme
          </h1>
          <div className="ta mt-3 text-[17px] text-ink-60" lang="ta">
            இந்தத் திட்டம் கிடைக்கவில்லை
          </div>
          <p className="mt-5 text-[15.5px] leading-[1.6] text-ink-60">
            The link may be out of date, or this scheme may not be offered in your state.
          </p>
          <button onClick={() => nav('/feed')} className="btn mt-7">
            Back to my schemes
          </button>
        </div>
      </Frame>
    );
  }

  const cat = CATEGORY_LABEL[scheme.category];
  const facts = eligibilityFacts(scheme);
  const docs = scheme.documents_required || [];
  const modes = scheme.application_modes || [];
  const outbound = scheme.official_url || scheme.application_link;
  const isOfficial = Boolean(scheme.official_url);
  const conditions = decode(scheme.eligibility?.additional_conditions || '');
  const bullets = ((lang === 'ta' && scheme.description_simple_ta) || scheme.description_simple || [])
    .map(decode)
    .filter(Boolean);
  const targeted = vault ? isTargeted(scheme, vault) : false;
  const headline = formatBenefit(scheme.benefit, 'en');
  const headlineTa = formatBenefit(scheme.benefit, 'ta');
  const hasFigure = headline.tone !== 'unknown';

  // "This scheme pays" is true of a grant and false of everything else. Above a
  // loan ceiling it is the exact claim the rest of this page exists to prevent,
  // so the eyebrow is chosen by kind rather than written once.
  const railEyebrow = {
    cash: 'This scheme pays',
    subsidy: 'This scheme discounts',
    insurance: 'This scheme covers',
    loan: 'This scheme lends',
    inkind: 'This scheme provides',
  }[headline.tone] || 'What this scheme offers';
  const deadline = scheme.deadline ? fmtDate(scheme.deadline) : null;
  const normalised = manifest?.generated_at ? fmtDate(manifest.generated_at) : null;

  // The leaving-Sevai note. Same words in the phone column and the desktop
  // rail, so the promise does not change shape with the viewport.
  const LeavingNote = ({ className = '' }) => (
    <div className={className}>
      <p className="m-0 text-[13px] leading-[1.6] text-ink-45">
        You are about to leave Sevai for {isOfficial ? 'a government website' : 'myscheme.gov.in'}.
        Sevai does not fill in or submit anything for you, and cannot see what happens there.
      </p>
      <p className="ta m-0 mt-1.5 text-[12.5px] leading-[1.55] text-ink-30" lang="ta">
        சேவை உங்களுக்காக எதையும் நிரப்பாது, சமர்ப்பிக்காது.
      </p>
    </div>
  );

  const Actions = ({ stacked = false }) => (
    <div className={stacked ? '' : 'flex gap-2.5'}>
      {outbound ? (
        <a
          href={outbound}
          target="_blank"
          rel="noopener noreferrer"
          className={`${stacked ? 'w-full' : 'flex-1'} min-h-[58px] flex items-center justify-center
                      rounded-flat bg-ink text-white hover:text-white text-[15.5px] font-semibold
                      transition-opacity hover:opacity-90 px-4 text-center`}
        >
          {isOfficial ? 'Apply on official site ↗' : 'Open the scheme page ↗'}
        </a>
      ) : (
        <div className={`${stacked ? 'w-full' : 'flex-1'} panel-flat px-4 py-4 text-[13.5px] leading-[1.6] text-ink-45`}>
          This scheme has not published an application link. Ask at your village or ward office.
          <span className="ta block mt-1 text-[12.5px] text-ink-30" lang="ta">
            விண்ணப்ப இணைப்பு அறிவிக்கப்படவில்லை.
          </span>
        </div>
      )}
      <button
        onClick={() => nav(`/apply/${scheme.id}`)}
        className={`${stacked ? 'w-full mt-2.5' : 'w-[132px] shrink-0'} min-h-[56px] flex items-center
                    justify-center rounded-flat border border-rule-20 hover:border-ink bg-white
                    text-[15px] font-medium text-center px-3`}
      >
        {stacked ? 'Get my documents ready' : 'Get ready first'}
      </button>
    </div>
  );

  return (
    <Frame onBack={back} backLabel={backLabel}>
      <div className="grid gap-9 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] lg:gap-11 items-start">
        {/* ── reading column ───────────────────────────────────────────── */}
        <div className="min-w-0 enter">
          <div className="flex flex-wrap gap-[7px]">
            <Tag tone="solid">
              {scheme.nationwide ? 'Central' : (scheme.state || (scheme.states || [])[0] || 'State')}
            </Tag>
            {cat && <Tag>{cat.en}</Tag>}
            <Tag tone="open">{targeted ? 'Written for you' : 'Open to all citizens'}</Tag>
          </div>

          {/* Long in English, longer again in Tamil. Text face, balanced wrap,
              never a display face and never clipped. Both languages, always. */}
          <h1 className="scheme-name mt-4 mb-0 text-[26px] lg:text-[40px] lg:leading-[1.14]
                         lg:tracking-[-.038em] font-bold max-w-[24ch]">
            {scheme.name_plain}
          </h1>
          {scheme.name_ta && (
            <div className="scheme-name ta mt-2 lg:mt-3 text-[16px] lg:text-[20px] font-normal text-ink-60"
                 lang="ta">
              {scheme.name_ta}
            </div>
          )}
          {scheme.name_official && scheme.name_official !== scheme.name_plain && (
            <div className="scheme-name mt-2 text-[13.5px] font-normal text-ink-40 max-w-[64ch]">
              {decode(scheme.name_official)}
            </div>
          )}

          {/* Why this citizen is looking at it — before the money, not after. */}
          {vault && (
            <div className="mt-5 lg:mt-7 rounded-panel border border-rule-16 bg-bloom-lav/10
                            px-4 py-4 lg:px-6 lg:py-6">
              <MatchReason scheme={scheme} profile={vault} lang={lang} />
              <p className="mt-3 mb-0 max-w-[60ch] text-[13px] lg:text-[14px] leading-[1.6] text-ink-70">
                These answers are the reason. Change any of them in your profile and this scheme
                may drop out of your list.
              </p>
              <p className="ta mt-1 mb-0 text-[12.5px] leading-[1.55] text-ink-45" lang="ta">
                உங்கள் பதில்களே காரணம். அவற்றை மாற்றினால் இத்திட்டம் பட்டியலில் இருந்து விலகலாம்.
              </p>
            </div>
          )}

          {/* ── what it pays ────────────────────────────────────────────── */}
          <Eyebrow en="What it pays" ta="என்ன தருகிறது" className="mt-8 lg:mt-10 mb-3" />
          <BenefitBreakdown benefit={scheme.benefit} />

          {/* ── who can get it ──────────────────────────────────────────── */}
          {facts.length > 0 && (
            <>
              <Eyebrow en="Who can get it" ta="யார் பெறலாம்" className="mt-8 lg:mt-10 mb-3" />
              <dl className="m-0 rounded-panel border border-rule-14 overflow-hidden
                             flex flex-col gap-px bg-rule-12">
                {facts.map((f) => (
                  <div
                    key={f.en + f.value}
                    className="bg-white px-4 py-3 flex justify-between gap-4
                               lg:grid lg:grid-cols-[210px_1fr] lg:gap-6 lg:px-5 lg:py-4"
                  >
                    <dt className="shrink-0">
                      <span className="block text-[13.5px] lg:text-[14px] text-ink-55">{f.en}</span>
                      <span className="ta block text-[11.5px] text-ink-30" lang="ta">{f.ta}</span>
                    </dt>
                    <dd className="m-0 text-[13.5px] lg:text-[14.5px] font-medium text-right lg:text-left">
                      {f.value}
                    </dd>
                  </div>
                ))}
              </dl>
              {conditions && (
                <p className="mt-2.5 mb-0 max-w-[68ch] text-[13px] leading-[1.65] text-ink-45">
                  Also on the record: {conditions}
                </p>
              )}
            </>
          )}

          {/* ── documents · how to apply ────────────────────────────────── */}
          <div className="grid gap-8 lg:grid-cols-2 lg:gap-6 mt-8 lg:mt-10">
            <div>
              <Eyebrow en="Documents" ta="தேவையான ஆவணங்கள்" className="mb-3" />
              <div className="panel px-4 py-4 lg:px-5 lg:py-5">
                {docs.length > 0 ? (
                  <>
                    <ul className="m-0 p-0 list-none flex flex-col gap-2.5">
                      {docs.map((d) => (
                        <li key={d} className="flex gap-2.5 items-start text-[14.5px] lg:text-[15px]">
                          <span className="mt-[7px] w-[7px] h-[7px] rounded-[1px] bg-ink shrink-0"
                                aria-hidden="true" />
                          <span>{decode(d)}</span>
                        </li>
                      ))}
                    </ul>
                    <p className="mt-3.5 pt-3 mb-0 border-t border-rule-10 text-[12.5px] leading-[1.6] text-ink-30">
                      Only about 19% of schemes publish a document list. This one does. Where a
                      scheme does not, Sevai leaves this section empty rather than guessing.
                    </p>
                  </>
                ) : (
                  <>
                    <p className="m-0 text-[14.5px] leading-[1.6] text-ink-60">
                      This scheme has not published a document list.
                    </p>
                    <p className="ta m-0 mt-1 text-[12.5px] leading-[1.55] text-ink-40" lang="ta">
                      இத்திட்டம் ஆவணப் பட்டியலை வெளியிடவில்லை.
                    </p>
                    <p className="mt-3.5 pt-3 mb-0 border-t border-rule-10 text-[12.5px] leading-[1.6] text-ink-30">
                      Only about 19% of schemes publish one. Rather than guess at the usual
                      documents and send you to an office without the right paper, Sevai leaves
                      this empty. Check the official page before you travel.
                    </p>
                  </>
                )}
              </div>
            </div>

            {modes.length > 0 && (
              <div>
                <Eyebrow en="How to apply" ta="எப்படி விண்ணப்பிப்பது" className="mb-3" />
                <div className="flex flex-col gap-2.5">
                  {modes.map((m) => (
                    <div key={m} className="panel-flat bg-white px-4 py-3 lg:py-3.5">
                      <div className="text-[14.5px]">{MODE_LABEL[m] ? MODE_LABEL[m].en : m}</div>
                      {MODE_LABEL[m] && (
                        <div className="ta text-[12.5px] text-ink-40 mt-[2px]" lang="ta">
                          {MODE_LABEL[m].ta}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                {deadline && (
                  <div className="mt-2.5 panel-flat px-4 py-3">
                    <div className="mono text-[9.5px] tracking-[.12em] text-ink-55">
                      Applications close
                    </div>
                    <div className="tabular text-[15px] font-medium mt-1">{deadline}</div>
                    <div className="ta text-[12.5px] text-ink-40" lang="ta">
                      விண்ணப்பிக்க கடைசி நாள்
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── what it is ──────────────────────────────────────────────── */}
          {(bullets.length > 0 || scheme.description_long) && (
            <>
              <Eyebrow en="What this is" ta="இது என்ன" className="mt-8 lg:mt-10 mb-3" />
              <div className="panel px-4 py-4 lg:px-6 lg:py-5">
                {bullets.length > 0 && (
                  <ul className="m-0 p-0 list-none flex flex-col gap-2.5">
                    {bullets.map((b, i) => (
                      <li key={i} className="flex gap-2.5 text-[14.5px] lg:text-[15.5px] leading-[1.6] text-ink-70"
                          lang={lang === 'ta' && scheme.description_simple_ta ? 'ta' : 'en'}>
                        <span className="mt-[9px] w-[5px] h-[5px] rounded-full bg-ink/25 shrink-0"
                              aria-hidden="true" />
                        <span>{b}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {scheme.description_long && (
                  <p className={`${bullets.length ? 'mt-4 pt-4 border-t border-rule-10' : ''} mb-0
                                 max-w-[72ch] text-[14px] leading-[1.7] text-ink-45`}>
                    {decode(scheme.description_long)}
                  </p>
                )}
              </div>
            </>
          )}

          {/* Phone: the note and the actions live at the end of the column,
              exactly where the source puts them. Desktop takes them from the
              sticky rail instead. */}
          <div className="lg:hidden">
            <div className="mt-7 panel-flat px-4 py-4">
              <LeavingNote />
            </div>
            <div className="mt-4">
              <Actions />
            </div>
          </div>
        </div>

        {/* ── apply rail (desktop) ─────────────────────────────────────── */}
        <aside className="hidden lg:flex flex-col gap-3.5 sticky top-6">
          <div className="panel px-6 py-6">
            <div className="mono text-[10px] tracking-[.12em] text-ink-55">{railEyebrow}</div>
            {hasFigure ? (
              <>
                {/* The qualifier sits on its own line. Inline, it wrapped
                    mid-phrase against the 34px figure and read as a broken
                    sentence — and on a loan the qualifier is the part that
                    must not be missed. */}
                <div className="tabular mt-2 text-[34px] font-extrabold leading-[1.06] tracking-[-.042em]">
                  {headline.primary}
                </div>
                <div className="mt-1 text-[15px] leading-[1.45] font-medium tracking-[-.01em] text-ink-60">
                  {headline.secondary}
                </div>
                <div className="ta mt-1 text-[13px] text-ink-40" lang="ta">
                  {headlineTa.secondary}
                </div>
              </>
            ) : (
              <>
                <div className="mt-2 text-[16px] leading-[1.5] text-ink-60">Amount not published</div>
                <div className="ta mt-1 text-[13px] text-ink-40" lang="ta">
                  தொகை அறிவிக்கப்படவில்லை
                </div>
              </>
            )}

            <div className="h-px bg-rule-12 my-5" />
            <Actions stacked />
            <LeavingNote className="mt-4" />
          </div>

          <div className="rounded-panel border border-rule-14 px-5 py-4">
            <div className="mono text-[9.5px] tracking-[.11em] text-ink-25 leading-[1.8]">
              Source · myscheme.gov.in
              {normalised && <><br />Normalised {normalised}</>}
              {isOfficial && <><br />Direct official portal</>}
            </div>
            {scheme.ministry && (
              <div className="mt-2.5 text-[12.5px] leading-[1.55] text-ink-40">
                Administered by {decode(scheme.ministry)}
              </div>
            )}
            <div className="ta mt-2 text-[12px] leading-[1.5] text-ink-30" lang="ta">
              இறுதி முடிவு அரசுத் துறையினுடையது.
            </div>
          </div>
        </aside>
      </div>

      {/* Provenance on the phone, where the rail cannot go. */}
      <div className="lg:hidden mt-8 pt-5 border-t border-rule-10">
        <div className="mono text-[9.5px] tracking-[.11em] text-ink-25 leading-[1.8]">
          Source · myscheme.gov.in{normalised && <> · Normalised {normalised}</>}
        </div>
        {scheme.ministry && (
          <div className="mt-1.5 text-[12.5px] leading-[1.55] text-ink-40">
            Administered by {decode(scheme.ministry)}
          </div>
        )}
        <div className="ta mt-1.5 text-[12px] leading-[1.5] text-ink-30" lang="ta">
          இறுதி முடிவு அரசுத் துறையினுடையது. சேவை தகுதியை உறுதி செய்யாது.
        </div>
      </div>
    </Frame>
  );
}
