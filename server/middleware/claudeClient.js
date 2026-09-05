import Anthropic from '@anthropic-ai/sdk';

// Singleton Claude client. Returns null if no API key set (graceful demo fallback).
let client = null;

export const getClaude = () => {
  if (client) return client;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || key.startsWith('sk-ant-...')) return null;
  client = new Anthropic({ apiKey: key });
  return client;
};

export const MODEL = 'claude-opus-5';

// Effort is the latency knob. Every call in this server is a short extraction or
// summarisation sitting behind a button press, so low effort keeps the thinking
// pass brief; the default (high) makes the UI wait for reasoning it does not need.
export const EFFORT = 'low';

// Shared helper: simple text completion with a system prompt + user message.
//
// No `temperature` — sampling parameters are rejected outright on current models.
// max_tokens is a floor rather than the tight budget it used to be: thinking is on
// by default and its tokens come out of the same allowance, so a 200-token cap can
// be spent entirely on reasoning and return an empty string to a caller that is
// about to JSON.parse it.
export async function completeText({ system, user, max_tokens = 2000 }) {
  const c = getClaude();
  if (!c) {
    const err = new Error('no_api_key');
    err.code = 'no_api_key';
    throw err;
  }
  const resp = await c.messages.create({
    model: MODEL,
    max_tokens,
    output_config: { effort: EFFORT },
    system,
    messages: [{ role: 'user', content: user }],
  });
  const text = resp.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
  return text;
}
