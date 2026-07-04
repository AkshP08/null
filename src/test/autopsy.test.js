import { describe, it, expect } from "vitest";
import { diagnose, answerLocal, isOptimizeQuestion, CAUSE, REFUSAL } from "../engine/autopsy.js";

// Build a result object shaped exactly like the engine's output, with knobs.
function makeResult(over = {}) {
  const m = over.metrics || {};
  return {
    ok: true,
    instrument: { symbol: over.symbol || "TST" },
    counts: { trades: 40, bars: 2000, exposure: 0.5, ...(over.counts || {}) },
    metrics: {
      inSample: { sharpe: 0.6, totalReturn: 0.2, ...(m.inSample || {}) },
      outSample: { sharpe: 0.6, totalReturn: 0.2, ...(m.outSample || {}) },
      full: { sharpe: 0.6, turnover: 0.05, expectancy: 0.004, maxDrawdown: -0.2, ...(m.full || {}) },
      fullNoCost: { sharpe: 0.7, ...(m.fullNoCost || {}) },
      benchmark: { totalReturn: 0.25, ...(m.benchmark || {}) },
    },
  };
}
const modes = (dx) => dx.causes.map((c) => c.mode);

describe("diagnose — each failure mode fires on a constructed example", () => {
  it("NEVER_TRIGGERED when there are zero trades", () => {
    const dx = diagnose(makeResult({ counts: { trades: 0 } }));
    expect(modes(dx)).toContain(CAUSE.NEVER_TRIGGERED);
    expect(dx.primary.severity).toBe("fatal");
    expect(dx.alive).toBe(false);
  });

  it("BUY_AND_HOLD when exposure is ~always in", () => {
    const dx = diagnose(makeResult({ counts: { exposure: 0.99, trades: 30 } }));
    const c = dx.causes.find((x) => x.mode === CAUSE.BUY_AND_HOLD);
    expect(c).toBeTruthy();
    expect(c.severity).toBe("fatal");
    expect(c.text).toMatch(/99/); // cites the real exposure figure
  });

  it("TOO_FEW_TRADES when trades < 10", () => {
    const dx = diagnose(makeResult({ counts: { trades: 4, exposure: 0.3 } }));
    const c = dx.causes.find((x) => x.mode === CAUSE.TOO_FEW_TRADES);
    expect(c).toBeTruthy();
    expect(c.text).toMatch(/4 trade/);
  });

  it("COST_DRAG (fatal) when a pre-cost edge dies after costs", () => {
    const dx = diagnose(makeResult({
      counts: { trades: 60, exposure: 0.5 },
      metrics: { fullNoCost: { sharpe: 0.8 }, full: { sharpe: -0.1, turnover: 0.9, expectancy: -0.001 }, inSample: { sharpe: 0.4 }, outSample: { sharpe: 0.45, totalReturn: 0.1 } },
    }));
    const c = dx.causes.find((x) => x.mode === CAUSE.COST_DRAG);
    expect(c).toBeTruthy();
    expect(c.severity).toBe("fatal");
    expect(c.text).toMatch(/0\.80/); // before-cost sharpe cited
    expect(c.text).toMatch(/-0\.10/); // after-cost sharpe cited
  });

  it("COST_DRAG (warn) when costs take a heavy but non-fatal cut", () => {
    const dx = diagnose(makeResult({
      counts: { trades: 80, exposure: 0.5 },
      metrics: { fullNoCost: { sharpe: 1.0 }, full: { sharpe: 0.4, turnover: 0.6 }, inSample: { sharpe: 0.5 }, outSample: { sharpe: 0.45, totalReturn: 0.1 } },
    }));
    const c = dx.causes.find((x) => x.mode === CAUSE.COST_DRAG);
    expect(c).toBeTruthy();
    expect(c.severity).toBe("warn");
  });

  it("OVERFIT (fatal) when in-sample Sharpe collapses out-of-sample", () => {
    const dx = diagnose(makeResult({
      counts: { trades: 50, exposure: 0.5 },
      metrics: { inSample: { sharpe: 1.9 }, outSample: { sharpe: -0.3, totalReturn: -0.1 }, full: { sharpe: 0.3, turnover: 0.05 }, fullNoCost: { sharpe: 0.4 } },
    }));
    const c = dx.causes.find((x) => x.mode === CAUSE.OVERFIT);
    expect(c).toBeTruthy();
    expect(c.severity).toBe("fatal");
    expect(c.text).toMatch(/1\.90/);
    expect(c.text).toMatch(/-0\.30/);
    expect(c.evidence.some(([k]) => /Edge lost/.test(k))).toBe(true);
  });

  it("OOS_LOSS (warn) when it loses money OOS without being a clean overfit story", () => {
    // Buy-and-hold of the same window ALSO fell (-18%), so the -15% OOS loss is
    // not underperformance vs holding — it isolates the plain OOS_LOSS finding.
    const dx = diagnose(makeResult({
      counts: { trades: 30, exposure: 0.5 },
      metrics: { inSample: { sharpe: -0.1 }, outSample: { sharpe: -0.2, totalReturn: -0.15 }, full: { sharpe: -0.12, turnover: 0.05 }, fullNoCost: { sharpe: -0.1 }, benchmark: { totalReturn: -0.18 }, benchmarkOut: { totalReturn: -0.18 } },
    }));
    expect(modes(dx)).toContain(CAUSE.OOS_LOSS);
    expect(modes(dx)).not.toContain(CAUSE.OVERFIT);
    expect(modes(dx)).not.toContain(CAUSE.UNDERPERFORMS_BENCH);
  });

  it("INSTRUMENT_DEPENDENCE when the edge holds on one instrument of several", () => {
    const primary = makeResult({ symbol: "AAA", counts: { trades: 40, exposure: 0.5 }, metrics: { inSample: { sharpe: 0.6 }, outSample: { sharpe: 0.7, totalReturn: 0.2 }, full: { sharpe: 0.6 }, fullNoCost: { sharpe: 0.7 } } });
    const pass = { id: "AAA", symbol: "AAA", result: { ok: true, counts: { trades: 40 }, metrics: { outSample: { sharpe: 0.7 } } } };
    const fail1 = { id: "BBB", symbol: "BBB", result: { ok: true, counts: { trades: 40 }, metrics: { outSample: { sharpe: -0.2 } } } };
    const fail2 = { id: "CCC", symbol: "CCC", result: { ok: true, counts: { trades: 40 }, metrics: { outSample: { sharpe: 0.0 } } } };
    const dx = diagnose(primary, [pass, fail1, fail2]);
    const c = dx.causes.find((x) => x.mode === CAUSE.INSTRUMENT_DEPENDENCE);
    expect(c).toBeTruthy();
    expect(c.severity).toBe("fatal");
    expect(c.text).toMatch(/1 of 3/);
  });

  it("ALIVE when the edge survives OOS and costs (no fatal cause)", () => {
    const dx = diagnose(makeResult({
      counts: { trades: 40, exposure: 0.5 },
      metrics: { inSample: { sharpe: 1.5 }, outSample: { sharpe: 0.9, totalReturn: 0.3 }, full: { sharpe: 0.8 }, fullNoCost: { sharpe: 0.9 }, benchmark: { totalReturn: 0.2 } },
    }));
    expect(dx.alive).toBe(true);
    expect(dx.causes.some((c) => c.severity === "fatal")).toBe(false);
  });

  it("three genuinely different strategies produce three different primary causes", () => {
    const overfit = diagnose(makeResult({ counts: { trades: 50 }, metrics: { inSample: { sharpe: 1.9 }, outSample: { sharpe: -0.3, totalReturn: -0.1 }, full: { sharpe: 0.3 }, fullNoCost: { sharpe: 0.4 } } }));
    const cost = diagnose(makeResult({ counts: { trades: 60 }, metrics: { fullNoCost: { sharpe: 0.8 }, full: { sharpe: -0.1, turnover: 0.9 }, inSample: { sharpe: 0.4 }, outSample: { sharpe: 0.45, totalReturn: 0.1 } } }));
    const bh = diagnose(makeResult({ counts: { trades: 30, exposure: 0.995 } }));
    const primaries = [overfit.primary.mode, cost.primary.mode, bh.primary.mode];
    expect(new Set(primaries).size).toBe(3);
  });
});

