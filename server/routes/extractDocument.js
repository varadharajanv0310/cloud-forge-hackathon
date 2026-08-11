/**
 * extractDocument.js
 * POST /api/extract-document
 *
 * Accepts a base64 data-URL image of an Indian ID document, asks Claude vision to
 * FIRST classify the document and THEN extract the fields that document actually
 * carries, and returns the shared contract shape.
 *
 * Response contract (every key is ALWAYS present — null, never omitted):
 *   {
 *     documentType: 'aadhaar'|'pan'|'driving_licence'|'voter_id'|'ration_card'|'other'|'unreadable',
 *     confidence:   'high'|'medium'|'low',
 *     name, dob, idNumber, address, gender, fatherName,
 *     issueDate, expiryDate, vehicleClasses,      // driving licence only, else null
 *     source:       'claude'|'mock'|'mock_fallback',
 *     error:        string|null                   // diagnostic only, not part of the contract
 *   }
 *
 * Every response path (success / no-key mock / error fallback) is funnelled through
 * buildResponse() so the shape cannot drift between them.
 *
 * Graceful-degradation policy (demo must never 500):
 *   no ANTHROPIC_API_KEY -> deterministic mock      (source: 'mock')
 *   Claude call fails    -> deterministic mock      (source: 'mock_fallback' + error)
 * Mocks are NEVER labelled 'claude'. The real error is always logged server-side.
 */
import { Router } from 'express';
import { getClaude, MODEL } from '../middleware/claudeClient.js';

const router = Router();

// ─────────────────────────────────────────────────────────────────────────────
// Contract vocabulary
// ─────────────────────────────────────────────────────────────────────────────
const ID_TYPES = new Set([
  'aadhaar',
  'pan',
  'driving_licence',
  'voter_id',
  'ration_card',
  'other',
  'unreadable',
]);

// Things the model might plausibly say instead of the canonical slug.
const DOC_TYPE_ALIASES = {
  aadhar: 'aadhaar',
  adhaar: 'aadhaar',
  aadhaar_card: 'aadhaar',
  aadhar_card: 'aadhaar',
  uidai: 'aadhaar',
  pan_card: 'pan',
  permanent_account_number: 'pan',
  driving_license: 'driving_licence',
  drivers_licence: 'driving_licence',
  drivers_license: 'driving_licence',
  dl: 'driving_licence',
  licence: 'driving_licence',
  license: 'driving_licence',
  voter: 'voter_id',
  voter_card: 'voter_id',
  voter_id_card: 'voter_id',
  epic: 'voter_id',
  elector_photo_identity_card: 'voter_id',
  ration: 'ration_card',
  family_card: 'ration_card',
  smart_card: 'ration_card',
  unknown: 'unreadable',
  unclear: 'unreadable',
  illegible: 'unreadable',
  none: 'unreadable',
};

const CONFIDENCES = new Set(['high', 'medium', 'low']);
const SOURCES = new Set(['claude', 'mock', 'mock_fallback']);

// Claude vision accepts exactly these. Rejecting anything else up front keeps an
// unsupported format (HEIC, SVG) from becoming a silent "mock_fallback".
const SUPPORTED_MEDIA_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

// Guard on the length of the base64 payload we would ship to the API (~5MB of
// base64 ≈ 3.7MB of actual image), rejected with a clear 413 instead of a stack trace.
const MAX_BASE64_CHARS = 5 * 1024 * 1024;

// Thinking tokens are billed against max_tokens alongside the visible reply, and
// on the current default model (claude-sonnet-5) adaptive thinking is ON when the
// `thinking` field is omitted — as it is here. The JSON payload itself is small
// (~300 tokens even with a full address), so the budget is really sizing the
// reasoning. Headroom is free: you are billed for tokens generated, not reserved.
//
// Sized deliberately high because the failure is silent. A truncated reply comes
// back as stop_reason 'max_tokens' -> unparseable JSON -> mock_fallback, so an
// undersized budget would not error; it would quietly serve canned data on every
// extraction while looking like it worked. That is the exact failure the retired
// model id in claudeClient.js caused, and it went unnoticed for weeks.
const MAX_TOKENS = 8192;

