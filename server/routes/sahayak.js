/**
 * sahayak.js
 * POST /api/sahayak/grant   — the citizen's phone asks for a handover token
 * POST /api/sahayak/redeem  — the helper's phone exchanges it for a session
 * GET  /api/sahayak/session — what the helper is currently allowed to see
 * POST /api/sahayak/end     — either side ends it
 *
 * WHAT THIS REPLACES
 * Assisted access used to be a six-digit code and a PIN, both typed. Three
 * things were wrong with that. The code was guessable (a million possibilities,
 * no rate limit, and the demo shipped three of them in the UI). It never
 * expired, so a code overheard at a counter worked that evening. And nothing
 * bound the grant to the citizen who gave it — anyone holding the digits was
 * the beneficiary as far as the app was concerned.
 *
 * A signed token fixes all three at once, and a QR carries it without anyone
 * reading digits aloud in a queue.
 *
 * THE SHAPE OF THE HANDOVER
 *   1. The citizen taps "hand this phone to a helper". Their phone asks this
 *      route for a token and draws it as a QR on their own screen.
 *   2. The helper scans that QR with their own phone and redeems it here.
 *   3. The helper's phone now holds a session, scoped and time-boxed, and every
 *      action it takes is written to the citizen's audit log.
 *
 * The QR is shown on the citizen's screen and never leaves it. It is not sent,
 * not stored, and not printed — a photograph of it is useless the moment it
 * expires or is redeemed, whichever comes first.
 *
 * THREE PROPERTIES, EACH ENFORCED HERE RATHER THAN PROMISED
 *   Signed      — HMAC-SHA256 over the payload. A token that has been edited
 *                 (a longer expiry, a different beneficiary) fails verification.
 *   Short-lived — `exp` is inside the signed payload, so it cannot be extended
 *                 by editing the QR. Default 120 seconds: long enough to hand a
 *                 phone across a desk, too short to be useful to a photograph.
 *   Single-use  — the token id is burned on redemption. A QR photographed over
 *                 someone's shoulder is worthless once the helper has scanned it.
 */
import { Router } from 'express';
import crypto from 'node:crypto';

const router = Router();

/**
 * The signing key. A per-boot random key is the right default for a demo: it
 * means a restart invalidates every outstanding handover, which is the safe
 * direction to fail. A deployment sets SAHAYAK_SECRET so tokens survive a
 * restart and are consistent across instances — without it, two servers behind
 * a load balancer cannot verify each other's tokens.
 */
const SECRET = process.env.SAHAYAK_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.SAHAYAK_SECRET) {
  console.log('[sahayak] no SAHAYAK_SECRET set — using a per-boot key; restarts invalidate handovers');
}

const TOKEN_TTL_S = Number(process.env.SAHAYAK_TOKEN_TTL || 120);
const SESSION_TTL_MS = Number(process.env.SAHAYAK_SESSION_TTL || 15 * 60) * 1000;

const b64url = (buf) => Buffer.from(buf).toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');

const sign = (data) => b64url(crypto.createHmac('sha256', SECRET).update(data).digest());

/**
 * Burned token ids, and live sessions. In memory, which is correct for a demo
 * and wrong for a deployment — a restart forgets which tokens were spent, and a
 * second instance never knew. A real one needs Redis with a TTL.
 */
const BURNED = new Map();   // jti -> burnedAt
const SESSIONS = new Map(); // sid -> { beneficiary, grantedAt, expiresAt, actions[] }

function prune() {
  const now = Date.now();
  for (const [k, t] of BURNED) if (now - t > (TOKEN_TTL_S + 60) * 1000) BURNED.delete(k);
  for (const [k, s] of SESSIONS) if (now > s.expiresAt) SESSIONS.delete(k);
}

/* ── grant ─────────────────────────────────────────────────────────────────
   Called by the CITIZEN's phone. The beneficiary snapshot travels inside the
   signed payload rather than being looked up later, because there is no server
   copy of a citizen's vault to look it up in — the whole product keeps that on
   the device. Signing it is what stops the helper's phone from editing it.

   Only the fields an assisting helper actually needs are accepted. Caste,
   disability, marital and maternity status are dropped here even if the client
   sends them: a helper does not need them to fill a form, and a delegated
   session is exactly the wrong place for them to appear.                    */
