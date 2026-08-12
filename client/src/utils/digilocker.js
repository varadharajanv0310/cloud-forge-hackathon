/**
 * digilocker.js — thin client for the /api/digilocker/* routes.
 *
 * DigiLocker returns a citizen's *issued* documents as government-signed XML,
 * so unlike the camera there is nothing to read and nothing to guess: the
 * issuer states the value. That provenance is the whole reason to offer it, and
 * it is why `issuer` and `issuedOn` travel with every document here — a screen
 * that hides where a value came from throws away the only advantage this route
 * has over a photograph.
 *
 * Two things this module deliberately does NOT do:
 *
 *   It never holds a token. The access token lives on the server, keyed by an
 *   opaque session id in an httpOnly cookie the page cannot read. That is why
 *   every call passes `credentials: 'include'` and why there is no login state
 *   in localStorage — there is nothing here worth stealing.
 *
 *   It never throws. This runs while a citizen is part-way through filling in
 *   their profile, and an exception would lose their place. Every failure comes
 *   back as a value with an `error` string the caller can render.
 */

const j = async (path, init = {}) => {
  const res = await fetch(`/api/digilocker/${path}`, {
    credentials: 'include',
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  return res.json();
};

/** { configured, mode: 'live'|'demo', connected } */
export async function getStatus() {
  try {
    return await j('status');
  } catch {
    // The API not being up is a normal state during a demo, not an error worth
    // a red banner — report it as "not configured" and let the UI say so.
    return { configured: false, mode: 'demo', connected: false, offline: true };
  }
}

/** { url } in live mode, { demo: true, message } without credentials. */
export async function getAuthorizeUrl() {
  try {
    return await j('authorize');
  } catch {
    return { demo: true, mode: 'demo', message: 'The Sevai API is not running.' };
  }
}

/** { documents: [{ uri, name, type, issuer, issuedOn, description }], demo } */
export async function listIssued() {
  try {
    const data = await j('issued');
    return { ...data, documents: Array.isArray(data.documents) ? data.documents : [] };
  } catch {
    return { documents: [], demo: true, error: 'Could not reach DigiLocker just now.' };
  }
}

/**
 * Pull one document. Returns the SAME contract shape the scanner produces, so
 * Profile can merge a DigiLocker pull and a QR scan through one code path.
 * For Aadhaar, `idNumber` is null by construction — only `aadhaarLast4` crosses
 * the wire, exactly as with the secure QR.
 */
export async function fetchDocument(uri) {
  try {
    return await j('fetch', { method: 'POST', body: JSON.stringify({ uri }) });
  } catch {
    return { error: 'Could not read that document. Nothing was changed.' };
  }
}

export async function disconnect() {
  try {
    return await j('disconnect', { method: 'POST' });
  } catch {
    return { connected: false };
  }
}

/** Bilingual labels for the document kinds DigiLocker hands back. */
export const DL_TYPE_LABELS = {
  aadhaar: { en: 'Aadhaar', ta: 'ஆதார்' },
  pan: { en: 'PAN', ta: 'பான்' },
  driving_licence: { en: 'Driving licence', ta: 'ஓட்டுநர் உரிமம்' },
  voter_id: { en: 'Voter ID', ta: 'வாக்காளர் அடையாள அட்டை' },
  other: { en: 'Certificate', ta: 'சான்றிதழ்' },
};