// Models from Opus 4.7 / Sonnet 5 onward removed the sampling parameters and
// reject a non-default `temperature` with a 400. MODEL is env-driven
// (CLAUDE_MODEL), so decide per-model rather than hardcoding either behaviour:
// on those models determinism comes from the strict schema in the system prompt.
// Sending temperature there would 400 on every request, and the soft fallback
// below would turn the whole feature into canned data without anyone noticing.
const REJECTS_SAMPLING_PARAMS =
  /^claude-(fable-5|mythos-5|opus-5|opus-4-7|opus-4-8|sonnet-5)/.test(MODEL);

// ─────────────────────────────────────────────────────────────────────────────
// Verhoeff checksum (the checksum UIDAI uses for the 12th Aadhaar digit)
// Implemented here so the Aadhaar mock below is derived, not guessed — a mock
// that failed the client's own isValidAadhaar() would make the feature look broken.
// ─────────────────────────────────────────────────────────────────────────────
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

const VERHOEFF_INV = [0, 4, 3, 2, 1, 5, 6, 7, 8, 9];

function verhoeffSum(digits) {
  let c = 0;
  const reversed = String(digits).split('').reverse();
  for (let i = 0; i < reversed.length; i += 1) {
    c = VERHOEFF_D[c][VERHOEFF_P[i % 8][Number(reversed[i])]];
  }
  return c;
}

const isVerhoeffValid = (digits) => verhoeffSum(digits) === 0;

/**
 * Derive the trailing Verhoeff check digit for an 11-digit Aadhaar prefix.
 * Appending a placeholder 0 puts the real digits at their final positions:
 * P[0][0] = 0 and D[c][0] = c, so the placeholder contributes nothing.
 */
const verhoeffCheckDigit = (prefix) => VERHOEFF_INV[verhoeffSum(`${prefix}0`)];

// Obviously-fake 999-prefix, real check digit computed at module load.
const MOCK_AADHAAR_PREFIX = '99912345678'; // first digit 9 => passes the 2-9 rule
const MOCK_AADHAAR_DIGITS = MOCK_AADHAAR_PREFIX + verhoeffCheckDigit(MOCK_AADHAAR_PREFIX);
const MOCK_AADHAAR = MOCK_AADHAAR_DIGITS.replace(/(\d{4})(\d{4})(\d{4})/, '$1 $2 $3');

if (!isVerhoeffValid(MOCK_AADHAAR_DIGITS)) {
  // Cannot happen unless the tables above are edited; loud, but never fatal.
  console.warn('[extract-document] mock Aadhaar failed its own Verhoeff check — check the tables');
}

// ─────────────────────────────────────────────────────────────────────────────
// Mocks — one per document type, all clearly fake but FORMAT-VALID so the
// client-side validators in utils/idDocuments.js pass on them.
// ─────────────────────────────────────────────────────────────────────────────
const MOCKS = {
  aadhaar: {
    documentType: 'aadhaar',
    confidence: 'high',
    name: 'Kavitha Rajan (DEMO)',
    dob: '1988-03-14',
    idNumber: MOCK_AADHAAR, // Verhoeff-valid, 4-4-4 grouping
    address: 'No. 12, Sample Street, Anna Nagar, Chennai - 600040',
    gender: 'female',
    fatherName: 'Rajan M (DEMO)',
  },
  pan: {
    documentType: 'pan',
    confidence: 'high',
    name: 'Murugan Selvam (DEMO)',
    dob: '1979-11-02',
    idNumber: 'ABCPQ1234F', // 4th char 'P' = individual holder code
    address: null, // PAN cards do not print an address
    gender: 'male',
    fatherName: 'Selvam K (DEMO)',
  },
  driving_licence: {
    documentType: 'driving_licence',
    confidence: 'medium',
    name: 'Arun Prakash (DEMO)',
    dob: '1992-07-21',
    idNumber: 'TN-01-2018-0012345',
    address: 'No. 8, Sample Road, Madurai - 625001',
    gender: 'male',
    fatherName: 'Prakash R (DEMO)',
    issueDate: '2018-06-14',
    expiryDate: '2038-06-13',
    vehicleClasses: ['LMV', 'MCWG'],
  },
  voter_id: {
    documentType: 'voter_id',
    confidence: 'medium',
    name: 'Lakshmi Devi (DEMO)',
    dob: '1985-01-30',
    idNumber: 'ABC1234567', // EPIC: 3 letters + 7 digits
    address: 'No. 45, Sample Cross Street, Coimbatore - 641001',
    gender: 'female',
    fatherName: 'Devan S (DEMO)',
  },
  ration_card: {
    documentType: 'ration_card',
    confidence: 'medium',
    name: 'Saravanan Muthu (DEMO)',
    dob: null, // family cards do not reliably print a DOB
    // A TN family card number is 12 digits, exactly an Aadhaar's shape, so
    // detectIdTypeFromNumber() does guess 'aadhaar' for this — shape is all it
    // has. The leading 1 is what matters: UIDAI reserves 0 and 1, so this can
    // never pass isValidAadhaar(), and the declared documentType below is what
    // the client validates against.
    idNumber: '118800112233',
    address: 'No. 3, Sample Lane, Trichy - 620001',
    gender: 'male',
    fatherName: null,
  },
};

