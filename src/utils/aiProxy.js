// aiProxy.js — hardening helpers for the DeepSeek chat proxy.
//
// Covers manifest tasks:
//   P0-A  <think> tag stripper + JSON payload cleanup
//   P0-B  circuit breaker + graceful fallback provider
//
// Design notes (deliberate deviations from the manifest, for accuracy):
//   * The manifest's "4 second timeout" is meant for a STREAMING time-to-first-token
//     guard. This proxy is buffered (non-streaming) and a real route generation can
//     legitimately take 20-60s, so a 4s TOTAL timeout would kill every valid call.
//     We therefore use a generous total timeout (UPSTREAM_TIMEOUT_MS) and trip the
//     breaker only on genuine failure (network error / timeout / 5xx), never on
//     "slow but successful".
//   * Fallback (OpenRouter) only activates if OPENROUTER_API_KEY is set. Without it
//     we transparently return DeepSeek's own status/body — nothing breaks today.

const UPSTREAM_TIMEOUT_MS = Number(process.env.AI_UPSTREAM_TIMEOUT_MS || 90_000);
const BREAKER_FAIL_THRESHOLD = Number(process.env.AI_BREAKER_THRESHOLD || 3);
const BREAKER_COOLDOWN_MS = Number(process.env.AI_BREAKER_COOLDOWN_MS || 30_000);

// ---------------------------------------------------------------------------
// P0-A: strip DeepSeek-R1 reasoning so Swift's JSONDecoder never sees it.
// ---------------------------------------------------------------------------

// Remove <think>…</think> blocks (including unclosed ones) and leading ```json fences.
function stripThink(text) {
  if (typeof text !== 'string') return text;
  let out = text
    // Closed reasoning blocks.
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    // Unclosed / truncated reasoning block (keep only what follows the last </think>).
    .replace(/^[\s\S]*<\/think>/i, '')
    // A dangling opening <think> with no close → drop from the tag onward is wrong
    // (we'd lose the answer). Instead just remove the stray tag itself.
    .replace(/<\/?think>/gi, '');
  // Markdown code fences the model sometimes wraps JSON in.
  out = out.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '');
  return out.trim();
}

// Given the raw upstream HTTP body text, return a cleaned body text.
// The OpenAI-compatible envelope stays valid JSON; we only sanitize the
// assistant content string(s) inside choices[].message.content.
function sanitizeCompletionBody(bodyText) {
  let json;
  try {
    json = JSON.parse(bodyText);
  } catch {
    // Not JSON (error page, SSE, etc.) — leave untouched.
    return bodyText;
  }
  if (json && Array.isArray(json.choices)) {
    for (const c of json.choices) {
      if (c && c.message) {
        if (typeof c.message.content === 'string') {
          c.message.content = stripThink(c.message.content);
        }
        // R1 sometimes exposes reasoning separately — never forward it.
        if ('reasoning_content' in c.message) delete c.message.reasoning_content;
        if ('reasoning' in c.message) delete c.message.reasoning;
      }
    }
    return JSON.stringify(json);
  }
  return bodyText;
}

// ---------------------------------------------------------------------------
// P0-B: minimal per-provider circuit breaker (in-memory, single-instance safe).
// ---------------------------------------------------------------------------

const breakers = new Map(); // name -> { fails, openedAt }

function breakerState(name) {
  let b = breakers.get(name);
  if (!b) {
    b = { fails: 0, openedAt: 0 };
    breakers.set(name, b);
  }
  return b;
}

// true = circuit OPEN (skip this provider), false = allow the call.
function isOpen(name) {
  const b = breakerState(name);
  if (b.fails < BREAKER_FAIL_THRESHOLD) return false;
  if (Date.now() - b.openedAt >= BREAKER_COOLDOWN_MS) {
    // Cooldown elapsed → half-open: allow one probe.
    b.fails = BREAKER_FAIL_THRESHOLD - 1;
    return false;
  }
  return true;
}

function recordSuccess(name) {
  const b = breakerState(name);
  b.fails = 0;
  b.openedAt = 0;
}

function recordFailure(name) {
  const b = breakerState(name);
  b.fails += 1;
  if (b.fails >= BREAKER_FAIL_THRESHOLD) b.openedAt = Date.now();
}

// ---------------------------------------------------------------------------
// Upstream call with timeout. Returns { status, contentType, retryAfter, body }.
// Throws on network error / timeout so the breaker can count it.
// ---------------------------------------------------------------------------

async function callUpstream({ url, apiKey, body, extraHeaders = {} }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const upstream = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        ...extraHeaders,
      },
      body: JSON.stringify(body || {}),
      signal: controller.signal,
    });
    const text = await upstream.text();
    return {
      status: upstream.status,
      contentType: upstream.headers.get('content-type') || 'application/json',
      retryAfter: upstream.headers.get('retry-after'),
      body: text,
    };
  } finally {
    clearTimeout(timer);
  }
}

// Map a DeepSeek model id to its OpenRouter equivalent for the fallback path.
function toOpenRouterModel(model) {
  if (!model || typeof model !== 'string') return 'deepseek/deepseek-chat';
  if (model.startsWith('deepseek/')) return model; // already namespaced
  return `deepseek/${model}`;
}

module.exports = {
  UPSTREAM_TIMEOUT_MS,
  stripThink,
  sanitizeCompletionBody,
  isOpen,
  recordSuccess,
  recordFailure,
  callUpstream,
  toOpenRouterModel,
};
