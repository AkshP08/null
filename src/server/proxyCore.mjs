// ── Serverless proxy core (pure, platform-agnostic, unit-tested) ────────────
//
// Shared logic for the Vercel/Netlify functions that forward the browser's
// request to the Anthropic API using a SERVER-SIDE key. Kept pure and free of
// any platform/runtime API so it can be tested deterministically (time is
// injected). The functions themselves only wire up request/response + the key.
//
// Two jobs: (1) sanitize the client request so a hostile client can't run up an
// unbounded bill — force a known model, hard-cap max_tokens, and pass through
// only the fields the app uses; (2) a best-effort per-instance rate limiter.

export const ALLOWED_MODELS = new Set(["claude-sonnet-4-6", "claude-sonnet-4-5", "claude-haiku-4-5-20251001"]);
export const DEFAULT_MODEL = "claude-sonnet-4-6";
export const MAX_TOKENS_CAP = 1024;
export const MAX_SYSTEM_CHARS = 20000;
export const MAX_BODY_CHARS = 60000; // total serialized request the proxy will forward

/**
 * Sanitize a client Messages-API request. Returns { ok, body } or { ok:false, status, error }.
 * Never lets the client pick an arbitrary model or an unbounded token budget.
 */
export function sanitizeRequest(raw) {
  if (!raw || typeof raw !== "object") return { ok: false, status: 400, error: "Request body must be a JSON object." };
  const messages = Array.isArray(raw.messages) ? raw.messages : null;
  if (!messages || messages.length === 0) return { ok: false, status: 400, error: "`messages` is required." };
  if (messages.length > 12) return { ok: false, status: 400, error: "Too many messages." };

  const model = ALLOWED_MODELS.has(raw.model) ? raw.model : DEFAULT_MODEL;
  const reqTokens = Number(raw.max_tokens);
  const max_tokens = Math.min(MAX_TOKENS_CAP, Number.isFinite(reqTokens) && reqTokens > 0 ? reqTokens : MAX_TOKENS_CAP);

  const body = { model, max_tokens, messages };
  if (typeof raw.system === "string") body.system = raw.system.slice(0, MAX_SYSTEM_CHARS);
  if (Array.isArray(raw.tools)) body.tools = raw.tools;
  if (raw.tool_choice && typeof raw.tool_choice === "object") body.tool_choice = raw.tool_choice;

  if (JSON.stringify(body).length > MAX_BODY_CHARS) return { ok: false, status: 413, error: "Request too large." };
  return { ok: true, body };
}

/**
 * A sliding-window rate limiter. Time is injected (`now` ms) so it is pure and
 * testable; state lives in the closure (per warm serverless instance — a
 * best-effort guard, documented as such). Returns { ok } or { ok:false, retryAfterMs }.
 */
export function makeRateLimiter({ windowMs = 60000, max = 30 } = {}) {
  const hits = new Map(); // ip -> number[] (timestamps)
  return function check(ip, now) {
    const key = ip || "unknown";
    const recent = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (recent.length >= max) {
      hits.set(key, recent);
      return { ok: false, retryAfterMs: Math.max(0, windowMs - (now - recent[0])) };
    }
    recent.push(now);
    hits.set(key, recent);
    return { ok: true, remaining: max - recent.length };
  };
}

export const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
export const ANTHROPIC_VERSION = "2023-06-01";
