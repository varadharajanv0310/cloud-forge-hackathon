/**
 * AsyncStates — ported from the Claude Design source (Sevai.dc.html, isWStates).
 *
 * The four moments where a product usually lies: while it is working, when the
 * network is gone, when the honest answer is "nothing", and when there is far
 * more than a screen can hold.
 *
 * The design's position on all four is the same — say the true thing plainly,
 * in both languages, and never dress a real answer up as an error. So:
 *
 *   loading   names what is being checked and how far it has got, then holds
 *             the shape of the result with skeletons rather than a spinner;
 *   offline   leads with what still works (the matches were computed on this
 *             device) and is specific about the one thing that does not;
 *   empty     is written as a finding, not a failure — "that is a real answer,
 *             not a missing page";
 *   many      refuses to pretend the number is smaller than it is.
 *
 * Every figure here is a prop. Nothing on this screen may be invented: a count
 * that is not passed in is simply not rendered.
 */

/* Shared frame: hairline-ruled, generous, no card chrome. */
const WRAP = 'max-w-[640px]';

/* ── 1 · Loading ──────────────────────────────────────────────────────────── */

const SKELETON_W = ['72%', '54%', '81%', '61%', '76%', '48%'];

/**
 * @param {string}  stateName    citizen's state, e.g. "Tamil Nadu"
 * @param {number} [total]       schemes being checked; omitted → not claimed
 * @param {object} [central]     { done, total } central shard progress
 * @param {object} [shard]       { done, total } state shard progress
 * @param {number} [cards]       how many skeleton tiles to hold
 */
