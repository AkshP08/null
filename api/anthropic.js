// ── Vercel Serverless Function: server-side Anthropic proxy ─────────────────
//
// Vercel equivalent of netlify/functions/anthropic.mjs. Holds the Anthropic key
// server-side (env ANTHROPIC_API_KEY); the browser calls /api/anthropic (set
// VITE_AI_PROXY_URL=/api/anthropic). Rate-limits + caps tokens/model via the
// shared, unit-tested proxyCore. The optional user-key path in the client
// bypasses this and calls Anthropic directly.
import { sanitizeRequest, makeRateLimiter, ANTHROPIC_URL, ANTHROPIC_VERSION } from "../src/server/proxyCore.mjs";

const limiter = makeRateLimiter({ windowMs: 60000, max: 30 });

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(503).json({ error: "AI is not configured on this server." });

  const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket?.remoteAddress || "unknown";
  const rl = limiter(ip, Date.now());
  if (!rl.ok) return res.status(429).json({ error: "Rate limit exceeded — try again shortly." });

  let raw = req.body;
  if (typeof raw === "string") { try { raw = JSON.parse(raw); } catch { return res.status(400).json({ error: "Invalid JSON." }); } }
  const s = sanitizeRequest(raw);
  if (!s.ok) return res.status(s.status).json({ error: s.error });

  try {
    const upstream = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": ANTHROPIC_VERSION },
      body: JSON.stringify(s.body),
    });
    const text = await upstream.text();
    res.status(upstream.status).setHeader("content-type", "application/json").send(text);
  } catch (e) {
    res.status(502).json({ error: "Upstream request failed." });
  }
}