describe("follow-up answers — grounded, and never coaching", () => {
  const dx = diagnose(makeResult({
    counts: { trades: 50, exposure: 0.5 },
    metrics: { inSample: { sharpe: 1.9 }, outSample: { sharpe: -0.3, totalReturn: -0.1 }, full: { sharpe: 0.3, turnover: 0.05, expectancy: -0.002 }, fullNoCost: { sharpe: 0.5 } },
  }));
  const res = makeResult();

  it("refuses to help make it pass / optimize (multiple phrasings)", () => {
    for (const q of ["how do I make it pass?", "what parameters should I try?", "help me optimize this", "would tweaking the stop make it green?", "how can I improve it to survive?"]) {
      expect(isOptimizeQuestion(q)).toBe(true);
      expect(answerLocal(q, dx, res)).toBe(REFUSAL);
    }
    expect(REFUSAL).toMatch(/overfitting/i);
  });

  it("answers 'costs or overfitting' with BOTH real figures", () => {
    const a = answerLocal("was it the costs or the overfitting?", dx, res);
    expect(a).toMatch(/1\.90/); // in-sample sharpe
    expect(a).toMatch(/-0\.30/); // out-of-sample sharpe
    expect(a).toMatch(/0\.50/); // no-cost sharpe
  });

  it("'why did it die' summarizes the primary cause", () => {
    const a = answerLocal("why did it die?", dx, res);
    expect(a).toMatch(/overfit/i);
  });

  it("'would fewer trades help' cites expectancy and refuses to prescribe a number", () => {
    const a = answerLocal("would fewer trades help?", dx, res);
    expect(a).toMatch(/expectancy/i);
    expect(a).toMatch(/won't suggest/i);
    // must not prescribe a concrete target
    expect(a).not.toMatch(/set .* to \d|use \d+ trades|try \d+/i);
  });

  it("is deterministic (pure): same question → same answer", () => {
    expect(answerLocal("why did it die?", dx, res)).toBe(answerLocal("why did it die?", dx, res));
  });

  it("distinct question types → DISTINCT grounded answers (no single blob)", () => {
    const die = answerLocal("why did it die?", dx, res);
    const costsVsFit = answerLocal("was it the costs or the overfitting?", dx, res);
    const trades = answerLocal("would fewer trades help?", dx, res);
    // all three are different from one another
    const set = new Set([die, costsVsFit, trades]);
    expect(set.size).toBe(3);
    // and each is grounded in this run's real figures
    expect(die).toMatch(/overfit/i);
    expect(costsVsFit).toMatch(/1\.90/); // in-sample sharpe
    expect(costsVsFit).toMatch(/-0\.30/); // out-of-sample sharpe
    expect(trades).toMatch(/50 trades/); // real trade count
  });

  it("REFUSES 'what would you prefer instead' / recommendation coaching (not the generic summary)", () => {
    const coaching = [
      "what strategy would you prefer instead?",
      "what should I do instead?",
      "recommend a better strategy",
      "can you suggest a different approach?",
      "what would you do instead?",
      "give me a better indicator to use",
      "what's an alternative strategy?",
      "which strategy is better?",
    ];
    const die = answerLocal("why did it die?", dx, res);
    for (const q of coaching) {
      expect(isOptimizeQuestion(q)).toBe(true);
      const a = answerLocal(q, dx, res);
      expect(a).toBe(REFUSAL);
      expect(a).not.toBe(die); // the exact bug: coaching must NOT return the primary-cause blob
    }
  });

  it("broadened refusal gate does NOT over-catch legitimate diagnostic questions", () => {
    for (const q of [
      "why did it die?",
      "was it the costs or the overfitting?",
      "would fewer trades help?",
      "was it just buy and hold?",
      "did it overfit?",
      "does it work on other instruments?",
    ]) {
      expect(isOptimizeQuestion(q)).toBe(false);
      expect(answerLocal(q, dx, res)).not.toBe(REFUSAL);
    }
  });
});
