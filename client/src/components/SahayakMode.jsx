import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { SAHAYAK_PIN, BENEFICIARIES, appendAudit } from '../utils/sahayakMock.js';
import { SahayakRedeem } from './SahayakHandover.jsx';
import { evaluateAll } from '../utils/eligibilityEngine.js';
import { useSchemes } from '../utils/schemesStore.js';
import { formatBenefit, formatRupees } from '../utils/formatters.js';
import { MatchReason } from './Thread.jsx';

/**
 * SahayakMode — ported from the Claude Design source (Sevai.dc.html, isWSahayak).
 *
 * Someone else is holding the phone: a volunteer, a VAO clerk, a relative.
 *
 * The design's answer to that is not a banner — it is a different *surface*.
 * The whole screen is hatched in amber, the header bar is solid `--sah-ink`,
 * and every rule and figure on it takes the warm ink rather than the citizen's
 * near-black. Nothing about this view can be mistaken, at a glance across a
 * counter, for the helper's own account. That is the point: an operator who
 * forgets whose data is on the glass is the failure mode this screen exists to
 * prevent, and a small chip in a corner does not prevent it.
 *
 * What is deliberately absent: caste and marital status. They still drive
 * matching — they are simply never rendered, and the right-hand panel says so
 * out loud rather than leaving their absence to be noticed. There is no reveal
 * control, because a control that can expose caste to a third party is the
 * defect, not the mitigation.
 *
 * The PIN gate, the beneficiary lookup and the audit log are unchanged; the
 * design merges the PIN and the code into one signed-out form, and the 15
 * minute session it advertises is now real — it counts down and expires.
 */

const SESSION_MS = 15 * 60 * 1000;
const PIN_LEN = 4;

const clock = (ms) =>
  new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

/* Warm-surface eyebrow. Mono, Latin only, as everywhere else. */
const SahEyebrow = ({ children, className = '' }) => (
  <div className={`mono text-[10.5px] tracking-[.14em] text-sah-ink ${className}`}>{children}</div>
);

