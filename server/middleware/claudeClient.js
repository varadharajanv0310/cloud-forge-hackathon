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

// claude-sonnet-4-20250514 was pinned here and has been retired — every call
// 404'd, and because each route soft-falls-back to a mock rather than a 500,
// the whole AI surface looked like it worked while returning canned data.
export const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-5';

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
