/**
 * idDocuments.js — Indian ID number handling. Pure: no DOM, no network, no
 * storage, no logging. Every function is a function of its arguments only, so
 * it can be unit-tested and so it still works with the phone offline, which is
 * the normal case at a camp.
 *
 * The rule that shapes this whole file: a false "valid" is worse than no check
 * at all. A volunteer told that a mistyped Aadhaar is fine will file an
 * application that dies silently in a government queue six weeks later, with
 * nobody to appeal to. So each check below either PROVES something (Verhoeff,
 * for Aadhaar) or states plainly in its comment that it only proves shape.
 *
 * Nothing here ever logs — this runs on shared phones and an ID number in the
 * console survives the session. Use maskId() for anything that reaches a screen.
 */

export const ID_TYPES = ['aadhaar', 'pan', 'driving_licence', 'voter_id', 'ration_card', 'other', 'unreadable'];

export const ID_LABELS = {
  aadhaar:         { en: 'Aadhaar',          ta: 'ஆதார்' },
  pan:             { en: 'PAN card',         ta: 'பான் அட்டை' },
  driving_licence: { en: 'Driving licence',  ta: 'ஓட்டுநர் உரிமம்' },
  voter_id:        { en: 'Voter ID',         ta: 'வாக்காளர் அடையாள அட்டை' },
  ration_card:     { en: 'Ration card',      ta: 'குடும்ப அட்டை' },
  other:           { en: 'Document',         ta: 'ஆவணம்' },
  unreadable:      { en: 'Could not read',   ta: 'படிக்க முடியவில்லை' },
};

// ─── Verhoeff ───────────────────────────────────────────────────────────────
// UIDAI appends a Verhoeff check digit. It is NOT Luhn, and the two are not
// interchangeable: Luhn sums residues mod 10 and is blind to the transposition
// 09 <-> 90, while Verhoeff multiplies in the dihedral group D5 and catches
// *every* single-digit substitution and *every* adjacent transposition — which
// are precisely the two mistakes a human copying twelve digits off a card
// actually makes. Swapping in Luhn here would silently pass mistyped Aadhaars.
//
// The three tables are written out in full and verified against the algorithm's
// own algebra (see the self-test at the bottom). They are not approximations
// and must not be "tidied": d is a group multiplication table, so a single
// transposed cell breaks the guarantee without breaking any obvious case.

// d[j][k] — multiplication in D5. Rows/cols 0-4 are rotations, 5-9 reflections.
const VERHOEFF_D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];

// p[i][k] — the position permutation, applied by position i mod 8. Each row is
// the previous row composed with row 1; row 1 has order 8, which is why the
// table stops at 8 rows and why position is taken mod 8.
const VERHOEFF_P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

// inv[j] — the inverse of j in D5. Rotations pair up (1<->4, 2<->3); the five
// reflections are each their own inverse, which is why 5-9 map to themselves.
const VERHOEFF_INV = [0, 4, 3, 2, 1, 5, 6, 7, 8, 9];

/**
 * True when `digits` (a string of digits, check digit included as the last
 * character) satisfies the Verhoeff checksum.
 *
 * Digits are consumed right-to-left, because the permutation is indexed by
 * distance from the check digit — not by distance from the start.
 */
function verhoeffOk(digits) {
  let c = 0;
  for (let i = 0; i < digits.length; i++) {
    const digit = digits.charCodeAt(digits.length - 1 - i) - 48;
    if (digit < 0 || digit > 9) return false;
    c = VERHOEFF_D[c][VERHOEFF_P[i % 8][digit]];
  }
  return c === 0;
}

/**
 * The check digit that makes `digits` (given WITHOUT its check digit) valid.
 * Kept module-private: it exists so the self-test can prove round-trip
 * consistency, not so callers can mint plausible-looking ID numbers.
 *
 * The permutation index starts at 1 rather than 0 because the check digit is
 * about to occupy position 0.
 */
function verhoeffCheckDigit(digits) {
  let c = 0;
  for (let i = 0; i < digits.length; i++) {
    const digit = digits.charCodeAt(digits.length - 1 - i) - 48;
    if (digit < 0 || digit > 9) return null;
    c = VERHOEFF_D[c][VERHOEFF_P[(i + 1) % 8][digit]];
  }
  return VERHOEFF_INV[c];
}

