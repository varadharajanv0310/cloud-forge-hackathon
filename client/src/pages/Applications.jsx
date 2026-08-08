import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../hooks/useLanguage.js';
import { useVault } from '../hooks/useVault.js';
import { useSchemes, getSchemeById } from '../utils/schemesStore.js';
import { loadApplications, saveApplications } from '../utils/applications.js';
import { MatchReason } from '../components/Thread.jsx';

/**
 * Applications — ported from the Claude Design source (Sevai.dc.html, isWApps).
 *
 * Two rules hold this screen, and they are the reason it looks the way it does.
 *
 *  1. NO RUPEE FIGURE APPEARS HERE. An amount set beside a pending status reads
 *     as money already owed. The worth of a scheme is stated on the scheme, once,
 *     where the eligibility rules that qualify it are also stated.
 *
 *  2. A rejection is not a verdict, it is a task. So the "not accepted" card
 *     does not stop at the status — it carries what went wrong, what to do about
 *     it, and the fact that reapplying costs nothing and the citizen stays
 *     eligible. That block takes the one warm surface the system allows.
 *
 * The status rail is horizontal here, four hairline bars under the name, rather
 * than the vertical rail used on the phone: on a wide screen the whole life of
 * an application should be legible without reading.
 */

/**
 * Demo seed: one rejected application so the fix-and-resubmit path can be shown.
 * Only ever written when the citizen has none of their own.
 *
 * It seeds a scheme that is genuinely IN this device's shards. The v1 seed used
 * a hand-written id ('pmay-gramin') that the v2 corpus does not contain, so the
 * demo card came up as "scheme details are not available" — the one card meant
 * to prove the product works was the one card that could not name its scheme.
 */
const seedIfEmpty = (schemes) => {
  if (loadApplications().length > 0 || !schemes?.length) return false;
  const pick =
    schemes.find((s) => s.category === 'housing')
    || schemes.find((s) => /awas|housing|gramin/i.test(s.name_plain || ''))
    || schemes[0];
  saveApplications([
    {
      scheme_id: pick.id,
      submitted_at: Date.now() - 5 * 24 * 60 * 60 * 1000,
      status: 'rejected',
      reject_reason: null,
      documents: ['Aadhaar Card', 'Bank Passbook'],
    },
  ]);
  return true;
};

/* ── tone palette, straight from the source ───────────────────────────────── */
const TONES = {
  neutral: { color: '#3B3B46', border: 'rgba(20,20,26,.16)', bg: 'transparent', bar: '#14141A' },
  ok:      { color: '#2F6B4F', border: 'rgba(47,107,79,.35)', bg: 'rgba(47,107,79,.08)', bar: '#14141A' },
  warn:    { color: '#7A5410', border: 'rgba(158,110,26,.45)', bg: 'rgba(226,164,54,.10)', bar: '#E2A436' },
  bad:     { color: '#8B2B2B', border: 'rgba(139,43,43,.40)', bg: 'rgba(139,43,43,.07)', bar: '#8B2B2B' },
};

/**
 * Dates, defensively. A record saved by an older build — or by any path that
 * did not set `submitted_at` — otherwise puts the literal string "INVALID DATE"
 * on screen where a citizen expects the day they applied. Returning null lets
 * the caller print an em dash, which is the honest rendering of "we do not
 * know", and ISO strings are accepted as well as epoch milliseconds.
 */
const parseWhen = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const d = new Date(typeof v === 'number' ? v : String(v));
  return Number.isNaN(d.getTime()) ? null : d;
};

const DATE = (v) => {
  const d = parseWhen(v);
  return d ? d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }).toUpperCase() : null;
};

const LONG_DATE = (v) => {
  const d = parseWhen(v);
  return d ? d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : null;
};