const HELPER_VISIBLE = [
  'name', 'age', 'gender', 'state', 'occupation', 'ration_card',
  'land_tenure', 'land_acres', 'livestock', 'housing_status',
  'student_level', 'welfare_board_registered', 'aadhaar_last4',
];

router.post('/sahayak/grant', (req, res) => {
  prune();
  const src = req.body?.beneficiary;
  if (!src || typeof src !== 'object') {
    return res.status(400).json({ error: 'beneficiary required', code: 'beneficiary_required' });
  }

  const beneficiary = {};
  for (const k of HELPER_VISIBLE) if (src[k] !== undefined && src[k] !== null) beneficiary[k] = src[k];

  const now = Math.floor(Date.now() / 1000);
  const payload = {
    v: 1,
    jti: b64url(crypto.randomBytes(12)),
    iat: now,
    exp: now + TOKEN_TTL_S,
    scope: 'assist',            // read the profile, help apply; never change the PIN or erase
    b: beneficiary,
  };

  const body = b64url(JSON.stringify(payload));
  const token = `${body}.${sign(body)}`;

  res.json({
    token,
    expiresAt: payload.exp * 1000,
    ttlSeconds: TOKEN_TTL_S,
    // The citizen's screen shows this so they can say it aloud if the camera
    // will not focus — a fallback that costs nothing and rescues a bad light.
    shortCode: payload.jti.slice(0, 6).toUpperCase(),
  });
});

/* ── redeem ────────────────────────────────────────────────────────────────
   Called by the HELPER's phone with whatever the camera read.               */
router.post('/sahayak/redeem', (req, res) => {
  prune();
  const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
  const fail = (reason, message) => res.status(400).json({ ok: false, reason, message });

  const dot = token.indexOf('.');
  if (dot < 1) return fail('malformed', 'That code is not a Sevai handover code.');

  const body = token.slice(0, dot);
  const provided = token.slice(dot + 1);

  // Constant-time compare. A plain === leaks how much of the signature matched
  // through timing, which is the whole attack against a naive verifier.
  const expected = sign(body);
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return fail('bad_signature', 'That code has been altered and cannot be trusted.');
  }

  let payload;
  try {
    payload = JSON.parse(unb64url(body).toString('utf8'));
  } catch {
    return fail('malformed', 'That code is not a Sevai handover code.');
  }

  const now = Math.floor(Date.now() / 1000);
  // Checked AFTER the signature, so an expiry cannot be read off an unsigned
  // payload — and because exp lives inside the signed body, editing the QR to
  // extend it invalidates the signature.
  if (typeof payload.exp !== 'number' || now > payload.exp) {
    return fail('expired', 'That code has expired. Ask them to show a new one.');
  }
  if (!payload.jti || BURNED.has(payload.jti)) {
    return fail('already_used', 'That code has already been used once. Ask for a new one.');
  }

  BURNED.set(payload.jti, Date.now());

  const sid = b64url(crypto.randomBytes(24));
  const session = {
    beneficiary: payload.b || {},
    scope: payload.scope || 'assist',
    grantedAt: Date.now(),
    expiresAt: Date.now() + SESSION_TTL_MS,
    actions: [],
  };
  SESSIONS.set(sid, session);

  res.json({
    ok: true,
    sessionId: sid,
    expiresAt: session.expiresAt,
    scope: session.scope,
    beneficiary: session.beneficiary,
  });
});

router.get('/sahayak/session', (req, res) => {
  prune();
  const s = SESSIONS.get(String(req.query.sid || ''));
  if (!s) return res.status(404).json({ ok: false, reason: 'no_session' });
  res.json({ ok: true, ...s, remainingMs: Math.max(0, s.expiresAt - Date.now()) });
});

router.post('/sahayak/end', (req, res) => {
  const sid = String(req.body?.sessionId || '');
  const existed = SESSIONS.delete(sid);
  res.json({ ok: true, ended: existed });
});

export default router;