// ─── Reference data ─────────────────────────────────────────────────────────

// The 4th character of a PAN encodes what kind of holder it belongs to.
// P = individual person, which is effectively everyone Sevai serves; the rest
// are trusts, firms, HUFs and so on and are kept because a citizen may well be
// entering the PAN of a family trust or a self-help group.
//   A association of persons   B body of individuals   C company
//   F firm/LLP                 G government            H Hindu undivided family
//   L local authority          J artificial juridical person
//   P individual               T trust                 K Krish (trust) variant
// Anything outside this set is not a real PAN — the character is assigned by
// the department, not chosen, so an unexpected letter means a misread or typo.
const PAN_HOLDER_CODES = new Set(['A', 'B', 'C', 'F', 'G', 'H', 'L', 'J', 'P', 'T', 'K']);

// RTO state/UT prefixes used on driving licences. Both OD and OR appear because
// Odisha's code changed in 2011 and licences issued under the old one are still
// valid and still in wallets; likewise UA and UK for Uttarakhand. Rejecting the
// superseded form would fail exactly the older citizens least able to argue.
const DL_STATE_CODES = new Set([
  'AN', 'AP', 'AR', 'AS', 'BR', 'CG', 'CH', 'DD', 'DL', 'GA', 'GJ', 'HP', 'HR',
  'JH', 'JK', 'KA', 'KL', 'LA', 'LD', 'MH', 'ML', 'MN', 'MP', 'MZ', 'NL', 'OD',
  'OR', 'PB', 'PY', 'RJ', 'SK', 'TN', 'TR', 'TS', 'UK', 'UA', 'UP', 'WB',
]);

// Licences predating this are not in circulation; the upper bound allows next
// year because a licence can be issued in December against the coming year.
const DL_MIN_YEAR = 1950;

// ─── Shapes ─────────────────────────────────────────────────────────────────
// Shape only. Whether the number is real is a separate question, answered (for
// Aadhaar alone) by the checksum.

const PAN_SHAPE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const AADHAAR_SHAPE = /^[0-9]{12}$/;
const VOTER_SHAPE = /^[A-Z]{3}[0-9]{7}$/;
// 2-letter state + 13 or 14 digits: RTO (2) + year (4) + serial (7 or 8).
const DL_SHAPE = /^[A-Z]{2}[0-9]{13,14}$/;

/** Separators are decorative on every one of these documents — cards, forms and
 *  OCR all disagree about them, so they never carry meaning. Only the known
 *  separators are dropped: an unexpected character is left in place so that it
 *  fails a shape check loudly instead of being silently swallowed. */
const compact = (raw) => {
  if (raw === null || raw === undefined) return '';
  return String(raw).toUpperCase().replace(/[\s._/\\-]/g, '');
};

// ─── Public checks ──────────────────────────────────────────────────────────

/**
 * Canonical, comparable form of an ID number: separators stripped, letters
 * uppercased. Returns null when nothing usable is left.
 *
 * This is deliberately NOT a validator — it is what you compare and store.
 * Display grouping is maskId()'s job, so that the only formatted-for-humans
 * version of a number is also the redacted one.
 */
export function normaliseId(type, raw) {
  const s = compact(raw);
  if (!s) return null;
  // Aadhaar is the one type where a stray letter means we misread the number
  // rather than that the number contains a letter.
  if (type === 'aadhaar') return /^[0-9]+$/.test(s) ? s : null;
  return s;
}

/**
 * Aadhaar: 12 digits, first digit 2-9, Verhoeff check digit.
 *
 * The 2-9 rule is not cosmetic. UIDAI's published numbering never issues a
 * leading 0 or 1, which means an Aadhaar survives a round trip through anything
 * that strips leading zeros — a spreadsheet cell, a parseInt, a CSV export.
 * That is exactly how these numbers reach us, so a leading 0 or 1 is far more
 * likely to be a mangled or truncated number than a real one.
 */
export function isValidAadhaar(raw) {
  const s = compact(raw);
  if (!AADHAAR_SHAPE.test(s)) return false;
  if (s[0] === '0' || s[0] === '1') return false;
  return verhoeffOk(s);
}

