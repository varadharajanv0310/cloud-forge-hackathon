import { useMemo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useVault } from '../hooks/useVault.js';
import { useLanguage } from '../hooks/useLanguage.js';
import { t } from '../data/strings.js';
import { QUESTIONS } from '../data/profileSchema.js';
import Thread, { profileToChips } from '../components/Thread.jsx';
import { getAuditLog } from '../utils/sahayakMock.js';
import SahayakMode from '../components/SahayakMode.jsx';
import { triggerDemoNotification } from '../utils/alertEngine.js';
import { useSchemes } from '../utils/schemesStore.js';
import { categoryEmoji } from '../utils/formatters.js';

/**
 * Profile — the citizen's own record, and the second place the Thread lives.
 *
 * Three decisions carry this screen:
 *
 * 1. The editable field list is DERIVED FROM `QUESTIONS`, never hand-written.
 *    The old version kept its own array and drifted: it was still editing
 *    `district`, `taluk` and `ration_card_number` long after onboarding had
 *    stopped asking for them, so a citizen could edit fields the matcher no
 *    longer read. Each row here shows the exact question that was asked and
 *    re-uses that question's own options to edit it, so drift is impossible.
 *
 * 2. The Thread is the same object they saw during onboarding. Their answers
 *    are not a form they filled in and lost — they are still there, in their
 *    own words, and they are what the matches were made of.
 *
 * 3. Sensitive answers are collapsed behind a deliberate reveal. This is often
 *    a shared phone; caste, disability, marital and maternity status must not
 *    simply sit on screen for whoever picks it up next (DESIGN.md §7).
 */

// Mirrors the SENSITIVE set in Thread.jsx — these never render unasked.
const PRIVATE_KEYS = new Set(['caste', 'disability', 'marital_status', 'maternity']);

// Categories a citizen can mute. Includes the v2 additions, welfare and sports.
const ALERT_CATEGORIES = [
  ['farming', { en: 'Farming', ta: 'விவசாயம்' }],
  ['education', { en: 'Education', ta: 'கல்வி' }],
  ['health', { en: 'Health', ta: 'சுகாதாரம்' }],
  ['housing', { en: 'Housing', ta: 'வீட்டுவசதி' }],
  ['women', { en: 'Women', ta: 'மகளிர்' }],
  ['employment', { en: 'Employment', ta: 'வேலைவாய்ப்பு' }],
  ['business', { en: 'Business', ta: 'வணிகம்' }],
  ['elderly', { en: 'Elderly', ta: 'முதியோர்' }],
  ['disability', { en: 'Disability', ta: 'மாற்றுத்திறன்' }],
  ['welfare', { en: 'Welfare', ta: 'நலத்திட்டம்' }],
  ['sports', { en: 'Sports', ta: 'விளையாட்டு' }],
];

/** The label the citizen themselves chose, in their language. */
function answerLabel(q, value, lang) {
  if (value === undefined || value === null || value === '') return null;
  const match = (q.options || []).find((o) => o.value === value);
  if (match) return lang === 'ta' ? match.ta : match.en;
  if (typeof value === 'boolean') {
    if (lang === 'ta') return value ? 'ஆம்' : 'இல்லை';
    return value ? 'Yes' : 'No';
  }
  return String(value);
}

