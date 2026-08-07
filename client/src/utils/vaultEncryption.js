// Simple PIN-derived XOR "encryption" for the hackathon demo.
// NOT real cryptography — it just obscures plaintext in devtools.
// The vault never leaves the device.

const VAULT_KEY = 'sevai_vault';
const PIN_SALT_KEY = 'sevai_pin_salt';
const DEFAULT_PIN = '1234'; // demo default

const deriveKey = (pin) => {
  let h = 2166136261;
  const s = `${pin}|sevai-salt|${pin.length}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 16777619) >>> 0;
  }
  // expand to a 32-byte keystream seed
  const seed = [];
  for (let i = 0; i < 32; i++) {
    h ^= (h >>> 13);
    h = (h * 2654435761) >>> 0;
    seed.push(h & 0xff);
  }
  return seed;
};

const xorString = (text, keyBytes) => {
  const out = [];
  for (let i = 0; i < text.length; i++) {
    out.push(text.charCodeAt(i) ^ keyBytes[i % keyBytes.length]);
  }
  return out;
};

const toB64 = (bytes) => {
  const chars = bytes.map((b) => String.fromCharCode(b & 0xff)).join('');
  return btoa(chars);
};

const fromB64 = (b64) => {
  const chars = atob(b64);
  const bytes = [];
  for (let i = 0; i < chars.length; i++) bytes.push(chars.charCodeAt(i));
  return bytes;
};

export const encryptVault = (data, pin = DEFAULT_PIN) => {
  const json = JSON.stringify(data);
  const keyBytes = deriveKey(pin);
  const xored = xorString(json, keyBytes);
  return toB64(xored);
};

export const decryptVault = (cipherB64, pin = DEFAULT_PIN) => {
  try {
    const bytes = fromB64(cipherB64);
    const keyBytes = deriveKey(pin);
    const out = bytes.map((b, i) => b ^ keyBytes[i % keyBytes.length]);
    const str = out.map((c) => String.fromCharCode(c & 0xff)).join('');
    return JSON.parse(str);
  } catch (e) {
    console.warn('Vault decrypt failed', e);
    return null;
  }
};

export const saveVault = (vault, pin = DEFAULT_PIN) => {
  const cipher = encryptVault(vault, pin);
  localStorage.setItem(VAULT_KEY, cipher);
  localStorage.setItem(PIN_SALT_KEY, 'v1');
  return true;
};

export const loadVault = (pin = DEFAULT_PIN) => {
  const cipher = localStorage.getItem(VAULT_KEY);
  if (!cipher) return null;
  return decryptVault(cipher, pin);
};

export const clearVault = () => {
  localStorage.removeItem(VAULT_KEY);
  localStorage.removeItem(PIN_SALT_KEY);
};

export const vaultExists = () => !!localStorage.getItem(VAULT_KEY);

// v3 profile. `district` is gone — with 36 states a district list is unusable,
// and no scheme in the corpus gates below state level. Every field below is
// justified by a measured count of schemes that gate on it; see
// data/profileSchema.js for the question flow and the counts.
export const EMPTY_VAULT = {
  name: '',

  // base — asked of everyone
  state: null,                    // replaces district; decides the candidate pool
  age: null,
  gender: null,
  caste: null,
  ration_card: null,              // primary poverty signal, replaces annual_income
  occupation: null,
  disability: null,               // 'none' | 'under40' | 'over40' | 'unknown'

  // student branch — the 1,139-scheme education block
  student_level: null,            // class_1_8 … phd
  last_exam_pct: null,
  institution_type: null,         // government | aided | private

  // farmer branch
  land_tenure: null,              // owner | tenant | sharecropper | landless
  land_acres: null,
  livestock: null,

  // worker branch
  welfare_board_registered: null,

  // women branch
  maternity: null,                // pregnant | lactating | neither
  marital_status: null,

  // senior / household
  drawing_pension: null,
  housing_status: null,

  // optional refinement — never required, since citizens rarely know it
  annual_income: null,

  aadhaar_last4: '',
  languages_preferred: ['ta'],
  onboarding_complete: false,
};