// Fixed order so the "which mock?" choice is reproducible across restarts.
const MOCK_ORDER = ['aadhaar', 'pan', 'driving_licence', 'voter_id', 'ration_card'];

/**
 * Pick a mock deterministically from the image itself, so the demo shows variety
 * (different photo -> different document type) while the same photo always
 * produces the same result.
 */
function pickMock(base64Data = '') {
  const key = MOCK_ORDER[base64Data.length % MOCK_ORDER.length];
  return MOCKS[key];
}

// ─────────────────────────────────────────────────────────────────────────────
// Field normalisers
// ─────────────────────────────────────────────────────────────────────────────
function cleanText(value, maxLength = 200) {
  if (typeof value !== 'string') return null;
  const cleaned = value
    .replace(/[\x00-\x1f\x7f]/g, ' ') // strip control characters
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned || cleaned.toLowerCase() === 'null') return null;
  return cleaned.slice(0, maxLength);
}

/** ID numbers keep their printed grouping ("1234 5678 9012"), so only tidy the edges. */
function cleanIdNumber(value) {
  if (typeof value !== 'string') return null;
  const cleaned = value
    .replace(/[\x00-\x1f\x7f]/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
  if (!cleaned || cleaned.toLowerCase() === 'null') return null;
  return cleaned.slice(0, 40);
}

function normaliseDocType(value) {
  if (typeof value !== 'string') return null;
  const key = value.trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (ID_TYPES.has(key)) return key;
  return DOC_TYPE_ALIASES[key] ?? null;
}

function normaliseConfidence(value) {
  if (typeof value !== 'string') return 'low';
  const key = value.trim().toLowerCase();
  return CONFIDENCES.has(key) ? key : 'low';
}

function normaliseGender(value) {
  if (typeof value !== 'string') return null;
  const key = value.trim().toLowerCase();
  if (['m', 'male', 'ஆண்'].includes(key)) return 'male';
  if (['f', 'female', 'பெண்'].includes(key)) return 'female';
  if (['t', 'tg', 'transgender', 'third gender', 'திருநங்கை'].includes(key)) return 'transgender';
  return null;
}

function normaliseVehicleClasses(value) {
  const raw = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[,/]/)
      : [];

  const classes = [];
  for (const entry of raw) {
    if (typeof entry !== 'string' && typeof entry !== 'number') continue;
    const code = String(entry).trim().toUpperCase();
    if (!/^[A-Z0-9-]{2,10}$/.test(code)) continue;
    if (!classes.includes(code)) classes.push(code);
    if (classes.length === 8) break;
  }
  return classes.length ? classes : null;
}

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function buildIsoDate(year, month, day) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (year < 1900 || year > 2100) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  // Round-trip through UTC so impossible dates (31 Feb, 31 Apr) are rejected.
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Normalise a printed date to strict YYYY-MM-DD.
 *
 * Indian IDs are ALWAYS day-first (DD/MM/YYYY or DD-MM-YYYY), so 03/04/1990 is
 * 3 April, never 4 March. Anything that cannot be read unambiguously — two-digit
 * years, a bare year of birth, an out-of-range "month" that implies the document
 * was month-first — returns null. A null beats a plausible-looking wrong date.
 */
