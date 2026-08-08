import { useMemo, useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useVault } from '../hooks/useVault.js';
import { useLanguage } from '../hooks/useLanguage.js';
import { QUESTIONS } from '../data/profileSchema.js';
import { getAuditLog } from '../utils/sahayakMock.js';
import SahayakMode from '../components/SahayakMode.jsx';
import { triggerDemoNotification } from '../utils/alertEngine.js';
import { useSchemes } from '../utils/schemesStore.js';

/**
 * Profile — ported from the Claude Design source (Sevai.dc.html, isWProfile).
 *
 * Three decisions carry this screen, and all three survive the port.
 *
 * 1. The field list is DERIVED FROM `QUESTIONS`, never hand-written. An earlier
 *    version kept its own array and drifted: it was still editing `district` and
 *    `taluk` long after onboarding had stopped asking for them, so a citizen
 *    could edit fields the matcher no longer read. Each row re-uses the exact
 *    question's own options, so the two can never disagree.
 *
 * 2. Sensitive answers are masked until the citizen asks for them, one row at a
 *    time. This is frequently a shared phone; caste, disability, marital and
 *    maternity status must not simply sit on the glass for whoever picks it up
 *    next. Masked, they read as mono dots — present, accounted for, unreadable.
 *
 * 3. The right-hand rail is the citizen's control over the product rather than
 *    over their data: what may interrupt them, who has acted on their behalf,
 *    and the single button that ends the relationship entirely.
 */

// Mirrors the SENSITIVE set in Thread.jsx — these never render unasked.
const PRIVATE_KEYS = new Set(['caste', 'disability', 'marital_status', 'maternity']);

/**
 * Short column labels. The QUESTIONS entries carry a full spoken question
 * ("Which state do you live in?"), which is right when it is being asked and
 * wrong as a row label. Only the wording lives here — the field set itself is
 * still whatever onboarding asked, so the two cannot drift.
 */
const LABELS = {
  state: ['State', 'மாநிலம்'],
  age: ['Age', 'வயது'],
  gender: ['Gender', 'பாலினம்'],
  caste: ['Community', 'சமூகம்'],
  ration_card: ['Ration card', 'குடும்ப அட்டை'],
  occupation: ['Work', 'வேலை'],
  disability: ['Disability', 'மாற்றுத்திறன்'],
  student_level: ['Studying', 'படிப்பு'],
  last_exam_pct: ['Last exam', 'கடைசித் தேர்வு'],
  institution_type: ['Institution', 'கல்வி நிறுவனம்'],
  land_tenure: ['Land tenure', 'நில உரிமை'],
  land_acres: ['Land size', 'நில அளவு'],
  livestock: ['Livestock', 'கால்நடை'],
  welfare_board_registered: ['Welfare board', 'நல வாரியம்'],
  maternity: ['Maternity', 'தாய்மை'],
  marital_status: ['Marital status', 'திருமண நிலை'],
  drawing_pension: ['Pension', 'ஓய்வூதியம்'],
  housing_status: ['Housing', 'வீட்டுவசதி'],
};

// Categories a citizen can mute. Includes the v2 additions, welfare and sports.
const ALERT_CATEGORIES = [
  ['farming', 'Farming', 'விவசாயம்'],
  ['education', 'Education', 'கல்வி'],
  ['health', 'Health', 'சுகாதாரம்'],
  ['housing', 'Housing', 'வீட்டுவசதி'],
  ['women', 'Women', 'மகளிர்'],
  ['employment', 'Employment', 'வேலைவாய்ப்பு'],
  ['business', 'Business', 'வணிகம்'],
  ['elderly', 'Elderly', 'முதியோர்'],
  ['disability', 'Disability', 'மாற்றுத்திறன்'],
  ['welfare', 'Welfare', 'நலத்திட்டம்'],
  ['sports', 'Sports', 'விளையாட்டு'],
];

// Units for the numeric answers, used only when the stored value falls outside
// the offered bands. A bare "1.5" in a row labelled "Land size" is unreadable.
const UNITS = { land_acres: ['acres', 'ஏக்கர்'], age: [null, null] };

