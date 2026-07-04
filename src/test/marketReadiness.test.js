import { describe, it, expect } from "vitest";
import { verdictMeaning } from "../ui/verdictMeaning.js";
import { sanitizeProps, strategyDescriptor } from "../analytics.js";
import { normalizeError } from "../monitoring.js";

// Prompt 14 hardening: the new positioning/analytics/monitoring logic is pure
// and must behave exactly as specified — the DEAD reframe must read as the tool
// WORKING (not coach a pass), analytics must never leak PII, and error
// normalization must be bounded.

describe("verdict meaning (DEAD/SHAKY positioning)", () => {
  it("frames a DEAD (REJECTED) verdict as the tool working / a save", () => {
    const m = verdictMeaning("REJECTED");
    expect(m.tone).toBe("dead");
    expect(`${m.title} ${m.body}`.toLowerCase()).toMatch(/save|working|caught|before it cost/);
  });

  it("does NOT coach the user toward a passing verdict", () => {
    // The caution copy must warn against tuning until the tool caves.
    const dead = verdictMeaning("REJECTED");
    const shaky = verdictMeaning("SUSPECT");
    expect(dead.caution.toLowerCase()).toMatch(/overfit|walk away|until the verdict flips/);
    expect(shaky.caution.toLowerCase()).toMatch(/not shopping|squeaks a pass|more instruments/);
  });

  it("keeps SURVIVED honest — encouraging, not proof", () => {
    const m = verdictMeaning("PLAUSIBLE");
    expect(m.body.toLowerCase()).toMatch(/not proof|one split|one instrument/);
  });

  it("returns null for unknown buckets", () => {
    expect(verdictMeaning("WHATEVER")).toBe(null);
  });
});

describe("analytics: privacy by construction", () => {
  it("strategyDescriptor reports structure only — never the user's text", () => {
    const spec = {
      name: "my secret alpha with email me@example.com",
      direction: "long_flat",
      entry: [{ type: "cross", fast: { kind: "sma", period: 50 }, slow: { kind: "sma", period: 200 }, dir: "above" }],
    };
    const d = strategyDescriptor(spec);
    expect(d).toEqual({ direction: "long_flat", entry: "cross" });
    // no field should carry the free-text name
    expect(JSON.stringify(d)).not.toMatch(/secret|email|example/i);
  });

  it("sanitizeProps drops unknown keys and coerces/caps the rest", () => {
    const out = sanitizeProps({
      source: "english", instruments: "IBM,AAPL", count: 2,
      email: "me@example.com", userText: "buy when I feel like it", // must be stripped
      bucket: "REJECTED", junk: { a: 1 },
    });
    expect(out).toEqual({ source: "english", instruments: "IBM,AAPL", count: 2, bucket: "REJECTED" });
    expect("email" in out).toBe(false);
    expect("userText" in out).toBe(false);
  });

  it("sanitizeProps truncates long strings and rejects non-finite numbers", () => {
    const out = sanitizeProps({ source: "x".repeat(500), count: Infinity });
    expect(out.source.length).toBe(80);
    expect("count" in out).toBe(false);
  });
});

describe("error normalization is bounded and non-throwing", () => {
  it("handles Error, string, and null without throwing", () => {
    const a = normalizeError(new Error("boom"), "react-render");
    expect(a.name).toBe("Error");
    expect(a.message).toBe("boom");
    expect(a.context).toBe("react-render");

    const b = normalizeError("plain string");
    expect(b.message).toBe("plain string");

    const c = normalizeError(null);
    expect(c.message).toBe("unknown error");
    expect(c.stack).toBe(null);
  });

  it("caps message and stack length", () => {
    const big = new Error("m".repeat(1000));
    big.stack = "line\n".repeat(50);
    const info = normalizeError(big);
    expect(info.message.length).toBeLessThanOrEqual(300);
    expect(info.stack.split("\n").length).toBeLessThanOrEqual(5);
  });
});
