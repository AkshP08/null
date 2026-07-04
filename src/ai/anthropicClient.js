// ── Client-side Anthropic transport: proxy-by-default, user-key optional ────
//
// Two ways to reach the model, chosen per request:
//   • DIRECT — the user supplied their own key (stored only in their browser);
//     we call the Anthropic API directly with it.
//   • PROXY — no user key, but the deployment set VITE_AI_PROXY_URL (the
//     serverless function). We POST to that same-origin path; the SERVER injects
//     its key. No key is ever exposed in the browser bundle.
//
// This is the demo default: with the proxy configured, AI works for everyone
// with zero client-side key. This module lives on the "interpret" side of the
// wall and never imports the engine's price/metric functions.

const ENV = (typeof import.meta !== "undefined" && import.meta.env) || {};
const DIRECT_URL = "https://api.anthropic.com/v1/messages";

/** The configured serverless proxy path, or "" if none. */
export function proxyUrl() {
  return ENV.VITE_AI_PROXY_URL || "";
}

/** True if the model is reachable at all: via a user key OR the server proxy. */
export function aiBackendAvailable(userKey) {
  return !!userKey || !!proxyUrl();
}

/**
 * POST a Messages-API request body and return the parsed response `data`.
 * @param {object} request  the Anthropic request body (model/system/messages/tools…)
 * @param {object} opts  { userKey, signal, timeoutMs }
 * @throws if no backend is available, or on network/HTTP error.
 */
export async function callAnthropic(request, { userKey = null, signal, timeoutMs = 20000 } = {}) {
  const proxy = proxyUrl();
  const direct = !!userKey;
  if (!direct && !proxy) throw new Error("No AI backend configured.");

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  if (signal) signal.addEventListener("abort", () => ac.abort(), { once: true });
  try {
    const headers = { "content-type": "application/json" };
    let url;
    if (direct) {
      url = DIRECT_URL;
      headers["x-api-key"] = userKey; // the user's own key, from their browser only
      headers["anthropic-version"] = "2023-06-01";
      headers["anthropic-dangerous-direct-browser-access"] = "true";
    } else {
      url = proxy; // same-origin serverless function; server holds the key
    }
    const res = await fetch(url, { method: "POST", signal: ac.signal, headers, body: JSON.stringify(request) });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`AI backend ${res.status}: ${body.slice(0, 200)}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}
