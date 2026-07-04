// ── Netlify Function: server-side Anthropic proxy ───────────────────────────
//
// Holds the Anthropic key SERVER-SIDE (env ANTHROPIC_API_KEY) so the deployed
// demo can use AI with NO key in the browser. Rate-limits per IP and hard-caps
// max_tokens / model via the shared, unit-tested proxyCore. The browser calls
// this at /.netlify/functions/anthropic (set VITE_AI_PROXY_URL to that path).
//
// The optional user-supplied-key path in the client bypasses this entirely and
// calls Anthropic directly with the user's own key — this proxy is only the
// keyless demo default.
import { sanitizeRequest, makeRateLimiter, ANTHROPIC_URL, ANTHROPIC_VERSION } from "../../src/server/proxyCore.mjs";

const limiter = makeRateLimiter({ windowMs: 60000, max: 30 });
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });

export default async (request) => {
  if (request.method !== "POST") return json({ error: "Method Not Allowed" }, 405);

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return json({ error: "AI is not configured on this server." }, 503);

  const ip =
    request.headers.get("x-nf-client-connection-ip") ||
    (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
    "unknown";
  const rl = limiter(ip, Date.now());
  if (!rl.ok) return json({ error: "Rate limit exceeded — try again shortly." }, 429);

  let raw;
  try { raw = await request.json(); } catch { return json({ error: "Invalid JSON." }, 400); }
  const s = sanitizeRequest(raw);
  if (!s.ok) return json({ error: s.error }, s.status);

  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": ANTHROPIC_VERSION },
      body: JSON.stringify(s.body),
    });
    const text = await res.text();
    return new Response(text, { status: res.status, headers: { "content-type": "application/json" } });
  } catch (e) {
    return json({ error: "Upstream request failed." }, 502);
  }
};

export const config = { path: "/.netlify/functions/anthropic" };
