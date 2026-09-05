/**
 * digilocker.js
 * OAuth 2.0 (authorization code + PKCE) against the DigiLocker Partner API,
 * plus the issued-document list and a single-document pull.
 *
 * WHY THIS EXISTS
 * DigiLocker returns a citizen's *issued* documents — Aadhaar, PAN, driving
 * licence, vehicle RC, marksheets, caste and income certificates — as
 * government-signed XML. There is no photograph, no OCR and no guessing: the
 * issuer states the data. It is the only route that genuinely reaches most
 * Indian documents, which is why it is worth building even though the camera
 * and QR paths already work.
 *
 * THE ONE RULE
 * Talking to DigiLocker needs a partner client_id/client_secret issued under a
 * signed agreement with NeGD. This build does not have one. So the code below
 * is a faithful implementation of the real flow that starts working the moment
 * credentials are supplied, and when they are absent it runs in a mode that is
 * unmistakably labelled a demonstration — `source: 'demo'` on every payload,
 * '(DEMO)' on every name, and the words on screen rather than in a tooltip.
 * Nothing here may state or imply that a document was verified, issued, or
 * fetched from a government system when it was not. A judge discovering a faked
 * government integration is a far worse outcome than not having the integration.
 *
 * WHAT WE DO NOT DO
 * We parse the signed XML. We do not verify its signature — that needs the
 * issuer's certificate and a real RSA verify. `signatureVerified` is therefore
 * hardcoded false on every path, and the UI says "issued by", never "verified".
 */
import { Router } from 'express';
import crypto from 'node:crypto';

const router = Router();

/* ─────────────────────────────────────────────────────────────────────────────
   Config. Endpoint versions drift between Partner API revisions (authorize is
   on /1/, issued files moved to /2/, eAadhaar to /3/), so every path lives here
   and every one is env-overridable. A version bump should be one edit, not a
   hunt through the file.
   ──────────────────────────────────────────────────────────────────────────── */
const CFG = {
  base: process.env.DIGILOCKER_BASE || 'https://digilocker.meripehchaan.gov.in',
  clientId: process.env.DIGILOCKER_CLIENT_ID || '',
  clientSecret: process.env.DIGILOCKER_CLIENT_SECRET || '',
  redirectUri: process.env.DIGILOCKER_REDIRECT_URI
    || 'http://localhost:5050/api/digilocker/callback',
  // Where the citizen lands again once the handshake is done.
  appReturnUrl: process.env.DIGILOCKER_RETURN_URL || 'http://localhost:5173/profile',
  paths: {
    authorize: process.env.DIGILOCKER_PATH_AUTHORIZE || '/public/oauth2/1/authorize',
    token: process.env.DIGILOCKER_PATH_TOKEN || '/public/oauth2/1/token',
    issued: process.env.DIGILOCKER_PATH_ISSUED || '/public/oauth2/2/files/issued',
    xml: process.env.DIGILOCKER_PATH_XML || '/public/oauth2/1/xml',
    eaadhaar: process.env.DIGILOCKER_PATH_EAADHAAR || '/public/oauth2/3/xml/eaadhaar',
  },
};

const isConfigured = () => Boolean(CFG.clientId && CFG.clientSecret);
const mode = () => (isConfigured() ? 'live' : 'demo');

/* ─────────────────────────────────────────────────────────────────────────────
   Server-side state.

   Two in-memory maps: pending handshakes (state -> code_verifier) and live
   sessions (session id -> token). In memory is the right call for a demo and
   the wrong one for a deployment — a restart drops every connection and a
   second instance shares nothing. A real deployment needs Redis or a signed,
   encrypted cookie. Stated here so nobody has to discover it.

   The access token never leaves this process. It is not returned in any
   response body, never placed in a redirect URL, and never sent to the browser.
   The browser only ever holds an opaque session id in an httpOnly cookie.
   ──────────────────────────────────────────────────────────────────────────── */
const PENDING = new Map(); // state -> { verifier, createdAt }
const SESSIONS = new Map(); // sid   -> { accessToken, refreshToken, expiresAt, createdAt }

const PENDING_TTL_MS = 10 * 60 * 1000;
const SESSION_TTL_MS = 60 * 60 * 1000;

