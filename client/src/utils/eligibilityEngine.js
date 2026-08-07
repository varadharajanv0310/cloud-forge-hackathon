/**
 * eligibilityEngine.js — v2 matcher.
 *
 * Changes from v1, and why:
 *
 *  SCOPE.  v1 had no notion of level or state — every scheme in the file was
 *  assumed to apply. v2 admits central schemes for everyone and state schemes
 *  only for residents of that state, and drops institutional schemes from a
 *  citizen's feed entirely (a person cannot claim a Centre-of-Excellence grant).
 *
 *  PRECISION.  v1 matched 137 of 233 schemes (59%) for a typical profile because
 *  income limits existed on only 37 schemes and occupation on 99. Structured
 *  facets now carry gender, caste, occupation, BPL, student, disability and
 *  residence, so a match means something. Left unfixed, the India-wide corpus
 *  would have returned ~700 "matches" per citizen — a phone book, not a feed.
 *
 *  MONEY.  v1 summed one number per scheme, inventing Rs 50,000 whenever it
 *  could not parse an amount, and labelled the sum "per year". v2 returns a
 *  breakdown that never mixes kinds and never invents a figure.
 *
 *  COST.  v1's relatedEligible() rebuilt a 53,032-edge graph on every call.
 *  Relationships are now precomputed in the data (avg 3.2 per scheme).
 */

import { getLoadedSchemes, getSchemeById } from './schemesStore.js';

const DEFAULT_STATE = 'Tamil Nadu';

// ─── helpers ────────────────────────────────────────────────────────────────
export const daysUntil = (isoDate) => {
  if (!isoDate) return Infinity;
  const target = new Date(isoDate);
  if (Number.isNaN(target.getTime())) return Infinity;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.ceil((target - today) / (1000 * 60 * 60 * 24));
};

const OCCUPATION_RELATIVES = {
  farmer: ['daily_wage'],
  daily_wage: ['farmer', 'homemaker'],
  student: ['unemployed'],
  unemployed: ['student', 'daily_wage'],
  small_business: ['daily_wage'],
  homemaker: ['daily_wage'],
};

/** Citizen's state, defaulting to Tamil Nadu (the only districts onboarding offers). */
const profileState = (profile) => profile?.state || DEFAULT_STATE;

// ─── 1. hardFilter ──────────────────────────────────────────────────────────
/**
 * False when the profile definitively fails a rule. Null/empty means
 * "no restriction" and always passes — absence of a facet is unrestricted.
 */