/** The label the citizen themselves chose, in both languages. */
function answerLabel(q, value) {
  if (value === undefined || value === null || value === '') return null;
  const match = (q.options || []).find((o) => o.value === value);
  if (match) return { en: match.en, ta: match.ta };
  if (typeof value === 'boolean') return value ? { en: 'Yes', ta: 'ஆம்' } : { en: 'No', ta: 'இல்லை' };
  const [unitEn, unitTa] = UNITS[q.key] || [];
  return {
    en: unitEn ? `${value} ${unitEn}` : String(value),
    ta: unitTa ? `${value} ${unitTa}` : null,
  };
}

export default function Profile() {
  const { vault, setVault, resetVault } = useVault();
  const { lang, setLang } = useLanguage();
  const loc = useLocation();
  const ta = lang === 'ta';

  const [editing, setEditing] = useState(null);
  const [peek, setPeek] = useState({});
  const [showSahayak, setShowSahayak] = useState(false);
  const [nameDraft, setNameDraft] = useState(null);

  // The desktop rail's Sahayak entry links here with #sahayak, so the assisted
  // flow opens where its audit log already lives.
  useEffect(() => {
    if (loc.hash === '#sahayak') setShowSahayak(true);
  }, [loc.hash]);

  const audit = getAuditLog();
  const { schemes, loading: schemesLoading } = useSchemes(vault.state);

  // Only the questions this citizen would actually be asked. A non-farmer never
  // sees a land-tenure row at all.
  const visible = useMemo(
    () => QUESTIONS.filter((q) => (q.askWhen ? q.askWhen(vault) : true)),
    [vault],
  );

  /**
   * Write one answer, then drop any answer whose question no longer applies — a
   * citizen who changes "farming" to "salaried job" must not keep an orphaned
   * land-tenure answer that the matcher would still read.
   */
  const applyAnswer = (key, value) => {
    setVault((prev) => {
      const next = { ...prev, [key]: value };
      for (const q of QUESTIONS) {
        if (q.askWhen && !q.askWhen(next) && next[q.key] != null) next[q.key] = null;
      }
      return next;
    });
    setEditing(null);
  };

  const saveName = () => {
    setVault({ name: (nameDraft || '').trim() });
    setNameDraft(null);
  };

  // Demo only, and only ever with a scheme that publishes a real cash figure —
  // a scheme with no published amount would put an invented ₹0 in the alert.
  const demoScheme = useMemo(
    () => (schemes || []).find((s) => (s.benefit?.cash ?? 0) > 0) || null,
    [schemes],
  );

  const fireDemoAlert = async () => {
    if (!demoScheme) return;
    const fired = await triggerDemoNotification(
      { ...demoScheme, benefit_amount: demoScheme.benefit.cash },
      lang,
    );
    if (!fired) {
      alert(
        ta
          ? 'Notification அனுமதி தேவை — browser settings-ல் அனுமதிக்கவும்'
          : 'Please allow notifications in browser settings first',
      );
    }
  };

  const cats = vault.alert_categories ?? {};

  return (
    <div className="relative">
      <div className="bloom bloom-header" aria-hidden="true" />

      <div className="relative mx-auto w-full max-w-[1080px] px-5 sm:px-8 lg:px-11 pt-8 sm:pt-10 pb-14">
        {/* ── header ───────────────────────────────────────────────────────── */}
        <div className="flex items-start justify-between gap-5 flex-wrap">
          <div className="min-w-0">
            <h1 className="title-2 m-0">Your answers</h1>
            <div className="ta text-[18px] text-ink-60 mt-2.5" lang="ta">உங்கள் பதில்கள்</div>
          </div>

          <button
            onClick={() => setLang(ta ? 'en' : 'ta')}
            className="mono text-[10px] tracking-[.11em] text-ink-55 border border-rule-20 rounded-[3px]
                       px-2.5 py-1.5 hover:border-ink hover:text-ink transition-colors lg:hidden"
            lang={ta ? 'en' : 'ta'}
          >
            {ta ? 'English' : 'தமிழ்'}
          </button>
        </div>

        {/* ── the promise, restated where the data actually sits ───────────── */}
        <div className="panel mt-6 px-5 sm:px-[22px] py-[18px] flex gap-3 items-start max-w-[82ch] bg-white/80">
          <span className="w-2.5 h-2.5 rounded-[2px] bg-ink mt-[5px] flex-none" aria-hidden="true" />
          <div>
            <div className="text-[15px] leading-[1.6] text-ink-90">
              Stored only on this device. Sevai has no account, no server copy and no way to recover
              these answers if you clear them.
            </div>
            <div className="ta text-[13.5px] leading-[1.5] text-ink-40 mt-1" lang="ta">
              இந்தச் சாதனத்தில் மட்டுமே சேமிக்கப்படுகிறது.
            </div>
          </div>
        </div>

        <div className="grid lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-8 lg:gap-10 mt-8 items-start">
          {/* ── the answers ────────────────────────────────────────────────── */}
          <div className="min-w-0">
            {/* Your name — not a question, but the first thing on the record. */}
            <div className="panel px-5 py-4 flex items-center justify-between gap-4 flex-wrap">
              <div className="min-w-0">
                <div className="mono text-[10px] tracking-[.12em] text-ink-25">Name</div>
                {nameDraft === null ? (
                  <div className="text-[15px] font-medium tracking-[-.012em] mt-1 break-words">
                    {vault.name || <span className="text-ink-25">Not given</span>}
                  </div>
                ) : (
                  <input
                    autoFocus
                    value={nameDraft}
                    onChange={(e) => setNameDraft(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && saveName()}
                    placeholder={ta ? 'பெயர்' : 'Name'}
                    className="mt-1.5 w-[240px] max-w-full border border-rule-16 rounded-flat px-3 py-2
                               text-[15px] bg-white outline-none focus:border-ink"
                  />
                )}
              </div>
              {nameDraft === null ? (
                <MetaButton onClick={() => setNameDraft(vault.name || '')}>
                  {vault.name ? 'Edit' : 'Add'}
                </MetaButton>
              ) : (
                <div className="flex gap-2 items-center">
                  <MetaButton onClick={() => setNameDraft(null)}>Cancel</MetaButton>
                  <MetaButton onClick={saveName} solid>Save</MetaButton>
                </div>
              )}
            </div>

            {/* One row per question actually asked. */}
            <div className="mt-4 border border-rule-14 rounded-panel overflow-hidden bg-white">
              {visible.map((q, i) => (
                <FieldRow
                  key={q.key}
                  q={q}
                  first={i === 0}
                  value={vault[q.key]}
                  isPrivate={PRIVATE_KEYS.has(q.key)}
                  revealed={!!peek[q.key]}
                  onReveal={() => setPeek((p) => ({ ...p, [q.key]: !p[q.key] }))}
                  isEditing={editing === q.key}
                  onOpen={() => setEditing(editing === q.key ? null : q.key)}
                  onPick={(v) => applyAnswer(q.key, v)}
                />
              ))}
            </div>

            <p className="text-[13px] leading-[1.6] text-ink-30 mt-3 mb-0 max-w-[70ch]">
              These rows come from the same question definitions as onboarding, so the two can never
              drift apart. Change one and your matches are recalculated on this device.
            </p>
            <p className="ta text-[12.5px] leading-[1.55] text-ink-25 mt-1 mb-0 max-w-[52ch]" lang="ta">
              ஒரு பதிலை மாற்றினால் உங்கள் பொருத்தங்கள் உடனே மீண்டும் கணக்கிடப்படும்.
            </p>

            {/* Not questions — kept only to pre-fill government forms. */}
            <div className="mt-8">
              <div className="mono text-[10px] tracking-[.12em] text-ink-55">Kept only to fill forms</div>
              <div className="ta text-[12.5px] text-ink-30 mt-1" lang="ta">படிவங்களை நிரப்ப மட்டும்</div>

              <div className="mt-3 border border-rule-14 rounded-panel overflow-hidden bg-white">
                <TextRow
                  first
                  label="Last 4 digits of Aadhaar"
                  labelTa="ஆதார் கடைசி 4 இலக்கம்"
                  value={vault.aadhaar_last4}
                  inputMode="numeric"
                  maxLength={4}
                  onSave={(v) => setVault({ aadhaar_last4: v.replace(/\D/g, '').slice(0, 4) })}
                />
                <TextRow
                  label="Annual income — optional"
                  labelTa="ஆண்டு வருமானம் — விருப்பம்"
                  value={vault.annual_income == null ? '' : String(vault.annual_income)}
                  display={
                    vault.annual_income == null
                      ? null
                      : `₹${Number(vault.annual_income).toLocaleString('en-IN')}`
                  }
                  inputMode="numeric"
                  onSave={(v) => {
                    const digits = v.replace(/\D/g, '');
                    setVault({ annual_income: digits === '' ? null : Number(digits) });
                  }}
                />
              </div>
            </div>
          </div>

          {/* ── the rail ───────────────────────────────────────────────────── */}
          <div className="flex flex-col gap-4">
            {/* Alerts */}
            <section className="panel px-5 sm:px-6 py-[22px]">
              <div className="mono text-[10px] tracking-[.12em] text-ink-55">Alerts</div>
              <div className="ta text-[12.5px] text-ink-30 mt-1" lang="ta">அறிவிப்புகள்</div>
              <p className="text-[13px] leading-[1.6] text-ink-40 mt-3 mb-0">
                Which kinds of scheme may interrupt you. Everything else still matches — it simply
                waits on the list.
              </p>

              <div className="flex flex-col gap-3.5 mt-4">
                {ALERT_CATEGORIES.map(([cat, en, taLabel]) => {
                  const on = cats[cat] !== false; // default ON
                  return (
                    <button
                      key={cat}
                      onClick={() => setVault({ alert_categories: { ...cats, [cat]: !on } })}
                      role="switch"
                      aria-checked={on}
                      className="flex items-start justify-between gap-4"
                    >
                      <span className="min-w-0">
                        <span className="block text-[14.5px] font-medium tracking-[-.012em] leading-[1.35]">
                          {en}
                        </span>
                        <span className="ta block text-[12.5px] leading-[1.45] text-ink-30 mt-0.5" lang="ta">
                          {taLabel}
                        </span>
                      </span>
                      <Switch on={on} />
                    </button>
                  );
                })}
              </div>

              <div className="rule-t mt-5 pt-4">
                <div className="mono text-[10px] tracking-[.12em] text-ink-55">
                  Warn me before a deadline
                </div>
                <div className="ta text-[12.5px] text-ink-30 mt-1" lang="ta">
                  காலக்கெடுவுக்கு முன் எச்சரிக்கவும்
                </div>
                <div className="flex gap-2 mt-3 flex-wrap">
                  {[3, 7, 14].map((days) => {
                    const on = (vault.alert_deadline_days ?? 7) === days;
                    return (
                      <button
                        key={days}
                        onClick={() => setVault({ alert_deadline_days: days })}
                        aria-pressed={on}
                        className={`tabular text-[14px] px-3.5 py-2 rounded-flat border transition-colors ${
                          on ? 'bg-ink text-white border-ink' : 'border-rule-16 hover:border-ink'
                        }`}
                      >
                        {days} days
                      </button>
                    );
                  })}
                </div>
                <p className="text-[12.5px] leading-[1.6] text-ink-30 mt-2.5 mb-0">
                  Only a few schemes publish a closing date. The rest stay open and will never raise
                  a deadline alert.
                </p>
              </div>
            </section>

            {/* Assisted access log */}
            <section className="border border-rule-14 rounded-panel px-5 sm:px-6 py-[22px]">
              <div className="mono text-[10px] tracking-[.12em] text-ink-55">Assisted access log</div>
              <div className="ta text-[12.5px] text-ink-30 mt-1" lang="ta">உதவியாளர் செயல்பாடு</div>

              <div className="flex flex-col gap-3 mt-3.5">
                {audit.length === 0 ? (
                  <div className="text-[13.5px] leading-[1.55] text-ink-30">
                    Nobody has opened your profile on your behalf.
                  </div>
                ) : (
                  audit.slice(0, 8).map((a, i) => (
                    <div key={i} className="grid grid-cols-[auto_1fr] gap-2.5">
                      <span className="mono text-[10px] text-ink-15 pt-[3px] tabular">
                        {new Date(a.timestamp)
                          .toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
                          .toUpperCase()}
                      </span>
                      <span className="text-[13.5px] leading-[1.55] text-ink-70">
                        {String(a.sahayak_action || '').replace(/_/g, ' ')}
                        {a.scheme_id ? ` — ${a.scheme_id}` : ''}
                      </span>
                    </div>
                  ))
                )}
              </div>

              <p className="text-[12.5px] leading-[1.6] text-ink-30 mt-3.5 mb-0">
                Every assisted session is written here. Nobody can act for you without a PIN you gave
                them.
              </p>
            </section>

            {/* Sahayak */}
            <button
              onClick={() => setShowSahayak(true)}
              className="sahayak px-5 sm:px-6 py-5 text-left"
            >
              <div className="text-[15px] font-medium tracking-[-.015em]">Sahayak mode</div>
              <div className="ta text-[12.5px] mt-1 text-[color:var(--sah-ink-2)]" lang="ta">
                உதவியாளர் முறை
              </div>
              <p className="text-[13px] leading-[1.55] mt-2 mb-0 text-[color:var(--sah-ink-2)]">
                Hand the phone to a volunteer or a centre operator. Time-boxed, PIN-gated, and every
                action logged above.
              </p>
            </button>

            {/* Demo control — labelled as such, never dressed as product. */}
            <section className="border border-dashed border-rule-20 rounded-panel px-5 sm:px-6 py-5">
              <div className="mono text-[10px] tracking-[.12em] text-ink-25">
                Demo control — not part of the product
              </div>
              <p className="text-[13px] leading-[1.6] text-ink-40 mt-2 mb-3">
                Fires the same push notification a genuinely new match would.
              </p>
              <button
                onClick={fireDemoAlert}
                disabled={!demoScheme}
                className="text-[14px] px-4 py-2.5 rounded-flat border border-rule-20
                           hover:border-ink transition-colors disabled:opacity-40"
              >
                {schemesLoading
                  ? 'Loading schemes…'
                  : demoScheme
                    ? 'Send a sample alert'
                    : 'No scheme with a published amount'}
              </button>
              {demoScheme && (
                <p className="text-[12px] leading-[1.5] text-ink-25 mt-2 mb-0">
                  Will use: {demoScheme.name_plain}
                </p>
              )}
            </section>

            {/* The end of the relationship, stated plainly. */}
            <button
              onClick={() => {
                if (
                  confirm(
                    ta
                      ? 'எல்லாவற்றையும் அழித்து புதிதாகத் தொடங்கவா?'
                      : 'Erase everything on this device and start fresh?',
                  )
                ) {
                  resetVault();
                  location.href = '/';
                }
              }}
              className="border border-dashed border-rule-20 rounded-panel px-5 sm:px-6 py-[18px] text-left
                         hover:border-[#8B2B2B] transition-colors"
            >
              <div className="text-[15px] font-medium tracking-[-.015em]">
                Erase everything on this device
              </div>
              <div className="ta text-[12.5px] text-ink-30 mt-1" lang="ta">
                அனைத்தையும் அழிக்கவும்
              </div>
              <div className="text-[13px] leading-[1.55] text-ink-30 mt-1.5">
                Your answers and your applications. This cannot be undone.
              </div>
            </button>
          </div>
        </div>
      </div>

      {showSahayak && <SahayakMode lang={lang} onExit={() => setShowSahayak(false)} />}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */

/** The mono meta control used for Edit / Reveal / Save. */
function MetaButton({ children, onClick, solid = false }) {
  return (
    <button
      onClick={onClick}
      className={`mono text-[10px] tracking-[.11em] rounded-[3px] px-2.5 py-1.5 flex-none transition-colors ${
        solid
          ? 'bg-ink text-white border border-ink'
          : 'border border-rule-20 text-ink-55 hover:border-ink hover:text-ink'
      }`}
    >
      {children}
    </button>
  );
}

/** The 44×26 track from the source. Ink when on, hairline grey when off. */
function Switch({ on }) {
  return (
    <span
      aria-hidden="true"
      className={`w-11 h-[26px] rounded-full flex-none flex items-center p-[3px] transition-colors ${
        on ? 'bg-ink justify-end' : 'bg-black/[.16] justify-start'
      }`}
    >
      <span className="w-5 h-5 rounded-full bg-white block" />
    </span>
  );
}

/**
 * One question, one answer, and the same options it was first asked with.
 * A private row is masked until this row — not the whole screen — is revealed.
 */
function FieldRow({ q, value, first, isPrivate, revealed, onReveal, isEditing, onOpen, onPick }) {
  const [en, taLabel] = LABELS[q.key] || [q.q.en, q.q.ta];
  const answer = answerLabel(q, value);
  const isLong = q.type === 'state';
  const masked = isPrivate && !revealed;

  return (
    <div className={first ? '' : 'rule-t'}>
      <div className="px-5 py-[15px] grid grid-cols-[minmax(84px,148px)_minmax(0,1fr)_auto] gap-3 sm:gap-4 items-center">
        <div className="min-w-0">
          <div className="text-[13.5px] text-ink-40 leading-[1.35]">{en}</div>
          <div className="ta text-[11.5px] text-ink-25 leading-[1.4] mt-px" lang="ta">{taLabel}</div>
        </div>

        <div className="min-w-0">
          {masked ? (
            <span className="mono text-[14px] tracking-[.16em] text-ink-25">•••••••</span>
          ) : answer ? (
            <>
              <span className="block text-[15px] font-medium tracking-[-.012em] break-words">
                {answer.en}
              </span>
              {answer.ta && answer.ta !== answer.en && (
                <span className="ta block text-[12.5px] text-ink-30 leading-[1.4]" lang="ta">
                  {answer.ta}
                </span>
              )}
            </>
          ) : (
            <span className="text-[14px] text-ink-25">Not answered</span>
          )}
        </div>

        <div className="flex items-center gap-2 justify-self-end">
          {isPrivate && (
            <MetaButton onClick={onReveal}>{revealed ? 'Hide' : 'Reveal'}</MetaButton>
          )}
          {/* A masked row cannot be edited: opening the options would put the
              current answer back on the glass without the citizen asking. */}
          {!masked && (
            <MetaButton onClick={onOpen}>
              {isEditing ? 'Close' : answer ? 'Edit' : 'Add'}
            </MetaButton>
          )}
        </div>
      </div>

      {isEditing && !masked && (
        <div className="px-5 pb-5 -mt-1">
          {/* The question exactly as it was asked, so the edit is the same act. */}
          <div className="text-[14px] text-ink-60 leading-[1.45]">{q.q.en}</div>
          <div className="ta text-[12.5px] text-ink-30 leading-[1.45] mt-px" lang="ta">{q.q.ta}</div>

          <div
            className={`grid gap-2 mt-3 ${
              isLong
                ? 'grid-cols-2 sm:grid-cols-3 max-h-[44vh] overflow-y-auto pr-1'
                : 'sm:grid-cols-2'
            }`}
          >
            {(q.options || []).map((o) => (
              <button
                key={String(o.value)}
                onClick={() => onPick(o.value)}
                className="option !min-h-0 !py-2.5 !px-3.5"
                data-selected={o.value === value ? 'true' : 'false'}
              >
                <span className="block text-[14.5px] leading-[1.3]">{o.en}</span>
                {o.ta && o.ta !== o.en && (
                  <span className="ta block text-[11.5px] leading-[1.4] opacity-70" lang="ta">
                    {o.ta}
                  </span>
                )}
              </button>
            ))}
          </div>

          {q.skippable && value != null && (
            <button
              onClick={() => onPick(null)}
              className="mono text-[10px] tracking-[.11em] text-ink-40 mt-3 hover:text-ink"
            >
              Remove this answer
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** A free-text field. Not a question — kept only to pre-fill application forms. */
function TextRow({ label, labelTa, value, display, onSave, inputMode, maxLength, first }) {
  const [draft, setDraft] = useState(null);
  const shown = display !== undefined ? display : value;

  return (
    <div className={first ? '' : 'rule-t'}>
      <div className="px-5 py-[15px] grid grid-cols-[minmax(84px,148px)_minmax(0,1fr)_auto] gap-3 sm:gap-4 items-center">
        <div className="min-w-0">
          <div className="text-[13.5px] text-ink-40 leading-[1.35]">{label}</div>
          <div className="ta text-[11.5px] text-ink-25 leading-[1.4] mt-px" lang="ta">{labelTa}</div>
        </div>

        <div className="min-w-0">
          {draft === null ? (
            shown ? (
              <span className="text-[15px] font-medium tracking-[-.012em] tabular break-words">
                {shown}
              </span>
            ) : (
              <span className="text-[14px] text-ink-25">Not given</span>
            )
          ) : (
            <input
              autoFocus
              value={draft}
              inputMode={inputMode}
              maxLength={maxLength}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { onSave(draft); setDraft(null); }
              }}
              className="w-full max-w-[220px] border border-rule-16 rounded-flat px-3 py-2 text-[15px]
                         tabular bg-white outline-none focus:border-ink"
            />
          )}
        </div>

        <div className="flex items-center gap-2 justify-self-end">
          {draft === null ? (
            <MetaButton onClick={() => setDraft(value || '')}>{shown ? 'Edit' : 'Add'}</MetaButton>
          ) : (
            <>
              <MetaButton onClick={() => setDraft(null)}>Cancel</MetaButton>
              <MetaButton solid onClick={() => { onSave(draft); setDraft(null); }}>Save</MetaButton>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
