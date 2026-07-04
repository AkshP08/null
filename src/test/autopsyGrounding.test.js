import { describe, it, expect } from "vitest";
import { diagnose, buildAutopsyPayload, REFUSAL, OUT_OF_SCOPE, isOutOfScope } from "../engine/autopsy.js";
import { isGrounded, firstUngrounded, allowedNumberSet, looksLikeCoaching, extractNumbers } from "../ai/grounding.js";
import { askAutopsy } from "../ai/autopsyChat.js";

// AI-2: the autopsy's AI phrasing must be PROVABLY grounded. These tests use no
// network and no key — the model is replaced by recorded fixtures. They prove:
// the guard admits only payload numbers, an injected ungrounded number triggers
// the deterministic fallback, coaching is refused, unanswerable questions get
// "the backtest doesn't show that", and the no-key path is templated.

function makeResult(over = {}) {
  const m = over.metrics || {};
  return {
    ok: true,
    instrument: { symbol: over.symbol || "IBM" },
    spec: over.spec || { name: "Overfit strat", direction: "long_flat", entry: [{ type: "cross", fast: { kind: "sma", period: 50 }, slow: { kind: "sma", period: 200 }, dir: "above" }] },
    counts: { trades: 50, bars: 2000, exposure: 0.5, ...(over.counts || {}) },
    metrics: {
      inSample: { sharpe: 1.9, totalReturn: 0.4, ...(m.inSample || {}) },
      outSample: { sharpe: -0.3, totalReturn: -0.1, ...(m.outSample || {}) },
      full: { sharpe: 0.3, turnover: 0.05, expectancy: -0.002, maxDrawdown: -0.2, ...(m.full || {}) },
      fullNoCost: { sharpe: 0.5, ...(m.fullNoCost || {}) },
      benchmark: { totalReturn: 0.25, ...(m.benchmark || {}) },
    },
  };
}

const result = makeResult();
const diagnosis = diagnose(result);
const payload = buildAutopsyPayload(diagnosis);

// recorded model responses (Anthropic message shape)
const textResp = (text) => ({ content: [{ type: "text", text }] });
function mockTransport(queue) {
  const calls = [];
  const fn = async (request) => { calls.push(request); const r = queue[calls.length - 1]; if (r instanceof Error) throw r; return r; };
  fn.calls = calls;
  return fn;
}

describe("buildAutopsyPayload — deterministic facts, no prices", () => {
  it("exposes the engine figures and no price/equity data", () => {
    expect(payload.figures.inSampleSharpe).toBe("1.90");
    expect(payload.figures.outSampleSharpe).toBe("-0.30");
    expect(payload.figures.sharpeBeforeCosts).toBe("0.50");
    expect(payload.figures.trades).toBe(50);
    const json = JSON.stringify(payload);
    expect(json).not.toMatch(/equity|"open"|"close"|"high"|"low"|prices/i);
  });

  it("its allowed-number set contains the real figures", () => {
    const allowed = allowedNumberSet(payload);
    expect(allowed.has("1.9")).toBe(true);
    expect(allowed.has("0.3")).toBe(true);   // |-0.30|
    expect(allowed.has("0.5")).toBe(true);
    expect(allowed.has("50")).toBe(true);
    expect(allowed.has("1.87")).toBe(false); // a fabricated Sharpe is NOT admitted
  });
});

describe("grounding guard — pure", () => {
  it("passes text that uses only provided figures", () => {
    const t = "In-sample Sharpe was 1.90 but out-of-sample it collapsed to -0.30, and it returned -10.0% versus +25.0% for buy-and-hold.";
    expect(isGrounded(t, payload)).toBe(true);
  });
  it("rejects text that introduces an unsupported number", () => {
    const t = "The real Sharpe is 1.87 with a 63% win rate.";
    expect(isGrounded(t, payload)).toBe(false);
    expect(firstUngrounded(t, payload)).toBe(1.87);
  });
  it("text with no numbers is trivially grounded", () => {
    expect(isGrounded("It fell apart on unseen data.", payload)).toBe(true);
    expect(extractNumbers("no digits here").length).toBe(0);
  });
  it("accepts rounded forms of a real figure (0.40 → 0.4, 49.3% → 49%)", () => {
    const p = { figures: { a: "0.40", b: "+49.3%" } };
    expect(isGrounded("about 0.4 and 49%", p)).toBe(true);
    expect(isGrounded("about 0.41", p)).toBe(false);
  });
});

