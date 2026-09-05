import { useNavigate } from 'react-router-dom';
import { formatBenefit } from '../utils/formatters.js';
import { MatchReason, matchChips } from './Thread.jsx';

/**
 * SchemeCard — ported from the Claude Design source (Sevai.dc.html: the desktop
 * feed grid + strongest-match panel, lines 302-358, and the mobile equivalents,
 * lines 1310-1360).
 *
 * A hairline panel, not a card: 6px radius, one 1px rule, no shadow. Structure
 * comes from the rule and from whitespace, so a hundred of these stacked read as
 * a document rather than a hundred floating tiles.
 *
 * Three product constraints land in this file:
 *
 *  1. BENEFIT KINDS MUST NEVER LOOK ADDABLE. Each kind gets its own row, its own
 *     container, its own weight and its own face — see <Benefit> below. Cash is
 *     the only kind at full weight; a loan ceiling is set in the MONO face inside
 *     a DASHED box, so it is typographically incapable of reading as cash. When a
 *     scheme carries both, they are separated by a rule and never share a line.
 *  2. EVERY MATCH SHOWS WHY IT MATCHED. <MatchReason> echoes the citizen's own
 *     answers back onto the artefact.
 *  3. NEVER INVENT A NUMBER. A scheme with no published amount renders prose,
 *     never a numeral.
 *
 * Deadline UI only exists when `scheme.deadline` does — it is null for all but
 * four schemes in the corpus — and a past date is marked CLOSED and greyed,
 * never shown as though the scheme were still open.
 */

const fmtDate = (d) =>
  d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

/** null when the scheme publishes no date — which is nearly all of them. */
export function deadlineState(scheme) {
  if (!scheme?.deadline) return null;
  const d = new Date(scheme.deadline);
  if (Number.isNaN(d.getTime())) return null;
  const closed = d.getTime() < Date.now();
  const days = Math.ceil((d.getTime() - Date.now()) / 86400000);
  return { date: d, label: fmtDate(d), closed, days };
}

/** Scope: Central, or the state whose list this citizen is actually reading. */
function scopeLabel(scheme, vault) {
  if (scheme.nationwide) return 'Central';
  const states = scheme.states || [];
  if (vault?.state && states.includes(vault.state)) return vault.state;
  return scheme.state || states[0] || 'State';
}

function Badges({ scheme, vault, dl, size = 'sm' }) {
  const big = size === 'lg';
  const px = big ? 'px-[9px]' : 'px-2';
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <span
        className={`mono ${px} py-1 rounded-[2px] bg-ink text-white ${
          big ? 'text-[9.5px]' : 'text-[9px]'
        } tracking-[.12em]`}
      >
        {scopeLabel(scheme, vault)}
      </span>
      {scheme.category && (
        <span
          className={`mono ${px} py-[3px] rounded-[2px] border border-rule-16 text-ink-55 ${
            big ? 'text-[9.5px]' : 'text-[9px]'
          } tracking-[.11em]`}
        >
          {scheme.category}
        </span>
      )}
      {dl && (
        <span
          className={`mono ${px} py-[3px] rounded-[2px] ${
            big ? 'text-[9.5px]' : 'text-[9px]'
          } tracking-[.11em] ${
            dl.closed
              ? 'border border-rule-16 text-ink-30'
              : 'border border-[rgba(47,107,79,0.35)] bg-[rgba(47,107,79,0.08)] text-[#2F6B4F]'
          }`}
        >
          {dl.closed ? `Closed ${dl.label}` : `Open · closes ${dl.label}`}
        </span>
      )}
    </div>
  );
}

/**
 * The benefit, in the grammar its kind requires.
 *
 * cash        display face, full ink weight — the only kind ever set this way
 * one-time    same face, guarded by a mono NOT A YEARLY AMOUNT
 * loan        MONO face inside a DASHED box, muted — cannot read as cash
 * subsidy     text face, semibold, described as a discount rather than a payment
 * insurance   teal well, light weight, "only on a claim"
 * in kind     prose, no numeral at all
 * unpublished prose, no numeral at all
 */