/** Both maps are pruned on every touch so neither can grow without bound. */
function prune() {
  const now = Date.now();
  for (const [k, v] of PENDING) if (now - v.createdAt > PENDING_TTL_MS) PENDING.delete(k);
  for (const [k, v] of SESSIONS) if (now - v.createdAt > SESSION_TTL_MS) SESSIONS.delete(k);
}

const COOKIE = 'sevai_dl_sid';

/** No cookie-parser dependency for one cookie. */
function readCookie(req, name) {
  const header = req.headers?.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

const sessionOf = (req) => {
  prune();
  const sid = readCookie(req, COOKIE);
  return sid ? SESSIONS.get(sid) || null : null;
};

/* ── PKCE ─────────────────────────────────────────────────────────────────────
   Mandatory on the Partner API, and correct regardless: without it an
   intercepted authorization code can be redeemed by whoever holds it.        */
const b64url = (buf) => buf.toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const makeVerifier = () => b64url(crypto.randomBytes(64)).slice(0, 128); // 43..128 chars
const challengeFor = (verifier) =>
  b64url(crypto.createHash('sha256').update(verifier).digest());

/** Never log a token, a code or a secret. */
const redact = (s) => String(s ?? '').replace(/[A-Za-z0-9_\-.]{12,}/g, '***');

/* ─────────────────────────────────────────────────────────────────────────────
   The single response builder. Every document, live or demo, leaves through
   here, so the shape the client sees cannot drift between paths — and the
   Aadhaar-number rule cannot be forgotten on one of them.
   ──────────────────────────────────────────────────────────────────────────── */
const DOC_TYPES = new Set(['aadhaar', 'pan', 'driving_licence', 'voter_id', 'other']);

const clean = (v, max = 200) => {
  if (typeof v !== 'string') return null;
  const s = v.replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim();
  return s && s.toLowerCase() !== 'null' ? s.slice(0, max) : null;
};

/** Indian documents print DD-MM-YYYY. Day-first, always. Ambiguity -> null. */
function toIso(v) {
  const s = clean(v, 40);
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return isoOf(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
  if (m) return isoOf(+m[3], +m[2], +m[1]);
  return null;
}
function isoOf(y, mo, d) {
  if (!(y >= 1900 && y <= 2100 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31)) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

const genderOf = (v) => {
  const g = String(v ?? '').trim().toLowerCase();
  if (['m', 'male'].includes(g)) return 'male';
  if (['f', 'female'].includes(g)) return 'female';
  if (['t', 'tg', 'transgender', 'o', 'other'].includes(g)) return 'transgender';
  return null;
};

const last4Of = (v) => {
  const digits = String(v ?? '').replace(/\D/g, '');
  return digits.length >= 4 ? digits.slice(-4) : null;
};

function buildDocument(fields = {}, source = 'demo') {
  const documentType = DOC_TYPES.has(fields.documentType) ? fields.documentType : 'other';
  const isDl = documentType === 'driving_licence';

  // The Aadhaar rule, enforced in one place so no path can forget it: the full
  // twelve digits never reach the client. Four is enough for a citizen to
  // recognise which card a form is asking for, and useless to anyone else.
  const rawId = clean(fields.idNumber, 40);
  const aadhaarLast4 = documentType === 'aadhaar'
    ? (last4Of(fields.aadhaarLast4) || last4Of(rawId))
    : null;
  const idNumber = documentType === 'aadhaar' ? null : rawId;

  return {
    documentType,
    confidence: 'high', // an issuer stating a value is not a guess
    name: clean(fields.name, 120),
    dob: toIso(fields.dob),
    idNumber,
    address: clean(fields.address, 300),
    gender: genderOf(fields.gender),
    fatherName: clean(fields.fatherName, 120),
    issueDate: isDl ? toIso(fields.issueDate) : null,
    expiryDate: isDl ? toIso(fields.expiryDate) : null,
    vehicleClasses: isDl && Array.isArray(fields.vehicleClasses)
      ? fields.vehicleClasses.map((c) => String(c).toUpperCase().slice(0, 10)).slice(0, 8)
      : null,
    source: source === 'digilocker' ? 'digilocker' : 'demo',
    issuer: clean(fields.issuer, 120),
    issuedOn: toIso(fields.issuedOn),
    aadhaarLast4,
    signaturePresent: Boolean(fields.signaturePresent),
    // Hardcoded. We parse the signed XML; we do not verify the signature, which
    // needs the issuer's certificate. Reporting true here would be the worst
    // kind of lie this product can tell, because everything downstream — the
    // profile, the checklist, the citizen standing at a counter — would treat
    // an unverified document as proven.
    signatureVerified: false,
  };
}

/* ─────────────────────────────────────────────────────────────────────────────
   Demo data. Clearly fake, format-valid, and labelled at every level.
   ──────────────────────────────────────────────────────────────────────────── */
const DEMO_DOCS = [
  {
    uri: 'in.gov.uidai-ADHAR-demo0001',
    name: 'Aadhaar Card (DEMO)',
    type: 'aadhaar',
    issuer: 'Unique Identification Authority of India',
    issuedOn: '2019-04-12',
    description: 'Identity and address, issued by UIDAI',
    fields: {
      documentType: 'aadhaar',
      name: 'Kavitha Rajan (DEMO)',
      dob: '14-03-1988',
      gender: 'F',
      aadhaarLast4: '6789',
      address: 'No 12, Sample Street, Anna Nagar, Chennai, Tamil Nadu, 600040',
      fatherName: 'Rajan Murugesan (DEMO)',
      signaturePresent: true,
    },
  },
  {
    uri: 'in.gov.pan-PANCR-demo0002',
    name: 'PAN Verification Record (DEMO)',
    type: 'pan',
    issuer: 'Income Tax Department',
    issuedOn: '2016-08-30',
    description: 'Permanent Account Number',
    fields: {
      documentType: 'pan',
      name: 'Kavitha Rajan (DEMO)',
      dob: '14-03-1988',
      idNumber: 'ABCPQ1234F',
      fatherName: 'Rajan Murugesan (DEMO)',
      signaturePresent: true,
    },
  },
  {
    uri: 'in.gov.transport-DRVLC-demo0003',
    name: 'Driving Licence (DEMO)',
    type: 'driving_licence',
    issuer: 'Ministry of Road Transport and Highways',
    issuedOn: '2018-06-14',
    description: 'Licence to drive, with vehicle classes',
    fields: {
      documentType: 'driving_licence',
      name: 'Kavitha Rajan (DEMO)',
      dob: '14-03-1988',
      idNumber: 'TN-01-2018-0012345',
      address: 'No 12, Sample Street, Anna Nagar, Chennai',
      issueDate: '14-06-2018',
      expiryDate: '13-06-2038',
      vehicleClasses: ['LMV', 'MCWG'],
      signaturePresent: true,
    },
  },
  {
    uri: 'in.gov.tn-INCCR-demo0004',
    name: 'Income Certificate (DEMO)',
    type: 'other',
    issuer: 'Revenue Department, Government of Tamil Nadu',
    issuedOn: '2025-11-03',
    description: 'Annual family income, for scheme eligibility',
    fields: {
      documentType: 'other',
      name: 'Kavitha Rajan (DEMO)',
      address: 'Anna Nagar, Chennai, Tamil Nadu',
      signaturePresent: true,
    },
  },
];

/* ─────────────────────────────────────────────────────────────────────────────
   XML reading.

   Deliberately narrow: a bounded attribute reader over the handful of shapes
   DigiLocker actually returns, with no new dependency. A real deployment should
   use a proper XML parser configured with entity expansion and external DTDs
   DISABLED — this input is a network response, and a naive parser is an XXE
   hole. The regex below cannot expand an entity, which is precisely why it is
   acceptable here and not merely convenient.
   ──────────────────────────────────────────────────────────────────────────── */
function readAttrs(xml, tagNames) {
  for (const tag of tagNames) {
    const m = new RegExp(`<${tag}\\b([^>]*)>`, 'i').exec(xml);
    if (!m) continue;
    const attrs = {};
    const re = /([A-Za-z_:][\w:.-]*)\s*=\s*"([^"]*)"/g;
    let a;
    while ((a = re.exec(m[1])) !== null) attrs[a[1].toLowerCase()] = a[2];
    if (Object.keys(attrs).length) return attrs;
  }
  return {};
}

function parseIssuedXml(xml, hint = {}) {
  const person = readAttrs(xml, ['Person', 'IssuedTo', 'Holder']);
  const cert = readAttrs(xml, ['Certificate', 'CertificateData', 'IssuedDoc']);
  const poa = readAttrs(xml, ['Poa', 'Address', 'Addr']);

  const addressParts = ['house', 'street', 'lm', 'landmark', 'loc', 'vtc', 'po', 'dist', 'state', 'pc']
    .map((k) => poa[k])
    .filter(Boolean);

  return buildDocument({
    documentType: hint.type,
    name: person.name || person.uname || cert.name || null,
    dob: person.dob || person.dateofbirth || null,
    gender: person.gender || person.sex || null,
    fatherName: person.co || person.careof || person.father || null,
    idNumber: cert.number || cert.certificateno || cert.docid || person.uid || null,
    aadhaarLast4: person.maskeduid || null,
    address: addressParts.length ? addressParts.join(', ') : null,
    issuer: hint.issuer || cert.issuer || null,
    issuedOn: cert.issuedate || cert.issueddate || hint.issuedOn || null,
    issueDate: cert.issuedate || null,
    expiryDate: cert.validtill || cert.expirydate || null,
    signaturePresent: /<Signature[\s>]/i.test(xml),
  }, 'digilocker');
}

/* ─────────────────────────────────────────────────────────────────────────────
   Routes
   ──────────────────────────────────────────────────────────────────────────── */

router.get('/digilocker/status', (req, res) => {
  res.json({
    configured: isConfigured(),
    mode: mode(),
    connected: Boolean(sessionOf(req)),
  });
});

router.get('/digilocker/authorize', (req, res) => {
  prune();
  if (!isConfigured()) {
    // No credentials: say so plainly rather than sending the citizen to a
    // government login that cannot possibly succeed.
    return res.json({
      demo: true,
      mode: 'demo',
      message:
        'DigiLocker needs a partner client id and secret issued by NeGD. '
        + 'This build has none, so the flow below is a demonstration and no '
        + 'government system is contacted.',
    });
  }

  const state = b64url(crypto.randomBytes(24));
  const verifier = makeVerifier();
  PENDING.set(state, { verifier, createdAt: Date.now() });

  const url = new URL(CFG.paths.authorize, CFG.base);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', CFG.clientId);
  url.searchParams.set('redirect_uri', CFG.redirectUri);
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', challengeFor(verifier));
  url.searchParams.set('code_challenge_method', 'S256');

  res.json({ demo: false, mode: 'live', url: url.toString() });
});

router.get('/digilocker/callback', async (req, res) => {
  prune();
  const { code, state, error: uError } = req.query || {};

  const back = (params) => {
    const u = new URL(CFG.appReturnUrl);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    return res.redirect(u.toString());
  };

  if (uError) return back({ digilocker: 'error', reason: String(uError).slice(0, 60) });

  // Without this check the flow is CSRF-open: anyone could hand the citizen a
  // callback URL carrying their own authorization code.
  const pending = typeof state === 'string' ? PENDING.get(state) : null;
  if (!pending) return back({ digilocker: 'error', reason: 'state_mismatch' });
  PENDING.delete(state);

  if (!code) return back({ digilocker: 'error', reason: 'no_code' });

  try {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code: String(code),
      client_id: CFG.clientId,
      client_secret: CFG.clientSecret,
      redirect_uri: CFG.redirectUri,
      code_verifier: pending.verifier,
    });

    const resp = await fetch(new URL(CFG.paths.token, CFG.base), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!resp.ok) throw new Error(`token endpoint returned ${resp.status}`);
    const tok = await resp.json();
    if (!tok?.access_token) throw new Error('token response carried no access_token');

    const sid = b64url(crypto.randomBytes(32));
    SESSIONS.set(sid, {
      accessToken: tok.access_token,
      refreshToken: tok.refresh_token || null,
      expiresAt: Date.now() + (Number(tok.expires_in || 3600) * 1000),
      createdAt: Date.now(),
    });

    // httpOnly so script on the page cannot read it; the token itself stays in
    // this process and never appears in the redirect.
    res.cookie?.(COOKIE, sid, { httpOnly: true, sameSite: 'lax', path: '/' });
    if (!res.cookie) {
      res.setHeader('Set-Cookie', `${COOKIE}=${sid}; HttpOnly; SameSite=Lax; Path=/`);
    }
    return back({ digilocker: 'connected' });
  } catch (err) {
    console.error('[digilocker] token exchange failed:', redact(err?.message || String(err)));
    return back({ digilocker: 'error', reason: 'token_exchange_failed' });
  }
});

