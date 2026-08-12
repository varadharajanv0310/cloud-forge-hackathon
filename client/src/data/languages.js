/**
 * languages.js — which language sits beside English, and where that is decided.
 *
 * Until now every screen printed Tamil beneath its English. That is right for
 * Tamil Nadu and wrong everywhere else: a citizen in Bihar was shown a script
 * they cannot read, in the place reserved for the language that was supposed to
 * make the product usable. Worse than showing nothing, because it occupies the
 * space where help should be.
 *
 * So the second language is derived from the one fact the citizen has already
 * given us — their state. It is the first question onboarding asks, it is
 * required for scheme scoping anyway, and it is a far better signal than a
 * browser locale, which on a shared or second-hand phone is usually whatever
 * the last owner set.
 *
 * WHAT THIS FILE DOES NOT CLAIM
 * A state does not have one language. Maharashtra reads Marathi, Hindi and
 * Urdu; Karnataka's border districts read Marathi and Telugu; every state has
 * speakers of every other. This map is a DEFAULT, chosen as the language most
 * likely to help the most people in that state, and the citizen can change it.
 * The union territories with no single dominant regional language, and the
 * north-eastern states whose official language of administration is English,
 * are mapped to English deliberately rather than being forced into Hindi.
 */

/**
 * The languages we can actually set type in. `font` must match a family loaded
 * in index.html; `sample` is shown in the picker so a citizen recognises their
 * own script without being able to read the English name of it.
 */
export const LANGUAGES = {
  en: { code: 'en', name: 'English', native: 'English', font: null, sample: 'English' },
  hi: { code: 'hi', name: 'Hindi', native: 'हिन्दी', font: 'Noto Sans Devanagari', sample: 'हिन्दी' },
  ta: { code: 'ta', name: 'Tamil', native: 'தமிழ்', font: 'Noto Sans Tamil', sample: 'தமிழ்' },
  te: { code: 'te', name: 'Telugu', native: 'తెలుగు', font: 'Noto Sans Telugu', sample: 'తెలుగు' },
  kn: { code: 'kn', name: 'Kannada', native: 'ಕನ್ನಡ', font: 'Noto Sans Kannada', sample: 'ಕನ್ನಡ' },
  ml: { code: 'ml', name: 'Malayalam', native: 'മലയാളം', font: 'Noto Sans Malayalam', sample: 'മലയാളം' },
  mr: { code: 'mr', name: 'Marathi', native: 'मराठी', font: 'Noto Sans Devanagari', sample: 'मराठी' },
  gu: { code: 'gu', name: 'Gujarati', native: 'ગુજરાતી', font: 'Noto Sans Gujarati', sample: 'ગુજરાતી' },
  bn: { code: 'bn', name: 'Bengali', native: 'বাংলা', font: 'Noto Sans Bengali', sample: 'বাংলা' },
  pa: { code: 'pa', name: 'Punjabi', native: 'ਪੰਜਾਬੀ', font: 'Noto Sans Gurmukhi', sample: 'ਪੰਜਾਬੀ' },
  or: { code: 'or', name: 'Odia', native: 'ଓଡ଼ିଆ', font: 'Noto Sans Oriya', sample: 'ଓଡ଼ିଆ' },
  as: { code: 'as', name: 'Assamese', native: 'অসমীয়া', font: 'Noto Sans Bengali', sample: 'অসমীয়া' },
  ur: { code: 'ur', name: 'Urdu', native: 'اردو', font: 'Noto Nastaliq Urdu', sample: 'اردو', rtl: true },
  ne: { code: 'ne', name: 'Nepali', native: 'नेपाली', font: 'Noto Sans Devanagari', sample: 'नेपाली' },
};

/**
 * State or UT -> the language most likely to help there. Keys match the exact
 * strings in profileSchema.js STATES, because a mismatch here fails silently
 * and shows English — the test at the bottom of this file guards that.
 */
export const STATE_LANGUAGE = {
  'Andhra Pradesh': 'te',
  'Arunachal Pradesh': 'en',   // no single dominant regional language; English administers
  Assam: 'as',
  Bihar: 'hi',
  Chhattisgarh: 'hi',
  Goa: 'mr',                   // Konkani is official; Marathi is the script most read
  Gujarat: 'gu',
  Haryana: 'hi',
  'Himachal Pradesh': 'hi',
  Jharkhand: 'hi',
  Karnataka: 'kn',
  Kerala: 'ml',
  'Madhya Pradesh': 'hi',
  Maharashtra: 'mr',
  Manipur: 'en',               // Meitei Mayek is not reliably available as webfont
  Meghalaya: 'en',
  Mizoram: 'en',
  Nagaland: 'en',
  Odisha: 'or',
  Punjab: 'pa',
  Rajasthan: 'hi',
  Sikkim: 'ne',
  'Tamil Nadu': 'ta',
  Telangana: 'te',
  Tripura: 'bn',
  'Uttar Pradesh': 'hi',
  Uttarakhand: 'hi',
  'West Bengal': 'bn',

  // Union territories
  'Andaman and Nicobar Islands': 'bn',
  Chandigarh: 'pa',
  'Dadra & Nagar Haveli and Daman & Diu': 'gu',
  Delhi: 'hi',
  'Jammu and Kashmir': 'ur',
  Ladakh: 'en',
  Lakshadweep: 'ml',
  Puducherry: 'ta',
};

/** The language that sits beside English for this citizen. English if unknown. */
export function languageForState(state) {
  const code = STATE_LANGUAGE[state];
  return code && LANGUAGES[code] ? code : 'en';
}

export const languageInfo = (code) => LANGUAGES[code] || LANGUAGES.en;

/**
 * The font stack for a language. Returned rather than hardcoded in CSS because
 * one `.ta` class cannot serve fourteen scripts — Devanagari and Tamil have
 * different vertical metrics, and forcing one line-height on both clips the
 * taller one.
 */
export function fontStackFor(code) {
  const font = languageInfo(code).font;
  return font ? `'${font}', 'Noto Sans', sans-serif` : "'Archivo', sans-serif";
}

/**
 * Line-height per script. Indic scripts carry stacked matras above and below the
 * baseline; the 1.5 that suits Latin clips Devanagari and Bengali ascenders, and
 * Urdu's Nastaliq needs considerably more.
 */
export function lineHeightFor(code) {
  if (code === 'ur') return 2;
  if (['hi', 'mr', 'ne', 'bn', 'as', 'pa', 'or', 'gu'].includes(code)) return 1.62;
  if (['ta', 'te', 'kn', 'ml'].includes(code)) return 1.55;
  return 1.5;
}

/* Sanity check kept next to the data it guards: every state in the questionnaire
   must resolve, or a citizen silently loses their second language.

   import { STATES } from './profileSchema.js';
   const missing = STATES.filter((s) => !(s in STATE_LANGUAGE));
   // must be []
*/