export function Benefit({ benefit, lang = 'en', size = 'sm' }) {
  const b = benefit || {};
  const en = formatBenefit(b, 'en');
  const ta = formatBenefit(b, 'ta');
  const big = size === 'lg';

  if (b.cash) {
    const oneTime = b.cash_frequency !== 'annual' && b.cash_frequency !== 'monthly';
    return (
      <div
        className={
          big
            ? 'inline-block panel-flat bg-white px-4 py-3.5 lg:px-5 lg:py-4'
            : ''
        }
      >
        <div className="flex items-baseline gap-2 flex-wrap">
          <span
            className={`mono text-ink ${big ? 'text-[10px]' : 'text-[9.5px]'} tracking-[.12em]`}
          >
            Cash · {en.secondary}
          </span>
          {oneTime && (
            <span className="mono text-[9px] tracking-[.08em] text-ink-30">
              NOT A YEARLY AMOUNT
            </span>
          )}
        </div>
        <div
          className={`tabular figure-sm mt-1.5 ${
            big ? 'text-[30px] lg:text-[38px]' : 'text-[22px]'
          }`}
        >
          {en.primary}
        </div>
        <div className={`ta text-ink-45 mt-1 ${big ? 'text-[13px]' : 'text-[11.5px]'}`} lang="ta">
          {ta.secondary}
        </div>
      </div>
    );
  }

  if (b.loan_ceiling) {
    return (
      <div className="border border-dashed border-[rgba(20,20,26,0.32)] rounded-[4px] px-3 py-2.5">
        <div className="mono text-[9.5px] tracking-[.12em] text-ink-45">
          Credit available — to be repaid
        </div>
        <div
          className={`mono tabular normal-case text-ink-45 font-normal mt-1.5 tracking-[-.02em] ${
            big ? 'text-[24px]' : 'text-[17px]'
          }`}
        >
          {en.primary}
        </div>
        <div className="ta text-[11.5px] text-ink-30 mt-1" lang="ta">
          வருமானம் அல்ல — திருப்பிச் செலுத்த வேண்டியது
        </div>
      </div>
    );
  }

  if (b.subsidy) {
    return (
      <div>
        <div className="mono text-[9.5px] tracking-[.12em] text-ink-80">
          Subsidy · a discount, not a payment
        </div>
        <div
          className={`tabular font-semibold tracking-[-.015em] mt-1.5 ${
            big ? 'text-[20px]' : 'text-[16.5px]'
          }`}
        >
          {en.primary} off what you would otherwise pay
        </div>
        <div className="ta text-[11.5px] text-ink-45 mt-1" lang="ta">
          {ta.secondary} — மீதியை நீங்கள் செலுத்த வேண்டும்
        </div>
      </div>
    );
  }

  if (b.insurance_cover) {
    return (
      <div className="rounded-[4px] bg-[rgba(132,212,221,0.13)] px-3 py-2.5">
        <div className="mono text-[9.5px] tracking-[.12em] text-ink-80">Insurance cover</div>
        <div
          className={`tabular font-medium text-ink-80 tracking-[-.03em] mt-1.5 ${
            big ? 'text-[26px]' : 'text-[19px]'
          }`}
        >
          {en.primary}
        </div>
        <div className="text-[12.5px] leading-[1.5] text-ink-60 mt-1">
          Paid only on a claim. Not money in hand.
        </div>
        <div className="ta text-[11.5px] text-ink-30 mt-0.5" lang="ta">
          {ta.secondary}
        </div>
      </div>
    );
  }

  if (b.in_kind) {
    return (
      <div>
        <div className="mono text-[9.5px] tracking-[.12em] text-ink-80">In kind · goods or training</div>
        <div className="text-[13.5px] leading-[1.55] text-ink-90 mt-1.5">{en.secondary}</div>
        <div className="ta text-[11.5px] text-ink-30 mt-1" lang="ta">பொருள் உதவி</div>
      </div>
    );
  }

  // Nothing published. Say so; never substitute a figure.
  return (
    <div>
      <div className="mono text-[9.5px] tracking-[.12em] text-ink-40">Amount not published</div>
      <div className="text-[13px] leading-[1.5] text-ink-45 mt-1">
        This scheme has not said what it pays. Open it to see what it offers.
      </div>
      <div className="ta text-[11.5px] text-ink-30 mt-0.5" lang="ta">
        தொகை அறிவிக்கப்படவில்லை
      </div>
    </div>
  );
}

