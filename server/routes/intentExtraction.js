import { Router } from 'express';
import multer from 'multer';
import { completeText } from '../middleware/claudeClient.js';

// Audio is accepted but Claude's Messages API doesn't natively transcribe audio.
// For the demo we either: (a) accept a text transcript alongside the audio blob,
// or (b) return a plausible mocked value for the requested field so the onboarding
// flow stays unblocked. A real build would chain STT (e.g. AssemblyAI, whisper.cpp)
// in front of this endpoint.

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });
const router = Router();

const SYSTEM_PROMPT = `You are extracting structured profile data from a spoken Tamil or English response. The user was asked a question during onboarding for a government scheme app. Extract only the relevant field value. Return JSON only: { "field": string, "value": string | number, "confidence": "high" | "low", "clarification_needed": boolean }`;

const PROFILE_SYSTEM_PROMPT = `You are extracting multiple profile fields from a single spoken Tamil or English sentence for a government scheme app. The user might say something like "My name is Rajan, I am 45 years old, I am a farmer from Coimbatore". Extract all recognizable fields. Return JSON only: { "fields": { "name": string|null, "age": number|null, "occupation": string|null, "district": string|null, "annual_income": number|null }, "transcript": string }`;

// Deterministic fallback values per field when no API key is configured,
// so the demo doesn't break without a key.
const MOCK_BY_FIELD = {
  language: { value: 'ta', confidence: 'high' },
  age: { value: 34, confidence: 'high' },
  occupation: { value: 'farmer', confidence: 'high' },
  district: { value: 'thanjavur', confidence: 'low' },
  annual_income: { value: 90000, confidence: 'high' },
  caste: { value: 'OBC', confidence: 'low' },
  gender: { value: 'female', confidence: 'high' },
  profile: {
    fields: { name: 'Rajan Kumar', age: 45, occupation: 'farmer', district: 'coimbatore', annual_income: 90000 },
    confidence: 'high',
  },
};

router.post('/extract-intent', upload.single('audio'), async (req, res) => {
  const { language = 'ta', field = '', question = '', text: maybeText = '' } = req.body || {};
  const audioHint = req.file ? `(audio attached, ${req.file.size} bytes, ${req.file.mimetype})` : '(no audio)';

  // ── Multi-field profile extraction (Apply page voice fill) ──────────────
  if (field === 'profile') {
    const userPrompt = `Language: ${language}\nUser spoke: "${maybeText || '(transcript unavailable)'}"\n${audioHint}\n\nExtract all profile fields mentioned. Return JSON only.`;
    try {
      const raw = await completeText({ system: PROFILE_SYSTEM_PROMPT, user: userPrompt, max_tokens: 2000 });
      const start = raw.indexOf('{'); const end = raw.lastIndexOf('}');
      const json = JSON.parse(raw.slice(start, end + 1));
      return res.json({ field: 'profile', fields: json.fields || {}, transcript: json.transcript || maybeText, source: 'claude' });
    } catch {
      const mock = MOCK_BY_FIELD.profile;
      return res.json({ field: 'profile', fields: mock.fields, transcript: maybeText, source: 'mock' });
    }
  }

  // ── Single-field extraction (onboarding) ───────────────────────────────
  const userPrompt = `Language: ${language}\nField being asked: ${field}\nQuestion to user: ${question}\nUser's spoken transcript (if any): ${maybeText || '(transcript unavailable — pick a reasonable default for this field if you cannot tell)'}\n${audioHint}\n\nReturn JSON only.`;

  try {
    const raw = await completeText({ system: SYSTEM_PROMPT, user: userPrompt, max_tokens: 2000 });
    const firstBrace = raw.indexOf('{');
    const lastBrace = raw.lastIndexOf('}');
    const json = JSON.parse(raw.slice(firstBrace, lastBrace + 1));
    return res.json({
      field: json.field || field,
      value: json.value,
      confidence: json.confidence || 'low',
      clarification_needed: json.clarification_needed ?? false,
      source: 'claude',
    });
  } catch (err) {
    // Graceful fallback: return mock for this field so onboarding continues.
    const mock = MOCK_BY_FIELD[field] || { value: 'unknown', confidence: 'low' };
    return res.json({
      field,
      value: mock.value,
      confidence: mock.confidence,
      clarification_needed: true,
      source: 'mock',
      reason: err.code || 'fallback',
    });
  }
});

export default router;