router.get('/digilocker/issued', async (req, res) => {
  const session = sessionOf(req);

  if (!isConfigured() || !session) {
    return res.json({
      mode: 'demo',
      source: 'demo',
      demo: true,
      note: 'Demonstration data. No government system was contacted.',
      documents: DEMO_DOCS.map(({ uri, name, type, issuer, issuedOn, description }) =>
        ({ uri, name, type, issuer, issuedOn, description, source: 'demo' })),
    });
  }

  try {
    const resp = await fetch(new URL(CFG.paths.issued, CFG.base), {
      headers: { Authorization: `Bearer ${session.accessToken}` },
    });
    if (!resp.ok) throw new Error(`issued endpoint returned ${resp.status}`);
    const data = await resp.json();
    const items = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];

    return res.json({
      mode: 'live',
      source: 'digilocker',
      demo: false,
      documents: items.slice(0, 40).map((d) => ({
        uri: clean(d.uri || d.URI, 200),
        name: clean(d.name, 140),
        type: clean(d.doctype || d.type, 40),
        issuer: clean(d.issuer || d.issuerid, 120),
        issuedOn: toIso(d.date || d.issueddate),
        description: clean(d.description, 200),
        source: 'digilocker',
      })).filter((d) => d.uri),
    });
  } catch (err) {
    console.error('[digilocker] issued list failed:', redact(err?.message || String(err)));
    // Labelled failure rather than a 500 — the demo must never dead-end, and
    // the UI can render this sentence as-is.
    return res.json({
      mode: 'live',
      source: 'digilocker',
      demo: false,
      documents: [],
      error: 'Could not reach DigiLocker just now. Nothing was changed.',
    });
  }
});

