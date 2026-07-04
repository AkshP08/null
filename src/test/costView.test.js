import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { backtest } from "../engine/backtest.js";
import { costAwareMetrics, sliceMetricsView, beforeCostReturns, beforeCostTradeReturn } from "../ui/costView.js";
import { totalReturn, sharpe, maxDrawdown } from "../engine/metrics.js";

// BUG FIX — AFTER/BEFORE COSTS toggle. The toggle is a pure VIEW swap between two
// already-computed cost curves. These tests prove the view-side derivation of the
// before-cost metrics reproduces the engine's OWN numbers exactly (no recompute,
// nothing fabricated), and that switching modes actually changes which values are
// shown.

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "public", "data");
function longestInstrument() {
  if (!existsSync(DATA_DIR)) return null;
  const files = readdirSync(DATA_DIR).filter((f) => f.endsWith(".json") && f !== "manifest.json");
  return files.map((f) => JSON.parse(readFileSync(join(DATA_DIR, f), "utf8"))).sort((a, b) => (b.rows?.length || 0) - (a.rows?.length || 0))[0];
}
const data = longestInstrument();
// A strategy that actually trades a lot, so costs bite and the two modes differ.
const SPEC = {
  name: "rsi mean-reversion",
  direction: "long_flat",
  entry: [{ type: "threshold", indicator: { kind: "rsi", period: 14 }, op: "<", value: 35 }],
  exit: [{ type: "threshold", indicator: { kind: "rsi", period: 14 }, op: ">", value: 55 }],
};

describe("cost-mode view swap", () => {
  it("has data to build against", () => expect(data).toBeTruthy());

  const result = data && backtest(SPEC, data, { commissionBps: 10, slippageBps: 10 });

  it("after-cost mode returns the engine's authoritative IS/OOS metrics unchanged", () => {
    const m = costAwareMetrics(result, true);
    expect(m.inSample).toBe(result.metrics.inSample);
    expect(m.outSample).toBe(result.metrics.outSample);
  });

  it("the view slicing reproduces the engine's sliceMetrics for the after-cost series", () => {
    const dates = result.dates, split = result.split.splitIndex, m = result.returns.strategy.length;
    const rf = (result.config.rfAnnual || 0) / 252;
    const isView = sliceMetricsView(result.returns.strategy, result.trades, dates, 0, split, rf);
    const oosView = sliceMetricsView(result.returns.strategy, result.trades, dates, split, m, rf);
    for (const k of ["totalReturn", "sharpe", "maxDrawdown", "cagr", "winRate", "profitFactor"]) {
      expect(isView[k]).toBe(result.metrics.inSample[k]);
      expect(oosView[k]).toBe(result.metrics.outSample[k]);
    }
  });

  it("before-cost derivation reproduces the engine's metrics.fullNoCost (return metrics + trade stats)", () => {
    const rets = beforeCostReturns(result);
    const trades = result.trades.map((t) => ({ ...t, ret: beforeCostTradeReturn(t) }));
    // return-based metrics come straight off the no-cost equity curve
    expect(totalReturn(rets)).toBeCloseTo(result.metrics.fullNoCost.totalReturn, 10);
    expect(sharpe(rets)).toBeCloseTo(result.metrics.fullNoCost.sharpe, 10);
    expect(maxDrawdown(rets).maxDrawdown).toBeCloseTo(result.metrics.fullNoCost.maxDrawdown, 10);
    // trade-based metrics come from the exact no-cost trade returns
    const wins = trades.filter((t) => t.ret > 0).length;
    expect(wins / trades.length).toBeCloseTo(result.metrics.fullNoCost.winRate, 10);
  });

  it("before ≠ after: swapping the mode actually changes the numbers (costs bite)", () => {
    const after = costAwareMetrics(result, true);
    const before = costAwareMetrics(result, false);
    // gross (before-cost) return must exceed net (after-cost) when there are trades
    expect(before.outSample.totalReturn).toBeGreaterThan(after.outSample.totalReturn);
    expect(before.inSample.totalReturn).toBeGreaterThan(after.inSample.totalReturn);
    expect(result.counts.trades).toBeGreaterThan(0);
  });

  it("short trades use the short before-cost formula", () => {
    expect(beforeCostTradeReturn({ side: "long", entryPrice: 100, exitPrice: 110 })).toBeCloseTo(0.1, 12);
    expect(beforeCostTradeReturn({ side: "short", entryPrice: 100, exitPrice: 90 })).toBeCloseTo(0.1, 12);
  });
});
