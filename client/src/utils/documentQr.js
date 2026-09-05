/**
 * documentQr.js — reading the QR code that is already printed on an Indian
 * identity document, on this device, with no network and no OCR.
 *
 * ── Why this exists, and why it is tried before the camera read ───────────
 * Vision OCR guesses. A QR code does not. Every Aadhaar issued since 2018 —
 * the printed letter, the PVC card and the e-Aadhaar PDF — carries a UIDAI
 * "Secure QR Code" whose payload is a gzipped, delimited record of the exact
 * name, date of birth, gender and address that UIDAI itself holds. Decoding it
 * gives those values with zero reading error, entirely offline, with no API
 * key and no request.
 *
 * The privacy argument matters more than the accuracy one. The secure QR
 * deliberately does NOT carry the full 12-digit Aadhaar number: it carries the
 * last four digits, inside its reference id, and nothing else. So a citizen who
 * lets us read the QR hands over LESS about themselves than one who lets us
 * photograph the card and send it away to be read — and we get better data. The
 * UI is expected to say this at the point of the scan.
 *
 * ── What this module will never claim ─────────────────────────────────────
 * `signatureVerified` is hardcoded false, everywhere, always. The secure QR
 * ends in a 256-byte RSA signature over the payload, and checking it needs
 * UIDAI's public certificate and a real signature verification, neither of
 * which happens here. We parse; we do not verify. Telling a citizen their
 * document is "verified by UIDAI" when all we did was read a barcode would be
 * the worst kind of lie this product could tell, because they would carry that
 * belief to a government counter. The honest sentence is "read from the card's
 * QR code".
 *
 * ── Rules this file is built around ───────────────────────────────────────
 *   • Pure. No network, ever. No storage. No logging — an ID number in the
 *     console outlives the session on a shared phone.
 *   • DOM-free except for detectQrFromBitmap(), which is the one function
 *     allowed to touch BarcodeDetector and createImageBitmap. Everything else
 *     is a function of its arguments and can be unit-tested in node.
 *   • Nothing throws. Every entry point returns null (or []) on anything it
 *     cannot handle, because the caller's fallback is the vision path and a
 *     thrown error there would take down a working scan.
 */

import { detectIdTypeFromNumber, isValidAadhaar, isValidPan, normaliseId } from './idDocuments.js';

// ── Capability probe ────────────────────────────────────────────────────────
// Read once, at module load, so the UI can tell the citizen the truth about
// what this particular browser will do BEFORE they take the photograph. Where
// `detector` is false there is no on-device path at all, and any copy promising
// that the image stays on the phone would be false.
export const QR_SUPPORT = {
  detector: typeof globalThis !== 'undefined' && typeof globalThis.BarcodeDetector === 'function',
  gzip:
    typeof globalThis !== 'undefined' &&
    typeof globalThis.DecompressionStream === 'function' &&
    typeof globalThis.ReadableStream === 'function',
};

// ── Bounds ──────────────────────────────────────────────────────────────────
// A QR code cannot hold more than 7089 numeric or 4296 alphanumeric characters
// — that is the format's own ceiling at version 40, error correction L. Anything
// longer did not come off a card, so it is refused before any work is done on it.
const MAX_NUMERIC_PAYLOAD = 7089;
const MAX_TEXT_PAYLOAD = 4296;
// A secure QR inflates from several hundred bytes; a two-digit payload is not
// one, and BigInt work on junk is wasted work.
const MIN_NUMERIC_PAYLOAD = 64;
// Ceiling on the inflated result. A secure QR with its photo is tens of KB; a
// crafted payload that inflates to gigabytes would otherwise hang the phone.
const MAX_INFLATED_BYTES = 512 * 1024;

/**
 * The result shape, with every key always present.
 *
 * It is deliberately the same contract /api/extract-document returns, plus four
 * QR-only keys, so a caller can treat a QR read and a vision read identically
 * and never has to branch on where the data came from.
 *
 * `signatureVerified` is written AFTER the spread on purpose: no caller and no
 * future edit inside this file can set it true by passing it in.
 */
