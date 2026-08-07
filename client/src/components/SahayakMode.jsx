import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { SAHAYAK_PIN, BENEFICIARIES, appendAudit } from '../utils/sahayakMock.js';
import { evaluateAll } from '../utils/eligibilityEngine.js';
import { useSchemes } from '../utils/schemesStore.js';
import { formatBenefit, benefitToneClass, formatTotals } from '../utils/formatters.js';
import { MatchReason } from './Thread.jsx';
import { t } from '../data/strings.js';

/**
 * SahayakMode — delegated access.
 *
 * Someone else is holding the phone: a volunteer, a VAO clerk, a relative. That
 * changes two things and nothing else.
 *
 *  - The screen is now an operator surface, so it says whose data is on it and
 *    logs every action. PIN gate, beneficiary lookup and audit logging are
 *    unchanged from v1.
 *  - Caste is deliberately NOT displayed. It was in the beneficiary header, and
 *    this is precisely the screen where a third party is reading over someone's
 *    shoulder. It still drives matching; it just does not sit on the glass.
 *
 * v2 data changes: `evaluateAll` now returns { eligible, close_matches, totals }
 * and reads the sharded store, so the pool is fetched here and passed in. The
 * per-scheme figure comes from formatBenefit — `benefit_amount` is gone, and
 * with it the old behaviour of printing a loan ceiling as though it were a
 * payout the volunteer could promise out loud.
 */
