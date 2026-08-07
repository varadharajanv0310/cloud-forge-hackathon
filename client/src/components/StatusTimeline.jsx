import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { t, tf } from '../data/strings.js';
import { useSchemes, getSchemeById } from '../utils/schemesStore.js';
import { useVault } from '../hooks/useVault.js';
import { formatBenefit, benefitToneClass } from '../utils/formatters.js';
import { MatchReason } from './Thread.jsx';

/**
 * StatusTimeline — one tracked application.
 *
 * v2 notes:
 *  - `SCHEME_BY_ID` is gone. The scheme is looked up through schemesStore, which
 *    is asynchronous, so this component has three states rather than one: shards
 *    in flight, scheme found, scheme genuinely absent (a stored application for
 *    a scheme that is no longer in this citizen's shards). It never returns null
 *    on a real application — losing a citizen's submitted application from the
 *    list because a fetch had not resolved is the worst possible failure here.
 *  - The mock SMS quotes a figure ONLY when the scheme pays cash. The old code
 *    put `benefit_amount` into "₹X will be credited to your account", which for
 *    a credit-linked scheme promised a citizen that their loan ceiling was about
 *    to arrive in their bank account.
 *  - The timeline itself is now hairlines and ink dots; no filled colour bars.
 */
export default function StatusTimeline({ app, lang = 'en' }) {
  const { byId, loading } = useSchemes();
  const { vault } = useVault();
  const nav = useNavigate();

  const scheme = byId?.get?.(app.scheme_id) || getSchemeById(app.scheme_id);
  const ta = lang === 'ta';

  const isApproved = app.status === 'approved';
  const isRejected = app.status === 'rejected';

  const nodes = [
    {
      key: 'submitted',
      label: t('status_submitted', lang),
      reached: true,
      state: 'done',
    },
    {
      key: 'under_review',
      label: t('status_under_review', lang),
      reached: true,
      state: 'done',
    },
    {
      key: 'final',
      label: isApproved
        ? t('status_approved', lang)
        : isRejected
        ? t('status_rejected', lang)
        : t('status_under_review', lang),
      reached: isApproved || isRejected,
      state: isApproved ? 'done' : isRejected ? 'attention' : 'pending',
    },
  ];

  // ── Shards still loading: hold the shape, say nothing we cannot defend ────
  if (!scheme && loading) {
    return (
      <div className="card" aria-busy="true">
        <div className="u-meta" lang={lang}>{t('status_submitted', lang)}</div>
        <div className="mt-3 h-5 w-2/3 rounded-full bg-surface-sub" />
        <div className="mt-2 h-5 w-1/3 rounded-full bg-surface-sub" />
        <Rail nodes={nodes} lang={lang} />
      </div>
    );
  }

  const name = scheme
    ? (ta && scheme.name_ta ? scheme.name_ta : scheme.name_plain)
    : null;

  const b = scheme?.benefit || {};
  const money = formatBenefit(b, lang);

  const plainCopy = !name
    ? null
    : isApproved
    ? tf('status_plain_approved', lang, { name })
    : isRejected
    ? tf('status_plain_rejected', lang, {
        name,
        reason:
          app.reject_reason ||
          (ta ? 'வருமான சான்றிதழ் இல்லை' : 'Income certificate missing'),
      })
    : tf('status_plain_review', lang, { name });

  // Mock SMS. A rupee figure appears only where one is genuinely payable.
  const shortName = name ? name.split(' ').slice(0, 4).join(' ') : null;
  const cashClause = b.cash
    ? ta
      ? ` ${money.primary} 7 நாட்களில் உங்கள் கணக்கில் வரவு வைக்கப்படும்.`
      : ` ${money.primary} will be credited to your account within 7 days.`
    : '';

  const smsMock = !shortName
    ? null
    : isApproved
    ? ta
      ? `உங்கள் ${shortName} விண்ணப்பம் அங்கீகரிக்கப்பட்டது.${cashClause}`
      : `Your ${shortName} application is approved.${cashClause}`
    : isRejected
    ? ta
      ? `உங்கள் ${shortName} விண்ணப்பத்திற்கு கூடுதல் ஆவணங்கள் தேவை. மீண்டும் சமர்ப்பிக்கவும்.`
      : `Your ${shortName} application needs additional documents. Please resubmit with required docs.`
    : ta
    ? `உங்கள் ${shortName} விண்ணப்பம் செயலில் உள்ளது. 5-7 நாட்களில் அறிவிக்கப்படும்.`
    : `Your ${shortName} application is under review. You will receive an update in 5-7 days.`;

  return (
    <motion.article
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
      className="card"
    >
      <div className="flex items-center gap-2 mb-3">
        <span className="u-meta" lang={lang}>
          {ta ? 'விண்ணப்பம்' : 'Application'}
        </span>
        {scheme && (
          <>
            <span className="w-1 h-1 rounded-full bg-ink/20" />
            <span className="u-meta" lang={lang}>
              {scheme.nationwide
                ? ta ? 'மத்தியம்' : 'Central'
                : (scheme.state || (scheme.states || [])[0] || '')}
            </span>
          </>
        )}
      </div>

      <div className="flex items-start justify-between gap-5">
        <div className="min-w-0 flex-1">
          <h3 className="u-scheme-name text-scheme font-semibold text-ink" lang={lang}>
            {name || (ta ? 'திட்ட விவரம் இப்போது கிடைக்கவில்லை' : 'Scheme details unavailable')}
          </h3>
          {!scheme && (
            <p className="text-[13px] text-muted mt-1 tabular" lang={lang}>
              {ta ? 'குறியீடு' : 'Reference'}: {app.scheme_id}
            </p>
          )}
        </div>

        {/* Only cash takes the display face. Nothing here is ever summed. */}
        {scheme && b.cash ? (
          <div className="shrink-0 text-right">
            <div className="u-display tabular text-[22px] leading-none text-ink">
              {money.primary}
            </div>
            <div className="u-meta mt-1" lang={lang}>{money.secondary}</div>
          </div>
        ) : scheme ? (
          <div className={`shrink-0 text-right text-[13px] ${benefitToneClass(money.tone)}`}>
            <div className="font-medium">{money.primary}</div>
            <div className="text-muted">{money.secondary}</div>
          </div>
        ) : null}
      </div>

      {/* A loan ceiling is not an amount being paid out on approval. */}
      {scheme && b.cash && b.loan_ceiling ? (
        <div className="well mt-3 px-4 py-2.5 flex items-center justify-between gap-3">
          <span className="text-[13px] text-muted" lang={lang}>
            ↩ {ta ? 'கடன் வசதி — திருப்பிச் செலுத்த வேண்டும்' : 'credit available — to be repaid'}
          </span>
          <span className="tabular text-[14px] font-medium text-muted shrink-0">
            {formatBenefit({ loan_ceiling: b.loan_ceiling }, lang).primary}
          </span>
        </div>
      ) : null}

      <Rail nodes={nodes} lang={lang} />

      {plainCopy && (
        <div
          className={isRejected ? 'amber-banner mt-5' : 'well mt-5 px-4 py-3 text-sm text-ink-2'}
          lang={lang}
        >
          {plainCopy}
        </div>
      )}

      {smsMock && (
        <div className="well mt-3 px-4 py-3">
          <div className="u-meta" lang={lang}>{t('mock_sms_label', lang)}</div>
          <p className="mt-1.5 text-[14px] text-ink-2 leading-relaxed" lang={lang}>
            {smsMock}
          </p>
        </div>
      )}

      {/* Why this scheme was surfaced in the first place, still on the artefact. */}
      {scheme && vault && (
        <MatchReason scheme={scheme} profile={vault} lang={lang} className="mt-5" />
      )}

      {isRejected && scheme && (
        <button
          onClick={() => nav(`/apply/${scheme.id}`)}
          className="btn-primary w-full mt-5"
          lang={lang}
        >
          {t('fix_resubmit', lang)}
        </button>
      )}
    </motion.article>
  );
}

/**
 * The vertical rail: a single hairline with ink dots on it. A reached stage is a
 * filled ink dot; a stage still to come is an empty dot with a hairline ring; a
 * stage needing the citizen's attention takes the peach bloom stop, which is the
 * only saturated colour the system allows.
 */
function Rail({ nodes, lang }) {
  return (
    <div className="relative pl-7 mt-5">
      <div className="absolute left-[6px] top-2 bottom-2 w-px bg-hairline" aria-hidden="true" />
      {nodes.map((n) => (
        <div key={n.key} className="relative mb-4 last:mb-0">
          <span
            aria-hidden="true"
            className={`absolute -left-[28px] top-[5px] w-[13px] h-[13px] rounded-full ${
              n.state === 'done'
                ? 'bg-ink'
                : n.state === 'attention'
                ? 'bg-bloom-peach ring-1 ring-ink/15'
                : 'bg-surface ring-1 ring-hairline'
            }`}
          />
          <div
            className={`text-[15px] ${
              n.reached ? 'text-ink font-medium' : 'text-muted'
            }`}
            lang={lang}
          >
            {n.label}
          </div>
        </div>
      ))}
    </div>
  );
}
