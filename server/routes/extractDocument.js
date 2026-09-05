/**
 * extractDocument.js
 * POST /api/extract-document
 * Accepts a base64 data-URL image, sends to Claude vision, returns structured doc data.
 * Falls back to a deterministic mock when no ANTHROPIC_API_KEY is set.
 */
import { Router } from 'express';
import { getClaude, MODEL, EFFORT } from '../middleware/claudeClient.js';

const router = Router();

const SYSTEM_PROMPT =
  'You are an OCR assistant extracting data from an Indian government ID document (Aadhaar, Voter ID, Ration card, PAN, etc.). ' +
  'Return ONLY a single valid JSON object with these fields (use null for anything unreadable): ' +
  '{ "name": string|null, "dob": string|null (YYYY-MM-DD), "idNumber": string|null, "address": string|null, "gender": string|null, "fatherName": string|null }. ' +
  'No markdown, no explanation — raw JSON only.';

const MOCK_DATA = {
  name: 'Sample Name',
  dob: '1990-01-15',
  idNumber: '1234 5678 9012',
  address: 'No. 12, Anna Nagar, Chennai - 600040',
  gender: null,
  fatherName: null,
  source: 'mock',
};

router.post('/extract-document', async (req, res) => {
  const { image } = req.body || {};

  if (!image || typeof image !== 'string') {
    return res.status(400).json({ error: 'image field required (base64 data URL)' });
  }

  // Parse data URL → media_type + raw base64
  const match = image.match(/^data:(image\/[a-z+]+);base64,(.+)$/is);
  if (!match) {
    return res.status(400).json({ error: 'image must be a base64 data URL (data:image/...;base64,...)' });
  }
  const mediaType = match[1].toLowerCase(); // e.g. "image/jpeg"
  const base64Data = match[2];

  const claude = getClaude();
  if (!claude) {
    // No API key — return deterministic mock so the UI flow stays unblocked
    return res.json(MOCK_DATA);
  }

  try {
    const resp = await claude.messages.create({
      model: MODEL,
      max_tokens: 2000,
      output_config: { effort: EFFORT },
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mediaType, data: base64Data },
            },
            {
              type: 'text',
              text: 'Extract all readable fields from this ID document and return JSON only.',
            },
          ],
        },
      ],
    });

    const raw = resp.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();

    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start === -1 || end === -1) throw new Error('no JSON in response');
    const parsed = JSON.parse(raw.slice(start, end + 1));
    return res.json({ ...parsed, source: 'claude' });
  } catch (err) {
    console.error('[extract-document] Claude error:', err.message || err);
    // Soft fallback — return mock rather than 500 so demo keeps working
    return res.json({ ...MOCK_DATA, source: 'mock_fallback', error: err.message });
  }
});

export default router;