export function hardFilter(scheme, profile) {
  if (!scheme || !profile) return false;
  const e = scheme.eligibility || {};

  // Institutional schemes are real but not claimable by a person.
  if (scheme.beneficiary_type === 'institution') return false;

  // Reach is the state list, not the level: 14 schemes are tagged Central while
  // naming specific states (one is Kerala + Tamil Nadu only), so trusting the
  // level would show those nationwide.
  if (!scheme.nationwide) {
    const reach = scheme.states && scheme.states.length
      ? scheme.states
      : [scheme.state || e.state].filter(Boolean);
    if (reach.length && !reach.includes(profileState(profile))) return false;
  }

  const age = profile.age ?? null;
  if (age !== null) {
    if (e.min_age != null && age < e.min_age) return false;
    if (e.max_age != null && age > e.max_age) return false;
  }

  if (e.gender && e.gender !== 'any' && profile.gender && e.gender !== profile.gender) {
    return false;
  }

  if (Array.isArray(e.caste_required) && e.caste_required.length > 0) {
    if (!profile.caste || !e.caste_required.includes(profile.caste)) return false;
  }

  if (e.income_max_annual != null && profile.annual_income != null) {
    if (profile.annual_income > e.income_max_annual) return false;
  }

  if (Array.isArray(e.occupation) && e.occupation.length > 0) {
    if (profile.occupation && !e.occupation.includes(profile.occupation)) return false;
  }

  // ── v3 discriminative gates ──
  // Rule throughout: exclude ONLY when the profile positively contradicts the
  // requirement. An unanswered field must never silently disqualify anyone,
  // otherwise a skipped question quietly costs the citizen real entitlements.

  if (e.student_required && profile.occupation && profile.occupation !== 'student') {
    return false;
  }

  // Education — 1,139 schemes, previously separated by a single bit.
  if (Array.isArray(e.student_levels) && e.student_levels.length > 0 && profile.student_level) {
    if (!e.student_levels.includes(profile.student_level)) return false;
  }
  if (e.marks_min_pct != null && profile.last_exam_pct != null) {
    if (profile.last_exam_pct < e.marks_min_pct) return false;
  }
  if (e.institution_type && profile.institution_type) {
    // A scheme for government students excludes private ones, but an
    // "aided" scheme should still admit government-school students.
    if (e.institution_type === 'private' && profile.institution_type !== 'private') return false;
    if (e.institution_type === 'government' && profile.institution_type === 'private') return false;
  }

  // Farming — tenure is the gate nobody asks.
  if (Array.isArray(e.land_tenure) && e.land_tenure.length > 0 && profile.land_tenure) {
    const wantsLandless = e.land_tenure.includes('landless');
    const wantsOwner = e.land_tenure.includes('owner') || e.land_tenure.includes('small_marginal');
    if (profile.land_tenure === 'landless' && wantsOwner && !wantsLandless) return false;
    if (profile.land_tenure !== 'landless' && wantsLandless && !wantsOwner &&
        !e.land_tenure.includes('tenant')) {
      return false;
    }
  }
  if (e.land_max_acres != null && profile.land_acres != null) {
    // Ceilings on small/marginal-farmer schemes; allow a margin for banding.
    if (profile.land_acres > e.land_max_acres * 1.25) return false;
  }
  if (e.fisher_required && profile.occupation && profile.occupation !== 'fisher') return false;

  // Disability — 221 schemes that could not surface at all before.
  if (e.disability_required) {
    if (profile.disability === 'none') return false;
    if (e.disability_min_pct != null && profile.disability === 'under40' &&
        e.disability_min_pct >= 40) {
      return false;
    }
  }

  // Household gates.
  if (Array.isArray(e.ration_card_required) && e.ration_card_required.length > 0 &&
      profile.ration_card && profile.ration_card !== 'unknown') {
    const poor = ['aay', 'bpl', 'priority'];
    const wantsPoor = e.ration_card_required.some((c) => poor.includes(c));
    if (wantsPoor && !poor.includes(profile.ration_card)) return false;
  }
  if (e.housing_status_required && profile.housing_status) {
    // Housing schemes target those without an adequate house.
    if (['homeless', 'kutcha', 'no_pucca'].includes(e.housing_status_required) &&
        profile.housing_status === 'owns_pucca') {
      return false;
    }
  }
  if (e.welfare_board_required && profile.welfare_board_registered === false) return false;
  if (e.pension_excluded && profile.drawing_pension === true) return false;
  if (e.maternity_required && profile.maternity === 'neither') return false;
  if (e.unemployed_required && profile.occupation &&
      !['unemployed', 'student'].includes(profile.occupation)) {
    return false;
  }
  if (e.chronic_illness_required && profile.chronic_illness === false) return false;

  if (e.minority_required && profile.is_minority === false) return false;
  if (e.bpl_required && profile.ration_card &&
      !['aay', 'bpl', 'priority'].includes(profile.ration_card)) {
    return false;
  }
  if (e.residence && e.residence !== 'any' && profile.residence &&
      e.residence !== profile.residence) {
    return false;
  }
  if (Array.isArray(e.marital_status) && e.marital_status.length > 0 &&
      profile.marital_status) {
    if (!e.marital_status.includes(profile.marital_status)) return false;
  }

  return true;
}

// ─── 2. scoreScheme ─────────────────────────────────────────────────────────
/**
 * 0-100. Rebalanced for v2: myScheme publishes a close date on ~5 of 1186
 * schemes, so v1's 25-point "deadline urgency" was a flat constant, and its
 * 20-point "district success rate" scored synthetic demo numbers. Weight now
 * sits on things that are real — money, how precisely the scheme targets this
 * person, and how hard it is to apply.
 */