export default function Profile() {
  const { vault, setVault, resetVault } = useVault();
  const { lang, setLang } = useLanguage();
  const ta = lang === 'ta';
  const reduce = useReducedMotion();

  const [editing, setEditing] = useState(null);
  const [showSahayak, setShowSahayak] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);
  const [privateOpen, setPrivateOpen] = useState(false);
  const [nameDraft, setNameDraft] = useState(null);

  const audit = getAuditLog();
  const { schemes, loading: schemesLoading } = useSchemes(vault.state);

  const chips = useMemo(() => profileToChips(vault, lang), [vault, lang]);

  // Only the questions this citizen would actually be asked. A non-farmer never
  // sees a land-tenure row at all.
  const visible = useMemo(
    () => QUESTIONS.filter((q) => (q.askWhen ? q.askWhen(vault) : true)),
    [vault],
  );
  const openQuestions = visible.filter((q) => !PRIVATE_KEYS.has(q.key));
  const privateQuestions = visible.filter((q) => PRIVATE_KEYS.has(q.key));

  /**
   * Write one answer, then drop any answer whose question no longer applies —
   * a citizen who changes "farming" to "salaried job" must not keep an orphaned
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
    // alertEngine still reads the v1 `benefit_amount`; bridge it from the real
    // v2 figure rather than letting the alert print ₹0.
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

  return (
    <div className="min-h-[100dvh] w-full bg-canvas relative overflow-hidden pb-32">
      <div className="bloom bloom-cool bloom-quiet" aria-hidden="true" />

      <div className="relative z-10 mx-auto w-full max-w-[1120px] px-4 sm:px-6 py-6 sm:py-8">
        {/* ── header ──────────────────────────────────────────────────────── */}
        <header className="flex items-start justify-between gap-4 px-1 mb-6 sm:mb-8">
          <div className="min-w-0">
            <div className="u-meta mb-2" lang={lang}>
              {t('profile_title', lang)}
            </div>
            {nameDraft === null ? (
              <button
                onClick={() => setNameDraft(vault.name || '')}
                className="compact text-left block max-w-full"
                aria-label={ta ? 'பெயரைத் திருத்து' : 'Edit your name'}
              >
                <h1 className="u-display text-q sm:text-q-md text-ink break-words" lang={lang}>
                  {vault.name || (ta ? 'உங்கள் விவரம்' : 'Your profile')}
                </h1>
              </button>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <input
                  autoFocus
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && saveName()}
                  placeholder={ta ? 'பெயர்' : 'Name'}
                  lang={lang}
                  className="rounded-well bg-surface px-4 py-3 text-[17px] text-ink outline-none
                             shadow-[inset_0_0_0_1px_var(--hairline)] focus:shadow-[inset_0_0_0_2px_rgba(20,19,26,0.35)]"
                />
                <button onClick={saveName} className="btn-primary compact !py-2.5 !px-5 !text-[15px]" lang={lang}>
                  {t('save', lang)}
                </button>
                <button onClick={() => setNameDraft(null)} className="btn-ghost compact text-[15px]" lang={lang}>
                  {ta ? 'விடு' : 'Cancel'}
                </button>
              </div>
            )}
          </div>

          <button
            onClick={() => setLang(ta ? 'en' : 'ta')}
            className="btn-ghost compact text-[14px] shrink-0"
            lang={ta ? 'en' : 'ta'}
          >
            {ta ? 'English' : 'தமிழ்'}
          </button>
        </header>

        <div className="grid lg:grid-cols-[minmax(0,1fr)_320px] gap-6 lg:gap-10 items-start">
          {/* ── the answers ───────────────────────────────────────────────── */}
          <div className="min-w-0 space-y-4">
            <section className="surface-tray">
              <div className="surface-plate px-5 sm:px-8 py-6 sm:py-8">
                <div className="u-meta mb-1" lang={lang}>
                  {ta ? 'நீங்கள் அளித்த பதில்கள்' : 'Your answers'}
                </div>
                <p className="text-[14px] text-muted mb-2 max-w-[52ch]" lang={lang}>
                  {ta
                    ? 'இவை தான் உங்கள் திட்டங்களைத் தேர்ந்தெடுக்கின்றன. எப்போது வேண்டுமானாலும் மாற்றலாம்.'
                    : 'These are what your matches are made from. Change any of them, any time.'}
                </p>

                <div className="divide-y divide-hairline">
                  {openQuestions.map((q) => (
                    <FieldRow
                      key={q.key}
                      q={q}
                      value={vault[q.key]}
                      lang={lang}
                      isEditing={editing === q.key}
                      onOpen={() => setEditing(editing === q.key ? null : q.key)}
                      onPick={(v) => applyAnswer(q.key, v)}
                      reduce={reduce}
                    />
                  ))}
                </div>
              </div>
            </section>

            {/* Private answers — deliberately closed. Someone else may be
                holding this phone. */}
            {privateQuestions.length > 0 && (
              <section className="card">
                <button
                  onClick={() => setPrivateOpen((o) => !o)}
                  className="compact w-full flex items-center justify-between gap-3 text-left"
                >
                  <span className="min-w-0">
                    <span className="block font-semibold text-ink" lang={lang}>
                      {ta ? 'தனிப்பட்ட பதில்கள்' : 'Private answers'}
                    </span>
                    <span className="block text-[13px] text-muted mt-0.5" lang={lang}>
                      {ta
                        ? 'இவை திரையில் தானாகக் காட்டப்படுவதில்லை'
                        : 'Kept off the screen unless you ask for them'}
                    </span>
                  </span>
                  <span className="u-meta shrink-0" lang={lang}>
                    {privateOpen ? (ta ? 'மறை' : 'Hide') : ta ? 'காட்டு' : 'Show'}
                  </span>
                </button>

                <AnimatePresence initial={false}>
                  {privateOpen && (
                    <motion.div
                      initial={reduce ? false : { height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
                      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                      className="overflow-hidden"
                    >
                      <div className="divide-y divide-hairline mt-2">
                        {privateQuestions.map((q) => (
                          <FieldRow
                            key={q.key}
                            q={q}
                            value={vault[q.key]}
                            lang={lang}
                            isEditing={editing === q.key}
                            onOpen={() => setEditing(editing === q.key ? null : q.key)}
                            onPick={(v) => applyAnswer(q.key, v)}
                            reduce={reduce}
                          />
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </section>
            )}

            {/* Not questions — kept on file to pre-fill application forms. */}
            <section className="card">
              <div className="u-meta mb-3" lang={lang}>
                {ta ? 'படிவங்களுக்காக மட்டும்' : 'Kept only to fill forms'}
              </div>
              <div className="divide-y divide-hairline">
                <TextRow
                  label={ta ? 'ஆதார் கடைசி 4 இலக்கம்' : 'Last 4 digits of Aadhaar'}
                  value={vault.aadhaar_last4}
                  lang={lang}
                  inputMode="numeric"
                  maxLength={4}
                  onSave={(v) => setVault({ aadhaar_last4: v.replace(/\D/g, '').slice(0, 4) })}
                />
                <TextRow
                  label={ta ? 'ஆண்டு வருமானம் (₹) — விருப்பம்' : 'Annual income (₹) — optional'}
                  value={vault.annual_income == null ? '' : String(vault.annual_income)}
                  display={
                    vault.annual_income == null
                      ? null
                      : `₹${Number(vault.annual_income).toLocaleString('en-IN')}`
                  }
                  lang={lang}
                  inputMode="numeric"
                  onSave={(v) => {
                    const digits = v.replace(/\D/g, '');
                    setVault({ annual_income: digits === '' ? null : Number(digits) });
                  }}
                />
              </div>
            </section>

            {/* ── alert settings ──────────────────────────────────────────── */}
            <section className="card space-y-6">
              <div>
                <div className="font-semibold text-ink" lang={lang}>
                  {ta ? 'எச்சரிக்கை அமைப்புகள்' : 'Alert settings'}
                </div>
                <p className="text-[13px] text-muted mt-0.5" lang={lang}>
                  {ta
                    ? 'எந்த வகைத் திட்டங்கள் வந்தால் உங்களுக்குத் தெரிவிக்க வேண்டும்?'
                    : 'Which kinds of scheme should reach you?'}
                </p>
              </div>

              <div>
                <div className="u-meta mb-2" lang={lang}>
                  {ta ? 'வகைகள்' : 'Categories'}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {ALERT_CATEGORIES.map(([cat, label]) => {
                    const cats = vault.alert_categories ?? {};
                    const enabled = cats[cat] !== false; // default ON
                    return (
                      <button
                        key={cat}
                        onClick={() => setVault({ alert_categories: { ...cats, [cat]: !enabled } })}
                        className="option !px-4 flex items-center gap-2.5 text-[15px]"
                        data-selected={enabled ? 'true' : 'false'}
                        aria-pressed={enabled}
                        lang={lang}
                      >
                        <span aria-hidden="true">{categoryEmoji(cat)}</span>
                        <span className="min-w-0 truncate">{ta ? label.ta : label.en}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <div className="u-meta mb-2" lang={lang}>
                  {ta ? 'கடைசி நாள் நெருங்கும்போது' : 'Warn me when a deadline is within'}
                </div>
                <div className="flex flex-wrap gap-2">
                  {[3, 7, 14].map((days) => (
                    <button
                      key={days}
                      onClick={() => setVault({ alert_deadline_days: days })}
                      className="option !w-auto tabular text-[15px] font-medium text-center"
                      data-selected={(vault.alert_deadline_days ?? 7) === days ? 'true' : 'false'}
                      aria-pressed={(vault.alert_deadline_days ?? 7) === days}
                      lang={lang}
                    >
                      {days} {ta ? 'நாள்' : 'days'}
                    </button>
                  ))}
                </div>
                <p className="text-[13px] text-muted mt-2 max-w-[52ch]" lang={lang}>
                  {ta
                    ? 'சில திட்டங்களுக்கு மட்டுமே கடைசி நாள் அறிவிக்கப்பட்டுள்ளது; மற்றவை தொடர்ந்து திறந்திருக்கும்.'
                    : 'Only a few schemes publish a closing date. The rest stay open, and will not raise a deadline alert.'}
                </p>
              </div>
            </section>

            {/* ── helper activity ─────────────────────────────────────────── */}
            {audit.length > 0 && (
              <section className="card">
                <button
                  onClick={() => setAuditOpen((o) => !o)}
                  className="compact w-full flex items-center justify-between gap-3 text-left"
                >
                  <span className="font-semibold text-ink" lang={lang}>
                    {t('helper_activity', lang)}
                  </span>
                  <span className="u-meta tabular shrink-0">
                    {audit.length} · {auditOpen ? '▲' : '▼'}
                  </span>
                </button>

                <AnimatePresence initial={false}>
                  {auditOpen && (
                    <motion.ul
                      initial={reduce ? false : { height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
                      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                      className="mt-3 space-y-2 overflow-hidden"
                    >
                      {audit.slice(0, 20).map((a, i) => (
                        <li key={i} className="well px-4 py-3">
                          <div className="text-[14px] font-medium text-ink">
                            {String(a.sahayak_action || '').replace(/_/g, ' ')}
                          </div>
                          <div className="text-[12px] text-muted mt-0.5 tabular">
                            {a.scheme_id ? `${a.scheme_id} · ` : ''}
                            {a.beneficiary_id} · {new Date(a.timestamp).toLocaleString()}
                          </div>
                        </li>
                      ))}
                    </motion.ul>
                  )}
                </AnimatePresence>
              </section>
            )}

            {/* ── Sahayak ─────────────────────────────────────────────────── */}
            <button
              onClick={() => setShowSahayak(true)}
              className="card w-full flex items-center gap-4 text-left transition-shadow duration-240
                         ease-composed hover:shadow-e2 active:scale-[0.995]"
            >
              <span className="w-12 h-12 rounded-well bg-surface-sub text-[22px] grid place-items-center shrink-0" aria-hidden="true">
                🧑‍🤝‍🧑
              </span>
              <span className="flex-1 min-w-0">
                <span className="block font-semibold text-ink" lang={lang}>
                  {t('sahayak_login', lang)}
                </span>
                <span className="block text-[13px] text-muted mt-0.5" lang={lang}>
                  {ta ? 'மற்றவர்களுக்காக விண்ணப்பிக்க' : 'Apply on behalf of someone else'}
                </span>
              </span>
              <span className="text-muted shrink-0" aria-hidden="true">›</span>
            </button>

            {/* ── demo control ────────────────────────────────────────────── */}
            <section
              className="rounded-surface p-6 bg-surface/70"
              style={{ boxShadow: 'inset 0 0 0 1px var(--hairline)' }}
            >
              <div className="u-meta mb-2">Demo control — not part of the product</div>
              <p className="text-[13px] text-muted mb-4 max-w-[52ch]" lang={lang}>
                {ta
                  ? 'ஒரு புதிய திட்டம் பொருந்தியது போல் அறிவிப்பு அனுப்பும். ஆப் மூடியிருந்தாலும் வரும்.'
                  : 'Fires the same push notification a genuinely new match would, so it can be shown while the app is closed.'}
              </p>
              <button
                onClick={fireDemoAlert}
                disabled={!demoScheme}
                className="btn-secondary compact !py-3 !px-6 !text-[15px] disabled:opacity-40"
                lang={lang}
              >
                {schemesLoading
                  ? ta ? 'திட்டங்கள் ஏற்றப்படுகின்றன…' : 'Loading schemes…'
                  : demoScheme
                    ? ta ? 'மாதிரி அறிவிப்பு அனுப்பு' : 'Send a sample alert'
                    : ta ? 'பொருத்தமான திட்டம் இல்லை' : 'No scheme with a published amount'}
              </button>
              {demoScheme && (
                <p className="text-[12px] text-muted mt-2 u-scheme-name" lang={lang}>
                  {ta ? 'பயன்படுத்துவது' : 'Will use'}: {demoScheme.name_plain}
                </p>
              )}
            </section>

            {/* ── reset ───────────────────────────────────────────────────── */}
            <div className="pt-2 pb-4 text-center">
              <button
                onClick={() => {
                  if (
                    confirm(
                      ta ? 'எல்லாவற்றையும் அழித்து புதிதாகத் தொடங்கவா?' : 'Erase everything and start fresh?',
                    )
                  ) {
                    resetVault();
                    location.href = '/';
                  }
                }}
                className="btn-ghost compact text-[14px] text-muted"
                lang={lang}
              >
                {ta ? 'சுயவிவரத்தை அழி' : 'Erase this profile'}
              </button>
            </div>
          </div>

          {/* ── the rail: the Thread, and the privacy promise ─────────────── */}
          <aside className="lg:sticky lg:top-8 space-y-4">
            <section className="card">
              <div className="u-meta mb-3" lang={lang}>
                {ta ? 'நீங்கள் சொன்னவை' : 'What you told us'}
              </div>
              {chips.length ? (
                <Thread chips={chips} lang={lang} />
              ) : (
                <p className="text-[14px] text-muted" lang={lang}>
                  {ta ? 'இன்னும் எதுவும் இல்லை.' : 'Nothing here yet.'}
                </p>
              )}
              <p className="text-[13px] text-muted mt-4 leading-relaxed" lang={lang}>
                {ta
                  ? 'ஒவ்வொரு திட்டமும் ஏன் உங்களுக்குக் காட்டப்பட்டது என்பதை இந்தப் பதில்கள் விளக்கும்.'
                  : 'These are the answers each match is explained by, on the scheme card itself.'}
              </p>
            </section>

            <section className="card">
              <div className="flex items-start gap-3">
                <span className="text-[20px] leading-none mt-0.5" aria-hidden="true">🔒</span>
                <div className="min-w-0">
                  <div className="font-semibold text-ink text-[15px]" lang={lang}>
                    {t('device_only', lang)}
                  </div>
                  <p className="text-[13px] text-muted mt-1 leading-relaxed" lang={lang}>
                    {t('profile_privacy', lang)}
                  </p>
                </div>
              </div>
            </section>
          </aside>
        </div>
      </div>

      {showSahayak && <SahayakMode lang={lang} onExit={() => setShowSahayak(false)} />}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   One question, one answer, and the same options it was first asked with.
   ───────────────────────────────────────────────────────────────────────────*/
function FieldRow({ q, value, lang, isEditing, onOpen, onPick, reduce }) {
  const ta = lang === 'ta';
  const current = answerLabel(q, value, lang);
  const isState = q.type === 'state';

  return (
    <div className="py-4 first:pt-0 last:pb-0">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          {/* The exact question they were asked — not a paraphrase of it. */}
          <div className="text-[13px] text-muted leading-snug" lang={lang}>
            {ta ? q.q.ta : q.q.en}
          </div>
          <div
            className={`mt-1 text-[17px] leading-snug break-words ${
              current ? 'font-medium text-ink' : 'text-muted'
            }`}
            lang={lang}
          >
            {current || (ta ? 'பதில் இல்லை' : 'Not answered')}
          </div>
        </div>

        <button
          onClick={onOpen}
          className="btn-ghost compact text-[14px] shrink-0"
          aria-expanded={isEditing}
          lang={lang}
        >
          {isEditing ? (ta ? 'விடு' : 'Close') : current ? t('edit', lang) : ta ? 'சேர்' : 'Add'}
        </button>
      </div>

      <AnimatePresence initial={false}>
        {isEditing && (
          <motion.div
            initial={reduce ? false : { height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="well mt-3 p-3">
              <div
                className={
                  isState
                    ? 'grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-[44vh] overflow-y-auto pr-1'
                    : 'grid gap-2 sm:grid-cols-2'
                }
              >
                {(q.options || []).map((o) => (
                  <button
                    key={String(o.value)}
                    onClick={() => onPick(o.value)}
                    className={`option ${isState ? 'text-[15px]' : 'text-[16px] font-medium'}`}
                    data-selected={o.value === value ? 'true' : 'false'}
                    lang={lang}
                  >
                    {ta ? o.ta : o.en}
                  </button>
                ))}
              </div>

              {q.skippable && value != null && (
                <button
                  onClick={() => onPick(null)}
                  className="btn-ghost compact mt-2 text-[14px] text-muted"
                  lang={lang}
                >
                  {ta ? 'இந்தப் பதிலை நீக்கு' : 'Remove this answer'}
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** A free-text field. Not a question — kept only to pre-fill application forms. */
function TextRow({ label, value, display, lang, onSave, inputMode, maxLength }) {
  const ta = lang === 'ta';
  const [draft, setDraft] = useState(null);
  const shown = display !== undefined ? display : value;

  return (
    <div className="py-4 first:pt-0 last:pb-0">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="text-[13px] text-muted leading-snug" lang={lang}>
            {label}
          </div>
          {draft === null ? (
            <div
              className={`mt-1 text-[17px] leading-snug break-words tabular ${
                shown ? 'font-medium text-ink' : 'text-muted'
              }`}
            >
              {shown || (ta ? 'பதிவு இல்லை' : 'Not given')}
            </div>
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
              className="mt-1.5 w-full rounded-well bg-surface px-4 py-3 text-[17px] text-ink tabular outline-none
                         shadow-[inset_0_0_0_1px_var(--hairline)] focus:shadow-[inset_0_0_0_2px_rgba(20,19,26,0.35)]"
            />
          )}
        </div>

        {draft === null ? (
          <button
            onClick={() => setDraft(value || '')}
            className="btn-ghost compact text-[14px] shrink-0"
            lang={lang}
          >
            {shown ? t('edit', lang) : ta ? 'சேர்' : 'Add'}
          </button>
        ) : (
          <div className="flex items-center gap-1 shrink-0">
            <button onClick={() => setDraft(null)} className="btn-ghost compact text-[14px] text-muted" lang={lang}>
              {ta ? 'விடு' : 'Cancel'}
            </button>
            <button
              onClick={() => { onSave(draft); setDraft(null); }}
              className="btn-primary compact !py-2 !px-4 !text-[14px]"
              lang={lang}
            >
              {t('save', lang)}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
