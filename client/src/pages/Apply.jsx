import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { useSchemes, getSchemeById } from '../utils/schemesStore.js';
import { useVault } from '../hooks/useVault.js';
import { useLanguage } from '../hooks/useLanguage.js';
import { t } from '../data/strings.js';
import { QUESTIONS } from '../data/profileSchema.js';
import { MatchReason } from '../components/Thread.jsx';
import { formatBenefit, benefitToneClass } from '../utils/formatters.js';
import { addApplication } from '../utils/applications.js';
import { appendAudit } from '../utils/sahayakMock.js';
import SuccessAnimation from '../components/SuccessAnimation.jsx';
import CrossSchemeChain from '../components/CrossSchemeChain.jsx';
import DocumentScanner from '../components/DocumentScanner.jsx';
import { speakImperative } from '../hooks/useTTS.js';
import { verifyDocument } from '../utils/documentVerifier.js';
import { useVoiceTranscript } from '../hooks/useVoiceTranscript.js';
import { createRecorder } from '../utils/speechUtils.js';

/**
 * Apply — gather what the citizen needs before they leave for the government
 * portal, and keep a record on the device that they went.
 *
 * v2 changes that matter here:
 *   • the scheme is looked up from the sharded store, so the page has a
 *     not-yet-loaded state and renders a calm shape rather than a spinner;
 *   • `vault.district` is gone — the citizen's scope is `vault.state`;
 *   • the document checklist is built from `scheme.documents_required`, which
 *     is real but published for only ~19% of the corpus. When it is empty the
 *     screen says so; it does not manufacture a plausible list, because a
 *     citizen would act on it.
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

// Only these keys are ever written back from voice extraction. The endpoint can
// return anything; the vault schema is the authority, not the response.
const VOICE_KEYS = new Set(['name', 'age', 'occupation', 'annual_income', 'state']);
const NUMERIC_KEYS = new Set(['age', 'annual_income']);

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
        <span className="animate-pulse opacity-50" aria-hidden="true">|</span>
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

  // ── Submit ────────────────────────────────────────────────────────────────
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

  const shell = (children, bloom = 'bloom-neutral') => (
    <div className="min-h-[100dvh] w-full bg-canvas relative overflow-x-hidden pb-28">
      <div className={`bloom ${bloom} bloom-quiet`} aria-hidden="true" />
      <div className="relative z-10 mx-auto w-full max-w-[820px] px-4 sm:px-6 py-4 sm:py-6">
        <header className="flex items-center justify-between mb-4 sm:mb-6">
          <button onClick={() => nav(-1)} className="btn-ghost compact text-[15px]" lang={lang}>
            <span aria-hidden="true">←</span> {ta ? 'பின்' : 'Back'}
          </button>
          <span className="u-meta" lang={lang}>
            {isSahayak
              ? ta ? 'உதவியாளர் முறை' : 'Sahayak mode'
              : ta ? 'உங்கள் விவரத்திலிருந்து' : 'From your profile'}
          </span>
        </header>
        {children}
      </div>
    </div>
  );

  // ── not-yet-loaded ────────────────────────────────────────────────────────
  if (!scheme && loading) {
    return shell(
      <div className="card" aria-busy="true">
        <div className="u-meta" lang={lang}>
          {ta ? 'திட்டம் ஏற்றப்படுகிறது' : 'Loading this scheme'}
        </div>
        <div className="mt-5 space-y-3 animate-pulse" aria-hidden="true">
          <div className="h-6 w-4/5 rounded-full bg-surface-sub" />
          <div className="h-6 w-2/5 rounded-full bg-surface-sub" />
          <div className="h-20 w-full rounded-well bg-surface-sub mt-6" />
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

  // ── derived ───────────────────────────────────────────────────────────────
  const name = ta && scheme.name_ta ? scheme.name_ta : scheme.name_plain;
  const required = scheme.documents_required || [];
  const allDocsDone = required.every((d) => docs[d]);
  const b = scheme.benefit || {};
  const money = formatBenefit(b, lang);
  const outbound = scheme.official_url || scheme.application_link;

  // vault.district is gone in v2 — the citizen's scope is their state.
  const fields = [
    { key: 'name',          label: ta ? 'பெயர்' : 'Name',
      value: liveFields.name ?? (vault.name || null) },
    { key: 'age',           label: ta ? 'வயது' : 'Age',
      value: liveFields.age ?? (vault.age != null ? String(vault.age) : null) },
    { key: 'gender',        label: ta ? 'பாலினம்' : 'Gender',
      value: answerLabel('gender', vault.gender, lang) },
    { key: 'state',         label: ta ? 'மாநிலம்' : 'State',
      value: liveFields.state ?? answerLabel('state', vault.state, lang) },
    { key: 'occupation',    label: ta ? 'வேலை' : 'Occupation',
      value: liveFields.occupation ?? answerLabel('occupation', vault.occupation, lang) },
    { key: 'ration_card',   label: ta ? 'குடும்ப அட்டை' : 'Ration card',
      value: answerLabel('ration_card', vault.ration_card, lang) },
    { key: 'caste',         label: ta ? 'சமூகம்' : 'Community',
      value: answerLabel('caste', vault.caste, lang) },
    { key: 'annual_income', label: ta ? 'ஆண்டு வருமானம்' : 'Annual income',
      value: liveFields.annual_income
        ?? (vault.annual_income ? `₹${Number(vault.annual_income).toLocaleString('en-IN')}` : null) },
  ];

  const rise = (d = 0) => ({
    initial: reduce ? false : { opacity: 0, y: 14 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.32, delay: d, ease: [0.22, 1, 0.36, 1] },
  });

  return shell(
    <div className="space-y-4">
      {/* ── which scheme, and why it is yours ─────────────────────────────── */}
      <motion.div {...rise(0)} className="surface-tray">
        <div className="surface-plate relative overflow-hidden px-6 sm:px-9 py-7 sm:py-9">
          <div className="bloom bloom-warm bloom-quiet" aria-hidden="true" />
          <div className="relative z-10">
            <div className="u-meta" lang={lang}>
              {ta ? 'இதற்கு விண்ணப்பிக்கிறீர்கள்' : 'You are applying for'}
            </div>
            <h1
              className="u-scheme-name mt-3 text-[24px] sm:text-[28px] leading-[1.35] font-semibold text-ink max-w-[24ch]"
              lang={lang}
            >
              {name}
            </h1>

            {/* Kinds keep their own grammar here too. Cash alone gets display. */}
            {b.cash ? (
              <div className="mt-5">
                <div className="u-display tabular text-[32px] leading-none text-ink">{money.primary}</div>
                <div className="u-meta mt-1.5" lang={lang}>{money.secondary}</div>
              </div>
            ) : (
              <div className={`mt-4 text-[15px] ${benefitToneClass(money.tone)}`} lang={lang}>
                <span className="font-medium">{money.primary}</span>
                <span className="text-muted"> · {money.secondary}</span>
              </div>
            )}

            {b.cash && b.loan_ceiling > 0 && (
              <div className="well mt-3 px-4 py-3 flex flex-wrap items-baseline justify-between gap-3">
                <span className="text-[13px] text-muted" lang={lang}>
                  <span aria-hidden="true">↩ </span>
                  {ta ? 'கடன் வசதி — திருப்பிச் செலுத்த வேண்டும்' : 'credit available — to be repaid'}
                </span>
                <span className="tabular text-[14px] font-medium text-muted shrink-0">
                  {formatBenefit({ loan_ceiling: b.loan_ceiling }, lang).primary}
                </span>
              </div>
            )}

            {vault && <MatchReason scheme={scheme} profile={vault} lang={lang} className="mt-6" />}
          </div>
        </div>
      </motion.div>

      {/* ── voice fill ───────────────────────────────────────────────────── */}
      <motion.section {...rise(0.05)} className="card">
        <div className="u-meta" lang={lang}>{t('apply_review_title', lang)}</div>

        <div className="mt-4">
          <button
            onClick={voiceFillActive ? stopVoiceFill : startVoiceFill}
            disabled={voiceFillTranscribing}
            className={voiceFillActive ? 'btn-primary compact !py-3' : 'btn-secondary compact !py-3'}
            lang={lang}
          >
            {voiceFillTranscribing
              ? (ta ? 'கேட்டதைப் பதிவு செய்கிறோம்…' : 'Working through what you said…')
              : voiceFillActive
              ? (ta ? 'நிறுத்தி நிரப்பு' : 'Stop and fill')
              : (ta ? 'குரலால் நிரப்பு' : 'Fill this by speaking')}
          </button>
        </div>

        <AnimatePresence>
          {voiceFillActive && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="well mt-3 px-4 py-3 flex items-center gap-2.5"
            >
              <span className="w-2 h-2 rounded-full bg-ink animate-pulse shrink-0" aria-hidden="true" />
              <span className="text-[15px] text-ink-2" lang={lang}>
                {voiceTx.transcript || (ta ? 'பேசுங்கள்…' : 'Speak now…')}
              </span>
            </motion.div>
          )}
          {voiceHeard && !voiceFillActive && !voiceFillTranscribing && (
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="well mt-3 px-4 py-3"
            >
              <div className="u-meta" lang={lang}>{ta ? 'கேட்டது' : 'What we heard'}</div>
              <div className="mt-1 text-[15px] text-ink-2" lang={lang}>{voiceHeard}</div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── review ─────────────────────────────────────────────────────── */}
        <dl className="mt-5 grid sm:grid-cols-2 gap-x-8">
          {fields.map((f) => (
            <div
              key={f.key}
              className={`py-3 border-t border-hairline transition-colors duration-320 ease-composed ${
                flash.has(f.key) ? 'bg-surface-sub' : ''
              }`}
            >
              <dt className="u-meta" lang={lang}>{f.label}</dt>
              <dd className="mt-1 text-[16px] leading-[1.5] text-ink break-words" lang={lang}>
                {f.value == null
                  ? <span className="text-muted">{ta ? 'சொல்லப்படவில்லை' : 'not given'}</span>
                  : (f.key in liveFields)
                  ? <TypewriterText text={String(f.value)} speed={150} />
                  : String(f.value)}
              </dd>
            </div>
          ))}
        </dl>

        <p className="mt-4 text-[13px] text-muted" lang={lang}>{t('device_only', lang)}</p>
      </motion.section>

      {/* ── documents ────────────────────────────────────────────────────── */}
      <motion.section {...rise(0.09)} className="card">
        <div className="u-meta" lang={lang}>{t('apply_document_title', lang)}</div>

        {required.length === 0 ? (
          // Real but sparse: only ~19% of schemes publish a document list. A
          // plausible-looking invented list is worse than none, because the
          // citizen would carry the wrong papers to the office.
          <p className="mt-3 text-[15px] leading-[1.6] text-muted max-w-[56ch]" lang={lang}>
            {ta
              ? 'இத்திட்டம் ஆவணப் பட்டியலை வெளியிடவில்லை. அரசு பக்கத்தில் பார்த்துக் கொள்ளுங்கள் — நாங்கள் ஊகிக்க மாட்டோம்.'
              : 'This scheme has not published a document list. Check the official page before you go — we will not guess at one.'}
          </p>
        ) : (
          <div className="mt-4 space-y-3">
            {required.map((d) => {
              const done = !!docs[d];
              const err = docErrors[d];
              return (
                <div key={d}>
                  <label
                    className="option flex items-center gap-4 cursor-pointer"
                    data-selected={done ? 'true' : 'false'}
                  >
                    <span
                      className={`w-9 h-9 rounded-full grid place-items-center text-[15px] shrink-0 ${
                        done ? 'bg-white/15 text-white' : 'bg-surface-sub text-muted'
                      }`}
                      aria-hidden="true"
                    >
                      {done ? '✓' : err ? '!' : '＋'}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-[16px] font-medium" lang={lang}>{d}</span>
                      <span className={`block text-[13px] mt-0.5 ${done ? 'text-white/70' : 'text-muted'}`} lang={lang}>
                        {done
                          ? (ta ? 'இந்த சாதனத்திலேயே சரிபார்க்கப்பட்டது' : 'checked on this device')
                          : err
                          ? (ta ? err.tamil_message : err.english_message)
                          : t('apply_tap_photo', lang)}
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
                        className="btn-ghost compact text-[14px]"
                        lang={lang}
                      >
                        {ta ? 'கேமராவால் ஸ்கேன் செய்' : 'Scan with the camera'}
                      </button>
                      {err && (
                        <label className="btn-ghost compact text-[14px] cursor-pointer" lang={lang}>
                          {ta ? 'மீண்டும் எடு' : 'Retake the photo'}
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

      {/* ── act ──────────────────────────────────────────────────────────── */}
      <motion.section {...rise(0.12)} className="card">
        <div className="flex flex-wrap items-center gap-3">
          <a
            href={outbound}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-primary inline-flex items-center"
            lang={lang}
          >
            {scheme.official_url
              ? ta ? 'அரசு தளத்தில் விண்ணப்பி' : 'Apply on the official site'
              : ta ? 'திட்டப் பக்கத்தைப் பார்' : 'Open the scheme page'}
            <span aria-hidden="true"> ↗</span>
          </a>
          <button
            disabled={submitting}
            onClick={handleSubmit}
            className="btn-secondary"
            lang={lang}
          >
            {submitting
              ? (ta ? 'பதிவு செய்கிறோம்…' : 'Saving…')
              : t('apply_submit', lang)}
          </button>
        </div>

        <p className="mt-4 text-[13px] leading-[1.6] text-muted max-w-[62ch]">
          <span lang="en">
            You are leaving Sevai for {scheme.official_url ? 'the official government site' : 'myscheme.gov.in'}. Sevai keeps a record on this device; it does not submit anything for you.
          </span>
          <br />
          <span lang="ta">
            நீங்கள் சேவையிலிருந்து {scheme.official_url ? 'அரசு இணையதளத்திற்கு' : 'myscheme.gov.in தளத்திற்கு'} செல்கிறீர்கள். சேவை இந்த சாதனத்தில் பதிவு மட்டும் வைக்கும்; உங்களுக்காக விண்ணப்பிக்காது.
          </span>
        </p>

        {required.length > 0 && !allDocsDone && (
          <p className="mt-3 text-[13px] text-muted" lang={lang}>
            {ta
              ? 'ஆவணப் படங்கள் இல்லாமலும் பதிவு செய்யலாம் — பின்னர் சேர்க்கலாம்.'
              : 'You can save this without the photos and add them later.'}
          </p>
        )}
      </motion.section>

      {/* ── scanner ──────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {activeScannerDoc && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-ink/50 flex flex-col justify-end"
            onClick={() => setActiveScannerDoc(null)}
          >
            <motion.div
              initial={reduce ? false : { y: 120 }}
              animate={{ y: 0 }}
              exit={{ y: 120 }}
              transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
              onClick={(e) => e.stopPropagation()}
              className="bg-surface rounded-t-[28px] p-5 pb-8 max-w-lg mx-auto w-full"
            >
              <div className="w-10 h-1 bg-surface-sub rounded-full mx-auto mb-4" aria-hidden="true" />
              <div className="u-meta text-center mb-4" lang={lang}>
                {ta ? 'கேமராவில் காட்டுங்கள்' : 'Hold it up to the camera'}
              </div>
              <div className="u-scheme-name text-center text-[17px] text-ink mb-4" lang={lang}>
                {activeScannerDoc}
              </div>
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
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-canvas/85 grid place-items-center px-6"
          >
            <div className="card max-w-sm w-full text-center">
              <div className="u-meta" lang={lang}>{ta ? 'சரிபார்க்கிறோம்' : 'Checking'}</div>
              <div className="u-scheme-name mt-2 text-[19px] text-ink" lang={lang}>{showOCR}</div>
              <div className="mt-4 h-1 bg-surface-sub rounded-full overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: '100%' }}
                  transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1] }}
                  className="h-full bg-ink"
                />
              </div>
              <p className="mt-4 text-[13px] text-muted" lang={lang}>
                {ta ? 'இந்த சாதனத்திலேயே — இணையம் தேவையில்லை' : 'On this device — no internet needed'}
              </p>
            </div>
          </motion.div>
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
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="fixed inset-0 z-40 bg-ink/40 grid place-items-end"
          onClick={() => nav('/applications')}
        >
          <motion.div
            initial={reduce ? false : { y: 300 }}
            animate={{ y: 0 }}
            transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
            onClick={(e) => e.stopPropagation()}
            className="bg-surface rounded-t-[28px] p-6 w-full max-w-lg mx-auto space-y-5"
          >
            <div className="w-10 h-1 bg-surface-sub rounded-full mx-auto" aria-hidden="true" />
            <div>
              <div className="u-meta" lang={lang}>{ta ? 'பதிவு செய்யப்பட்டது' : 'Saved on this device'}</div>
              <h3 className="u-scheme-name mt-2 text-[21px] font-semibold text-ink" lang={lang}>{name}</h3>
            </div>
            <CrossSchemeChain schemeId={scheme.id} vault={vault} lang={lang} variant="single" />
            <button onClick={() => nav('/applications')} className="btn-secondary w-full" lang={lang}>
              {ta ? 'என் விண்ணப்பங்களைக் காண்' : 'See my applications'}
            </button>
          </motion.div>
        </motion.div>
      )}
    </div>,
  );
}