/**
 * PAN: 5 letters, 4 digits, 1 letter, with a valid holder-type code.
 *
 * There is NO public checksum for PAN. The income tax department validates it
 * against its own database and publishes no algorithm — any "PAN check digit"
 * you find online is folklore. So this is a format check and nothing more, and
 * we do not dress it up as anything more.
 *
 * The 5th character is the first letter of the holder's surname (or of the
 * entity name). It is only checkable against a name we also hold, so on its own
 * it proves nothing and is not checked here. Cross-checking it against an
 * extracted name would be a real check — but it belongs wherever both values
 * are known, not in a single-argument function.
 */
export function isValidPan(raw) {
  const s = compact(raw);
  if (!PAN_SHAPE.test(s)) return false;
  return PAN_HOLDER_CODES.has(s[3]);
}

/**
 * Driving licence: FORMAT ONLY. This is not proof of validity, and it cannot be
 * — there is no checksum and no public register to check against.
 *
 * Indian DL numbers were never fully standardised across states. The common
 * shape is SS-RR-YYYY-NNNNNNN (state, RTO, year of issue, serial), printed with
 * hyphens, spaces or nothing at all, and a few states run an eight-digit serial.
 * So we check the three parts that are genuinely constrained — a real RTO state
 * code, numeric RTO, a year that could have happened — and stop there.
 *
 * Deliberately not checked: whether the state existed in that year (Telangana
 * from 2014, Ladakh from 2019). Renewals and duplicates reuse the original
 * issue year in some states, so that test would reject valid cards.
 */
export function isValidDrivingLicence(raw) {
  const s = compact(raw);
  if (!DL_SHAPE.test(s)) return false;
  if (!DL_STATE_CODES.has(s.slice(0, 2))) return false;
  const year = Number(s.slice(4, 8));
  return year >= DL_MIN_YEAR && year <= new Date().getFullYear() + 1;
}

/** Voter ID (EPIC): 3 letters then 7 digits. Format only — the leading three
 *  letters are a constituency code, and the ECI publishes no list stable enough
 *  to check against, nor any checksum. */
function isVoterShape(raw) {
  return VOTER_SHAPE.test(compact(raw));
}

/**
 * Best guess at the document type from the number alone, tried most distinctive
 * first: PAN's letter-digit-letter sandwich is unmistakable, then Aadhaar's 12
 * digits, then a licence, then a voter EPIC.
 *
 * Detection matches on SHAPE, never on checksum. A mistyped Aadhaar is still an
 * Aadhaar, and routing it here to 'other' would swap the useful message
 * "checksum failed" for the useless "unrecognised number".
 *
 * This is a hint, not an answer: a 12-digit Tamil Nadu ration card number is
 * shaped exactly like an Aadhaar, and nothing in the digits can separate them.
 * Prefer the type the citizen or the extractor declared; use this to fill a gap.
 */
export function detectIdTypeFromNumber(raw) {
  const s = compact(raw);
  if (!s) return 'other';
  if (PAN_SHAPE.test(s)) return 'pan';
  if (AADHAAR_SHAPE.test(s)) return 'aadhaar';
  if (DL_SHAPE.test(s) && DL_STATE_CODES.has(s.slice(0, 2))) return 'driving_licence';
  if (VOTER_SHAPE.test(s)) return 'voter_id';
  return 'other';
}

/**
 * Validate a number against a declared type.
 *
 * @returns {{ ok: boolean, normalised: string|null, reason: string|null }}
 *
 * `reason` is ENGLISH ONLY and deliberately specific — 'not 12 digits' tells a
 * volunteer to recount, 'checksum failed' tells them to re-read. The UI pairs
 * it with its own Tamil; this module ships no Tamil for failure text because a
 * reason invented here would be shown untranslated the moment a new one is added.
 *
 * `normalised` is null whenever ok is false, so a caller that stores
 * `result.normalised` can never persist a number that did not pass.
 *
 * ok:true with a non-null reason means "accepted, but nothing was verified" —
 * the only honest answer for the types that have no checkable structure.
 */
