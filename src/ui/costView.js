// ── Cost-mode view swap: after-cost ⇄ before-cost metrics (no recompute) ────
//
// The AFTER/BEFORE COSTS toggle is a pure VIEW switch. The engine already ran
// both simulations: the result carries the after-cost metrics (metrics.inSample
// / outSample) and the before-cost equity curve (equity.strategyNoCosts) plus
// every trade's real fill prices. This module derives the BEFORE-cost in-/out-
// of-sample metric bundles from that already-computed data, using the engine's
// own metric functions — no worker call, nothing fabricated.
//
// Why this is exact, not an approximation:
//   • Before-cost per-bar returns are read straight off equity.strategyNoCosts
//     (r_i = eq_i/eq_{i-1} − 1) — identical to the engine's no-cost `returns`.
//   • A trade's before-cost return is the raw adjusted-open ratio the engine's
//     zero-cost simulation produces: long → exit/entry − 1; short → 1 − exit/entry.
//     (The fill PRICES are cost-independent, so the after-cost result records
//     the same entry/exit prices the no-cost sim used.)
// costView.test.js proves that, over the full window, these reproduce the
// engine's own metrics.fullNoCost to machine epsilon.

import { computeMetrics } from "../engine/metrics.js";

/** Before-cost per-trade return from the engine's recorded fill prices. */
export function beforeCostTradeReturn(t) {
  const ratio = t.exitPrice / t.entryPrice;
  return t.side === "short" ? 1 - ratio : ratio - 1;
}

/** Before-cost per-bar returns, read from the engine's own no-cost equity curve. */
export function beforeCostReturns(result) {
  const eq = result.equity?.strategyNoCosts || [];
  const out = [];
  for (let i = 1; i < eq.length; i++) out.push(eq[i] / eq[i - 1] - 1);
  return out;
}

/**
 * Reproduce the engine's sliceMetrics() for a window [lo, hi): slice the
 * returns, filter trades by exit date inside the window, and run computeMetrics.
 * Mirrors backtest.js exactly (asserted by test), so it works identically for
 * the after-cost and before-cost series.
 */
export function sliceMetricsView(returns, trades, dates, lo, hi, rfPerPeriod = 0) {
  const seg = returns.slice(lo, hi);
  const winStart = dates[lo + 1] || dates[lo];
  const winEnd = dates[hi] || dates[dates.length - 1];
  const tr = (trades || []).filter((t) => t.exitDate > winStart && t.exitDate <= winEnd);
  return computeMetrics(seg, tr, { totalBars: seg.length, rfPerPeriod });
}

/**
 * The in-/out-of-sample metric bundles for the selected cost mode.
 *   after-cost  → the engine's authoritative metrics.inSample / outSample.
 *   before-cost → derived view-side from the engine's own no-cost data.
 * Pure; never recomputes through the engine/worker.
 */
export function costAwareMetrics(result, showCosts) {
  if (showCosts) {
    return { inSample: result.metrics.inSample, outSample: result.metrics.outSample };
  }
  const rf = (result.config?.rfAnnual || 0) / 252;
  const returns = beforeCostReturns(result);
  const trades = (result.trades || []).map((t) => ({ ...t, ret: beforeCostTradeReturn(t) }));
  const dates = result.dates || [];
  const splitAt = result.split?.splitIndex ?? 0;
  const m = returns.length;
  return {
    inSample: sliceMetricsView(returns, trades, dates, 0, splitAt, rf),
    outSample: sliceMetricsView(returns, trades, dates, splitAt, m, rf),
  };
}