function toIsoDate(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text || text.toLowerCase() === 'null') return null;

  // Already ISO.
  let match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (match) return buildIsoDate(Number(match[1]), Number(match[2]), Number(match[3]));

  // Day-first numeric: 15/08/1990, 15-08-1990, 15.08.1990, 15 08 1990
  match = text.match(/^(\d{1,2})[/\-. ](\d{1,2})[/\-. ](\d{4})$/);
  if (match) return buildIsoDate(Number(match[3]), Number(match[2]), Number(match[1]));

  // Day-first with a month name: 15 Aug 1990, 15-AUG-1990
  match = text.match(/^(\d{1,2})[/\-. ]([A-Za-z]{3,9})[/\-. ](\d{4})$/);
  if (match) {
    const month = MONTHS[match[2].toLowerCase().slice(0, 3)];
    if (!month) return null;
    return buildIsoDate(Number(match[3]), month, Number(match[1]));
  }

  // Two-digit years and year-only values are ambiguous by construction.
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// The single response builder. Every path returns through here, so no path can
// omit a contract key or invent a value outside the allowed vocabulary.
// ─────────────────────────────────────────────────────────────────────────────
function buildResponse(fields = {}, source = 'mock_fallback', error = null) {
  const name = cleanText(fields.name, 120);
  const dob = toIsoDate(fields.dob);
  const idNumber = cleanIdNumber(fields.idNumber);
  const address = cleanText(fields.address, 300);
  const gender = normaliseGender(fields.gender);
  const fatherName = cleanText(fields.fatherName, 120);

  const declaredType = normaliseDocType(fields.documentType);
  const hasAnyField = [name, dob, idNumber, address, gender, fatherName].some((v) => v !== null);

  // An unrecognised label with real data behind it is 'other'; with nothing
  // behind it, we genuinely could not read the document.
  const documentType = declaredType ?? (hasAnyField ? 'other' : 'unreadable');
  const isUnreadable = documentType === 'unreadable';
  const isDrivingLicence = documentType === 'driving_licence';

  return {
    documentType,
    // 'unreadable' can never be reported confidently.
    confidence: isUnreadable ? 'low' : normaliseConfidence(fields.confidence),
    name: isUnreadable ? null : name,
    dob: isUnreadable ? null : dob,
    idNumber: isUnreadable ? null : idNumber,
    address: isUnreadable ? null : address,
    gender: isUnreadable ? null : gender,
    fatherName: isUnreadable ? null : fatherName,
    // Contract: licence-only fields are null on every other document type.
    issueDate: isDrivingLicence ? toIsoDate(fields.issueDate) : null,
    expiryDate: isDrivingLicence ? toIsoDate(fields.expiryDate) : null,
    vehicleClasses: isDrivingLicence ? normaliseVehicleClasses(fields.vehicleClasses) : null,
    source: SOURCES.has(source) ? source : 'mock_fallback',
    error: error ? String(error).slice(0, 300) : null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Vision prompt — classify first, then extract what that document actually carries
// ─────────────────────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You read a photograph of an Indian identity document and return structured data about it. You work in two steps.

Step 1 — classify the document. Choose exactly one:
- "aadhaar": UIDAI card carrying a 12-digit number printed in three groups of four (4-4-4), the UIDAI logo and usually a QR code; shows name, date or year of birth, gender and a full address, typically in English alongside a regional language.
- "pan": Income Tax Department PAN card, blue or grey, carrying a 10-character alphanumeric "Permanent Account Number" (five letters, four digits, one letter), the holder's name, the father's name and a date of birth; it carries the Government of India emblem and prints no address.
- "driving_licence": Indian driving licence carrying "DL No" or "Licence No", vehicle class codes such as LMV, MCWG, HMV, HGMV or TRANS, an issue date and a validity/expiry date, usually with blood group and address.
- "voter_id": Election Commission of India "Elector Photo Identity Card" (EPIC), carrying an EPIC number of three letters followed by seven digits, the elector's name, a father's or husband's name and an address.
- "ration_card": a state family or ration card (in Tamil Nadu, a TNPDS "Family Card"), listing a family head, family member names, a card number and often a card category such as rice or sugar.
- "other": a readable identity or government document that is none of the above.
- "unreadable": the photo is too blurry, dark, glared, cropped or angled to identify with confidence.

Step 2 — extract only the fields that document actually carries, and only what you can genuinely read on it.

Return ONE JSON object and nothing else. No markdown, no code fences, no commentary. Exactly these keys:
{
  "documentType": one of the seven values above,
  "confidence": "high" | "medium" | "low",
  "name": string or null,
  "dob": string or null,
  "idNumber": string or null,
  "address": string or null,
  "gender": "male" | "female" | "transgender" or null,
  "fatherName": string or null,
  "issueDate": string or null,
  "expiryDate": string or null,
  "vehicleClasses": array of strings or null
}

Rules:
- Copy dates EXACTLY as printed on the card, character for character (for example "15/08/1990" or "15-08-1990"). Do not reorder or reformat them; the server converts them.
- Copy idNumber exactly as printed, keeping the spacing and hyphens the card uses.
- issueDate, expiryDate and vehicleClasses apply to a driving licence only. Use null for all three on every other document type.
- Use null for any field the document does not carry, and for any field you cannot read. A PAN card has no address; a family card usually has no date of birth.
- Never infer, complete or correct a number, name or date you cannot fully see. If half the Aadhaar number is behind a thumb, idNumber is null.
- confidence describes the whole reading: "high" when the document type is obvious and the fields you filled in are crisp, "medium" when it is legible but some characters are uncertain, "low" when you are largely guessing.
- If you cannot tell what the document is, return "documentType": "unreadable" with "confidence": "low" and every other field null. Admitting the photo is unclear is the correct answer; a confident wrong answer is the worst possible outcome, because a real person's benefit application depends on it.`;

const USER_TEXT =
  'Classify this Indian identity document and extract its fields. Return only the JSON object.';

/** Mask digit runs so a debug log can never leak an ID number. */
const redact = (text = '') => String(text).replace(/\d{4,}/g, '****');

function parseModelJson(raw) {
  const withoutFences = raw.replace(/```(?:json)?/gi, '').trim();
  const start = withoutFences.indexOf('{');
  const end = withoutFences.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('model returned no JSON object');
  }
  return JSON.parse(withoutFences.slice(start, end + 1));
}

// ─────────────────────────────────────────────────────────────────────────────
// Route
// ─────────────────────────────────────────────────────────────────────────────
router.post('/extract-document', async (req, res) => {
  const { image } = req.body || {};

  if (!image || typeof image !== 'string') {
    return res.status(400).json({
      error: 'image field required (base64 data URL)',
      code: 'image_required',
    });
  }

  const match = image.match(/^data:(image\/[a-z+]+);base64,(.+)$/is);
  if (!match) {
    return res.status(400).json({
      error: 'image must be a base64 data URL (data:image/...;base64,...)',
      code: 'invalid_data_url',
    });
  }

  const mediaType = match[1].toLowerCase();
  const base64Data = match[2];

  if (!SUPPORTED_MEDIA_TYPES.has(mediaType)) {
    return res.status(400).json({
      error: `unsupported image type "${mediaType}" — use JPEG, PNG, GIF or WebP`,
      code: 'unsupported_media_type',
    });
  }

  if (base64Data.length > MAX_BASE64_CHARS) {
    return res.status(413).json({
      error: `image too large (${Math.round(base64Data.length / 1024)}KB encoded, limit ${Math.round(
        MAX_BASE64_CHARS / 1024,
      )}KB) — retake or compress the photo`,
      code: 'image_too_large',
    });
  }

  const claude = getClaude();
  if (!claude) {
    // No API key — deterministic mock so the demo flow stays unblocked.
    return res.json(buildResponse(pickMock(base64Data), 'mock'));
  }

  try {
    const request = {
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mediaType, data: base64Data },
            },
            { type: 'text', text: USER_TEXT },
          ],
        },
      ],
    };
    if (!REJECTS_SAMPLING_PARAMS) request.temperature = 0;

    const resp = await claude.messages.create(request);

    if (resp.stop_reason === 'refusal') {
      throw new Error('model declined to read this image');
    }
    if (resp.stop_reason === 'max_tokens') {
      throw new Error('model response truncated at max_tokens');
    }

    // Text blocks only — skips thinking blocks on thinking-enabled models.
    const raw = resp.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();

    let parsed;
    try {
      parsed = parseModelJson(raw);
    } catch (parseErr) {
      // Redacted so a malformed reply containing an ID number never hits the log.
      console.error(
        `[extract-document] could not parse model JSON (${raw.length} chars):`,
        redact(raw).slice(0, 400),
      );
      throw parseErr;
    }

    return res.json(buildResponse(parsed, 'claude'));
  } catch (err) {
    // Log the real error — status, type and stack — so a broken model id or a
    // rejected parameter is visible instead of hiding behind canned data.
    console.error('[extract-document] Claude call failed', {
      model: MODEL,
      status: err?.status ?? null,
      type: err?.error?.type ?? err?.name ?? null,
      message: err?.message ?? String(err),
    });
    if (err?.stack) console.error(err.stack);

    // Soft fallback — a mock rather than a 500, but never labelled 'claude'.
    return res.json(
      buildResponse(pickMock(base64Data), 'mock_fallback', err?.message ?? 'claude_error'),
    );
  }
});

export default router;