export default function SahayakMode({ lang = 'en', onExit }) {
  const [phase, setPhase] = useState('pin'); // pin | scan | beneficiary
  const [pinInput, setPinInput] = useState('');
  const [codeInput, setCodeInput] = useState('');
  const [beneficiary, setBeneficiary] = useState(null);
  const [err, setErr] = useState(null);
  const nav = useNavigate();
  const ta = lang === 'ta';

  const submitPin = () => {
    if (pinInput === SAHAYAK_PIN) {
      setErr(null);
      setPhase('scan');
    } else {
      setErr(ta ? 'தவறான PIN' : 'Wrong PIN');
    }
  };

  const submitCode = () => {
    const b = BENEFICIARIES[codeInput.trim()];
    if (b) {
      setBeneficiary(b);
      setPhase('beneficiary');
      setErr(null);
      appendAudit({
        sahayak_action: 'loaded_beneficiary',
        scheme_id: null,
        beneficiary_id: b.id,
      });
    } else {
      setErr(ta ? 'பயனாளி காணப்படவில்லை' : 'Beneficiary not found');
    }
  };

  const initiateFor = (scheme_id) => {
    appendAudit({
      sahayak_action: 'initiated_application',
      scheme_id,
      beneficiary_id: beneficiary.id,
    });
    // Switch to this beneficiary's "vault" temporarily via sessionStorage
    sessionStorage.setItem('sevai_sahayak_beneficiary', JSON.stringify(beneficiary));
    nav(`/apply/${scheme_id}?sahayak=1`);
  };

  const panel = 'surface-tray max-w-[420px] mx-auto';

  return (
    <div className="fixed inset-0 z-50 bg-canvas overflow-y-auto">
      <div className="bloom bloom-neutral bloom-quiet" aria-hidden="true" />

      <div className="relative z-10 min-h-full flex flex-col">
        <header className="sticky top-0 z-20 bg-canvas/85 backdrop-blur border-b border-hairline">
          <div className="max-w-[1120px] mx-auto px-5 py-4 flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="u-meta" lang={lang}>
                {ta ? 'பிறருக்காக' : 'Assisted access'}
              </div>
              <div className="text-lead font-semibold text-ink truncate" lang={lang}>
                {t('sahayak_title', lang)}
              </div>
            </div>
            <button onClick={onExit} className="btn-secondary compact !py-2.5 !px-5 !text-[15px]" lang={lang}>
              {ta ? 'வெளியேறு' : 'Exit'}
            </button>
          </div>
        </header>

        <div className="flex-1 px-5 py-8 sm:py-12">
          <AnimatePresence mode="wait">
            {phase === 'pin' && (
              <motion.div
                key="pin"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
                className={panel}
              >
                <div className="surface-plate p-7">
                  <h2 className="u-display text-[26px] text-ink" lang={lang}>
                    {t('sahayak_enter_pin', lang)}
                  </h2>
                  <p className="u-meta mt-3" lang={lang}>
                    {ta ? 'மாதிரி PIN: 9999' : 'Demo PIN: 9999'}
                  </p>

                  <input
                    type="password"
                    inputMode="numeric"
                    maxLength={6}
                    value={pinInput}
                    onChange={(e) => setPinInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && submitPin()}
                    aria-label={t('sahayak_enter_pin', lang)}
                    className="w-full mt-5 rounded-well bg-surface-sub px-4 py-4 text-center
                               text-[26px] tabular tracking-[0.35em] text-ink outline-none
                               ring-1 ring-hairline focus:ring-2 focus:ring-ink/25
                               transition-shadow duration-240 ease-composed"
                  />

                  {err && <div className="amber-banner mt-3" lang={lang}>{err}</div>}

                  <button onClick={submitPin} className="btn-primary w-full mt-5" lang={lang}>
                    {t('continue', lang)}
                  </button>
                </div>
              </motion.div>
            )}

            {phase === 'scan' && (
              <motion.div
                key="scan"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
                className={panel}
              >
                <div className="surface-plate p-7">
                  <h2 className="u-display text-[26px] text-ink" lang={lang}>
                    {t('sahayak_scan_code', lang)}
                  </h2>

                  <div className="well relative mt-5 mx-auto w-40 h-40 grid place-items-center">
                    {['top-3 left-3 border-t border-l', 'top-3 right-3 border-t border-r',
                      'bottom-3 left-3 border-b border-l', 'bottom-3 right-3 border-b border-r'].map((pos) => (
                      <span
                        key={pos}
                        aria-hidden="true"
                        className={`absolute w-6 h-6 rounded-[4px] border-ink/25 ${pos}`}
                      />
                    ))}
                    <span className="u-meta">QR</span>
                  </div>

                  <p className="u-meta mt-5" lang={lang}>
                    {ta ? 'மாதிரி குறியீடுகள்' : 'Demo codes'}
                  </p>
                  <p className="tabular text-[14px] text-muted mt-1">100100 · 200200 · 300300</p>

                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    value={codeInput}
                    onChange={(e) => setCodeInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && submitCode()}
                    placeholder="100100"
                    aria-label={t('sahayak_scan_code', lang)}
                    className="w-full mt-4 rounded-well bg-surface-sub px-4 py-4 text-center
                               text-[22px] tabular tracking-[0.3em] text-ink outline-none
                               ring-1 ring-hairline focus:ring-2 focus:ring-ink/25
                               transition-shadow duration-240 ease-composed"
                  />

                  {err && <div className="amber-banner mt-3" lang={lang}>{err}</div>}

                  <button onClick={submitCode} className="btn-primary w-full mt-5" lang={lang}>
                    {ta ? 'பயனாளியை ஏற்று' : 'Load beneficiary'}
                  </button>
                </div>
              </motion.div>
            )}

            {phase === 'beneficiary' && beneficiary && (
              <BeneficiaryView
                key="b"
                beneficiary={beneficiary}
                lang={lang}
                onInitiate={initiateFor}
              />
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

function BeneficiaryView({ beneficiary, lang, onInitiate }) {
  const ta = lang === 'ta';
  const { schemes, loading } = useSchemes(beneficiary.state);

  const { eligible, close_matches, totals } = useMemo(
    () => evaluateAll(beneficiary, schemes),
    [beneficiary, schemes],
  );

  const top = eligible.slice(0, 5);
  const rows = formatTotals(totals, lang);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
      className="max-w-[720px] mx-auto space-y-4"
    >
      {/* Who this session is about. Caste is used for matching but never shown. */}
      <div className="card">
        <div className="u-meta" lang={lang}>
          {ta ? 'பயனாளி' : 'Beneficiary'} · {beneficiary.id}
        </div>
        <div className="mt-3 flex items-start gap-4">
          <div className="w-12 h-12 shrink-0 rounded-full bg-surface-sub grid place-items-center">
            <span className="u-display text-[18px] text-ink-2">
              {beneficiary.name.charAt(0)}
            </span>
          </div>
          <div className="min-w-0">
            <div className="text-lead font-semibold text-ink" lang={lang}>
              {beneficiary.name}
            </div>
            <div className="text-[14px] text-muted mt-0.5" lang={lang}>
              {ta ? `வயது ${beneficiary.age}` : `Age ${beneficiary.age}`}
              {' · '}
              {String(beneficiary.occupation).replace(/_/g, ' ')}
              {beneficiary.district ? ` · ${beneficiary.district}` : ''}
            </div>
            <div className="text-[13px] text-muted mt-0.5 tabular" lang={lang}>
              ₹{beneficiary.annual_income.toLocaleString('en-IN')}{' '}
              {ta ? 'ஆண்டு வருமானம்' : 'a year'}
            </div>
          </div>
        </div>
      </div>

      {loading && (
        <div className="card" aria-busy="true">
          <div className="h-5 w-1/2 rounded-full bg-surface-sub" />
          <div className="mt-2 h-5 w-1/3 rounded-full bg-surface-sub" />
        </div>
      )}

      {/* The money, by kind. Each row is its own object — nothing here adds up. */}
      {!loading && rows.length > 0 && (
        <div className="space-y-3">
          {rows.map((r) =>
            r.tone === 'cash' ? (
              <div key={r.key} className="card">
                <div className="u-meta" lang={lang}>{r.label}</div>
                <div className="u-display tabular text-[34px] leading-none text-ink mt-2">
                  {r.value}
                </div>
              </div>
            ) : r.tone === 'loan' ? (
              <div key={r.key} className="well px-5 py-4 flex items-center justify-between gap-4">
                <span className="text-[13px] text-muted" lang={lang}>↩ {r.label}</span>
                <span className="tabular text-[16px] font-medium text-muted shrink-0">
                  {r.value}
                </span>
              </div>
            ) : (
              <p key={r.key} className={`text-[14px] px-1 ${benefitToneClass(r.tone)}`} lang={lang}>
                {r.label}
              </p>
            ),
          )}
        </div>
      )}

      {!loading && (
        <div>
          <h3 className="u-meta mb-3" lang={lang}>
            {ta
              ? `தகுதியான திட்டங்கள் · ${eligible.length}`
              : `Eligible schemes · ${eligible.length}`}
          </h3>

          <div className="space-y-3">
            {top.map(({ scheme }) => {
              const b = scheme.benefit || {};
              const money = formatBenefit(b, lang);

              return (
                <div key={scheme.id} className="card">
                  <div className="u-meta" lang={lang}>
                    {scheme.nationwide
                      ? ta ? 'மத்தியம்' : 'Central'
                      : (scheme.state || (scheme.states || [])[0] || '')}
                  </div>

                  <div className="mt-2 flex items-start justify-between gap-5">
                    <h4 className="u-scheme-name text-scheme font-semibold text-ink min-w-0 flex-1" lang={lang}>
                      {ta && scheme.name_ta ? scheme.name_ta : scheme.name_plain}
                    </h4>

                    {/* Cash only, in the display face. Everything else stays text. */}
                    {b.cash ? (
                      <div className="shrink-0 text-right">
                        <div className="u-display tabular text-[22px] leading-none text-ink">
                          {money.primary}
                        </div>
                        <div className="u-meta mt-1" lang={lang}>{money.secondary}</div>
                      </div>
                    ) : (
                      <div className={`shrink-0 text-right text-[13px] ${benefitToneClass(money.tone)}`}>
                        <div className="font-medium">{money.primary}</div>
                        <div className="text-muted">{money.secondary}</div>
                      </div>
                    )}
                  </div>

                  {b.cash && b.loan_ceiling ? (
                    <div className="well mt-3 px-4 py-2.5 flex items-center justify-between gap-3">
                      <span className="text-[13px] text-muted" lang={lang}>
                        ↩ {ta ? 'கடன் வசதி — திருப்பிச் செலுத்த வேண்டும்' : 'credit available — to be repaid'}
                      </span>
                      <span className="tabular text-[14px] font-medium text-muted shrink-0">
                        {formatBenefit({ loan_ceiling: b.loan_ceiling }, lang).primary}
                      </span>
                    </div>
                  ) : null}

                  <MatchReason
                    scheme={scheme}
                    profile={beneficiary}
                    lang={lang}
                    className="mt-4"
                  />

                  <button
                    onClick={() => onInitiate(scheme.id)}
                    className="btn-primary compact mt-5 !py-3 !px-6 !text-[15px]"
                    lang={lang}
                  >
                    {ta ? 'இவருக்காக விண்ணப்பி' : 'Start application'}
                  </button>
                </div>
              );
            })}
          </div>

          {close_matches.length > 0 && (
            <p className="text-[14px] text-muted mt-4 px-1" lang={lang}>
              {ta
                ? `மேலும் ${close_matches.length} திட்டங்கள் கிட்டத்தட்ட பொருந்துகின்றன — ஊராட்சி அலுவலகத்தில் சரிபார்க்கவும்.`
                : `${close_matches.length} more are near misses — worth checking at the Panchayat office.`}
            </p>
          )}
        </div>
      )}
    </motion.div>
  );
}