export default function SahayakMode({ lang = 'en', onExit }) {
  const [beneficiary, setBeneficiary] = useState(null);
  const [codeInput, setCodeInput] = useState('');
  const [pinInput, setPinInput] = useState('');
  const [err, setErr] = useState(null);
  const [openedAt, setOpenedAt] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [actions, setActions] = useState(0);
  const nav = useNavigate();
  const ta = lang === 'ta';
  const endedRef = useRef(false);

  const remaining = openedAt ? Math.max(0, openedAt + SESSION_MS - now) : 0;

  // The session the header promises is the session the app keeps.
  useEffect(() => {
    if (!openedAt) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [openedAt]);

  useEffect(() => {
    if (!openedAt || remaining > 0 || endedRef.current) return;
    endedRef.current = true;
    endSession(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remaining, openedAt]);

  function endSession(expired = false) {
    if (beneficiary) {
      appendAudit({
        sahayak_action: expired ? 'session_expired' : 'session_ended',
        scheme_id: null,
        beneficiary_id: beneficiary.id,
      });
    }
    sessionStorage.removeItem('sevai_sahayak_beneficiary');
    setBeneficiary(null);
    setOpenedAt(null);
    setActions(0);
    setPinInput('');
    setCodeInput('');
    setErr(expired ? (ta ? 'அமர்வு காலாவதியானது' : 'That session ran out. Start a new one.') : null);
    endedRef.current = false;
  }

  // One form, two gates: their code and the PIN they set.
  const startSession = () => {
    const b = BENEFICIARIES[codeInput.trim()];
    if (!b) {
      setErr(ta ? 'பயனாளி காணப்படவில்லை' : 'No beneficiary with that code');
      return;
    }
    if (pinInput !== SAHAYAK_PIN) {
      setErr(ta ? 'தவறான PIN' : 'That PIN does not match');
      return;
    }
    setErr(null);
    setBeneficiary(b);
    setOpenedAt(Date.now());
    setNow(Date.now());
    setActions(1);
    appendAudit({ sahayak_action: 'loaded_beneficiary', scheme_id: null, beneficiary_id: b.id });
  };

  const initiateFor = (scheme_id) => {
    appendAudit({ sahayak_action: 'initiated_application', scheme_id, beneficiary_id: beneficiary.id });
    setActions((n) => n + 1);
    // Apply reads this beneficiary as its vault for the duration of the session.
    sessionStorage.setItem('sevai_sahayak_beneficiary', JSON.stringify(beneficiary));
    nav(`/apply/${scheme_id}?sahayak=1`);
  };

  const sessionId = beneficiary ? `SVK-${beneficiary.id}` : null;
  const firstName = beneficiary ? String(beneficiary.name).split(' ')[0] : '';

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto"
      style={{
        background:
          'repeating-linear-gradient(135deg,rgba(226,164,54,.07) 0 14px,transparent 14px 28px),'
          + 'linear-gradient(rgba(226,164,54,.05),rgba(226,164,54,.05)),#FBFBFD',
      }}
    >
      {/* ── the bar that never lets you forget ─────────────────────────────── */}
      <header className="bg-sah-ink text-[#FFF6E2] px-5 sm:px-11 py-3.5 flex items-center justify-between gap-5 flex-wrap">
        <div className="flex items-center gap-3.5 min-w-0">
          <div className="w-[11px] h-[11px] rounded-[2px] bg-[#E2A436] flex-none" aria-hidden="true" />
          <div className="min-w-0">
            {beneficiary ? (
              <>
                <div className="text-[14.5px] sm:text-[15px] font-semibold tracking-[-.012em]">
                  You are acting for {beneficiary.name} — this is not your own account
                </div>
                <div className="ta text-[12.5px] text-[rgba(255,246,226,.72)] mt-0.5" lang="ta">
                  நீங்கள் {beneficiary.name} அவர்களுக்காகச் செயல்படுகிறீர்கள்
                </div>
              </>
            ) : (
              <>
                <div className="text-[14.5px] sm:text-[15px] font-semibold tracking-[-.012em]">
                  Assisted access — no session is open yet
                </div>
                <div className="ta text-[12.5px] text-[rgba(255,246,226,.72)] mt-0.5" lang="ta">
                  உதவி அணுகல் — இன்னும் அமர்வு தொடங்கவில்லை
                </div>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="mono text-[10.5px] tracking-[.12em] text-right leading-[1.8]">
            {beneficiary ? (
              <>
                {Math.ceil(remaining / 60000)} min remaining
                <br />
                Session {sessionId} · logged
              </>
            ) : (
              <>
                Code + PIN required
                <br />
                Every action is logged
              </>
            )}
          </div>
          <button
            onClick={onExit}
            className="mono text-[10px] tracking-[.11em] border border-[rgba(255,246,226,.45)] rounded-[3px] px-3 py-2 hover:bg-[#FFF6E2] hover:text-sah-ink transition-colors flex-none"
          >
            Exit
          </button>
        </div>
      </header>

      <div className="px-5 sm:px-11 py-9 sm:py-10">
        {/* Entrances here are translate-only, as everywhere else in this
            design: the signed-out panel carries the consent copy a volunteer
            must read before they can act for someone, and whether it is
            readable may not depend on a tween finishing. */}
        <AnimatePresence mode="wait">
          {!beneficiary ? (
            <motion.div
              key="off"
              initial={{ y: 10 }}
              animate={{ y: 0 }}
              exit={{ y: -10 }}
              transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
              className="max-w-[520px]"
            >
              <SahEyebrow>Assisted access</SahEyebrow>
              <h2 className="m-0 mt-3.5 text-[30px] sm:text-[36px] font-bold tracking-[-.036em] leading-[1.12] text-[#2A2410]">
                Who are you helping?
              </h2>
              <div className="ta text-[17px] sm:text-[18px] text-[#5A4A1E] mt-2.5" lang="ta">
                நீங்கள் யாருக்கு உதவுகிறீர்கள்?
              </div>
              <p className="mt-4 mb-0 text-[15.5px] leading-[1.65] text-[#4A4020] max-w-[54ch]">
                You need both the beneficiary&rsquo;s code and the PIN they set. The session lasts 15
                minutes, everything you do is written to their log, and they can end it at any time.
              </p>
              <div className="ta text-[13.5px] text-[#6A5A2E] mt-2 max-w-[46ch]" lang="ta">
                அமர்வு 15 நிமிடங்கள் மட்டுமே. நீங்கள் செய்யும் ஒவ்வொன்றும் அவர்களின் பதிவேட்டில் எழுதப்படும்.
              </div>

              <div className="flex flex-col gap-3.5 mt-7">
                <div>
                  <div className="mono text-[10px] tracking-[.12em] text-sah-ink mb-2">
                    Beneficiary code
                  </div>
                  <input
                    value={codeInput}
                    onChange={(e) => setCodeInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && startSession()}
                    inputMode="numeric"
                    maxLength={10}
                    placeholder="100100"
                    aria-label="Beneficiary code"
                    className="w-full h-[58px] border-[1.5px] border-sah-ink rounded-[5px] bg-white px-[18px]
                               font-mono text-[19px] tracking-[.22em] text-[#2A2410] outline-none
                               placeholder:text-[#C9BCA0]"
                  />
                  <div className="mono text-[9.5px] tracking-[.1em] text-[#8A7A4A] mt-2">
                    Demo codes · 100100 · 200200 · 300300
                  </div>
                </div>

                <div>
                  <div className="mono text-[10px] tracking-[.12em] text-sah-ink mb-2">Their PIN</div>
                  <div className="relative flex gap-[9px] w-[247px] max-w-full">
                    <input
                      type="password"
                      inputMode="numeric"
                      maxLength={PIN_LEN}
                      value={pinInput}
                      onChange={(e) => setPinInput(e.target.value.replace(/\D/g, ''))}
                      onKeyDown={(e) => e.key === 'Enter' && startSession()}
                      aria-label="Their PIN"
                      className="absolute inset-0 w-full h-full opacity-0 z-10 cursor-pointer"
                    />
                    {Array.from({ length: PIN_LEN }).map((_, i) => (
                      <div
                        key={i}
                        aria-hidden="true"
                        className={`w-[58px] h-[58px] rounded-[5px] bg-white flex items-center justify-center text-[22px] text-[#2A2410] ${
                          i === pinInput.length
                            ? 'border-[1.5px] border-sah-ink'
                            : 'border-[1.5px] border-[rgba(122,84,16,.4)]'
                        }`}
                      >
                        {pinInput[i] ? '•' : i === pinInput.length ? (
                          <span className="text-ink-15 animate-svPulse">|</span>
                        ) : ''}
                      </div>
                    ))}
                  </div>
                  <div className="mono text-[9.5px] tracking-[.1em] text-[#8A7A4A] mt-2">
                    Demo PIN · 9999
                  </div>
                </div>
              </div>

              {err && (
                <div className="sahayak mt-4 px-4 py-3 text-[14px]" lang={lang}>
                  {err}
                </div>
              )}

              <button
                onClick={startSession}
                className="mt-6 min-h-[58px] px-[30px] bg-sah-ink text-[#FFF6E2] rounded-[4px] text-[16px] font-semibold hover:opacity-90 transition-opacity"
              >
                Start assisted session
                <span className="ta font-normal opacity-75 ml-1.5" lang="ta">· அமர்வைத் தொடங்கு</span>
              </button>

              <p className="mt-3.5 mb-0 text-[13px] leading-[1.6] text-[#8A7A4A] max-w-[56ch]">
                You will not be able to see their community or marital status, change their PIN, or
                erase their answers.
              </p>

              {/* The signed handover, offered above the typed code because it
                  is the better door: nothing is spoken aloud in a queue, the
                  code dies in two minutes, and it works exactly once. The typed
                  code stays for a phone with no working camera. */}
              <div className="mt-6 max-w-[520px]">
                <SahayakRedeem
                  lang={lang}
                  onSession={(session) => {
                    const b = {
                      ...session.beneficiary,
                      id: session.sessionId,
                      name: session.beneficiary?.name || 'Beneficiary',
                    };
                    setBeneficiary(b);
                    setOpenedAt(Date.now());
                    appendAudit({
                      sahayak_action: 'loaded_beneficiary_by_qr',
                      scheme_id: null,
                      beneficiary_id: b.id,
                    });
                  }}
                />
              </div>
              <div className="ta text-[12.5px] text-[#8A7A4A] mt-1 max-w-[48ch]" lang="ta">
                அவர்களின் சமூகம், திருமண நிலை உங்களுக்குக் காட்டப்படாது.
              </div>
            </motion.div>
          ) : (
            <BeneficiaryView
              key="on"
              beneficiary={beneficiary}
              firstName={firstName}
              lang={lang}
              openedAt={openedAt}
              actions={actions}
              onInitiate={initiateFor}
              onEnd={() => endSession(false)}
            />
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

/* ── signed in ─────────────────────────────────────────────────────────────
   Same money grammar as the citizen's own reveal: cash carries weight, cover
   is set lighter, and credit is mono inside a dashed box so a volunteer can
   never read a loan ceiling aloud as money the beneficiary is owed.          */

function BeneficiaryView({ beneficiary, firstName, lang, openedAt, actions, onInitiate, onEnd }) {
  const ta = lang === 'ta';
  const { schemes, loading } = useSchemes(beneficiary.state);

  const { eligible, close_matches, totals } = useMemo(
    () => evaluateAll(beneficiary, schemes),
    [beneficiary, schemes],
  );

  const t = totals || {};
  const top = eligible.slice(0, 6);

  const cells = [];
  if (t.focusCashAnnual > 0) {
    cells.push({
      k: 'annual', en: 'Cash / year', taLabel: 'ஆண்டுக்கு',
      value: formatRupees(t.focusCashAnnual),
      cls: 'text-[26px] sm:text-[28px] font-extrabold tracking-[-.04em] text-[#2A2410]',
    });
  }
  if (t.focusCashOneTime > 0) {
    cells.push({
      k: 'once', en: 'One-time', taLabel: 'ஒரு முறை',
      value: formatRupees(t.focusCashOneTime), guard: 'Not a yearly amount',
      cls: 'text-[22px] sm:text-[24px] font-bold tracking-[-.038em] text-[#2A2410]',
    });
  }
  if (t.insuranceCover > 0) {
    cells.push({
      k: 'cover', en: 'Cover', taLabel: 'காப்பீடு',
      value: formatRupees(t.insuranceCover), guard: 'Not money received',
      cls: 'text-[22px] sm:text-[24px] font-medium tracking-[-.03em] text-[#5A4A1E]',
    });
  }
  if (t.subsidyTotal > 0) {
    cells.push({
      k: 'subsidy', en: 'Subsidy', taLabel: 'மானியம்',
      value: formatRupees(t.subsidyTotal), guard: 'A discount, not a payment',
      cls: 'text-[22px] sm:text-[24px] font-medium tracking-[-.03em] text-[#5A4A1E]',
    });
  }

  const ends = openedAt ? clock(openedAt + SESSION_MS) : null;

  return (
    <motion.div
      initial={{ y: 10 }}
      animate={{ y: 0 }}
      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
      className="grid gap-8 lg:gap-9 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] items-start"
    >
      {/* ═══ left ══════════════════════════════════════════════════════════ */}
      <div className="min-w-0">
        <SahEyebrow>{firstName}&rsquo;s schemes · read and assist only</SahEyebrow>
        <h2 className="m-0 mt-3.5 text-[26px] sm:text-[32px] font-bold tracking-[-.034em] leading-[1.14] text-[#2A2410]">
          {loading
            ? `Checking schemes for ${firstName}`
            : `${eligible.length.toLocaleString('en-IN')} schemes match ${firstName}`}
        </h2>
        <div className="ta text-[15px] text-[#5A4A1E] mt-2" lang="ta">
          {loading
            ? 'திட்டங்கள் சரிபார்க்கப்படுகின்றன'
            : `${eligible.length} திட்டங்கள் பொருந்துகின்றன`}
        </div>

        {/* who this is, without the two answers a helper must never see */}
        <div className="mono text-[10px] tracking-[.11em] text-[#8A7A4A] mt-4">
          Age {beneficiary.age} · {String(beneficiary.occupation).replace(/_/g, ' ')} ·{' '}
          <span className="tabular">₹{Number(beneficiary.annual_income).toLocaleString('en-IN')}</span> a year
        </div>

        {loading ? (
          <div className="mt-6 flex flex-col gap-2.5 max-w-[560px]" aria-busy="true" aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="border border-[rgba(122,84,16,.24)] rounded-[5px] bg-white px-4 py-4 flex flex-col gap-2.5"
              >
                <div className="h-4 rounded-[3px] bg-[rgba(122,84,16,.10)]" style={{ width: ['72%', '56%', '64%'][i] }} />
                <div className="h-3 w-28 rounded-[2px] bg-[rgba(122,84,16,.10)]" />
              </div>
            ))}
          </div>
        ) : (
          <>
            {cells.length > 0 ? (
              <div className="grid sm:grid-cols-3 mt-6 border border-[rgba(122,84,16,.28)] rounded-[6px] bg-white overflow-hidden">
                {cells.map((c, i) => (
                  <div
                    key={c.k}
                    className={`px-5 py-[18px] border-b sm:border-b-0 border-[rgba(122,84,16,.18)] ${
                      i === cells.length - 1 ? 'sm:border-r-0 border-b-0' : 'sm:border-r'
                    }`}
                  >
                    <div className="mono text-[9.5px] tracking-[.12em] text-sah-ink">{c.en}</div>
                    <div className="ta text-[11.5px] text-[#8A7A4A]" lang="ta">{c.taLabel}</div>
                    <div className={`tabular mt-1.5 ${c.cls}`}>{c.value}</div>
                    {c.guard && (
                      <div className="mono text-[9px] tracking-[.1em] text-[#8A7A4A] mt-1.5">{c.guard}</div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-6 border border-dashed border-sah-rule rounded-[5px] px-4 py-3.5 max-w-[560px]">
                <div className="text-[14.5px] text-[#4A4020]">
                  None of these matches has published an amount. Do not promise a figure.
                </div>
                <div className="ta text-[12.5px] text-[#8A7A4A] mt-1" lang="ta">
                  தொகை அறிவிக்கப்படவில்லை — எந்தத் தொகையையும் உறுதியளிக்க வேண்டாம்.
                </div>
              </div>
            )}

            {/* Credit: mono, dashed, never beside the cash figure. */}
            {t.loanCeiling > 0 && (
              <div className="mt-3 border border-dashed border-sah-rule rounded-[4px] px-4 py-3 flex flex-wrap items-center justify-between gap-3">
                <span className="mono text-[9.5px] tracking-[.12em] text-[#8A7A4A]">
                  Credit available — to be repaid
                </span>
                <span className="mono tabular text-[14px] tracking-[.04em] text-[#8A7A4A] flex-none">
                  {formatRupees(t.loanCeiling)}
                </span>
              </div>
            )}

            {t.unvaluedCount > 0 && (
              <div className="mono text-[9.5px] tracking-[.11em] text-[#8A7A4A] mt-3">
                +{t.unvaluedCount} more matched · amount not published
              </div>
            )}

            {/* ── the schemes themselves ────────────────────────────────── */}
            <div className="mt-6 flex flex-col gap-2.5">
              {top.map(({ scheme }) => {
                const b = scheme.benefit || {};
                const money = formatBenefit(b, lang);
                const kind = {
                  cash: 'Cash', loan: 'Credit', subsidy: 'Subsidy',
                  insurance: 'Cover', inkind: 'In kind', unknown: 'Amount not published',
                }[money.tone];

                return (
                  <div
                    key={scheme.id}
                    className="border border-[rgba(122,84,16,.24)] rounded-[5px] bg-white px-4 sm:px-[18px] py-4"
                  >
                    <div className="flex items-start justify-between gap-4 flex-wrap">
                      <span className="min-w-0 flex-1">
                        <span className="scheme-name block text-[15.5px] sm:text-[16px] text-[#2A2410]" lang={lang}>
                          {ta && scheme.name_ta ? scheme.name_ta : scheme.name_plain}
                        </span>

                        {money.tone === 'loan' ? (
                          <span className="mono inline-block mt-1.5 text-[9.5px] tracking-[.11em] text-[#8A7A4A] border border-dashed border-sah-rule rounded-[3px] px-2 py-1">
                            Credit · {money.primary} · to be repaid
                          </span>
                        ) : money.tone === 'unknown' ? (
                          <span className="mono block mt-1 text-[9.5px] tracking-[.11em] text-[#8A7A4A]">
                            {kind}
                          </span>
                        ) : (
                          <span className="mono block mt-1 text-[9.5px] tracking-[.11em] text-[#8A7A4A]">
                            {kind} · <span className="tabular">{money.primary}</span> · {money.secondary}
                          </span>
                        )}
                      </span>

                      <button
                        onClick={() => onInitiate(scheme.id)}
                        className="text-[13.5px] px-3.5 py-2 border border-[rgba(122,84,16,.35)] rounded-[4px] text-sah-ink flex-none hover:bg-sah-ink hover:text-[#FFF6E2] transition-colors"
                      >
                        Help apply
                        <span className="ta ml-1.5 opacity-80" lang="ta">· உதவி</span>
                      </button>
                    </div>

                    {/* Why it matched — shown here too, so the helper can read
                        the beneficiary's own answers back to her. */}
                    <MatchReason scheme={scheme} profile={beneficiary} lang={lang} className="mt-3.5" />
                  </div>
                );
              })}
            </div>

            {eligible.length > top.length && (
              <div className="mono text-[9.5px] tracking-[.11em] text-[#8A7A4A] mt-3">
                Showing {top.length} of {eligible.length.toLocaleString('en-IN')} matches
              </div>
            )}

            {close_matches.length > 0 && (
              <p className="mt-3 mb-0 text-[13.5px] leading-[1.6] text-[#6A5A2E] max-w-[62ch]">
                {close_matches.length} more are near misses — worth checking at the Panchayat office.
                <span className="ta block text-[12.5px] text-[#8A7A4A] mt-1" lang="ta">
                  மேலும் {close_matches.length} திட்டங்கள் கிட்டத்தட்ட பொருந்துகின்றன.
                </span>
              </p>
            )}
          </>
        )}
      </div>

      {/* ═══ right ═════════════════════════════════════════════════════════ */}
      <div className="flex flex-col gap-3.5 min-w-0">
        <div className="border border-[rgba(122,84,16,.3)] rounded-[6px] bg-white px-[22px] py-5">
          <div className="mono text-[10px] tracking-[.12em] text-sah-ink">Hidden from you</div>
          <div className="flex flex-wrap gap-[7px] mt-3.5">
            {[['Community', 'சமூகம்'], ['Marital status', 'திருமண நிலை']].map(([en, taLabel]) => (
              <span
                key={en}
                className="mono text-[11px] tracking-[.08em] px-[11px] py-1.5 border border-dashed border-[rgba(122,84,16,.4)] rounded-full text-[#8A7A4A]"
              >
                {en} ·•••
                <span className="ta ml-1.5" lang="ta">{taLabel}</span>
              </span>
            ))}
          </div>
          <p className="mt-3.5 mb-0 text-[13px] leading-[1.6] text-[#6A5A2E]">
            These were used to match her schemes but are never shown to a helper, even one she trusts.
          </p>
          <div className="ta text-[12.5px] text-[#8A7A4A] mt-1.5" lang="ta">
            இவை பொருத்தத்திற்குப் பயன்பட்டன — உதவியாளருக்குக் காட்டப்படாது.
          </div>
        </div>

        <div className="border border-[rgba(122,84,16,.3)] rounded-[6px] px-[22px] py-5">
          <div className="mono text-[10px] tracking-[.12em] text-sah-ink">This session</div>
          <div className="text-[13.5px] leading-[1.65] text-[#4A4020] mt-2.5">
            Opened {openedAt ? clock(openedAt) : '—'}. Ends automatically at {ends || '—'}.{' '}
            {actions} {actions === 1 ? 'action' : 'actions'} logged so far. {firstName} will see all of
            it in her profile.
          </div>
          <div className="ta text-[12.5px] text-[#8A7A4A] mt-2" lang="ta">
            அமர்வு {ends} மணிக்குத் தானாக முடியும். ஒவ்வொரு செயலும் பதிவாகிறது.
          </div>
          <button
            onClick={onEnd}
            className="mt-4 min-h-[48px] px-5 border border-sah-ink rounded-[4px] text-[14.5px] font-medium text-sah-ink hover:bg-sah-ink hover:text-[#FFF6E2] transition-colors"
          >
            End session now
            <span className="ta ml-1.5 font-normal opacity-80" lang="ta">· இப்போதே முடி</span>
          </button>
        </div>
      </div>
    </motion.div>
  );
}
