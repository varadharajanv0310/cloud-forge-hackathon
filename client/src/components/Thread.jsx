/**
 * Thread.jsx — the signature element.
 *
 * Every answer a citizen gives becomes a chip, and the chips do not disappear
 * when the question does. They accumulate through onboarding, collapse inward
 * to form the processing sphere, and are echoed back on each scheme card as the
 * reason that scheme matched.
 *
 * This is how the product answers "why am I seeing this?" — as a visual
 * property rather than a disclosure link. It works at low literacy because each
 * chip carries the exact word the citizen tapped, so they recognise their own
 * answer instead of parsing an eligibility table.
 */
import { QUESTIONS } from '../data/profileSchema.js';

// Never rendered in the Thread. This is frequently a shared phone and someone
// may be reading over the citizen's shoulder; caste, disability and marital
// status must not sit on screen as a persistent label.
const SENSITIVE = new Set(['caste', 'disability', 'marital_status', 'maternity']);

/** profile -> [{ key, label }] in question order. */
export function profileToChips(profile = {}, lang = 'en', { includeSensitive = false } = {}) {
  const out = [];
  for (const q of QUESTIONS) {
    if (!includeSensitive && SENSITIVE.has(q.key)) continue;
    const v = profile[q.key];
    if (v === undefined || v === null || v === '') continue;

    const match = (q.options || []).find((o) => o.value === v);
    let label = match ? (lang === 'ta' ? match.ta : match.en) : null;

    if (!label) {
      if (typeof v === 'boolean') label = v ? (lang === 'ta' ? 'ஆம்' : 'Yes') : null;
      else label = String(v);
    }
    if (!label) continue;
    out.push({ key: q.key, label });
  }
  return out;
}

/**
 * Which of a citizen's chips explain this particular match. Reads the scheme's
 * own eligibility so the reason shown is the reason the engine used.
 */
export function matchChips(scheme, profile = {}, lang = 'en') {
  const e = scheme?.eligibility || {};
  const chips = [];
  const push = (key, en, ta) => chips.push({ key, label: lang === 'ta' ? ta : en });

  if (profile.occupation && (e.occupation || []).includes(profile.occupation)) {
    const q = QUESTIONS.find((x) => x.key === 'occupation');
    const o = q.options.find((x) => x.value === profile.occupation);
    if (o) push('occupation', o.en, o.ta);
  }
  if (scheme?.nationwide) push('state', 'Central scheme', 'மத்தியத் திட்டம்');
  else if (profile.state && (scheme?.states || []).includes(profile.state)) {
    push('state', profile.state, profile.state);
  }
  if (e.income_max_annual != null && profile.ration_card &&
      ['aay', 'bpl', 'priority'].includes(profile.ration_card)) {
    push('ration_card', 'Income eligible', 'வருமானத் தகுதி');
  }
  if (e.marks_min_pct != null && profile.last_exam_pct != null &&
      profile.last_exam_pct >= e.marks_min_pct) {
    push('last_exam_pct', `${e.marks_min_pct}%+ marks`, `${e.marks_min_pct}%+ மதிப்பெண்`);
  }
  if (Array.isArray(e.student_levels) && profile.student_level &&
      e.student_levels.includes(profile.student_level)) {
    const q = QUESTIONS.find((x) => x.key === 'student_level');
    const o = q.options.find((x) => x.value === profile.student_level);
    if (o) push('student_level', o.en, o.ta);
  }
  if (e.welfare_board_required && profile.welfare_board_registered === true) {
    push('welfare_board_registered', 'Board registered', 'வாரியப் பதிவு');
  }
  if (Array.isArray(e.land_tenure) && profile.land_tenure &&
      e.land_tenure.includes(profile.land_tenure === 'sharecropper' ? 'tenant' : profile.land_tenure)) {
    const q = QUESTIONS.find((x) => x.key === 'land_tenure');
    const o = q.options.find((x) => x.value === profile.land_tenure);
    if (o) push('land_tenure', o.en, o.ta);
  }
  if (e.livestock_required && profile.livestock === true) {
    push('livestock', 'Keeps livestock', 'கால்நடை உள்ளது');
  }
  // Age is a safe, non-sensitive reason and is very often the real one.
  if (chips.length === 0 && profile.age != null && (e.min_age != null || e.max_age != null)) {
    push('age', `Age ${profile.age}`, `வயது ${profile.age}`);
  }
  return chips.slice(0, 3);
}

/** Horizontal strip of chips. Used under a question and on scheme cards. */
export default function Thread({ chips = [], lang = 'en', max = 0, className = '', tone = 'default' }) {
  if (!chips.length) return null;
  const shown = max > 0 ? chips.slice(-max) : chips;
  const hidden = chips.length - shown.length;

  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className}`} lang={lang}>
      {hidden > 0 && (
        <span className="chip text-muted" aria-label={`${hidden} earlier answers`}>
          +{hidden}
        </span>
      )}
      {shown.map((c, i) => (
        <span
          key={`${c.key}-${i}`}
          className={`chip ${tone === 'match' ? 'bg-surface-sub' : ''}`}
          lang={lang}
        >
          {c.label}
        </span>
      ))}
    </div>
  );
}

/** Why a scheme matched, shown on the artefact itself. */
export function MatchReason({ scheme, profile, lang = 'en', className = '' }) {
  const chips = matchChips(scheme, profile, lang);
  if (!chips.length) return null;
  return (
    <div className={className}>
      <div className="u-meta mb-1.5" lang={lang}>
        {lang === 'ta' ? 'ஏன் பொருந்தியது' : 'Why this matched you'}
      </div>
      <Thread chips={chips} lang={lang} tone="match" />
    </div>
  );
}