function Modes({ modes }) {
  const list = (modes || []).filter(Boolean).slice(0, 3);
  if (!list.length) return null;
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {list.map((m) => (
        <span
          key={m}
          className="mono text-[8.5px] tracking-[.11em] text-ink-40 border border-rule-12 rounded-[2px] px-1.5 py-[3px]"
        >
          {m}
        </span>
      ))}
    </div>
  );
}

export default function SchemeCard({ scheme, vault, lang = 'en', variant = 'list' }) {
  const nav = useNavigate();
  if (!scheme) return null;

  const ta = lang === 'ta';
  const b = scheme.benefit || {};
  const dl = deadlineState(scheme);
  const closed = Boolean(dl?.closed);

  // official_url first: a citizen should land on the department's own page, not
  // on an aggregator, whenever the department publishes one.
  const outbound = scheme.official_url || scheme.application_link;
  const isOfficial = Boolean(scheme.official_url);
  const open = () => nav(`/scheme/${scheme.id}`);

  const name = scheme.name_plain || scheme.name_official || '';
  const nameTa = scheme.name_ta;
  const hasWhy = vault ? matchChips(scheme, vault, lang).length > 0 : false;

  const applyLabel = closed
    ? ta ? 'திட்டப் பக்கம்' : 'Scheme page'
    : isOfficial
      ? ta ? 'அரசு தளத்தில் விண்ணப்பி' : 'Apply on official site'
      : ta ? 'திட்டப் பக்கத்தைப் பார்' : 'View scheme page';

  /* ── the strongest match ─────────────────────────────────────────────────
     A 1.5px ink rule instead of the hairline, and the only place the benefit
     is set at display size. Desktop splits it: the scheme on the left, the
     citizen's own reasons and the actions on the right. */
  if (variant === 'featured') {
    return (
      <article
        className={`bg-white border-[1.5px] border-ink rounded-[6px] overflow-hidden
                    lg:grid lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] ${closed ? 'opacity-70' : ''}`}
      >
        <div className="p-4 lg:p-7">
          <Badges scheme={scheme} vault={vault} dl={dl} size="lg" />
          <button
            onClick={open}
            className="block mt-3.5 lg:mt-4 text-left max-w-[26ch] scheme-name text-[20px] lg:text-[27px] lg:leading-[1.24] lg:tracking-[-.03em] font-semibold hover:text-violet"
          >
            {name}
          </button>
          {nameTa && (
            <div className="ta text-[14px] lg:text-[16px] text-ink-45 mt-1.5" lang="ta">
              {nameTa}
            </div>
          )}
          <div className="mt-4 lg:mt-5">
            <Benefit benefit={b} lang={lang} size="lg" />
          </div>
          {/* Cash and credit never share a container, a line or a weight. */}
          {b.cash && b.loan_ceiling ? (
            <div className="mt-3">
              <Benefit benefit={{ loan_ceiling: b.loan_ceiling }} lang={lang} size="lg" />
            </div>
          ) : null}
        </div>

        <div className="p-4 lg:p-7 border-t lg:border-t-0 lg:border-l border-rule-12 flex flex-col">
          <div className="mono text-[10px] tracking-[.12em] text-ink-55">Why this matched you</div>
          <div className="ta text-[12.5px] text-ink-30 mt-0.5" lang="ta">
            இது உங்களுக்கு ஏன் பொருந்தியது
          </div>
          {vault && hasWhy ? (
            <div className="mt-3">
              {/* The eyebrow is already set above, in both languages. */}
              <MatchReason scheme={scheme} profile={vault} lang={lang} showLabel={false} />
            </div>
          ) : (
            <p className="mt-3 mb-0 text-[13px] leading-[1.6] text-ink-45">
              This scheme sets no restriction that rules you out — it is open to every citizen.
            </p>
          )}
          <p className="mt-3.5 mb-0 text-[13px] leading-[1.6] text-ink-45">
            Change any of these in your profile and this scheme may drop out of your list.
          </p>
          <Modes modes={scheme.application_modes} />

          <div className="flex-1 min-h-[16px]" />

          <div className="flex flex-col gap-2.5 mt-4">
            {outbound && (
              <a
                href={outbound}
                target="_blank"
                rel="noopener noreferrer"
                className="min-h-[52px] flex items-center justify-center rounded-[4px] bg-ink text-white text-[15.5px] font-semibold hover:!text-white hover:opacity-90"
                lang={lang}
              >
                {applyLabel} <span aria-hidden="true">&nbsp;↗</span>
              </a>
            )}
            <div className="flex gap-2.5">
              <button
                onClick={open}
                className="flex-1 min-h-[48px] rounded-[4px] border border-rule-20 text-[14.5px] font-medium flex items-center justify-center hover:border-ink"
                lang={lang}
              >
                {ta ? 'விவரங்கள்' : 'Details'}
              </button>
              <button
                onClick={() => nav(`/apply/${scheme.id}`)}
                className="flex-1 min-h-[48px] rounded-[4px] border border-rule-20 text-[14.5px] font-medium flex items-center justify-center hover:border-ink"
                lang={lang}
              >
                {ta ? 'தயாராகுங்கள்' : 'Get ready'}
              </button>
            </div>
          </div>
        </div>
      </article>
    );
  }

  /* ── one row in the list ─────────────────────────────────────────────── */
  return (
    <article
      onClick={open}
      className={`panel h-full flex flex-col p-4 lg:p-[18px] cursor-pointer
                  transition-colors duration-200 hover:border-rule-22 ${closed ? 'opacity-65' : ''}`}
    >
      <Badges scheme={scheme} vault={vault} dl={dl} />

      <button
        onClick={(e) => { e.stopPropagation(); open(); }}
        className="block text-left mt-3 scheme-name text-[15.5px] lg:text-[16.5px]"
      >
        {name}
      </button>
      {nameTa && (
        <div className="ta text-[12px] text-ink-30 mt-1" lang="ta">
          {nameTa}
        </div>
      )}

      <div className="mt-auto pt-4">
        <Benefit benefit={b} lang={lang} />
        {b.cash && b.loan_ceiling ? (
          <div className="mt-2.5">
            <Benefit benefit={{ loan_ceiling: b.loan_ceiling }} lang={lang} />
          </div>
        ) : null}
      </div>

      {closed && (
        <div className="mono text-[9px] tracking-[.1em] text-ink-30 mt-3">
          Applications closed {dl.label}
        </div>
      )}

      {vault && hasWhy && (
        <div className="mt-4 pt-3.5 border-t border-rule-10">
          <MatchReason scheme={scheme} profile={vault} lang={lang} />
        </div>
      )}

      <div className="mt-3.5 flex items-center justify-between gap-3 flex-wrap">
        <Modes modes={scheme.application_modes} />
        {outbound && (
          <a
            href={outbound}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="mono text-[9.5px] tracking-[.11em] text-ink-55 hover:text-violet"
            lang={lang}
          >
            {applyLabel} <span aria-hidden="true">↗</span>
          </a>
        )}
      </div>
    </article>
  );
}
