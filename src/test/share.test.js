import { describe, it, expect } from "vitest";
import { encodeShare, decodeShare } from "../share.js";
import { validateSpec } from "../engine/schema.js";
import { CLASSICS } from "../classics.js";

const spec = {
  name: "Golden cross", direction: "long_flat",
  entry: [{ type: "cross", fast: { kind: "sma", period: 50 }, slow: { kind: "sma", period: 200 }, dir: "above" }],
  stopLoss: 0.08, takeProfit: null, trailingStop: { type: "atr", period: 14, mult: 3 },
};
const config = { from: "", to: "", commissionBps: 2, slippageBps: 3, isFraction: 0.7 };

describe("share encode/decode", () => {
  it("round-trips spec + settings (results are never encoded)", () => {
    const token = encodeShare({ spec, config, selected: ["IBM", "BTC-USD"], mode: "english", text: "golden cross" });
    expect(typeof token).toBe("string");
    expect(token).not.toMatch(/[^A-Za-z0-9_-]/); // URL-safe
    const { ok, state } = decodeShare(token);
    expect(ok).toBe(true);
    expect(state.spec).toMatchObject({ direction: "long_flat" });
    expect(state.spec.entry[0].fast.period).toBe(50);
    expect(state.spec.trailingStop).toMatchObject({ type: "atr", mult: 3 });
    expect(state.selected).toEqual(["IBM", "BTC-USD"]);
    expect(state.config.commissionBps).toBe(2);
    // no results snuck in
    expect(JSON.stringify(state)).not.toMatch(/sharpe|equity|metrics/i);
  });

  it("rejects a malformed token", () => {
    expect(decodeShare("not-a-real-token!!").ok).toBe(false);
  });

  it("rejects a token whose spec is invalid", () => {
    const bad = encodeShare({ spec: { name: "x", direction: "long_flat", entry: [] }, config });
    expect(decodeShare(bad).ok).toBe(false);
  });
});

describe("classics library", () => {
  it("every classic is a valid spec", () => {
    for (const c of CLASSICS) {
      const v = validateSpec(c.spec);
      expect(v.ok, `${c.label}: ${(v.errors || []).join("; ")}`).toBe(true);
    }
  });
});