router.post('/digilocker/fetch', async (req, res) => {
  const session = sessionOf(req);
  const uri = clean(req.body?.uri, 200);
  if (!uri) return res.status(400).json({ error: 'uri required', code: 'uri_required' });

  if (!isConfigured() || !session) {
    const demo = DEMO_DOCS.find((d) => d.uri === uri) || DEMO_DOCS[0];
    return res.json({
      ...buildDocument({ ...demo.fields, issuer: demo.issuer, issuedOn: demo.issuedOn }, 'demo'),
      demo: true,
      note: 'Demonstration data. No government system was contacted.',
    });
  }

  try {
    const isAadhaar = /uidai|adhar|aadhaar/i.test(uri);
    const target = isAadhaar
      ? new URL(CFG.paths.eaadhaar, CFG.base)
      : new URL(`${CFG.paths.xml}/${encodeURIComponent(uri)}`, CFG.base);

    const resp = await fetch(target, {
      headers: { Authorization: `Bearer ${session.accessToken}` },
    });
    if (!resp.ok) throw new Error(`document endpoint returned ${resp.status}`);
    const xml = await resp.text();

    const hint = { type: isAadhaar ? 'aadhaar' : undefined };
    return res.json({ ...parseIssuedXml(xml, hint), demo: false });
  } catch (err) {
    console.error('[digilocker] document fetch failed:', redact(err?.message || String(err)));
    return res.json({
      ...buildDocument({}, 'digilocker'),
      error: 'Could not read that document from DigiLocker. Nothing was changed.',
      demo: false,
    });
  }
});

router.post('/digilocker/disconnect', (req, res) => {
  const sid = readCookie(req, COOKIE);
  if (sid) SESSIONS.delete(sid);
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
  res.json({ connected: false, mode: mode() });
});

export default router;