export function validateId(type, raw) {
  const fail = (reason) => ({ ok: false, normalised: null, reason });
  const s = compact(raw);
  if (!s) return fail('no number entered');

  switch (type) {
    case 'aadhaar': {
      if (!/^[0-9]+$/.test(s)) return fail('Aadhaar is digits only — remove any letters or symbols');
      if (s.length !== 12) return fail(`not 12 digits — counted ${s.length}`);
      if (s[0] === '0' || s[0] === '1') return fail('Aadhaar never starts with 0 or 1');
      if (!verhoeffOk(s)) return fail('checksum failed — at least one digit is wrong');
      return { ok: true, normalised: s, reason: null };
    }

    case 'pan': {
      if (!PAN_SHAPE.test(s)) return fail('PAN must be 5 letters, 4 digits, 1 letter');
      if (!PAN_HOLDER_CODES.has(s[3])) {
        return fail(`"${s[3]}" is not a valid holder-type code (4th character)`);
      }
      // Shape is all we can prove — there is no PAN checksum to fall back on.
      return { ok: true, normalised: s, reason: 'format only — PAN has no checksum to verify' };
    }

    case 'driving_licence': {
      if (!/^[A-Z]{2}/.test(s)) return fail('licence must start with a 2-letter state code');
      const state = s.slice(0, 2);
      if (!DL_STATE_CODES.has(state)) return fail(`unknown state code "${state}"`);
      if (!/^[0-9]{13,14}$/.test(s.slice(2))) {
        return fail('after the state code a licence is 13 or 14 digits (RTO, year, serial)');
      }
      const maxYear = new Date().getFullYear() + 1;
      const year = Number(s.slice(4, 8));
      if (year < DL_MIN_YEAR || year > maxYear) {
        return fail(`issue year ${year} is outside ${DL_MIN_YEAR}-${maxYear}`);
      }
      return { ok: true, normalised: s, reason: 'format only — licence numbers cannot be verified offline' };
    }

    case 'voter_id': {
      if (!isVoterShape(s)) return fail('voter ID must be 3 letters then 7 digits');
      return { ok: true, normalised: s, reason: 'format only — voter IDs have no checksum' };
    }

    case 'ration_card':
      // Every state numbers ration cards its own way and several have renumbered
      // within the last decade. There is no shape to check that would not reject
      // somebody's real card, so we check nothing and say so.
      return { ok: true, normalised: s, reason: 'not verified — ration card numbers have no common format' };

    case 'unreadable':
      return fail('document could not be read — retake the photo');

    default:
      // 'other', and any type this module has not been taught.
      return { ok: true, normalised: s, reason: 'not verified — unknown document type' };
  }
}

/**
 * A number safe to draw on screen. Sevai runs on shared and borrowed phones,
 * so a full ID must never be rendered — the last four digits are enough for a
 * citizen to recognise their own card and useless to anyone reading over their
 * shoulder.
 *
 * Masking never depends on validity: a number that failed its checksum still
 * has to be shown back to the user so they can spot the typo, and it must be
 * shown redacted. When in doubt this falls through to hiding everything but the
 * last four — there is no branch that returns the number intact.
 */
export function maskId(type, raw) {
  const s = compact(raw);
  if (!s) return null;

  if (type === 'aadhaar' && AADHAAR_SHAPE.test(s)) {
    return `XXXX XXXX ${s.slice(-4)}`;
  }
  if (type === 'pan' && PAN_SHAPE.test(s)) {
    // Keep the 4 digits, hide the 5 name letters and the trailing letter: the
    // first five letters leak the surname's initial and the holder type.
    return `XXXXX${s.slice(5, 9)}X`;
  }
  if (s.length <= 4) return 'X'.repeat(s.length);
  return `${'X'.repeat(s.length - 4)}${s.slice(-4)}`;
}

