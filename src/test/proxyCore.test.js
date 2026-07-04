import { describe, it, expect } from "vitest";
import { sanitizeRequest, makeRateLimiter, MAX_TOKENS_CAP, DEFAULT_MODEL } from "../server/proxyCore.mjs";

// AI-3: the serverless proxy's pure core. Deterministic (time injected). Proves
// a hostile client can't pick an arbitrary model or run up an unbounded bill,
// and that the per-instance rate limiter behaves as specified.

describe("sanitizeRequest — caps and whitelists the forwarded request", () => {
  it("hard-caps max_tokens to the ceiling", () => {
    const s = sanitizeRequest({ messages: [{ role: "user", content: "hi" }], max_tokens: 100000 });
    expect(s.ok).toBe(true);
    expect(s.body.max_tokens).toBe(MAX_TOKENS_CAP);
  });

  it("forces a known model when the client asks for an unknown one", () => {
    const s = sanitizeRequest({ messages: [{ role: "user", content: "hi" }], model: "gpt-4o" });
    expect(s.body.model).toBe(DEFAULT_MODEL);
  });

  it("passes through system/tools/tool_choice but drops unknown fields", () => {
    const s = sanitizeRequest({
      messages: [{ role: "user", content: "hi" }],
      system: "be blunt", tools: [{ name: "t" }], tool_choice: { type: "any" },
      metadata: { user_id: "leak" }, secretField: 1,
    });
    expect(s.body.system).toBe("be blunt");
    expect(s.body.tools).toEqual([{ name: "t" }]);
    expect(s.body.tool_choice).toEqual({ type: "any" });
    expect("metadata" in s.body).toBe(false);
    expect("secretField" in s.body).toBe(false);
  });

  it("rejects a request with no messages", () => {
    const s = sanitizeRequest({ model: DEFAULT_MODEL });
    expect(s.ok).toBe(false);
    expect(s.status).toBe(400);
  });

  it("rejects a non-object body", () => {
    expect(sanitizeRequest(null).ok).toBe(false);
    expect(sanitizeRequest("nope").ok).toBe(false);
  });
});

describe("makeRateLimiter — sliding window, deterministic", () => {
  it("allows up to `max` in a window, then blocks", () => {
    const check = makeRateLimiter({ windowMs: 1000, max: 3 });
    const ip = "1.2.3.4";
    expect(check(ip, 0).ok).toBe(true);
    expect(check(ip, 100).ok).toBe(true);
    expect(check(ip, 200).ok).toBe(true);
    const blocked = check(ip, 300);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });

  it("frees up as the window slides", () => {
    const check = makeRateLimiter({ windowMs: 1000, max: 2 });
    const ip = "5.6.7.8";
    expect(check(ip, 0).ok).toBe(true);
    expect(check(ip, 500).ok).toBe(true);
    expect(check(ip, 900).ok).toBe(false); // both still in window
    expect(check(ip, 1100).ok).toBe(true); // the t=0 hit expired
  });

  it("tracks IPs independently", () => {
    const check = makeRateLimiter({ windowMs: 1000, max: 1 });
    expect(check("a", 0).ok).toBe(true);
    expect(check("a", 10).ok).toBe(false);
    expect(check("b", 10).ok).toBe(true);
  });
});
