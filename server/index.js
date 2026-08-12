import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import intentExtraction from './routes/intentExtraction.js';
import schemeSummarizer from './routes/schemeSummarizer.js';
import tts from './routes/tts.js';
import extractDocument from './routes/extractDocument.js';
import digilocker from './routes/digilocker.js';
import { getClaude, MODEL } from './middleware/claudeClient.js';

const app = express();
// 5000 is taken by macOS ControlCenter (the AirPlay Receiver) on every recent
// macOS. It answers requests with a 403, so the Vite proxy appeared to be
// reaching an API — every /api call went to Apple's service instead, and the
// document scanner's extraction silently failed. 5050 is out of that way.
const PORT = process.env.PORT || 5050;

// credentials:true so the DigiLocker session cookie survives the XHR round
// trip. A wildcard origin cannot carry cookies, so the client origin is named.
app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173', credentials: true }));
// Must sit ABOVE the 5MB base64 ceiling that extractDocument enforces, or the
// body parser rejects a large photo first — with its own generic 413 and no
// bilingual "retake or compress" message. The route's guard is the one that
// should fire, because it is the one that can explain itself.
app.use(express.json({ limit: '8mb' }));

// Mount all routes under /api
app.use('/api', intentExtraction);
app.use('/api', schemeSummarizer);
app.use('/api', tts);
app.use('/api', extractDocument);
app.use('/api', digilocker);

// Health check — useful for demo day ("is Claude wired up?")
app.get('/api/health', (_, res) => {
  const hasKey = !!getClaude();
  res.json({
    ok: true,
    model: MODEL,
    claude_configured: hasKey,
    message: hasKey
      ? 'Claude API wired up and ready'
      : 'No ANTHROPIC_API_KEY — server running in mock/local fallback mode (demo still works)',
  });
});

app.listen(PORT, () => {
  console.log(`\n🌾  Sevai-Scout server listening on http://localhost:${PORT}`);
  if (!getClaude()) {
    console.log('    ⚠  No ANTHROPIC_API_KEY set — using local fallbacks for summaries & intent.');
    console.log('    Add ANTHROPIC_API_KEY to server/.env to enable live Claude calls.');
  } else {
    console.log(`    ✓  Claude model: ${MODEL}`);
  }
});
