import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { useSchemes, getSchemeById } from '../utils/schemesStore.js';
import { useVault } from '../hooks/useVault.js';
import { useLanguage } from '../hooks/useLanguage.js';
import { QUESTIONS } from '../data/profileSchema.js';
import { MatchReason } from '../components/Thread.jsx';
import { formatBenefit } from '../utils/formatters.js';
import { addApplication } from '../utils/applications.js';
import { appendAudit } from '../utils/sahayakMock.js';
import SuccessAnimation from '../components/SuccessAnimation.jsx';
import CrossSchemeChain from '../components/CrossSchemeChain.jsx';
import DocumentScanner from '../components/DocumentScanner.jsx';
import { StateLoading } from '../components/AsyncStates.jsx';
import { speakImperative } from '../hooks/useTTS.js';
import { verifyDocument } from '../utils/documentVerifier.js';
import { useVoiceTranscript } from '../hooks/useVoiceTranscript.js';
import { createRecorder } from '../utils/speechUtils.js';

/**
 * Apply — ported from the Claude Design source (Sevai.dc.html, isWApply).
 *
 * The design's whole argument is in the first line of copy: *this is a
 * checklist, not an application*. So the page is laid out as a document with a
 * standing right-hand rail — profile, papers, camera on the left; the readiness
 * count and the single outbound link on the right — rather than as a form with
 * a Submit at the bottom. Sevai never posts anything to a government; the
 * citizen leaves for the department's own site and does it themselves.
 *
 * Two things carried over from v2 and one taken away:
 *   • the scheme is looked up from the sharded store, so there is a loading
 *     shape rather than a spinner;
 *   • `vault.district` is gone — the citizen's scope is `vault.state`;
 *   • the review table used to print the citizen's community in plain text.
 *     It no longer does, and there is no reveal control either: this is a
 *     shared phone, and an affordance that can expose caste over someone's
 *     shoulder is a worse defect than the missing row. The screen says the
 *     answer was used and is being withheld, which is the true statement.
 *
 * The document checklist is built from `scheme.documents_required`, published
 * for only ~19% of the corpus. Where it is empty the screen says so; it does
 * not manufacture a plausible list, because a citizen would act on it.
 */

// ── data plumbing ───────────────────────────────────────────────────────────
function useScheme(id, stateName) {
  const { loading, error } = useSchemes(stateName);
  return { scheme: getSchemeById(id), loading, error };
}

// Resolve a stored vault value back to the exact words the citizen tapped, so
// the review reads as their own answer rather than a database code.
const QMAP = new Map(QUESTIONS.map((q) => [q.key, q]));
function answerLabel(key, value, lang) {
  if (value === null || value === undefined || value === '') return null;
  const q = QMAP.get(key);
  const opt = (q?.options || []).find((o) => o.value === value);
  if (opt) return lang === 'ta' ? opt.ta : opt.en;
  if (typeof value === 'boolean') return value ? (lang === 'ta' ? 'ஆம்' : 'Yes') : (lang === 'ta' ? 'இல்லை' : 'No');
  return String(value);
}

// Answers that are used for matching and never drawn on the glass.
const WITHHELD = [
  ['caste', 'Community', 'சமூகம்'],
  ['marital_status', 'Marital status', 'திருமண நிலை'],
  ['disability', 'Disability', 'மாற்றுத்திறன்'],
  ['maternity', 'Maternity', 'தாய்மை'],
];

// Only these keys are ever written back from voice extraction. The endpoint can
// return anything; the vault schema is the authority, not the response.
const VOICE_KEYS = new Set(['name', 'age', 'occupation', 'annual_income', 'state']);
const NUMERIC_KEYS = new Set(['age', 'annual_income']);

// Cash is the only kind that takes full ink; a loan is set in mono in a dashed
// box further down, where it is typographically incapable of reading as cash.
const TONE_INK = {
  cash: 'text-ink',
  subsidy: 'text-ink-80',
  loan: 'text-ink-45',
  insurance: 'text-ink-45',
  inkind: 'text-ink-45',
  unknown: 'text-ink-40',
};

const hostOf = (url) => {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return null; }
};

// ── small type helpers ──────────────────────────────────────────────────────
const Eyebrow = ({ children, className = '' }) => (
  <div className={`mono text-[10.5px] tracking-[.13em] text-ink-55 ${className}`}>{children}</div>
);