describe("askAutopsy — enforced guards (offline, mocked model)", () => {
  it("returns the AI phrasing when every number is grounded", async () => {
    const t = mockTransport([textResp("In-sample Sharpe 1.90 collapsed to -0.30 out-of-sample — the edge was fit to the past.")]);
    const r = await askAutopsy("why did it die?", { diagnosis, result }, { transport: t });
    expect(r.source).toBe("ai");
    expect(t.calls).toHaveLength(1);
    // the model only ever received the facts payload — no prices
    expect(t.calls[0].messages[0].content).toMatch(/inSampleSharpe/);
    expect(t.calls[0].messages[0].content).not.toMatch(/equity|"close"/i);
  });

  it("DISCARDS an ungrounded AI number and falls back to the grounded template", async () => {
    const t = mockTransport([textResp("Actually the Sharpe is 1.87 and the win rate is 63%.")]);
    const r = await askAutopsy("why did it die?", { diagnosis, result }, { transport: t });
    expect(r.source).toBe("local");
    expect(r.guard).toBe("ungrounded-number");
    // whatever we show is itself grounded
    expect(isGrounded(r.text, payload)).toBe(true);
  });

  it("refuses coaching questions WITHOUT calling the model", async () => {
    const t = mockTransport([textResp("should never be used")]);
    const r = await askAutopsy("how do I make it pass?", { diagnosis, result }, { transport: t });
    expect(r.text).toBe(REFUSAL);
    expect(r.source).toBe("local");
    expect(t.calls).toHaveLength(0);
  });

  it("refuses 'what would you prefer instead' recommendation-class coaching WITHOUT calling the model", async () => {
    const t = mockTransport([textResp("should never be used")]);
    for (const q of [
      "what strategy would you prefer instead?",
      "recommend a better strategy",
      "what should I do instead?",
      "which approach is better?",
    ]) {
      const r = await askAutopsy(q, { diagnosis, result }, { transport: t });
      expect(r.text).toBe(REFUSAL);
      expect(r.source).toBe("local");
      expect(r.reason).toBe("coaching");
    }
    expect(t.calls).toHaveLength(0); // no model call for any coaching question
  });

  it("distinct questions route to distinct grounded answers on the no-key templated path", async () => {
    const [die, costs, trades] = await Promise.all([
      askAutopsy("why did it die?", { diagnosis, result }),
      askAutopsy("was it the costs or the overfitting?", { diagnosis, result }),
      askAutopsy("would fewer trades help?", { diagnosis, result }),
    ]);
    expect(new Set([die.text, costs.text, trades.text]).size).toBe(3);
    for (const r of [die, costs, trades]) {
      expect(r.source).toBe("local");
      expect(isGrounded(r.text, payload)).toBe(true);
    }
  });

  it("refuses coaching that appears in the model OUTPUT (grounded numbers)", async () => {
    const t = mockTransport([textResp("To make it pass, set the SMA period to 50.")]);
    const r = await askAutopsy("why did it die?", { diagnosis, result }, { transport: t });
    expect(r.guard).toBe("coaching-output");
    expect(r.text).toBe(REFUSAL);
  });

  it("answers unanswerable questions with 'the backtest doesn't show that' — no model call", async () => {
    const t = mockTransport([textResp("nope")]);
    for (const q of ["will it go up next year?", "should I buy this?", "what's the price target?"]) {
      expect(isOutOfScope(q)).toBe(true);
      const r = await askAutopsy(q, { diagnosis, result }, { transport: t });
      expect(r.text).toBe(OUT_OF_SCOPE);
      expect(r.source).toBe("local");
    }
    expect(t.calls).toHaveLength(0);
  });

  it("no key and no transport → deterministic templated answer", async () => {
    const r = await askAutopsy("why did it die?", { diagnosis, result });
    expect(r.source).toBe("local");
    expect(isGrounded(r.text, payload)).toBe(true);
  });

  it("network/model error → grounded template fallback", async () => {
    const t = mockTransport([new Error("boom")]);
    const r = await askAutopsy("was it the costs or the overfitting?", { diagnosis, result }, { transport: t });
    expect(r.source).toBe("local");
    expect(r.fellBack).toBe(true);
    expect(isGrounded(r.text, payload)).toBe(true);
  });
});

describe("looksLikeCoaching does not flag plain diagnostic description", () => {
  it("passes normal autopsy prose", () => {
    expect(looksLikeCoaching("The 50-day SMA crossed the 200-day SMA and the edge decayed out-of-sample.")).toBe(false);
    expect(looksLikeCoaching("Costs cut the Sharpe from 0.50 to 0.30.")).toBe(false);
  });
  it("flags explicit parameter coaching", () => {
    expect(looksLikeCoaching("You should increase the lookback to 100.")).toBe(true);
    expect(looksLikeCoaching("To make the strategy pass, widen the stop.")).toBe(true);
  });
});