export function scoreScheme(scheme, profile) {
  const b = scheme.benefit || {};
  const e = scheme.eligibility || {};
  let score = 0;

  // 1. BENEFIT VALUE (35) — log scale so a Rs 2 lakh grant does not swamp
  //    everything below it, and loans count for far less than cash.
  const cashish = (b.cash || 0) + (b.subsidy || 0) * 0.8 + (b.loan_ceiling || 0) * 0.15;
  if (cashish > 0) {
    score += Math.min(35, (Math.log10(cashish) / Math.log10(500000)) * 35);
  } else if (b.insurance_cover) {
    score += 12;
  } else if (b.in_kind) {
    score += 10;
  } else {
    score += 6;
  }

  // 2. TARGETING PRECISION (25) — a scheme written for this citizen in
  //    particular beats one open to everybody.
  let precision = 0;
  if (profile.occupation && (e.occupation || []).includes(profile.occupation)) precision += 9;
  if (profile.caste && (e.caste_required || []).includes(profile.caste)) precision += 6;
  if (profile.gender && e.gender === profile.gender) precision += 5;
  if (e.income_max_annual != null) precision += 3;
  if (e.min_age != null || e.max_age != null) precision += 2;
  score += Math.min(25, precision);

  // 3. APPLICATION SIMPLICITY (15)
  const docCount = (scheme.documents_required || []).length;
  if (docCount === 0) score += 9;            // unknown, not necessarily easy
  else if (docCount <= 2) score += 15;
  else if (docCount <= 4) score += 11;
  else score += 6;
  if ((scheme.application_modes || []).some((m) => /online/i.test(m))) score += 3;

  // 4. LOCALITY (12) — a state scheme is written for this state's citizens.
  score += scheme.level === 'state' ? 12 : 8;

  // 5. DEADLINE URGENCY (10) — only when a real date exists.
  if (scheme.deadline) {
    const d = daysUntil(scheme.deadline);
    if (d <= 7) score += 10;
    else if (d <= 30) score += 8;
    else if (d <= 90) score += 5;
    else score += 2;
  }

  // 6. Direct application URL is a materially better experience.
  if (scheme.official_url) score += 3;

  return Math.max(0, Math.min(100, Math.round(score)));
}

// ─── 3. fuzzyMatch ──────────────────────────────────────────────────────────
/** Called on schemes that FAILED hardFilter. Near-misses worth surfacing. */
export function fuzzyMatch(scheme, profile) {
  const e = scheme.eligibility || {};

  // Never soften these: they are categorical, not "nearly".
  if (scheme.beneficiary_type === 'institution') return null;
  if (!scheme.nationwide) {
    const reach = scheme.states && scheme.states.length
      ? scheme.states
      : [scheme.state || e.state].filter(Boolean);
    if (reach.length && !reach.includes(profileState(profile))) return null; // wrong state, full stop
  }
  if (e.gender && e.gender !== 'any' && profile.gender && e.gender !== profile.gender) {
    return null;
  }
  if (Array.isArray(e.caste_required) && e.caste_required.length > 0 &&
      profile.caste && !e.caste_required.includes(profile.caste)) {
    return null;
  }

  const age = profile.age ?? null;
  if (age !== null && e.min_age != null && age < e.min_age) {
    const diff = e.min_age - age;
    if (diff <= 3) {
      return {
        isFuzzy: true,
        type: 'age',
        months: Math.ceil(diff * 12),
        reason: `Eligible in ${diff} year${diff === 1 ? '' : 's'}`,
        reason_ta: `${diff} ஆண்டில் தகுதி பெறுவீர்கள்`,
      };
    }
    return null;
  }

  if (e.income_max_annual != null && profile.annual_income != null &&
      profile.annual_income > e.income_max_annual) {
    if (profile.annual_income / e.income_max_annual <= 1.2) {
      return {
        isFuzzy: true,
        type: 'income',
        reason: 'Just over the income limit — check with your Panchayat office',
        reason_ta: 'வருமான வரம்பை சற்று தாண்டுகிறது — ஊராட்சி அலுவலகத்தில் சரிபார்க்கவும்',
      };
    }
    return null;
  }

  if (Array.isArray(e.occupation) && e.occupation.length > 0 && profile.occupation &&
      !e.occupation.includes(profile.occupation)) {
    const related = OCCUPATION_RELATIVES[profile.occupation] || [];
    if (related.some((o) => e.occupation.includes(o))) {
      return {
        isFuzzy: true,
        type: 'occupation',
        reason: 'For a related occupation — you may still qualify',
        reason_ta: 'தொடர்புடைய தொழிலுக்கானது — நீங்களும் தகுதி பெறலாம்',
      };
    }
  }

  return null;
}