// ── Typewriter ──────────────────────────────────────────────────────────────
function TypewriterText({ text, speed = 150 }) {
  const [displayed, setDisplayed] = useState('');
  const reduce = useReducedMotion();
  useEffect(() => {
    const full = String(text || '');
    if (reduce) { setDisplayed(full); return; }
    setDisplayed('');
    if (!full) return;
    let i = 0;
    const id = setInterval(() => {
      i++;
      setDisplayed(full.slice(0, i));
      if (i >= full.length) clearInterval(id);
    }, speed);
    return () => clearInterval(id);
  }, [text, speed, reduce]);
  return (
    <span>
      {displayed}
      {displayed.length < String(text || '').length && (
        <span className="animate-svPulse opacity-50" aria-hidden="true">|</span>
      )}
    </span>
  );
}

export default function Apply() {
  const { id } = useParams();
  const [search] = useSearchParams();
  const isSahayak = search.get('sahayak') === '1';
  const { vault: ownVault, setVault } = useVault();
  const vault = useMemo(() => {
    if (!isSahayak) return ownVault;
    try {
      return JSON.parse(sessionStorage.getItem('sevai_sahayak_beneficiary') || '{}');
    } catch {
      return ownVault;
    }
  }, [isSahayak, ownVault]);
  const { lang } = useLanguage();
  const ta = lang === 'ta';
  const nav = useNavigate();
  const reduce = useReducedMotion();
  const { scheme, loading } = useScheme(id, vault?.state || ownVault?.state);

  const [docs, setDocs] = useState({});
  const [docErrors, setDocErrors] = useState({});
  const [showOCR, setShowOCR] = useState(null);
  const [activeScannerDoc, setActiveScannerDoc] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [showRelated, setShowRelated] = useState(false);
  const startRef = useRef(Date.now());
  const elapsedRef = useRef(0);

  // ── Voice fill state ──────────────────────────────────────────────────────
  const [voiceFillActive, setVoiceFillActive] = useState(false);
  const [voiceFillTranscribing, setVoiceFillTranscribing] = useState(false);
  const [voiceHeard, setVoiceHeard] = useState('');
  const [liveFields, setLiveFields] = useState({});
  const [flash, setFlash] = useState(new Set());
  const recorderRef = useRef(null);
  const voiceTx = useVoiceTranscript();

  // ── Document verification ─────────────────────────────────────────────────
  const handleDoc = async (docName, file) => {
    if (!file) return;
    setShowOCR(docName);
    setDocErrors((e) => { const next = { ...e }; delete next[docName]; return next; });

    const result = await verifyDocument(file);
    setShowOCR(null);

    if (!result.valid) {
      navigator.vibrate?.([200, 100, 200]);
      speakImperative(result.tamil_message, lang);
      setDocErrors((e) => ({ ...e, [docName]: result }));
    } else {
      speakImperative(ta ? 'ஆவணம் சரியாக உள்ளது' : 'Document looks good', lang);
      setDocs((d) => ({ ...d, [docName]: { name: file.name || 'captured.jpg', verified: true } }));
    }
  };

  const handleDocExtracted = useCallback((data) => {
    const docName = activeScannerDoc;
    setActiveScannerDoc(null);
    if (!docName) return;

    setDocs((d) => ({ ...d, [docName]: { name: 'scanned.jpg', verified: true } }));
    setDocErrors((e) => { const next = { ...e }; delete next[docName]; return next; });

    if (data && !data.error) {
      const updates = {};
      if (data.name && !vault.name) updates.name = data.name;
      if (data.gender && !vault.gender) {
        const g = String(data.gender).toLowerCase();
        if (g === 'male' || g === 'female' || g === 'transgender') updates.gender = g;
      }
      if (Object.keys(updates).length > 0) setVault(updates);
    }
  }, [activeScannerDoc, vault, setVault]);

  // ── Voice fill ────────────────────────────────────────────────────────────
  const startVoiceFill = async () => {
    if (!recorderRef.current) recorderRef.current = createRecorder();
    setVoiceFillActive(true);
    setVoiceHeard('');
    voiceTx.reset();
    try {
      await recorderRef.current.start();
      voiceTx.start(lang);
    } catch {
      setVoiceFillActive(false);
    }
  };

  const stopVoiceFill = async () => {
    voiceTx.stop();
    setVoiceFillActive(false);
    setVoiceFillTranscribing(true);
    const blob = await recorderRef.current?.stop();

    const transcript = voiceTx.transcript;
    setVoiceHeard(transcript);

    try {
      const fd = new FormData();
      if (blob) fd.append('audio', blob, 'audio.webm');
      fd.append('language', lang);
      fd.append('field', 'profile');
      fd.append('text', transcript);
      const res = await fetch('/api/extract-intent', { method: 'POST', body: fd });
      const data = await res.json();
      const extracted = data.fields || {};
      setVoiceFillTranscribing(false);

      let delay = 0;
      Object.entries(extracted).forEach(([key, val]) => {
        if (!VOICE_KEYS.has(key)) return;              // vault schema is authority
        if (val == null || val === '') return;
        const display = key === 'annual_income'
          ? `₹${Number(val).toLocaleString('en-IN')}`
          : String(val);
        const at = delay;
        delay += 300;
        setTimeout(() => {
          setLiveFields((prev) => ({ ...prev, [key]: display }));
          setTimeout(() => {
            setFlash((prev) => new Set([...prev, key]));
            setTimeout(() => setFlash((prev) => { const n = new Set(prev); n.delete(key); return n; }), 1200);
            setVault({ [key]: NUMERIC_KEYS.has(key) ? Number(val) : val });
          }, display.length * 155 + 200);
        }, at);
      });
    } catch {
      setVoiceFillTranscribing(false);
    }
  };

  // ── Record that the citizen went ──────────────────────────────────────────
  const handleSubmit = () => {
    if (submitting || !scheme) return;
    setSubmitting(true);
    elapsedRef.current = Math.round((Date.now() - startRef.current) / 1000);
    addApplication({
      scheme_id: scheme.id,
      submitted_at: Date.now(),
      status: 'under_review',
      documents: Object.keys(docs),
      by_sahayak: isSahayak,
    });
    if (isSahayak) {
      appendAudit({ sahayak_action: 'submitted_application', scheme_id: scheme.id, beneficiary_id: vault.id });
    }
    setShowSuccess(true);
  };

  const onSuccessDone = () => { setShowSuccess(false); setShowRelated(true); };

  // ── page frame ────────────────────────────────────────────────────────────
  const shell = (children) => (
    <div className="relative min-h-[100dvh] bg-page overflow-x-hidden">
      <div className="bloom bloom-header" aria-hidden="true" />
      <div className="relative mx-auto w-full max-w-[1120px] px-5 sm:px-9 lg:px-11 pt-8 pb-16">
        {children}
      </div>
    </div>
  );

  // ── not-yet-loaded ────────────────────────────────────────────────────────
  if (!scheme && loading) {
    return shell(
      <StateLoading stateName={vault?.state || ownVault?.state} cards={2} />,
    );
  }

  if (!scheme) {
    return shell(
      <div className="max-w-[640px] pt-6">
        <h1 className="title-2 m-0">We could not find this scheme</h1>
        <div className="ta text-[17px] text-ink-60 mt-2.5" lang="ta">இந்தத் திட்டம் கிடைக்கவில்லை</div>
        <p className="mt-4 mb-0 text-[16px] leading-[1.65] text-ink-90 max-w-[56ch]">
          The link may be out of date, or this scheme may not be offered in your state.
        </p>
        <div className="ta text-[14px] text-ink-45 mt-2" lang="ta">
          இணைப்பு பழையதாக இருக்கலாம், அல்லது இத்திட்டம் உங்கள் மாநிலத்திற்கானது அல்ல.
        </div>
        <button
          onClick={() => nav('/feed')}
          className="mt-6 min-h-[54px] px-6 bg-ink text-white rounded-[4px] text-[15.5px] font-semibold hover:opacity-90 transition-opacity"
        >
          Back to my schemes <span className="ta font-normal opacity-70" lang="ta">· என் திட்டங்கள்</span>
        </button>
      </div>,
    );
  }

  // ── derived ───────────────────────────────────────────────────────────────
  const name = ta && scheme.name_ta ? scheme.name_ta : scheme.name_plain;
  const required = scheme.documents_required || [];
  const doneCount = required.filter((d) => docs[d]).length;
  const allDocsDone = required.length > 0 && doneCount === required.length;
  const b = scheme.benefit || {};
  const money = formatBenefit(b, lang);
  const outbound = scheme.official_url || scheme.application_link;
  const host = hostOf(outbound) || 'myscheme.gov.in';

  // vault.district is gone in v2 — the citizen's scope is their state.
  // Community, marital status, disability and maternity are deliberately absent.
  const fields = [
    { key: 'name',          en: 'Name',           taLabel: 'பெயர்',
      value: liveFields.name ?? (vault.name || null) },
    { key: 'age',           en: 'Age',            taLabel: 'வயது',
      value: liveFields.age ?? (vault.age != null ? String(vault.age) : null) },
    { key: 'gender',        en: 'Gender',         taLabel: 'பாலினம்',
      value: answerLabel('gender', vault.gender, lang) },
    { key: 'state',         en: 'State',          taLabel: 'மாநிலம்',
      value: liveFields.state ?? answerLabel('state', vault.state, lang) },
    { key: 'occupation',    en: 'Occupation',     taLabel: 'வேலை',
      value: liveFields.occupation ?? answerLabel('occupation', vault.occupation, lang) },
    { key: 'ration_card',   en: 'Ration card',    taLabel: 'குடும்ப அட்டை',
      value: answerLabel('ration_card', vault.ration_card, lang) },
    { key: 'annual_income', en: 'Annual income',  taLabel: 'ஆண்டு வருமானம்',
      value: liveFields.annual_income
        ?? (vault.annual_income ? `₹${Number(vault.annual_income).toLocaleString('en-IN')}` : null) },
  ];

  const withheld = WITHHELD.filter(([k]) => vault[k] !== undefined && vault[k] !== null && vault[k] !== '');

  /**
   * Entrance. Deliberately translate-only: an entrance must never gate whether
   * content is VISIBLE on whether an animation completes. Framer Motion drives
   * these on requestAnimationFrame, and rAF is suspended whenever the renderer
   * treats the surface as non-visible — which left this whole page stacked at
   * `opacity: 0` with a working DOM underneath. Same rule as `.enter` in
   * index.css: move it, never fade it.
   */
  const rise = (d = 0) => ({
    initial: reduce ? false : { y: 12 },
    animate: { y: 0 },
    transition: { duration: 0.32, delay: d, ease: [0.22, 1, 0.36, 1] },
  });

  return shell(
    <>
      {/* ── back ─────────────────────────────────────────────────────────── */}
      <button
        onClick={() => nav(-1)}
        className="mono inline-flex items-center gap-2.5 text-[10.5px] tracking-[.12em] text-ink-55 hover:text-ink transition-colors mb-6"
      >
        <span aria-hidden="true">←</span>
        <span className="truncate max-w-[46ch]">Back to {scheme.name_plain}</span>
      </button>

      {/* ── title ────────────────────────────────────────────────────────── */}
      <motion.div {...rise(0)}>
        <h1 className="m-0 text-[30px] sm:text-[36px] font-bold tracking-[-.036em] leading-[1.12]">
          Get ready to apply
        </h1>
        <div className="ta text-[17px] sm:text-[19px] text-ink-60 mt-2.5" lang="ta">
          விண்ணப்பிக்க தயாராகுங்கள்
        </div>
        <p className="mt-4 mb-0 text-[15.5px] sm:text-[16px] leading-[1.6] text-ink-90 max-w-[74ch]">
          This is a checklist, not an application. When everything is ready you will be sent to{' '}
          {host} to apply there yourself.
        </p>
        <div className="ta text-[14px] text-ink-45 mt-2 max-w-[58ch]" lang="ta">
          இது ஒரு சரிபார்ப்புப் பட்டியல் — விண்ணப்பம் அல்ல. தயாரானதும் நீங்களே அரசு தளத்தில் விண்ணப்பிக்க
          அனுப்பப்படுவீர்கள்.
        </div>
      </motion.div>

      <div className="grid gap-9 lg:gap-10 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] items-start mt-9">
        {/* ═══ left column ═══════════════════════════════════════════════ */}
        <div className="min-w-0">
          {/* ── which scheme, and why it is yours ──────────────────────── */}
          <motion.section {...rise(0.03)} className="panel p-5 sm:p-6">
            <Eyebrow>You are applying for</Eyebrow>
            <h2 className="scheme-name text-[19px] sm:text-[21px] mt-3 mb-0 max-w-[34ch]" lang={lang}>
              {name}
            </h2>

            {/* Kinds keep their own grammar. Cash alone gets the display face. */}
            {b.cash ? (
              <div className="mt-4">
                <div className="figure-sm tabular text-ink">{money.primary}</div>
                <div className="mono text-[10px] tracking-[.12em] text-ink-55 mt-1.5">{money.secondary}</div>
              </div>
            ) : (
              <div className={`mt-3.5 text-[15px] ${TONE_INK[money.tone] || 'text-ink'}`}>
                <span className="font-medium">{money.primary}</span>
                <span className="text-ink-40"> · {money.secondary}</span>
              </div>
            )}

            {/* Credit is mono, inside a dashed box. It cannot read as cash. */}
            {b.cash > 0 && b.loan_ceiling > 0 && (
              <div className="mt-3.5 border border-dashed border-rule-22 rounded-[4px] px-4 py-3 flex flex-wrap items-center justify-between gap-3">
                <span className="mono text-[9.5px] tracking-[.12em] text-ink-45">
                  Credit available — to be repaid
                </span>
                <span className="mono tabular text-[14px] tracking-[.04em] text-ink-45 flex-none">
                  {formatBenefit({ loan_ceiling: b.loan_ceiling }, lang).primary}
                </span>
              </div>
            )}

            {vault && <MatchReason scheme={scheme} profile={vault} lang={lang} className="mt-5" />}
          </motion.section>

          {/* ── the profile this will use ──────────────────────────────── */}
          <motion.section {...rise(0.06)} className="mt-8">
            <div className="flex items-end justify-between gap-4 flex-wrap mb-3">
              <Eyebrow>The profile this will use</Eyebrow>
              <button
                onClick={voiceFillActive ? stopVoiceFill : startVoiceFill}
                disabled={voiceFillTranscribing}
                className="mono text-[10px] tracking-[.11em] text-ink-55 border border-rule-20 rounded-[3px] px-2.5 py-1.5 hover:border-ink hover:text-ink transition-colors disabled:opacity-50"
              >
                {voiceFillTranscribing ? 'Working through it…' : voiceFillActive ? 'Stop and fill' : 'Fill by speaking'}
              </button>
            </div>

            {/* Plain conditionals, not AnimatePresence. These two panels ARE
                the feedback that the microphone is working; a fade that stalls
                would hide them, and a stalled `exit` would strand them on
                screen forever. `.enter` moves them in without touching
                opacity, so they are readable whether or not it runs. */}
            {voiceFillActive && (
              <div className="enter panel-flat px-4 py-3 mb-2.5 flex items-center gap-2.5">
                <span className="w-2 h-2 rounded-full bg-ink animate-svPulse flex-none" aria-hidden="true" />
                <span className="text-[15px] text-ink-80" lang={lang}>
                  {voiceTx.transcript || (ta ? 'பேசுங்கள்…' : 'Speak now…')}
                </span>
              </div>
            )}
            {voiceHeard && !voiceFillActive && !voiceFillTranscribing && (
              <div className="enter panel-flat px-4 py-3 mb-2.5">
                <Eyebrow>What we heard</Eyebrow>
                <div className="mt-1 text-[15px] text-ink-80" lang={lang}>{voiceHeard}</div>
              </div>
            )}

            {/* Hairline-separated rows, not a card per field. */}
            <dl className="m-0 flex flex-col gap-px bg-rule-12 border border-rule-14 rounded-[6px] overflow-hidden">
              {fields.map((f) => (
                <div
                  key={f.key}
                  className={`grid grid-cols-[minmax(90px,180px)_minmax(0,1fr)] gap-4 items-baseline px-4 sm:px-5 py-3.5 transition-colors duration-300 ${
                    flash.has(f.key) ? 'bg-violet-mark' : 'bg-white'
                  }`}
                >
                  <dt className="min-w-0">
                    <span className="block text-[13.5px] text-ink-40">{f.en}</span>
                    <span className="ta block text-[11.5px] text-ink-30" lang="ta">{f.taLabel}</span>
                  </dt>
                  <dd className="m-0 text-[15.5px] leading-[1.45] text-ink break-words" lang={lang}>
                    {f.value == null ? (
                      <span className="text-ink-25">not given · <span className="ta" lang="ta">சொல்லப்படவில்லை</span></span>
                    ) : f.key in liveFields ? (
                      <TypewriterText text={String(f.value)} speed={150} />
                    ) : (
                      String(f.value)
                    )}
                  </dd>
                </div>
              ))}
            </dl>

            {/* Used for matching, never drawn. No reveal control — this is a
                shared phone and the design's own rule outranks the mockup's. */}
            {withheld.length > 0 && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {withheld.map(([k, en, taLabel]) => (
                  <span
                    key={k}
                    className="mono text-[10.5px] tracking-[.1em] text-ink-40 border border-dashed border-rule-22 rounded-full px-3 py-1.5"
                  >
                    {en} ·•••
                    <span className="ta ml-1.5 text-ink-30" lang="ta">{taLabel}</span>
                  </span>
                ))}
              </div>
            )}
            <p className="mt-2.5 mb-0 text-[13px] leading-[1.6] text-ink-30 max-w-[62ch]">
              Community and marital status are used to check schemes but are never shown here, on any
              screen, or to anyone helping you.
            </p>
            <div className="ta text-[12.5px] text-ink-30 mt-1 max-w-[52ch]" lang="ta">
              சமூகம், திருமண நிலை ஆகியவை திட்டங்களைச் சரிபார்க்கப் பயன்படுகின்றன — திரையில் காட்டப்படாது.
            </div>
            <p className="mt-2.5 mb-0 text-[13px] text-ink-30">
              Stored only on this device.
              <span className="ta ml-1.5" lang="ta">இந்த சாதனத்தில் மட்டுமே சேமிக்கப்பட்டது</span>
            </p>
          </motion.section>

          {/* ── documents ──────────────────────────────────────────────── */}
          <motion.section {...rise(0.09)} className="mt-9">
            <Eyebrow className="mb-3">Documents you will need</Eyebrow>

            {required.length === 0 ? (
              // Real but sparse: only ~19% of schemes publish a document list. A
              // plausible-looking invented list is worse than none, because the
              // citizen would carry the wrong papers to the office.
              <div className="border border-dashed border-rule-22 rounded-[5px] px-4 py-4">
                <p className="m-0 text-[15px] leading-[1.6] text-ink-60 max-w-[60ch]">
                  This scheme has not published a document list. Check the official page before you go —
                  we will not guess at one.
                </p>
                <div className="ta text-[13px] text-ink-40 mt-1.5 max-w-[52ch]" lang="ta">
                  இத்திட்டம் ஆவணப் பட்டியலை வெளியிடவில்லை. நாங்கள் ஊகிக்க மாட்டோம்.
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-2.5">
                {required.map((d) => {
                  const done = !!docs[d];
                  const err = docErrors[d];
                  return (
                    <div key={d}>
                      <label
                        className={`block cursor-pointer border rounded-[4px] bg-white px-4 py-3.5 transition-colors ${
                          done ? 'border-ink' : err ? 'border-rule-22' : 'border-rule-16 hover:border-ink'
                        }`}
                      >
                        <span className="flex items-start gap-3.5">
                          <span
                            className={`w-[22px] h-[22px] mt-0.5 flex-none rounded-[3px] border flex items-center justify-center text-[12px] ${
                              done ? 'bg-ink border-ink text-white' : 'border-rule-22 text-ink-25'
                            }`}
                            aria-hidden="true"
                          >
                            {done ? '✓' : err ? '!' : ''}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-[15.5px] font-medium tracking-[-.012em] leading-[1.3]">{d}</span>
                            <span className="block text-[12.5px] text-ink-40 mt-1">
                              {done
                                ? 'checked on this device'
                                : err
                                ? err.english_message
                                : 'Tap to take a photo'}
                            </span>
                            <span className="ta block text-[12.5px] text-ink-30 mt-0.5" lang="ta">
                              {done
                                ? 'இந்த சாதனத்திலேயே சரிபார்க்கப்பட்டது'
                                : err
                                ? err.tamil_message
                                : 'புகைப்படம் எடுக்க தட்டுங்கள்'}
                            </span>
                          </span>
                          <span
                            className={`mono text-[9.5px] tracking-[.11em] flex-none px-2 py-1 rounded-[3px] border ${
                              done ? 'border-ink text-ink' : 'border-rule-16 text-ink-30'
                            }`}
                          >
                            {done ? 'Ready' : 'Needed'}
                          </span>
                        </span>
                        <input
                          type="file"
                          accept="image/*"
                          capture="environment"
                          onChange={(e) => handleDoc(d, e.target.files?.[0])}
                          className="hidden"
                        />
                      </label>

                      {!done && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          <button
                            onClick={() => setActiveScannerDoc(d)}
                            className="mono text-[10px] tracking-[.11em] text-ink-55 border border-rule-20 rounded-[3px] px-2.5 py-1.5 hover:border-ink hover:text-ink transition-colors"
                          >
                            Scan with the camera
                          </button>
                          {err && (
                            <label className="mono cursor-pointer text-[10px] tracking-[.11em] text-ink-55 border border-rule-20 rounded-[3px] px-2.5 py-1.5 hover:border-ink hover:text-ink transition-colors">
                              Retake the photo
                              <input
                                type="file"
                                accept="image/*"
                                capture="environment"
                                onChange={(e) => handleDoc(d, e.target.files?.[0])}
                                className="hidden"
                              />
                            </label>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </motion.section>

          {/* ── camera ─────────────────────────────────────────────────── */}
          <motion.section {...rise(0.12)} className="mt-9">
            <Eyebrow className="mb-3">Or scan a document with your camera</Eyebrow>
            <div className="panel p-5 grid gap-6 sm:grid-cols-[minmax(0,290px)_minmax(0,1fr)] items-center">
              <div
                className="rounded-[5px] border-[1.5px] border-dashed border-[rgba(20,20,26,.28)] flex items-center justify-center text-center p-4"
                style={{
                  aspectRatio: '1.6',
                  background:
                    'repeating-linear-gradient(135deg,rgba(20,20,26,.035) 0 8px,transparent 8px 16px)',
                }}
                aria-hidden="true"
              >
                <span className="mono text-[10px] tracking-[.11em] text-ink-30 leading-[1.8]">
                  Camera view<br />hold the card flat
                </span>
              </div>
              <div>
                <div className="text-[16.5px] font-semibold tracking-[-.02em]">Scan a document</div>
                <div className="ta text-[13.5px] text-ink-45 mt-1" lang="ta">
                  ஆவணத்தை ஸ்கேன் செய்யுங்கள்
                </div>
                <p className="mt-3 mb-0 text-[14.5px] leading-[1.6] text-ink-60 max-w-[46ch]">
                  Sevai reads the name and number to fill the form for you. The photograph is never
                  stored and the reading happens on this device.
                </p>
                <button
                  onClick={() => setActiveScannerDoc(required[0] || 'Document')}
                  className="mt-4 min-h-[52px] px-6 bg-ink text-white rounded-[4px] text-[15.5px] font-semibold hover:opacity-90 transition-opacity"
                >
                  Open camera <span className="ta font-normal opacity-70" lang="ta">· கேமராவைத் திற</span>
                </button>
              </div>
            </div>
          </motion.section>
        </div>

        {/* ═══ right rail ════════════════════════════════════════════════ */}
        <motion.aside {...rise(0.06)} className="lg:sticky lg:top-5 flex flex-col gap-3.5 min-w-0">
          <div className="panel px-6 py-6">
            <Eyebrow className="!text-[10px] !tracking-[.12em]">Checklist</Eyebrow>

            {required.length === 0 ? (
              <>
                <div className="text-[19px] font-semibold tracking-[-.02em] mt-2.5 leading-[1.25]">
                  No document list published
                </div>
                <div className="ta text-[13px] text-ink-45 mt-1.5" lang="ta">
                  ஆவணப் பட்டியல் இல்லை
                </div>
              </>
            ) : (
              <>
                <div className="figure-sm tabular mt-2">
                  {doneCount}<span className="text-ink-25">/{required.length}</span>
                </div>
                <div className="text-[14px] leading-[1.6] text-ink-60 mt-1.5">
                  {allDocsDone
                    ? 'Everything on the list is ready.'
                    : `${required.length - doneCount} still to photograph. You can go without them and add them later.`}
                </div>
                <div className="ta text-[12.5px] text-ink-40 mt-1" lang="ta">
                  {allDocsDone ? 'அனைத்தும் தயார்' : 'படம் எடுக்க வேண்டியவை மீதம் உள்ளன'}
                </div>
              </>
            )}

            <div className="h-px bg-rule-12 my-5" />

            <a
              href={outbound}
              target="_blank"
              rel="noopener noreferrer"
              className="min-h-[56px] flex items-center justify-center text-center bg-ink text-white hover:text-white rounded-[4px] text-[15px] font-semibold px-4 hover:opacity-90 transition-opacity"
            >
              Continue to {host} ↗
            </a>

            <p className="mt-3.5 mb-0 text-[13px] leading-[1.6] text-ink-45">
              Sevai does not submit this application. You will fill in the government&rsquo;s own form,
              and the department decides.
            </p>
            <div className="ta text-[12.5px] text-ink-30 mt-1.5" lang="ta">
              சேவை உங்களுக்காக விண்ணப்பிக்காது. அரசுத் துறையே முடிவு செய்யும்.
            </div>
          </div>

          {/* Keeping a record on the device is a separate, quieter act. */}
          <div className="panel-flat px-6 py-5">
            <Eyebrow className="!text-[10px]">Keep a note of this</Eyebrow>
            <p className="mt-2.5 mb-0 text-[13.5px] leading-[1.6] text-ink-60">
              Save a record on this phone that you went, so you can follow it up later.
            </p>
            <button
              disabled={submitting}
              onClick={handleSubmit}
              className="mt-3.5 min-h-[48px] w-full px-4 border border-rule-22 rounded-[4px] text-[14.5px] font-medium hover:border-ink transition-colors disabled:opacity-50"
            >
              {submitting ? 'Saving…' : 'Save this to my applications'}
            </button>
          </div>
        </motion.aside>
      </div>

      {/* ── scanner ──────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {activeScannerDoc && (
          <motion.div
            className="fixed inset-0 z-50 bg-ink/50 flex flex-col justify-end"
            onClick={() => setActiveScannerDoc(null)}
          >
            {/* `y: 24`, not 120: if the spring never runs — rAF is suspended
                whenever the renderer treats the surface as non-visible — a
                sheet parked 120px down is off the bottom of the screen and the
                scanner is unreachable. At 24 a stall is cosmetic. */}
            <motion.div
              initial={reduce ? false : { y: 24 }}
              animate={{ y: 0 }}
              exit={{ y: 24 }}
              transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
              onClick={(e) => e.stopPropagation()}
              className="bg-page rounded-t-[8px] border-t border-rule-16 p-5 pb-8 max-w-lg mx-auto w-full"
            >
              <div className="w-10 h-1 bg-rule-14 rounded-full mx-auto mb-4" aria-hidden="true" />
              <Eyebrow className="text-center">Hold it up to the camera</Eyebrow>
              <div className="ta text-center text-[13px] text-ink-40 mt-1" lang="ta">
                கேமராவில் காட்டுங்கள்
              </div>
              <div className="scheme-name text-center text-[17px] text-ink my-4">{activeScannerDoc}</div>
              <DocumentScanner
                lang={lang}
                autoOpen
                onDataExtracted={handleDocExtracted}
                onClose={() => setActiveScannerDoc(null)}
              />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── on-device check ──────────────────────────────────────────────── */}
      <AnimatePresence>
        {showOCR && (
          <div className="fixed inset-0 z-40 bg-page/90 grid place-items-center px-6">
            <div className="panel max-w-sm w-full text-center px-6 py-6">
              <Eyebrow>Checking</Eyebrow>
              <div className="scheme-name mt-2 text-[18px] text-ink">{showOCR}</div>
              {/* CSS pulse rather than an animated width: a width tween that
                  never runs leaves a 0px bar, which reads as a stuck app. */}
              <div className="mt-4 h-[3px] bg-rule-10 rounded-full overflow-hidden">
                <div className="h-full w-full bg-ink animate-svPulse" />
              </div>
              <p className="mt-4 mb-0 text-[13px] text-ink-45">On this device — no internet needed</p>
              <div className="ta text-[12.5px] text-ink-30 mt-1" lang="ta">
                இந்த சாதனத்திலேயே — இணையம் தேவையில்லை
              </div>
            </div>
          </div>
        )}
      </AnimatePresence>

      {showSuccess && (
        <SuccessAnimation
          schemeName={name}
          elapsedSeconds={elapsedRef.current}
          lang={lang}
          onDone={onSuccessDone}
        />
      )}

      {showRelated && (
        <div
          className="fixed inset-0 z-40 bg-ink/40 grid place-items-end"
          onClick={() => nav('/applications')}
        >
          <motion.div
            initial={reduce ? false : { y: 24 }}
            animate={{ y: 0 }}
            transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
            onClick={(e) => e.stopPropagation()}
            className="bg-page rounded-t-[8px] border-t border-rule-16 p-6 w-full max-w-lg mx-auto"
          >
            <div className="w-10 h-1 bg-rule-14 rounded-full mx-auto mb-5" aria-hidden="true" />
            <Eyebrow>Saved on this device</Eyebrow>
            <div className="ta text-[12.5px] text-ink-30 mt-1" lang="ta">இந்த சாதனத்தில் சேமிக்கப்பட்டது</div>
            <h3 className="scheme-name mt-2.5 text-[20px] text-ink">{name}</h3>
            <div className="mt-5">
              <CrossSchemeChain schemeId={scheme.id} vault={vault} lang={lang} variant="single" />
            </div>
            <button
              onClick={() => nav('/applications')}
              className="mt-5 min-h-[52px] w-full bg-ink text-white rounded-[4px] text-[15.5px] font-semibold hover:opacity-90 transition-opacity"
            >
              See my applications <span className="ta font-normal opacity-70" lang="ta">· என் விண்ணப்பங்கள்</span>
            </button>
          </motion.div>
        </div>
      )}
    </>,
  );
}