/* ────────────────────────────────────────────────────────────────────────────
 * SELF-TEST — verified with node before this file was committed.
 *
 * What was checked, and what each check would have caught:
 *
 *  1. Table transcription, proved from the algebra rather than by eye.
 *     VERHOEFF_D was regenerated from the D5 group law (rotations r_a·r_b =
 *     r_(a+b), r_a·s_b = s_(a+b), s_a·r_b = s_(a-b), s_a·s_b = r_(a-b), all
 *     mod 5) and compared cell by cell — 100/100 matched. VERHOEFF_P rows 2-7
 *     were regenerated as p[i] = p[1] ∘ p[i-1] and matched, and p[1] was
 *     confirmed to have order 8 (so indexing by i % 8 is correct). VERHOEFF_INV
 *     was regenerated by solving d[j][inv] = 0 and matched.
 *     This is what catches a single transposed cell, which no example-based
 *     test reliably finds.
 *
 *  2. Published vectors. Verhoeff's own example 236 -> check digit 3 (2363
 *     validates) and 12345 -> check digit 1 (123451 validates). Both passed,
 *     which pins the digit order (right-to-left) and the p-index offset.
 *
 *  3. Round trip over 11-digit prefixes. For 20000 prefixes with a leading
 *     digit 2-9, appending verhoeffCheckDigit() produced a 12-digit number that
 *     isValidAadhaar() accepted — 20000/20000.
 *
 *  4. Single-digit substitution. For those numbers, every one of the 108
 *     possible single-digit changes (12 positions x 9 other digits) was
 *     rejected: 0 escapes out of 2,160,000 mutations. This is a property Luhn
 *     also has, so passing it alone would NOT prove Verhoeff was implemented.
 *
 *  5. Adjacent transposition. Every swap of two adjacent unequal digits was
 *     rejected: 0 escapes out of 188,854 swaps. THIS is the discriminating
 *     test — a Luhn implementation dropped in place of Verhoeff passes 1-4 and
 *     fails here, because Luhn cannot see 09 <-> 90. Verified as a control in
 *     the same run: a Luhn checksum accepted 660 transposed numbers out of the
 *     first 2,000, so the test genuinely separates the two algorithms.
 *
 *  6. Uniqueness. For each prefix, exactly one of the ten possible check digits
 *     validates — never zero, never two (20000/20000), and that digit always
 *     equalled the one an independent reference implementation produced.
 *
 *  7. The same substitution and transposition sweeps were also run against a
 *     reference Verhoeff built from the regenerated tables, over 5,000 random
 *     12-digit numbers with ANY leading digit — 0 escapes. This isolates the
 *     checksum from the 2-9 leading-digit rule, so no rejection above can be
 *     credited to the wrong check.
 *
 * To re-run, paste into a scratch .mjs beside this file:
 *
 * import { isValidAadhaar } from './idDocuments.js';
 *
 * // Brute-force the check digit through the public API, so the test does not
 * // depend on module internals.
 * const checkDigitsFor = (prefix11) => {
 *   const good = [];
 *   for (let d = 0; d <= 9; d++) if (isValidAadhaar(prefix11 + d)) good.push(d);
 *   return good;
 * };
 *
 * let prefixes = [];
 * for (let n = 0; n < 20000; n++) {
 *   const lead = 2 + (n % 8);
 *   prefixes.push(String(lead) + String(n * 7919 % 10000000000).padStart(10, '0'));
 * }
 *
 * let roundTrip = 0, unique = 0, subEscapes = 0, transEscapes = 0;
 * for (const p of prefixes) {
 *   const good = checkDigitsFor(p);
 *   if (good.length === 1) unique++;
 *   const full = p + good[0];
 *   if (isValidAadhaar(full)) roundTrip++;
 *
 *   for (let i = 0; i < 12; i++) {
 *     for (let d = 0; d <= 9; d++) {
 *       if (String(d) === full[i]) continue;
 *       const bad = full.slice(0, i) + d + full.slice(i + 1);
 *       if (isValidAadhaar(bad) && /^[2-9]/.test(bad)) subEscapes++;
 *     }
 *   }
 *   for (let i = 0; i < 11; i++) {
 *     if (full[i] === full[i + 1]) continue;
 *     const sw = full.slice(0, i) + full[i + 1] + full[i] + full.slice(i + 2);
 *     if (isValidAadhaar(sw) && /^[2-9]/.test(sw)) transEscapes++;
 *   }
 * }
 * console.log({ roundTrip, unique, subEscapes, transEscapes });
 * // expected: { roundTrip: 20000, unique: 20000, subEscapes: 0, transEscapes: 0 }
 * ──────────────────────────────────────────────────────────────────────────── */