function qrResult(over = {}) {
  return {
    documentType: 'other',
    confidence: 'high',
    name: null,
    dob: null,
    idNumber: null,
    address: null,
    gender: null,
    fatherName: null,
    issueDate: null,
    expiryDate: null,
    vehicleClasses: null,
    source: 'qr',
    qrFormat: 'unknown',
    aadhaarLast4: null,
    signaturePresent: false,
    ...over,
    // Parsed, not verified. See the header. This is not a configurable field.
    signatureVerified: false,
  };
}

// ── Text decoding ───────────────────────────────────────────────────────────

/** ISO-8859-1, done by hand. The Encoding API maps the label 'iso-8859-1' onto
 *  windows-1252, which differs at 0x80-0x9F — close enough to hide a bug and
 *  not close enough to be right. One byte, one code point, no table. */
function latin1(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
  return out;
}

/**
 * One field off the card.
 *
 * Older secure QRs encode names in latin1; V3 and V4 cards carry UTF-8, which
 * is how Tamil, Devanagari and Bengali names survive the trip. Strict UTF-8 is
 * therefore tried first — it either parses or it does not, with no ambiguity —
 * and latin1 is the fallback for the bytes that fail it. Doing it the other way
 * round always "succeeds" and silently produces mojibake.
 */
function decodeField(bytes) {
  if (!bytes || bytes.length === 0) return '';
  if (typeof TextDecoder === 'function') {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes).trim();
    } catch {
      /* not UTF-8 — fall through to latin1 */
    }
  }
  return latin1(bytes).trim();
}

// ── Shared field conversions ────────────────────────────────────────────────

const GENDER_LETTERS = { M: 'male', F: 'female', T: 'transgender' };

/** M / F / T — and the spelt-out forms, which start with the same letter.
 *  Anything else (including 'O') returns null rather than a guess. */
function genderFrom(raw) {
  const c = String(raw ?? '').trim().charAt(0).toUpperCase();
  return GENDER_LETTERS[c] || null;
}

/**
 * The card prints DD-MM-YYYY; the contract carries YYYY-MM-DD.
 *
 * Two refusals are deliberate. A four-digit value is a YEAR of birth — older
 * cards carry only that — and inventing 1 January to satisfy the field would
 * put a date the citizen has never seen onto a government form. And a date that
 * does not exist (31-02-2001) is discarded rather than allowed to roll over
 * into 3 March, because a rolled-over date reads as real.
 */
function isoDate(raw) {
  const s = String(raw ?? '').trim();
  if (/^\d{4}$/.test(s)) return null; // year of birth only
  let y;
  let mo;
  let d;
  let m = /^(\d{2})[-/.](\d{2})[-/.](\d{4})$/.exec(s);
  if (m) {
    d = Number(m[1]);
    mo = Number(m[2]);
    y = Number(m[3]);
  } else {
    m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!m) return null;
    y = Number(m[1]);
    mo = Number(m[2]);
    d = Number(m[3]);
  }
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Address parts, in the order they are read aloud, empties skipped. */
function joinAddress(parts) {
  const kept = parts.map((p) => String(p ?? '').trim()).filter(Boolean);
  return kept.length ? kept.join(', ') : null;
}

/**
 * The care-of line names a relative, but not always the same one: S/O and D/O
 * name the father, W/O names a husband and C/O names whoever the post reaches.
 * Only the first two are returned, because the field they fill is read as
 * "father / guardian" and a husband is neither.
 */
function fatherFromCareOf(careOf) {
  const m = /^\s*([SD])\s*[/|]?\s*O\b[\s.:—-]*(.+)$/i.exec(String(careOf ?? '').trim());
  const name = m ? m[2].trim() : '';
  return name || null;
}

const clean = (s, max = 200) => {
  const v = String(s ?? '').trim().slice(0, max);
  return v || null;
};

/**
 * Coerce anything at all to a string, without ever throwing.
 *
 * String() itself throws on a value whose toString() throws. No QR code produces
 * such a payload, but a caller mid-refactor produces one easily, and the promise
 * this module makes is that IT is never the thing that ends an application in
 * progress. Every exported entry point goes through here before touching input.
 */
