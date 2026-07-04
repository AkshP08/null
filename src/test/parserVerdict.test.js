import { describe, it, expect } from "vitest";
import { parseLocal } from "../parser/localParser.js";
import { parsePine } from "../parser/pineParser.js";
import { toPineScript } from "../parser/pineExport.js";
import { validateSpec } from "../engine/schema.js";
import { computeVerdict } from "../engine/verdict.js";

describe("local parser", () => {
  it("parses an MA crossover with a stop", () => {
    const r = parseLocal("go long when the 50-day average crosses above the 200-day, exit on a 5% stop");
    expect(r.ok).toBe(true);
    expect(validateSpec(r.spec).ok).toBe(true);
    expect(r.spec.entry[0]).toMatchObject({ type: "cross", dir: "above" });
    expect(r.spec.entry[0].fast.period).toBe(50);
    expect(r.spec.entry[0].slow.period).toBe(200);
    expect(r.spec.stopLoss).toBeCloseTo(0.05, 9);
  });

  it("parses RSI mean reversion with entry+exit", () => {
    const r = parseLocal("buy when RSI(14) is below 30 and sell when RSI rises above 70");
    expect(r.ok).toBe(true);
    expect(r.spec.entry[0]).toMatchObject({ type: "threshold", op: "<", value: 30 });
    expect(r.spec.exit[0]).toMatchObject({ type: "threshold", op: ">", value: 70 });
  });

  it("discloses genuinely unsupported constructs instead of dropping them", () => {
    // MACD/volume are now supported; Stochastic/ADX are not — those must be disclosed.
    const r = parseLocal("buy when the stochastic crosses up and ADX is above 25, 50/200 sma cross");
    expect(r.unsupported.length).toBeGreaterThan(0);
    expect(r.unsupported.join(" ")).toMatch(/stochastic|adx|not yet supported/i);
  });

  it("fails honestly on unrecognizable input", () => {
    const r = parseLocal("just make me rich please");
    expect(r.ok).toBe(false);
    expect(r.unsupported.length).toBeGreaterThan(0);
  });
});

describe("pine parser", () => {
  it("parses ta.crossover of two sma vars", () => {
    const src = `//@version=5
strategy("X")
fast = ta.sma(close, 10)
slow = ta.sma(close, 30)
if ta.crossover(fast, slow)
    strategy.entry("L", strategy.long)`;
    const r = parsePine(src);
    expect(r.ok).toBe(true);
    expect(r.spec.entry[0]).toMatchObject({ type: "cross", dir: "above" });
    expect(r.spec.entry[0].fast).toMatchObject({ kind: "sma", period: 10 });
  });

  it("flags unsupported ta.macd", () => {
    const src = `m = ta.macd(close, 12, 26, 9)\nif ta.crossover(ta.sma(close,5), ta.sma(close,20))\n  strategy.entry("L", strategy.long)`;
    const r = parsePine(src);
    expect(r.unsupported.join(" ")).toMatch(/unsupported ta/i);
  });
});

describe("pine export round-trips a validated spec to v5", () => {
  it("emits version, strategy(), and crossover", () => {
    const spec = parseLocal("buy when the 50 sma crosses above the 200 sma").spec;
    const code = toPineScript(spec);
    expect(code).toContain("//@version=5");
    expect(code).toContain("strategy(");
    expect(code).toContain("ta.sma(close, 50) > ta.sma(close, 200)");
  });
});

describe("verdict determinism", () => {
  const baseResult = (over) => ({
    ok: true,
    instrument: { symbol: "TST" },
    counts: { trades: 50, bars: 1000, exposure: 0.5 },
    metrics: {
      full: { sharpe: 1.0 },
      fullNoCost: { sharpe: 1.2 },
      inSample: { sharpe: 1.8 },
      outSample: { sharpe: 1.4, totalReturn: 0.3 },
      benchmark: { totalReturn: 0.2 },
    },
    ...over,
  });

  it("is a pure function (same input → same output)", () => {
    const r = baseResult();
    expect(JSON.stringify(computeVerdict(r))).toBe(JSON.stringify(computeVerdict(r)));
  });

  it("flags a curve fit when IS Sharpe collapses OOS", () => {
    const r = baseResult({
      metrics: {
        full: { sharpe: 0.4 },
        fullNoCost: { sharpe: 0.5 },
        inSample: { sharpe: 1.9 },
        outSample: { sharpe: -0.3, totalReturn: -0.1 },
        benchmark: { totalReturn: 0.2 },
      },
    });
    const v = computeVerdict(r);
    expect(v.bucket).toBe("REJECTED");
    expect(v.flags.curveFit).toBe(true);
  });

  it("rejects buy-and-hold in disguise (high exposure) before counting trades", () => {
    const r = baseResult({ counts: { trades: 1, bars: 1000, exposure: 0.995 } });
    const v = computeVerdict(r);
    expect(v.bucket).toBe("REJECTED");
    expect(v.flags.buyAndHold).toBe(true);
  });

  it("rejects too-few-trades as noise", () => {
    const r = baseResult({ counts: { trades: 4, bars: 1000, exposure: 0.3 } });
    const v = computeVerdict(r);
    expect(v.bucket).toBe("REJECTED");
    expect(v.flags.tooFewTrades).toBe(true);
  });

  it("calls a robust OOS edge PLAUSIBLE (with caution)", () => {
    const v = computeVerdict(baseResult());
    expect(v.bucket).toBe("PLAUSIBLE");
    expect(v.reasons.some((x) => x.level === "warn")).toBe(true);
  });
});
