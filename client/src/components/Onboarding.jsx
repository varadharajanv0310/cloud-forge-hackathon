import { useMemo, useState } from 'react';
import { QUESTIONS, nextQuestions } from '../data/profileSchema.js';
import { profileToChips } from './Thread.jsx';
import { useTTS } from '../hooks/useTTS.js';

/**
 * Onboarding — ported from the Claude Design source (Sevai.dc.html, isOnb).
 *
 * One question per screen, asked in large type, with the Tamil set directly
 * beneath the English rather than behind a toggle.
 *
 * Progress is expressed three ways deliberately: three bloom layers fade up as
 * the citizen advances (needs no literacy), the dot row fills, and an "n / of"
 * counter is given in the mono face for anyone who wants the number. Colour
 * alone would be invisible to a colour-blind user on a low-gamut screen.
 */

// Answers that must never be shown on screen again — this is frequently a
// shared phone and someone may be reading over the citizen's shoulder.
const SENSITIVE = new Set(['caste', 'disability', 'marital_status', 'maternity']);

const BASE_COUNT = QUESTIONS.filter((q) => !q.askWhen).length;

export default function Onboarding({ onComplete, lang = 'en', setLang }) {
  const [profile, setProfile] = useState({});
  const [history, setHistory] = useState([]);
  const [search, setSearch] = useState('');
  const { stop } = useTTS();

  const pending = nextQuestions(profile);
  const q = pending[0];
  const answered = history.length;
  const estimate = Math.max(BASE_COUNT, answered + pending.length);
  const p = estimate ? answered / estimate : 0;

  const chips = useMemo(() => profileToChips(profile, lang), [profile, lang]);

  const answer = (value) => {
    stop();
    if (!q) return;
    const next = { ...profile, [q.key]: value };
    setHistory((h) => [...h, q.key]);
    setProfile(next);
    setSearch('');
    if (nextQuestions(next).length === 0) onComplete(next);
  };

  const back = () => {
    stop();
    if (!history.length) return;
    const last = history[history.length - 1];
    const next = { ...profile };
    delete next[last];
    setHistory((h) => h.slice(0, -1));
    setProfile(next);
    setSearch('');
  };

  if (!q) return null;

  const isLong = q.type === 'state';
  const opts = isLong && search
    ? q.options.filter((o) => o.en.toLowerCase().includes(search.toLowerCase()))
    : q.options || [];

  // Three bloom layers, each fading up at its own point in the flow.
  const layer = (from, to) => Math.max(0, Math.min(1, (p - from) / (to - from)));

  return (
    <div className="relative min-h-[100dvh] flex flex-col bg-page overflow-hidden">
      <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
        {[
          [layer(0, .34), 'radial-gradient(52% 38% at 20% 6%,rgba(132,212,221,.62) 0%,rgba(132,212,221,.30) 38%,rgba(132,212,221,0) 72%)'],
          [layer(.28, .68), 'radial-gradient(58% 40% at 86% 22%,rgba(192,172,240,.60) 0%,rgba(192,172,240,.28) 40%,rgba(192,172,240,0) 74%)'],
          [layer(.6, 1), 'radial-gradient(66% 38% at 42% 100%,rgba(248,201,156,.66) 0%,rgba(248,201,156,.30) 40%,rgba(248,201,156,0) 74%)'],
        ].map(([o, bg], i) => (
          <div key={i} className="absolute inset-0 transition-opacity duration-[900ms]"
               style={{ opacity: o, background: bg }} />
        ))}
      </div>

      <div className="relative flex flex-col flex-1 min-h-0 mx-auto w-full max-w-[560px]">
        {/* ── top bar ──────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-5 pt-3.5">
          <button
            onClick={back}
            disabled={!history.length}
            aria-label="Previous question"
            className="w-11 h-11 flex items-center justify-center rounded-full border border-rule-16 bg-white/70 text-[17px] disabled:opacity-0"
          >
            ←
          </button>

          <div className="flex gap-[5px] items-center" role="progressbar"
               aria-valuenow={answered} aria-valuemin={0} aria-valuemax={estimate}>
            {Array.from({ length: Math.min(estimate, 12) }).map((_, i) => (
              <div key={i} className="h-[5px] rounded-full transition-all duration-300"
                   style={{
                     width: i < answered ? 16 : 5,
                     background: i < answered ? '#14141A' : 'rgba(20,20,26,.18)',
                   }} />
            ))}
          </div>

          <button
            onClick={() => setLang(lang === 'ta' ? 'en' : 'ta')}
            className="mono text-[11px] tracking-[.1em] text-ink-70"
          >
            {answered + 1}/{estimate}
          </button>
        </div>

        {/* ── the question ─────────────────────────────────────────────── */}
        <div className="px-5 pt-7">
          <h2 className="m-0" style={{ fontSize: 31, lineHeight: 1.14, fontWeight: 700, letterSpacing: '-.035em', textWrap: 'pretty' }}>
            {q.q.en}
          </h2>
          <div className="ta text-[19px] font-medium text-ink-80 mt-3" lang="ta">{q.q.ta}</div>
          {q.help && (
            <>
              <p className="mt-4 mb-0 text-[14.5px] leading-[1.55] text-ink-60">{q.help.en}</p>
              <div className="ta text-[13.5px] text-ink-40 mt-1" lang="ta">{q.help.ta}</div>
            </>
          )}
        </div>

        {SENSITIVE.has(q.key) && (
          <div className="mx-5 mt-4 border border-rule-16 rounded-[4px] bg-white/[.72] px-3.5 py-3 flex gap-3 items-start">
            <div className="w-[9px] h-[9px] rounded-[2px] bg-ink mt-1.5 flex-none" />
            <div>
              <div className="text-[13.5px] leading-[1.5] text-ink-90">
                This answer is never shown on your screen again. It is used only to check schemes.
              </div>
              <div className="ta text-[12.5px] text-ink-40 mt-1" lang="ta">
                இந்தப் பதில் மீண்டும் திரையில் காட்டப்படாது.
              </div>
            </div>
          </div>
        )}

        {isLong && (
          <div className="px-5 pt-5">
            <div className="flex items-center gap-2.5 border-[1.5px] border-ink rounded-[4px] bg-white px-3.5 h-[54px]">
              <div className="w-[13px] h-[13px] border-[1.5px] border-ink-60 rounded-full flex-none" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Type your state · மாநிலம்"
                className="border-0 outline-none flex-1 text-[16px] bg-transparent"
              />
            </div>
            <div className="mono text-[10.5px] tracking-[.12em] text-ink-45 mt-4">
              {search ? `${opts.length} matching` : 'All states & union territories'}
            </div>
          </div>
        )}

        {/* ── options ──────────────────────────────────────────────────── */}
        <div className="flex-1 min-h-0 overflow-auto px-5 pt-4 flex flex-col gap-[9px]">
          {opts.map((o) => (
            <button
              key={String(o.value)}
              onClick={() => answer(o.value)}
              className="group flex-none min-h-[56px] px-4 py-3 border border-rule-16 rounded-[4px] bg-white/[.82]
                         flex items-center justify-between gap-3.5 transition-all duration-200
                         hover:border-ink hover:bg-white hover:translate-x-[3px]"
            >
              <span className="min-w-0">
                <span className="block text-[16.5px] font-medium tracking-[-.012em] leading-[1.25]">{o.en}</span>
                {o.ta && o.ta !== o.en && (
                  <span className="ta block text-[13.5px] text-ink-45 mt-0.5" lang="ta">{o.ta}</span>
                )}
              </span>
              <span className="text-[15px] text-ink-15 flex-none">→</span>
            </button>
          ))}
          <div className="h-1 flex-none" />
        </div>

        {/* ── the Thread ───────────────────────────────────────────────── */}
        <div className="flex-none border-t border-rule-12 bg-page/[.86] px-5 pt-3 pb-3.5">
          {q.skippable && (
            <button
              onClick={() => answer(null)}
              className="w-full min-h-[48px] rounded-[4px] text-center text-[15px] text-ink-70 mb-3
                         border border-dashed transition-colors hover:border-ink hover:text-ink"
              style={{ borderColor: 'rgba(20,20,26,.28)' }}
            >
              Skip this question · <span className="ta" lang="ta">தவிர்க்கவும்</span>
            </button>
          )}
          <div className="mono text-[10px] tracking-[.12em] text-ink-40 mb-2.5">
            Your answers so far · {chips.length}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {chips.length === 0 ? (
              <span className="text-[13px] text-ink-25">Nothing yet — this is the first question.</span>
            ) : (
              chips.map((c, i) => <span key={`${c.key}-${i}`} className="chip">{c.label}</span>)
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