export function StateLoading({ stateName, total, central, shard, cards = 6 }) {
  const heading = total
    ? `Checking ${total.toLocaleString('en-IN')} schemes for ${stateName || 'your state'}`
    : `Checking every scheme for ${stateName || 'your state'}`;

  return (
    <div aria-busy="true">
      <h3 className="m-0 text-[24px] sm:text-[26px] font-semibold tracking-[-.028em] leading-[1.16]">
        {heading}
      </h3>
      <div className="ta text-[15px] sm:text-[16px] text-ink-45 mt-2" lang="ta">
        திட்டங்கள் சரிபார்க்கப்படுகின்றன
      </div>

      {(central || shard) && (
        <div className="flex flex-col gap-2.5 mt-6 max-w-[620px]">
          {central && (
            <div className="panel flex items-center justify-between gap-4 px-4 py-[15px] rounded-[5px]">
              <span className="text-[15px]">
                Central schemes
                <span className="ta block text-[12.5px] text-ink-40" lang="ta">மத்தியத் திட்டங்கள்</span>
              </span>
              <span className="mono tabular text-[11px] tracking-[.10em] text-[#2F6B4F] flex-none">
                {central.done} / {central.total} ✓
              </span>
            </div>
          )}
          {shard && (
            <div className="flex items-center justify-between gap-4 px-4 py-[15px] bg-white border-[1.5px] border-ink rounded-[5px]">
              <span className="text-[15px] font-medium">
                {stateName || 'Your state'} shard
                <span className="ta block text-[12.5px] font-normal text-ink-40" lang="ta">
                  உங்கள் மாநிலத் திட்டங்கள்
                </span>
              </span>
              <span className="mono tabular text-[11px] tracking-[.10em] text-ink flex-none animate-svPulse">
                {shard.done} / {shard.total} …
              </span>
            </div>
          )}
        </div>
      )}

      <div
        className="grid gap-3.5 mt-6"
        style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(min(100%,276px),1fr))' }}
        aria-hidden="true"
      >
        {Array.from({ length: cards }).map((_, i) => (
          <div key={i} className="panel px-[19px] py-[18px] min-h-[204px] flex flex-col gap-[11px]">
            <div className="w-16 h-3.5 rounded-[2px] bg-rule-10" />
            <div className="w-full h-4 rounded-[3px] bg-rule-10 mt-1.5" />
            <div className="h-4 rounded-[3px] bg-rule-10" style={{ width: SKELETON_W[i % SKELETON_W.length] }} />
            <div className="flex-1" />
            <div className="w-[88px] h-[22px] rounded-[3px] bg-rule-10" />
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── 2 · Offline ──────────────────────────────────────────────────────────── */

/**
 * Leads with what survives. The matches were worked out on the device, so they
 * are still true; the only thing lost is freshness, and that is named exactly.
 *
 * @param {number} [matchCount]     matches already held on the device
 * @param {string} [lastRefreshed]  human date, e.g. "02 Aug 2026 · 09:14"
 */
export function StateOffline({ matchCount, lastRefreshed, onOpenSaved, onRetry }) {
  return (
    <div className={`${WRAP} pt-10 sm:pt-14`}>
      <div className="w-[52px] h-[52px] border-[1.5px] border-rule-22 rounded-full flex items-center justify-center" aria-hidden="true">
        <div className="w-[22px] h-[2px] bg-ink rotate-[-45deg]" />
      </div>

      <h3 className="mt-6 mb-0 text-[26px] sm:text-[30px] font-bold tracking-[-.032em] leading-[1.14]">
        No connection — showing what we saved
      </h3>
      <div className="ta text-[16px] sm:text-[17px] text-ink-60 mt-2.5" lang="ta">
        இணைப்பு இல்லை — சேமித்ததைக் காட்டுகிறோம்
      </div>

      <p className="mt-4 mb-0 text-[15.5px] sm:text-[16px] leading-[1.65] text-ink-90">
        {matchCount != null
          ? `Your ${matchCount.toLocaleString('en-IN')} matches were worked out on this device and are still here.`
          : 'Your matches were worked out on this device and are still here.'}
        {' '}What we cannot do right now is check whether any deadlines have changed
        {lastRefreshed ? ` since ${lastRefreshed}` : ' since we last refreshed'}.
      </p>
      <div className="ta text-[14px] text-ink-45 mt-2" lang="ta">
        பொருத்தங்கள் இந்த சாதனத்திலேயே கணக்கிடப்பட்டவை — அவை அப்படியே உள்ளன.
      </div>

      <div className="flex gap-2.5 mt-6 flex-wrap">
        {onOpenSaved && (
          <button
            onClick={onOpenSaved}
            className="min-h-[54px] px-6 bg-ink text-white rounded-[4px] text-[15.5px] font-semibold hover:opacity-90 transition-opacity"
          >
            {matchCount != null ? `See my saved ${matchCount} schemes` : 'See my saved schemes'}
          </button>
        )}
        {onRetry && (
          <button
            onClick={onRetry}
            className="min-h-[54px] px-6 border border-rule-22 rounded-[4px] text-[15.5px] font-medium hover:border-ink transition-colors"
          >
            Try again <span className="ta text-ink-45" lang="ta">· மீண்டும் முயற்சி</span>
          </button>
        )}
      </div>

      {lastRefreshed && (
        <div className="mono text-[10.5px] tracking-[.11em] text-ink-25 mt-5">
          Last refreshed {lastRefreshed}
        </div>
      )}
    </div>
  );
}

/* ── 3 · Empty ────────────────────────────────────────────────────────────── */

/**
 * Nothing found is a finding. The copy is careful never to imply breakage, and
 * never to guess at *why* nothing matched — only the counts we actually hold.
 *
 * @param {string}  category      label of the filter in force, e.g. "Sports"
 * @param {string} [categoryTa]   its Tamil label
 * @param {number} [checked]      schemes examined under that filter
 * @param {string} [stateName]
 * @param {number} [otherCount]   matches outside this filter, still intact
 * @param {string} [backLabel]    where "back" goes, e.g. "Farming, 52 schemes"
 */
export function StateEmpty({
  category,
  categoryTa,
  checked,
  stateName,
  otherCount,
  backLabel,
  onClear,
  onBack,
}) {
  return (
    <div className={`${WRAP} pt-10 sm:pt-14`}>
      <div className="w-[52px] h-[52px] border-[1.5px] border-dashed border-rule-22 rounded-[6px]" aria-hidden="true" />

      <h3 className="mt-6 mb-0 text-[26px] sm:text-[30px] font-bold tracking-[-.032em] leading-[1.14]">
        Nothing under {category || 'this filter'} for you
      </h3>
      <div className="ta text-[16px] sm:text-[17px] text-ink-60 mt-2.5" lang="ta">
        {categoryTa ? `${categoryTa} பிரிவில் ஒன்றும் இல்லை` : 'இந்தப் பிரிவில் ஒன்றும் இல்லை'}
      </div>

      <p className="mt-4 mb-0 text-[15.5px] sm:text-[16px] leading-[1.65] text-ink-90">
        {checked != null
          ? `All ${checked.toLocaleString('en-IN')} ${(category || '').toLowerCase()} schemes${
              stateName ? ` in ${stateName}` : ''
            } were checked against your answers, and none of them fit. `
          : 'Every scheme under this filter was checked against your answers, and none of them fit. '}
        That is a real answer, not a missing page
        {otherCount != null ? ` — your other ${otherCount.toLocaleString('en-IN')} matches are unaffected` : ''}.
      </p>
      <div className="ta text-[14px] text-ink-45 mt-2" lang="ta">
        இது ஒரு உண்மையான பதில் — பக்கம் காணாமல் போகவில்லை.
      </div>

      <div className="flex gap-2.5 mt-6 flex-wrap">
        {onClear && (
          <button
            onClick={onClear}
            className="min-h-[54px] px-6 bg-ink text-white rounded-[4px] text-[15.5px] font-semibold hover:opacity-90 transition-opacity"
          >
            Clear the filter <span className="ta font-normal opacity-70" lang="ta">· வடிகட்டியை நீக்கு</span>
          </button>
        )}
        {onBack && (
          <button
            onClick={onBack}
            className="min-h-[54px] px-6 border border-rule-22 rounded-[4px] text-[15.5px] font-medium hover:border-ink transition-colors"
          >
            {backLabel ? `Back to ${backLabel}` : 'Back to all my schemes'}
          </button>
        )}
      </div>
    </div>
  );
}

/* ── 4 · Many ─────────────────────────────────────────────────────────────── */

/**
 * The opposite failure. Three hundred matches is the honest number, so the
 * screen explains how the feed will be paced instead of quietly truncating.
 *
 * @param {number}  count           total matches
 * @param {number} [unvaluedCount]  of those, how many publish no amount
 * @param {number} [pageSize]       how many tiles arrive at a time
 */
export function StateMany({ count, unvaluedCount, pageSize = 30, onOpen }) {
  return (
    <div>
      <h3 className="m-0 text-[24px] sm:text-[26px] font-semibold tracking-[-.028em] leading-[1.16] max-w-[24ch]">
        {count != null ? `${count.toLocaleString('en-IN')} matches` : 'A great many matches'} — and we are not
        pretending there are fewer
      </h3>
      <div className="ta text-[15px] sm:text-[16px] text-ink-45 mt-2.5" lang="ta">
        எண்ணிக்கையைக் குறைத்துக் காட்டவில்லை
      </div>

      <p className="mt-3.5 mb-0 text-[15.5px] sm:text-[16px] leading-[1.65] text-ink-90 max-w-[78ch]">
        The feed shows one hero, then {pageSize} at a time. Weight decays down the list: your strongest
        match gets a full card, the rest get equal tiles
        {unvaluedCount != null
          ? `, and the ${unvaluedCount.toLocaleString('en-IN')} with no published amount are marked rather than hidden`
          : ', and any scheme with no published amount is marked rather than hidden'}
        . Nothing is dropped to make the number look friendlier.
      </p>

      {onOpen && (
        <button
          onClick={onOpen}
          className="mt-6 min-h-[54px] px-6 bg-ink text-white rounded-[4px] text-[15.5px] font-semibold hover:opacity-90 transition-opacity"
        >
          Open the full feed <span className="ta font-normal opacity-70" lang="ta">· முழுப் பட்டியல்</span>
        </button>
      )}
    </div>
  );
}

export default { StateLoading, StateOffline, StateEmpty, StateMany };