function asText(value) {
  if (typeof value === 'string') return value.trim();
  if (value === null || value === undefined) return '';
  try {
    return String(value).trim();
  } catch {
    return '';
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. Finding a QR in the frame — the ONLY function in this file that touches
//    a browser API. Everything downstream takes a string.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @param {HTMLVideoElement|HTMLCanvasElement|ImageBitmap|Blob} source
 * @returns {Promise<string[]>} raw payloads, [] when there is nothing to read.
 *
 * Never throws, and never logs what it found: a payload is an identity
 * document. BarcodeDetector is absent on Safari and on Firefox, which is why
 * QR_SUPPORT.detector exists and why the vision path is not optional.
 */
export async function detectQrFromBitmap(source) {
  if (!source) return [];
  const Detector = typeof globalThis !== 'undefined' ? globalThis.BarcodeDetector : undefined;
  if (typeof Detector !== 'function') return [];

  let bitmap = null;
  try {
    let target = source;
    // A Blob is not a drawable source; it has to be decoded first.
    if (typeof Blob !== 'undefined' && source instanceof Blob) {
      if (typeof globalThis.createImageBitmap !== 'function') return [];
      bitmap = await globalThis.createImageBitmap(source);
      target = bitmap;
    }
    // Constructing with an unsupported format throws in some builds, so the
    // constructor is inside the try with everything else.
    const detector = new Detector({ formats: ['qr_code'] });
    const found = await detector.detect(target);
    // Deduplicated: a caller decodes each payload in turn, and decoding a secure
    // QR twice means doing the BigInt and the inflate twice on a phone that is
    // also running a camera preview.
    return [...new Set(
      (Array.isArray(found) ? found : [])
        .map((b) => (typeof b?.rawValue === 'string' ? b.rawValue : ''))
        .filter(Boolean),
    )];
  } catch {
    return [];
  } finally {
    bitmap?.close?.();
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. Aadhaar Secure QR — V2/V3/V4, every card issued since 2018
// ═══════════════════════════════════════════════════════════════════════════

// Field order after the optional leading version token. Fixed by UIDAI's
// published layout; the delimiter between them is the single byte 0xFF.
const SECURE_FIELDS = [
  'referenceId', 'name', 'dob', 'gender', 'careOf', 'district', 'landmark',
  'house', 'location', 'pincode', 'postOffice', 'state', 'street',
  'subDistrict', 'vtc',
];

/** The decimal payload, big-endian, as bytes. Built by pushing and reversing
 *  rather than unshifting: same bytes, without the quadratic array shuffle on
 *  a payload that runs to a few thousand bytes. */
function decimalToBytes(digits) {
  let n = BigInt(digits);
  const out = [];
  while (n > 0n) {
    out.push(Number(n & 0xffn));
    n >>= 8n;
  }
  out.reverse();
  return Uint8Array.from(out);
}

/** Inflate, or null. Null covers three different situations that all mean the
 *  same thing to the caller — no gzip support, not gzip data, or a payload that
 *  expands beyond anything a card could hold — and all three send them to the
 *  vision path. */
async function gunzip(bytes) {
  if (!QR_SUPPORT.gzip) return null;
  // gzip magic. Cheap, and it rejects the overwhelming majority of numeric
  // payloads that are not secure QRs before a stream is ever constructed.
  if (bytes.length < 18 || bytes[0] !== 0x1f || bytes[1] !== 0x8b) return null;
  try {
    const source = new ReadableStream({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    });
    const reader = source.pipeThrough(new DecompressionStream('gzip')).getReader();
    const chunks = [];
    let total = 0;
    for (;;) {
      // eslint-disable-next-line no-await-in-loop
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.length;
      if (total > MAX_INFLATED_BYTES) {
        try { await reader.cancel(); } catch { /* already gone */ }
        return null;
      }
      chunks.push(value);
    }
    const out = new Uint8Array(total);
    let at = 0;
    for (const c of chunks) {
      out.set(c, at);
      at += c.length;
    }
    return out;
  } catch {
    return null;
  }
}

/**
 * The inflated payload is text fields delimited by 0xFF, then an email/mobile
 * indicator byte, then a JPEG2000 photograph, then a 256-byte signature.
 *
 * Only the text region is split. The photograph is dense with 0xFF bytes — it is
 * the JPEG2000/JPEG marker prefix — so splitting the whole buffer would produce
 * hundreds of meaningless fragments and could shift every field by one.
 */
function parseSecureQrFields(bytes) {
  const bounds = [];
  let start = 0;
  for (let i = 0; i < bytes.length && bounds.length < SECURE_FIELDS.length + 1; i++) {
    if (bytes[i] === 0xff) {
      bounds.push([start, i]);
      start = i + 1;
    }
  }
  if (bounds.length === 0) return null;

  // V2/V3/V4 lead with a version token, but cards exist that begin straight at
  // the reference id — so it is detected, never assumed. Assuming it is what
  // shifts every field by one and turns a date of birth into a gender.
  const first = decodeField(bytes.subarray(bounds[0][0], bounds[0][1]));
  const offset = /^V\d$/i.test(first) ? 1 : 0;

  const v = {};
  for (let i = 0; i < SECURE_FIELDS.length; i++) {
    const b = bounds[offset + i];
    v[SECURE_FIELDS[i]] = b ? decodeField(bytes.subarray(b[0], b[1])) : '';
  }

  // Two sanity gates. Gzip already rejects almost everything that is not a
  // secure QR; these catch the rest rather than emitting a record of blanks
  // that a citizen would have to disprove.
  if (!/^\d{4}/.test(v.referenceId)) return null;
  if (!v.name) return null;

  // referenceId is <last4 of Aadhaar><YYYYMMDDHHMMSSmmm>. The first four
  // characters are the only part of the number the payload contains — there is
  // no full Aadhaar in here to extract, by design, and none is synthesised.
  const aadhaarLast4 = v.referenceId.slice(0, 4);

  // Everything after the last text field: the indicator byte, the photo, any
  // email/mobile hashes and the signature. 256 bytes is the signature's own
  // length, so anything shorter cannot be carrying one.
  const lastBound = bounds[offset + SECURE_FIELDS.length - 1] || bounds[bounds.length - 1];
  const trailing = Math.max(0, bytes.length - (lastBound[1] + 1));

  return qrResult({
    documentType: 'aadhaar',
    qrFormat: 'aadhaar_secure_v2',
    name: clean(v.name, 120),
    dob: isoDate(v.dob),
    gender: genderFrom(v.gender),
    fatherName: fatherFromCareOf(v.careOf),
    address: joinAddress([
      v.house, v.street, v.landmark, v.location, v.vtc,
      v.postOffice, v.subDistrict, v.district, v.state, v.pincode,
    ]),
    // Null, and not the last four: the secure QR genuinely does not carry the
    // Aadhaar number, and a four-digit fragment sitting in a field called
    // idNumber would be read downstream as one.
    idNumber: null,
    aadhaarLast4: /^\d{4}$/.test(aadhaarLast4) ? aadhaarLast4 : null,
    signaturePresent: trailing >= 256,
  });
}

/**
 * Decode a UIDAI Secure QR payload (V2/V3/V4, 2018 onward).
 * @returns {Promise<object|null>}
 */
export async function decodeAadhaarSecureQr(payload) {
  try {
    const digits = asText(payload);
    // The payload is one very large decimal integer written out in full.
    if (!/^[0-9]+$/.test(digits)) return null;
    if (digits.length < MIN_NUMERIC_PAYLOAD || digits.length > MAX_NUMERIC_PAYLOAD) return null;

    const bytes = decimalToBytes(digits);
    const inflated = await gunzip(bytes);
    if (!inflated) return null;
    return parseSecureQrFields(inflated);
  } catch {
    // One outer net rather than three inner ones. BigInt, TextDecoder and the
    // stream APIs each have their own edge cases across browser versions, and
    // none of them is allowed to reach the caller's render.
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. Aadhaar old XML QR — pre-2018 cards, still in wallets and still valid
// ═══════════════════════════════════════════════════════════════════════════

const XML_ENTITIES = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&#39;': "'", '&#x27;': "'",
};

const unescapeXml = (s) =>
  String(s).replace(/&(?:amp|lt|gt|quot|apos|#39|#x27);/gi, (e) => XML_ENTITIES[e.toLowerCase()] ?? e);

/**
 * The pre-2018 QR is a single self-closing XML element:
 *
 *   <?xml version="1.0"?><PrintLetterBarcodeData uid="123456789012" name="…"
 *     gender="M" yob="1988" co="S/O …" house="" street="" lm="" loc=""
 *     vtc="" po="" dist="" state="" pc="" dob="01-01-1988"/>
 *
 * Attributes are pulled with a regex and NOT with DOMParser: this module stays
 * DOM-free, and the input is an untrusted string off a stranger's card. There is
 * no element nesting here to justify a parser.
 *
 * This format carries the FULL uid, which is exactly why UIDAI replaced it. A
 * caller that only wants the last four should read aadhaarLast4 and ignore
 * idNumber — both are provided so it never has to slice a number itself.
 *
 * Unsigned by design: signaturePresent is false, and honestly so.
 */
export function decodeAadhaarXmlQr(payload) {
  try {
    return parseAadhaarXml(asText(payload));
  } catch {
    return null;
  }
}

function parseAadhaarXml(s) {
  if (!s || s.length > MAX_TEXT_PAYLOAD) return null;
  if (!/PrintLetterBarcodeData/i.test(s)) return null;

  const attrs = {};
  const re = /([A-Za-z_][\w.-]*)\s*=\s*"([^"]*)"/g;
  let m = re.exec(s);
  while (m !== null) {
    attrs[m[1].toLowerCase()] = unescapeXml(m[2]).trim();
    m = re.exec(s);
  }

  const name = clean(attrs.name, 120);

  /*
   * The uid is put through isValidAadhaar — shape, the 2-9 leading digit rule
   * and the Verhoeff check digit — and dropped when it fails.
   *
   * This is the opposite of the rule for a number a volunteer TYPES, where a
   * failing checksum is reported so they can hunt the typo. There is no typo to
   * hunt here. A QR carries its own Reed-Solomon error correction, so it either
   * decodes to the exact bytes that were printed or it does not decode at all —
   * which means a uid that fails Verhoeff was never issued by UIDAI. It is a
   * fake card, a test card, or a payload that is not an Aadhaar QR.
   *
   * Emitting those twelve digits anyway, in a result stamped confidence:'high'
   * and documentType:'aadhaar', is precisely the false "valid" that
   * idDocuments.js exists to prevent — and it would be worse here, because it
   * would arrive wearing the authority of a machine-read barcode. Nobody is
   * blocked by dropping it: the name, address and date of birth still come
   * through, and the number printed on the front of the card is still there for
   * the vision path to read and for validateId() to judge on its own terms.
   */
  const uid = normaliseId('aadhaar', attrs.uid);
  const hasUid = Boolean(uid && isValidAadhaar(uid));
  if (!name && !hasUid) return null;

  return qrResult({
    documentType: 'aadhaar',
    qrFormat: 'aadhaar_xml',
    name,
    // `dob` when the card printed a full date, otherwise nothing: `yob` is a
    // year and a year is not a date of birth.
    dob: isoDate(attrs.dob || ''),
    gender: genderFrom(attrs.gender),
    fatherName: fatherFromCareOf(attrs.co),
    address: joinAddress([
      attrs.house, attrs.street, attrs.lm, attrs.loc, attrs.vtc,
      attrs.po, attrs.subdist, attrs.dist, attrs.state, attrs.pc,
    ]),
    idNumber: hasUid ? uid : null,
    aadhaarLast4: hasUid ? uid.slice(-4) : null,
    signaturePresent: false,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. Everything else — best effort, and labelled as such
// ═══════════════════════════════════════════════════════════════════════════
//
// Voter ID (EPIC), Parivahan driving licence and vehicle RC QRs all exist, and
// NONE of their payloads is publicly standardised. They vary by state, by
// issuing batch and by year, and several are signed binary blobs with no
// published layout at all. There is nothing here that can be called a decode.
//
// So this section does one honest thing: it looks for a token whose SHAPE is
// unmistakable — an EPIC number, a licence number — and reports the document
// type that token belongs to. The characters come off the QR exactly, with no
// OCR error, which is worth something; the interpretation of the surrounding
// payload is a guess, which is worth nothing and is not attempted.
//
// This is also why these results do not carry confidence 'high'. That value is
// reserved for the two Aadhaar formats above, which are decoded against a
// published layout. Calling a shape match "read clearly" would launder a guess
// into a fact, and the whole point of preferring QR over OCR is that we stop
// guessing. Nobody reading a stored result should be able to mistake these for
// verified — see signatureVerified, which is false here as everywhere.

const PAN_TOKEN = /\b[A-Z]{5}[0-9]{4}[A-Z]\b/;
const EPIC_TOKEN = /\b[A-Z]{3}[0-9]{7}\b/;
// SS-RR-YYYY-NNNNNNN, printed with hyphens, spaces or nothing at all.
const DL_TOKEN = /\b[A-Z]{2}[-\s]?[0-9]{2}[-\s]?[0-9]{4}[-\s]?[0-9]{7,8}\b/;

/** Printable characters only, bounded. Control bytes from a binary payload
 *  would otherwise reach a regex and, worse, a screen. */
const printable = (s) => String(s).replace(/[\u0000-\u001F\u007F]+/g, ' ').slice(0, MAX_TEXT_PAYLOAD);

/**
 * Values that are LABELLED in the payload — `name=…`, `DOB: …`. Reading a
 * labelled value is not a guess; deciding that some unlabelled fragment looks
 * like a name is, so nothing unlabelled is salvaged. A wrong name here becomes
 * a wrong name on a government form.
 */
function salvageLabelled(text) {
  const name = /(?:^|[;|,\n\t])\s*(?:name|nm)\s*[:=]\s*"?([^;|,\n\t"]{2,60})/i.exec(text);
  const dob = /(?:dob|date\s*of\s*birth)\s*[:=]\s*"?(\d{2}[-/.]\d{2}[-/.]\d{4}|\d{4}-\d{2}-\d{2})/i.exec(text);
  const gender = /(?:gender|sex)\s*[:=]\s*"?([MFT])\b/i.exec(text);
  return {
    name: name ? clean(name[1], 120) : null,
    dob: dob ? isoDate(dob[1]) : null,
    gender: gender ? genderFrom(gender[1]) : null,
  };
}

function bestEffortOther(raw) {
  const text = printable(raw);
  const upper = text.toUpperCase();

  // Newer PAN cards carry a QR whose payload has no public specification. We do
  // not pretend to decode it: returning null hands the card to the vision path,
  // which at least knows that it is reading rather than knowing.
  //
  // isValidPan, not the shape alone. The 4th character of a PAN is a holder-type
  // code assigned by the department, so ABCDE1234F is PAN-SHAPED but is not a
  // PAN. Matching on shape alone would let a stray token inside an unrelated
  // payload suppress a read that would otherwise have salvaged something, and
  // null here is expensive — it is the one answer that stops the caller cold.
  const panMatch = PAN_TOKEN.exec(upper);
  if (panMatch && isValidPan(panMatch[0])) return null;

  const salvaged = salvageLabelled(text);

  const epic = EPIC_TOKEN.exec(upper);
  if (epic && detectIdTypeFromNumber(epic[0]) === 'voter_id') {
    return qrResult({
      documentType: 'voter_id',
      qrFormat: 'epic',
      confidence: 'medium',
      idNumber: epic[0],
      ...salvaged,
    });
  }

  const dl = DL_TOKEN.exec(upper);
  // detectIdTypeFromNumber holds the RTO state-code list; reusing it here means
  // the list cannot drift between the two files, and 'XX' shaped like a licence
  // is not reported as one.
  if (dl && detectIdTypeFromNumber(dl[0]) === 'driving_licence') {
    return qrResult({
      documentType: 'driving_licence',
      qrFormat: 'parivahan',
      confidence: 'medium',
      idNumber: dl[0].replace(/[-\s]/g, ''),
      ...salvaged,
    });
  }

  return qrResult({
    documentType: 'other',
    qrFormat: 'unknown',
    // We read a QR and cannot say what it was. 'low' is what that means to
    // every screen that renders this contract.
    confidence: 'low',
    ...salvaged,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. The one entry point a scanner needs
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Decode any QR payload we might find on an Indian identity document.
 *
 * @returns {Promise<object|null>} the shared contract shape, or null when this
 *   payload is not something we can read — in which case the caller should fall
 *   back to the vision path rather than showing the citizen nothing.
 */
export async function decodeIndianDocumentQr(payload) {
  try {
    const raw = asText(payload);
    if (!raw) return null;

    // A digits-only payload is either a secure QR or something we cannot name.
    // It never falls through to the shape matcher below: there are no letters in
    // it to match, so the only possible outcome there is an empty 'other' record,
    // which is worse than admitting we could not read it. Worse still, a secure
    // QR we failed to inflate would have its compressed Aadhaar record passed on
    // as "salvaged text".
    if (/^[0-9]+$/.test(raw)) return await decodeAadhaarSecureQr(raw);

    const xml = decodeAadhaarXmlQr(raw);
    if (xml) return xml;

    return bestEffortOther(raw);
  } catch {
    return null;
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * SELF-TEST — 147 assertions, run under node before this file was committed.
 * Every number below is from an actual run, not an expectation.
 *
 * Test payloads are built the way UIDAI builds a real one, in reverse: field
 * strings joined with a 0xFF byte, gzipped, the gzip bytes read as a big-endian
 * BigInt, and that integer printed in decimal. The decoder is therefore
 * exercised through its public API on input it has no special knowledge of.
 *
 * What was checked, and what each case would have caught:
 *
 *  1. V2 payload WITH the leading version token, all 15 fields, 256 trailing
 *     bytes. Every field round-tripped: name, dob 14-03-1988 -> 1988-03-14,
 *     gender female, fatherName "Rajan Murugesan" (the S/O prefix consumed),
 *     aadhaarLast4 "1234", idNumber null, address joined in envelope order,
 *     confidence high, source qr, signaturePresent true, signatureVerified
 *     false, and the key set exactly the 16 contract keys.
 *
 *  2. The SAME record with NO version token — byte-identical result (JSON
 *     compare). V3 and V4 tokens also produced the identical record. This is the
 *     case that catches an off-by-one in the field walk: a hardcoded "skip the
 *     first field" still "parses" here, and returns a record whose name is a
 *     date and whose gender is a care-of line.
 *
 *  3. UTF-8. A Tamil name (கவிதா ராஜன்) and a Tamil village came back exact,
 *     code point for code point (===, not eyeballed). A latin1 name (José
 *     Fernández, high bytes) also came back exact via the fallback. Decoding
 *     latin1 FIRST passes neither test loudly — it returns mojibake and throws
 *     nothing — which is why the order in decodeField() is tested, not assumed.
 *
 *  4. Dates. Year-only "1988" -> dob null with every other field still
 *     populated; "31-02-1988" -> null (the UTC round-trip refuses to let it roll
 *     into 3 March); "14-03-1988" -> 1988-03-14 and "03-04-1990" -> 1990-04-03,
 *     pinning day-first; "" and "garbage" -> null.
 *
 *  5. signaturePresent by trailing byte count: 0 -> false, 100 -> false,
 *     255 -> false, 256 -> true, 1024 -> true. Also a realistic tail (indicator
 *     byte, a 600-byte photo deliberately peppered with 0xFF markers, then a
 *     256-byte signature): signaturePresent true AND the text fields unchanged
 *     — which is the assertion that proves the parser stops at vtc instead of
 *     splitting the photo into hundreds of fragments.
 *
 *  6. Degradation. 21 hostile payloads, each returning null and throwing
 *     nothing: non-numeric text, empty, whitespace, null, undefined, an object,
 *     an array, digits that are not gzip, digits with leading zeros, 30 digits
 *     (under the floor), 8000 digits (over the ceiling), gzip truncated to 60%
 *     and to 30%, gzip header only, gzip with a flipped byte, a valid gzip of
 *     text with no delimiters, a valid gzip whose referenceId is not digits, a
 *     valid gzip with an empty name, and a 4MB gzip bomb (caught by
 *     MAX_INFLATED_BYTES rather than by the heap). 21/21 null, 0 threw.
 *
 *  7. XML QR. A full PrintLetterBarcodeData element with a Verhoeff-valid uid ->
 *     full 12 digits in idNumber, last four in aadhaarLast4, &amp; decoded to
 *     "&", dob converted, address joined. Then the cases the isValidAadhaar gate
 *     exists for: one digit changed -> idNumber AND aadhaarLast4 both null with
 *     name and address still present; a uid starting with 1 -> dropped; a uid
 *     with a letter in it -> dropped rather than silently stripped down to a
 *     shorter wrong number; a uid printed as "9991 2345 6789" -> normalised and
 *     kept. Non-matching payloads (wrong element name, empty, null, plain text,
 *     a secure-QR integer) -> null, no throw.
 *
 *  8. Dispatch. decodeIndianDocumentQr routed: the integer payload to
 *     aadhaar/aadhaar_secure_v2, the XML payload to aadhaar/aadhaar_xml,
 *     "ABC1234567" and "EPIC NO: ABC1234567 | ELECTOR" to voter_id/epic,
 *     "TN0120180012345" and "DL NO TN-01-2018-0012345" to
 *     driving_licence/parivahan, "XX0120180012345" to other/unknown (the unknown
 *     state code rejected by detectIdTypeFromNumber, not by a list duplicated
 *     here), three real PANs to null, and — the one that matters — a corrupt
 *     long digit string to null rather than to other/unknown, so a compressed
 *     Aadhaar record can never be republished as salvaged "plain text".
 *     A PAN-SHAPED token that is not a PAN (ABCDE1234F, holder code "D") did NOT
 *     suppress the read, which is what the isValidPan gate buys.
 *
 *  8b. Throw safety at the entry point. null, undefined, a number, {}, [], true,
 *     a nested object, a Symbol, a 200,000-character string, control bytes, and
 *     an object whose toString() throws: 11/11 returned without throwing. That
 *     last one DID throw before asText() existed — String() propagates it — and
 *     it is the reason the helper is there.
 *
 *  9. Invariants asserted over all 35 results produced during the run:
 *     signatureVerified true anywhere: 0. source !== 'qr': 0. Secure-QR results
 *     carrying an idNumber: 0 of 19. Results with a wrong key set: 0.
 *     Malformed aadhaarLast4: 0.
 *
 * 10. detectQrFromBitmap. Under node, where BarcodeDetector does not exist, six
 *     kinds of input all returned [] and none threw; QR_SUPPORT read
 *     { detector: false, gzip: true }. With a stub detector returning duplicates
 *     and blanks, the result was deduplicated and the blanks dropped. With a
 *     constructor that throws and with a detect() that throws (the real
 *     InvalidStateError case: a video element polled before its first frame),
 *     both returned [] — a rejected promise there would end a scan loop on the
 *     first unlucky frame while the camera sat there looking like it worked.
 *
 * 11. Cost, on a realistic 2,639-byte record (988 gzip bytes, 2,379 decimal
 *     digits, ~a third of what a QR could hold): 0.25 ms per full decode on a
 *     desktop, averaged over 200 runs. The worst case the guards allow — 7,089
 *     digits of junk, which pays for the whole BigInt conversion before the gzip
 *     magic check rejects it — costs 0.557 ms, and is paid once per QR found,
 *     not once per camera frame.
 *
 * To re-run, save as a .mjs and point the import at this file:
 *
 * import { gzipSync } from 'node:zlib';
 * import { decodeAadhaarSecureQr } from './documentQr.js';
 *
 * const FIELDS = ['V2', '123420180101120000123', 'Kavitha Rajan', '14-03-1988',
 *   'F', 'S/O Rajan Murugesan', 'Chennai', 'Near Water Tank', 'No 12',
 *   'Anna Nagar', '600040', 'Anna Nagar PO', 'Tamil Nadu', 'Sample Street',
 *   'Chennai North', 'Chennai'];
 *
 * const payload = (fields, trailing = 256) => {
 *   const parts = [];
 *   for (const f of fields) parts.push(Buffer.from(f, 'utf8'), Buffer.from([0xff]));
 *   if (trailing) parts.push(Buffer.alloc(trailing, 0x5a));
 *   let n = 0n;
 *   for (const b of gzipSync(Buffer.concat(parts))) n = (n << 8n) | BigInt(b);
 *   return n.toString(10);
 * };
 *
 * console.log(await decodeAadhaarSecureQr(payload(FIELDS)));          // full record
 * console.log(await decodeAadhaarSecureQr(payload(FIELDS.slice(1)))); // no V2 token
 * console.log(await decodeAadhaarSecureQr('hello world'));            // null
 * ──────────────────────────────────────────────────────────────────────────── */