export default function Applications() {
  const { lang } = useLanguage();
  const { vault } = useVault();
  const { schemes, byId, loading } = useSchemes(vault?.state);
  const [apps, setApps] = useState([]);
  const ta = lang === 'ta';

  useEffect(() => {
    setApps(loadApplications());
    const handler = () => setApps(loadApplications());
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, []);

  // The seed waits for the shards, because it needs a scheme that exists.
  useEffect(() => {
    if (seedIfEmpty(schemes)) setApps(loadApplications());
  }, [schemes]);

  const sorted = [...apps].sort((a, b) => b.submitted_at - a.submitted_at);
  const needsYou = sorted.filter((a) => a.status === 'rejected').length;

  return (
    <div className="relative">
      <div className="bloom bloom-header" aria-hidden="true" />

      <div className="relative mx-auto w-full max-w-[1080px] px-5 sm:px-8 lg:px-11 pt-8 sm:pt-10 pb-14">
        <h1 className="title-2 m-0">Applications</h1>
        <div className="ta text-[18px] text-ink-60 mt-2.5" lang="ta">விண்ணப்பங்கள்</div>

        <p className="mt-4 mb-0 text-[15.5px] leading-[1.6] text-ink-45 max-w-[76ch]">
          {apps.length === 0
            ? 'Nothing has been started yet. When you apply for a scheme it appears here with its status in plain language, and with what to do next if something is missing.'
            : `${apps.length} scheme${apps.length === 1 ? '' : 's'} you have started.`
              + ' Sevai shows no rupee figure here on purpose — an amount beside a pending status'
              + ' would imply money is already owed to you.'}
        </p>
        <p className="ta mt-2 mb-0 text-[14px] leading-[1.6] text-ink-30 max-w-[60ch]" lang="ta">
          {apps.length === 0
            ? 'நீங்கள் விண்ணப்பித்தால், அதன் நிலை இங்கே எளிய மொழியில் தெரியும்.'
            : needsYou > 0
              ? `அவற்றில் ${needsYou} உங்களிடமிருந்து ஒன்றை எதிர்பார்க்கிறது. மற்றவை துறையின் பரிசீலனையில்.`
              : 'அனைத்தும் துறையின் பரிசீலனையில் உள்ளன. உங்களிடம் எதுவும் நிலுவையில் இல்லை.'}
        </p>

        {apps.length === 0 ? (
          <div className="panel mt-8 p-6 sm:p-7 max-w-[76ch]">
            <div className="mono text-[10px] tracking-[.12em] text-ink-55">Where to start</div>
            <p className="mt-2.5 mb-0 text-[15px] leading-[1.6] text-ink-60">
              Open any scheme from your list and follow the link to the government's own site.
              Sevai never submits anything on your behalf.
            </p>
            <p className="ta mt-2 mb-0 text-[13.5px] leading-[1.55] text-ink-30" lang="ta">
              சேவை உங்கள் சார்பாக எதையும் சமர்ப்பிக்காது.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-4 mt-8">
            {sorted.map((app, i) => (
              <ApplicationCard
                key={`${app.scheme_id}-${i}`}
                app={app}
                scheme={byId?.get?.(app.scheme_id) || getSchemeById(app.scheme_id)}
                loading={loading}
                vault={vault}
                lang={lang}
                ta={ta}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */

function ApplicationCard({ app, scheme, loading, vault, lang, ta }) {
  const nav = useNavigate();

  const rejected = app.status === 'rejected';
  const approved = app.status === 'approved';

  const tone = rejected ? 'bad' : approved ? 'ok' : 'neutral';
  const T = TONES[tone];

  const statusLabel = rejected
    ? { en: 'Not accepted', ta: 'ஏற்கப்படவில்லை' }
    : approved
      ? { en: 'Approved', ta: 'அங்கீகரிக்கப்பட்டது' }
      : { en: 'Under review', ta: 'பரிசீலனையில்' };

  // Where the application has reached. Nothing is invented: the only date this
  // device holds is the one it recorded when the citizen submitted.
  const at = rejected || approved ? 3 : 2;
  const steps = [
    { en: 'Started', ta: 'தொடங்கியது', date: DATE(app.submitted_at) || '—' },
    { en: 'Documents submitted', ta: 'ஆவணங்கள் அளிக்கப்பட்டன', date: DATE(app.submitted_at) || '—' },
    { en: 'Under review', ta: 'பரிசீலனையில்', date: '—' },
    {
      en: rejected ? 'Not accepted' : approved ? 'Approved' : 'Decision',
      ta: rejected ? 'ஏற்கப்படவில்லை' : approved ? 'அங்கீகரிக்கப்பட்டது' : 'முடிவு',
      date: '—',
    },
  ];

  const scope = scheme
    ? scheme.nationwide
      ? 'Central'
      : scheme.state || (scheme.states || [])[0] || 'State'
    : null;

  const name = scheme?.name_plain || null;

  return (
    <article
      className="rounded-panel bg-white p-6 sm:px-[26px]"
      style={{ border: `1px solid ${rejected ? 'rgba(139,43,43,.28)' : 'rgba(20,20,26,.14)'}` }}
    >
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-4 sm:gap-6 items-start">
        <div className="min-w-0">
          <div className="flex gap-[7px] flex-wrap">
            {scope && (
              <span
                className="mono text-[9.5px] tracking-[.12em] px-2.5 py-1 rounded-[2px]"
                style={
                  scope === 'Central'
                    ? { background: '#14141A', color: '#fff' }
                    : { background: 'rgba(20,20,26,.08)', color: '#3B3B46' }
                }
              >
                {scope}
              </span>
            )}
            <span
              className="mono text-[9.5px] tracking-[.12em] px-2.5 py-[3px] rounded-[2px]"
              style={{ border: `1px solid ${T.border}`, background: T.bg, color: T.color }}
            >
              {statusLabel.en}
            </span>
            <span className="ta text-[12px] leading-[1.5] self-center" lang="ta" style={{ color: T.color }}>
              {statusLabel.ta}
            </span>
          </div>

          {name ? (
            <>
              <h2 className="scheme-name !text-[21px] mt-3 max-w-[34ch]">{name}</h2>
              {scheme.name_ta && (
                <div className="ta text-[13.5px] leading-[1.45] text-ink-30 mt-1" lang="ta">
                  {scheme.name_ta}
                </div>
              )}
            </>
          ) : loading ? (
            <div className="mt-3 h-5 w-2/3 rounded-[3px] bg-black/[.06]" aria-hidden="true" />
          ) : (
            <>
              <h2 className="scheme-name !text-[21px] mt-3 text-ink-45">
                Scheme details are not available on this device
              </h2>
              <div className="ta text-[13.5px] text-ink-30 mt-1" lang="ta">
                திட்ட விவரம் இப்போது கிடைக்கவில்லை
              </div>
            </>
          )}
        </div>

        <div className="mono text-[10px] tracking-[.1em] text-ink-25 sm:text-right leading-[1.8] tabular">
          REF {String(app.scheme_id).toUpperCase()}
          {LONG_DATE(app.submitted_at) && (
            <>
              <br />
              Submitted {LONG_DATE(app.submitted_at)}
            </>
          )}
        </div>
      </div>

      {/* ── the four stages, as bars ─────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-0 gap-y-4 mt-6">
        {steps.map((s, i) => (
          <div key={s.en} className="pr-3.5">
            <div
              className="h-[3px] rounded-[2px] mb-[11px]"
              style={{
                background:
                  i < at ? '#14141A' : i === at ? T.bar : 'rgba(20,20,26,.13)',
              }}
              aria-hidden="true"
            />
            <div
              className="text-[13.5px] leading-[1.4]"
              style={{ fontWeight: i === at ? 600 : 400, color: i <= at ? '#25252E' : '#B0B0BA' }}
            >
              {s.en}
            </div>
            <div
              className="ta text-[11.5px] leading-[1.4] mt-0.5"
              lang="ta"
              style={{ color: i <= at ? '#8A8A95' : '#C4C4CE' }}
            >
              {s.ta}
            </div>
            <div className="mono text-[9.5px] tracking-[.09em] text-ink-15 mt-1 tabular">{s.date}</div>
          </div>
        ))}
      </div>

      {/* ── a rejection is a task, not a verdict ─────────────────────────── */}
      {rejected && (
        <div
          className="mt-[22px] rounded-[5px] px-5 py-[18px]"
          style={{ border: '1px solid rgba(158,110,26,.32)', background: 'rgba(226,164,54,.10)' }}
        >
          <div className="mono text-[10px] tracking-[.12em]" style={{ color: '#7A5410' }}>
            What to do next
          </div>
          <div className="ta text-[12.5px] mt-1" lang="ta" style={{ color: '#9E7A2E' }}>
            அடுத்து என்ன செய்வது
          </div>

          <div
            className="text-[15.5px] font-medium tracking-[-.015em] mt-2.5"
            style={{ color: '#2A2410' }}
          >
            {app.reject_reason
              || 'A document the department asked for was missing or did not match your other papers.'}
          </div>
          <p className="text-[14px] leading-[1.65] mt-2 mb-0 max-w-[76ch]" style={{ color: '#4A4020' }}>
            This is fixable and you are still eligible. Correct the document, then apply again —
            there is no limit on reapplying and no penalty for a rejection.
          </p>
          <p className="ta text-[13px] leading-[1.6] mt-1.5 mb-0 max-w-[60ch]" lang="ta" style={{ color: '#4A4020' }}>
            இதைச் சரிசெய்து மீண்டும் விண்ணப்பிக்கலாம். உங்கள் தகுதி இழக்கப்படவில்லை.
          </p>

          <div className="flex gap-2.5 mt-3.5 flex-wrap">
            {['Take your Aadhaar and ration card', 'Ask at the village office', 'Then reapply — you stay eligible'].map(
              (c) => (
                <span
                  key={c}
                  className="text-[13.5px] px-3 py-2 rounded-flat bg-white"
                  style={{ border: '1px solid rgba(158,110,26,.35)', color: '#2A2410' }}
                >
                  {c}
                </span>
              ),
            )}
          </div>
        </div>
      )}

      {/* Why this scheme was ever surfaced — kept on the artefact itself. */}
      {scheme && vault && (
        <MatchReason scheme={scheme} profile={vault} lang={lang} className="mt-5" />
      )}

      {rejected && scheme && (
        <div className="mt-5 flex gap-2.5 items-center flex-wrap">
          <button
            onClick={() => nav(`/apply/${scheme.id}`)}
            className="min-h-[48px] px-5 rounded-flat border border-rule-22 text-[14.5px] font-medium
                       hover:border-ink hover:bg-page transition-colors"
          >
            {ta ? 'சரிசெய்து மீண்டும் அனுப்பு' : 'Fix and apply again'}
          </button>
          <span className="text-[13.5px] text-ink-30">
            {ta ? 'மீண்டும் விண்ணப்பிக்க வரம்பு இல்லை.' : 'Reapplying costs nothing.'}
          </span>
        </div>
      )}
    </article>
  );
}
