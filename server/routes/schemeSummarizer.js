import { Router } from 'express';
import { completeText } from '../middleware/claudeClient.js';

const router = Router();

// In-memory cache keyed by `${scheme_id}:${language}` to avoid redundant Claude calls in demos.
const cache = new Map();

const systemPromptFor = (language) => {
  const langName = language === 'ta' ? 'Tamil' : 'English';
  return `You are explaining a government scheme to a 30-year-old farmer in rural Tamil Nadu who completed Class 5 education. Language: ${langName}. Write exactly 3 bullet points. Each bullet point must be one short sentence. Use simple words. Format: ✓ [sentence]. Cover: what it gives, who can get it, what one document is needed.`;
};

// Very conservative local fallback when no API key is set — uses scheme.description_simple.
const localFallback = (scheme, language) => {
  const bullets = (scheme.description_simple || []).slice(0, 3).map((b) => `✓ ${b}`);
  const audio_text = bullets.join('. ').replace(/^✓\s*/g, '');
  return { bullets, audio_text, source: 'local' };
};

router.post('/summarize-scheme', async (req, res) => {
  const { scheme, language = 'ta' } = req.body || {};
  if (!scheme || !scheme.id) return res.status(400).json({ error: 'scheme required' });

  const key = `${scheme.id}:${language}`;
  if (cache.has(key)) return res.json(cache.get(key));

  const schemeLine = [
    `Name: ${scheme.name_plain}`,
    `Official: ${scheme.name_official}`,
    `Benefit: ₹${scheme.benefit_amount} (${scheme.benefit_type})`,
    `Eligibility: age ${scheme.eligibility.min_age}-${scheme.eligibility.max_age}`,
    scheme.eligibility.income_max_annual ? `Income under ₹${scheme.eligibility.income_max_annual}` : 'Any income',
    scheme.eligibility.gender ? `Gender: ${scheme.eligibility.gender}` : '',
    scheme.eligibility.caste_required?.length ? `Caste: ${scheme.eligibility.caste_required.join('/')}` : '',
    `Documents: ${(scheme.documents_required || []).join(', ')}`,
    `Description: ${scheme.description_long}`,
  ]
    .filter(Boolean)
    .join('\n');

  try {
    const text = await completeText({
      system: systemPromptFor(language),
      user: `Scheme:\n${schemeLine}\n\nReturn 3 bullet points only.`,
      max_tokens: 2000,
    });
    const lines = text
      .split(/\n+/)
      .map((l) => l.trim())
      .filter(Boolean)
      .filter((l) => l.startsWith('✓') || /^[-•]/.test(l) || l.length > 3)
      .slice(0, 3);
    const bullets = lines.map((l) => (l.startsWith('✓') ? l : `✓ ${l.replace(/^[-•\s]+/, '')}`));
    const audio_text = bullets.map((b) => b.replace(/^✓\s*/, '')).join('. ');
    const out = { bullets, audio_text, source: 'claude' };
    cache.set(key, out);
    res.json(out);
  } catch (err) {
    const out = localFallback(scheme, language);
    cache.set(key, out);
    res.json(out);
  }
});

export default router;
