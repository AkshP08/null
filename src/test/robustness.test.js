import { describe, it, expect } from "vitest";
import { walkForward, bootstrapCI } from "../engine/robustness.js";
import { computeVerdict } from "../engine/verdict.js";

describe("walkForward", () => {
  it("is consistent when a positive-drift edge shows up in every window", () => {
    const r = Array.from({ length: 200 }, (_, i) => 0.01 + 0.003 * Math.sin(i * 1.3));
    const wf = walkForward(r, null, { folds: 5 });
    expect(wf.ok).toBe(true);
    expect(wf.folds).toBe(5);
    expect(wf.positiveFraction).toBe(1);
    expect(wf.consistent).toBe(true);
  });

  it("is NOT consistent when the edge flips sign across history", () => {
    const r = Array.from({ length: 200 }, (_, i) => (i < 100 ? 0.01 : -0.01) + 0.002 * Math.sin(i));
    const wf = walkForward(r, null, { folds: 5 });
    expect(wf.consistent).toBe(false);
    expect(wf.positiveFraction).toBeLessThan(0.6);
  });

  it("shrinks fold count for short series and refuses when far too short", () => {
    const short = walkForward(Array(70).fill(0.001).map((v, i) => v + 0.0005 * Math.sin(i)), null, { folds: 5, minPerFold: 20 });
    expect(short.ok).toBe(true);
    expect(short.folds).toBeLessThan(5);
    const tooShort = walkForward([0.01, 0.02, -0.01], null, { minPerFold: 20 });
    expect(tooShort.ok).toBe(false);
  });
});

describe("bootstrapCI", () => {
  it("is deterministic: same seed → identical interval", () => {
    const trades = [0.05, -0.03, 0.08, -0.02, 0.04, 0.06, -0.05, 0.03];
    const a = bootstrapCI(trades, { seed: 42, iters: 1000 });
    const b = bootstrapCI(trades, { seed: 42, iters: 1000 });
    expect(a.totalReturn).toEqual(b.totalReturn);
    expect(a.meanTrade).toEqual(b.meanTrade);
  });

  it("keeps the interval above zero for uniformly positive trades", () => {
    const trades = [0.05, 0.06, 0.04, 0.05, 0.05, 0.06, 0.05];
    const ci = bootstrapCI(trades, { seed: 7, iters: 3000 });
    expect(ci.ok).toBe(true);
    expect(ci.totalReturn.lo).toBeGreaterThan(0);
    expect(ci.straddlesZero).toBe(false);
  });

  it("straddles zero for a symmetric win/lose sequence", () => {
    const trades = [0.05, -0.05, 0.05, -0.05, 0.05, -0.05, 0.05, -0.05];
    const ci = bootstrapCI(trades, { seed: 7, iters: 3000 });
    expect(ci.straddlesZero).toBe(true);
    expect(ci.totalReturn.lo).toBeLessThanOrEqual(0);
    expect(ci.totalReturn.hi).toBeGreaterThanOrEqual(0);
  });

  it("refuses with fewer than 5 trades", () => {
    expect(bootstrapCI([0.1, -0.1, 0.2]).ok).toBe(false);
  });
});

describe("verdict downgrade from robustness", () => {
  const plausible = () => ({
    ok: true,
    instrument: { symbol: "TST" },
    counts: { trades: 50, bars: 1000, exposure: 0.5 },
    metrics: {
      full: { sharpe: 1.0 }, fullNoCost: { sharpe: 1.2 },
      inSample: { sharpe: 1.8 }, outSample: { sharpe: 1.4, totalReturn: 0.3 },
      benchmark: { totalReturn: 0.2 },
    },
  });

  it("stays PLAUSIBLE with no robustness opts (backward compatible)", () => {
    expect(computeVerdict(plausible()).bucket).toBe("PLAUSIBLE");
  });

  it("stays PLAUSIBLE when walk-forward is consistent and CI is clear of zero", () => {
    const v = computeVerdict(plausible(), {
      robustness: { walkForward: { ok: true, consistent: true, folds: 5, positive: 5, meanSharpe: 1.1, worstSharpe: 0.6 }, bootstrap: { ok: true, straddlesZero: false, confidence: 0.95, seed: 1, totalReturn: { lo: 0.1, hi: 0.5 } } },
    });
    expect(v.bucket).toBe("PLAUSIBLE");
  });

  it("downgrades to SUSPECT when the edge is a one-window fluke", () => {
    const v = computeVerdict(plausible(), {
      robustness: { walkForward: { ok: true, consistent: false, folds: 5, positive: 1, meanSharpe: 0.1, worstSharpe: -0.9 } },
    });
    expect(v.bucket).toBe("SUSPECT");
    expect(v.flags.walkForwardInconsistent).toBe(true);
  });

  it("downgrades to SUSPECT when the OOS confidence interval straddles zero", () => {
    const v = computeVerdict(plausible(), {
      robustness: { bootstrap: { ok: true, straddlesZero: true, confidence: 0.95, seed: 1, totalReturn: { lo: -0.2, hi: 0.4 } } },
    });
    expect(v.bucket).toBe("SUSPECT");
    expect(v.flags.ciStraddlesZero).toBe(true);
  });
});