// ─── 4. getEligibleSchemes ──────────────────────────────────────────────────
/**
 * Main entry point.
 * @returns {{confirmed, fuzzy, totals, topCategory}}
 */
export function getEligibleSchemes(allSchemes, profile) {
  const empty = {
    confirmed: [],
    fuzzy: [],
    totals: emptyTotals(),
    topCategory: 'farming',
  };
  if (!profile || !Array.isArray(allSchemes) || allSchemes.length === 0) return empty;

  const confirmed = [];
  const fuzzy = [];

  for (const scheme of allSchemes) {
    if (hardFilter(scheme, profile)) {
      confirmed.push({ scheme, score: scoreScheme(scheme, profile) });
    } else {
      const f = fuzzyMatch(scheme, profile);
      if (f) fuzzy.push({ scheme, fuzzy: f, score: f.type === 'age' ? 40 : 30 });
    }
  }

  confirmed.sort((a, b) => b.score - a.score);
  fuzzy.sort((a, b) => b.score - a.score);

  const catCounts = {};
  for (const { scheme } of confirmed) {
    catCounts[scheme.category] = (catCounts[scheme.category] || 0) + 1;
  }
  const topCategory =
    Object.entries(catCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'farming';

  return {
    confirmed,
    fuzzy: fuzzy.slice(0, 6),
    // confirmed is already sorted by score, so the headline figure is built
    // from the same schemes the citizen sees at the top of the feed.
    totals: computeTotals(confirmed.map((c) => c.scheme), profile),
    topCategory,
  };
}

/** How many top schemes the headline figure is built from. */
export const FOCUS_N = 5;

function emptyTotals() {
  return {
    focusCount: 0,
    focusCashAnnual: 0,
    focusCashOneTime: 0,
    focusSchemes: [],
    cashAnnual: 0,
    cashOneTime: 0,
    loanCeiling: 0,
    subsidyTotal: 0,
    insuranceCover: 0,
    valuedCount: 0,
    unvaluedCount: 0,
    matchedCount: 0,
    targetedCount: 0,
    openCount: 0,
  };
}

/**
 * Does this scheme actively single out this citizen, or is it simply open to
 * everyone? Most of the corpus carries no restrictions at all, so a raw match
 * count reads as far more personal than it is. Saying "12 schemes are written
 * for someone like you, and 378 more are open to every citizen" is both honest
 * and more useful than "390 matches".
 */
export function isTargeted(scheme, profile) {
  const e = scheme.eligibility || {};
  if (profile.occupation && (e.occupation || []).includes(profile.occupation)) return true;
  if (profile.caste && (e.caste_required || []).includes(profile.caste)) return true;
  if (profile.gender && e.gender && e.gender === profile.gender) return true;
  if (e.income_max_annual != null) return true;
  if (e.bpl_required || e.student_required || e.disability_required) return true;
  if (scheme.level === 'state') return true;   // written for this state's people
  return false;
}

/**
 * Money breakdown across matched schemes.
 *
 * Two separate corrections live here.
 *
 * The first is per-scheme: kinds are never added together, and a scheme whose
 * amount could not be parsed is counted but never valued. v1 produced its
 * "Rs 1.0Cr per year" partly by substituting Rs 50,000 for every unparseable
 * scheme — 23% of that headline was invented.
 *
 * The second is about the aggregate itself, and it survives even after every
 * individual figure is correct. Against the India-wide corpus a citizen matches
 * ~390 schemes, and summing their cash gives ~Rs 3.8 crore. Every rupee of that
 * is arithmetically defensible and the number is still a lie, because nobody
 * applies to 390 schemes. So the headline is built from the FOCUS_N strongest
 * matches — a figure a person could actually go and claim. The full sum stays
 * available for context, clearly labelled as the whole catalogue rather than an
 * entitlement.
 */
export function computeTotals(schemes, profile) {
  const t = emptyTotals();
  const list = schemes || [];
  t.matchedCount = list.length;

  for (const s of list) {
    const b = s.benefit || {};
    let valued = false;

    if (profile) {
      if (isTargeted(s, profile)) t.targetedCount += 1;
      else t.openCount += 1;
    }

    if (b.cash) {
      // 'unknown' frequency is treated as one-time: claiming that an unqualified
      // figure recurs every year is the overstatement v2 exists to remove.
      if (b.cash_frequency === 'annual' || b.cash_frequency === 'monthly') {
        t.cashAnnual += b.cash;
      } else {
        t.cashOneTime += b.cash;
      }
      valued = true;
    }
    if (b.loan_ceiling) { t.loanCeiling += b.loan_ceiling; valued = true; }
    if (b.subsidy) { t.subsidyTotal += b.subsidy; valued = true; }
    if (b.insurance_cover) { t.insuranceCover += b.insurance_cover; valued = true; }

    if (valued) t.valuedCount += 1;
    else t.unvaluedCount += 1;
  }

  // The headline: the strongest matches *by fit*, taken in the order the caller
  // already ranked them, so the figure agrees with the cards at the top of the
  // feed. Ranking this by raw amount instead surfaced National Science Chair
  // and the Ramanujan Fellowship for a daily-wage labourer — schemes that match
  // only because myScheme records no eligibility restrictions on them, and that
  // no such citizen will ever receive.
  const focus = list.filter((s) => (s.benefit || {}).cash).slice(0, FOCUS_N);

  t.focusSchemes = focus;
  t.focusCount = focus.length;
  for (const s of focus) {
    if (isRecurring(s)) t.focusCashAnnual += s.benefit.cash;
    else t.focusCashOneTime += s.benefit.cash;
  }

  return t;
}

const isRecurring = (s) =>
  s.benefit.cash_frequency === 'annual' || s.benefit.cash_frequency === 'monthly';

// ─── 5. Cross-scheme chaining ───────────────────────────────────────────────
/**
 * Adjacent schemes the same citizen also qualifies for.
 *
 * v1 rebuilt a full similarity graph (53,032 edges over 233 schemes) on every
 * single call, because 230 of 233 schemes shared the placeholder document
 * "Aadhaar Card" and so linked to each other. Relationships are precomputed in
 * the dataset now, so this is a lookup and a filter.
 */
export function relatedEligible(schemeId, profile, allSchemes) {
  const pool = allSchemes || getLoadedSchemes();
  const src = getSchemeById(schemeId) || pool.find((s) => s.id === schemeId);
  if (!src || !profile) return [];

  const out = [];
  for (const rid of src.related_scheme_ids || []) {
    const r = getSchemeById(rid) || pool.find((s) => s.id === rid);
    if (!r || r.id === schemeId) continue;
    if (!hardFilter(r, profile)) continue;
    out.push({ scheme: r, score: scoreScheme(r, profile) / 100 });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 3);
}

/**
 * Kept so alertEngine and any legacy caller keep working. v2 does not build a
 * runtime graph; relationships ship precomputed in the data.
 */
export function buildSchemeGraph(allSchemes) {
  const graph = new Map();
  for (const s of allSchemes || []) {
    graph.set(s.id, {
      related: (s.related_scheme_ids || []).map((id) => ({ id, weight: 1, reason: 'precomputed' })),
    });
  }
  return graph;
}

// ─── Legacy compatibility ───────────────────────────────────────────────────
/** Used by CrossSchemeChain. */
export const evaluateOne = (scheme, profile) => {
  if (!scheme || !profile) return { status: 'unknown', score: 0 };
  if (hardFilter(scheme, profile)) {
    return { status: 'eligible', score: scoreScheme(scheme, profile) / 100, reasons: [] };
  }
  const f = fuzzyMatch(scheme, profile);
  if (f) return { status: 'close_match', score: 0.35, reasons: [f.type], fuzzy: f };
  return { status: 'not_eligible', score: 0, reasons: [] };
};

/** Used by SahayakMode to evaluate a beneficiary's profile. */
export const evaluateAll = (profile, allSchemes) => {
  const pool = allSchemes || getLoadedSchemes();
  const { confirmed, fuzzy, totals } = getEligibleSchemes(pool, profile);
  return {
    eligible: confirmed.map(({ scheme, score }) => ({
      scheme, score: score / 100, status: 'eligible',
    })),
    close_matches: fuzzy.map(({ scheme, fuzzy: f, score }) => ({
      scheme, score: score / 100, status: 'close_match', fuzzy: f,
    })),
    totals,
  };
};

/** @deprecated v1 summed a single per-scheme number. Use computeTotals(). */
export const totalBenefitValue = (entries) =>
  computeTotals((entries || []).map((e) => e.scheme).filter(Boolean)).cashAnnual;
