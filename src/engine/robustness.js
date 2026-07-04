// ── Robustness: walk-forward consistency + seeded bootstrap confidence ──────
//
// Pure and deterministic. One 70/30 split is a single data point; these two
// methods turn it into a distribution:
//   - walkForward(): roll the out-of-sample window across the whole history in
//     consecutive folds and report whether the edge shows up in most windows or
//     was one lucky stretch.
//   - bootstrapCI(): resample the out-of-sample TRADE sequence (with a FIXED
//     seed, so results are reproducible) to put a confidence interval around the
//     out-of-sample result instead of a false-precision point estimate.
//
// Nothing here fabricates data: it only resamples the real trades / real
// per-bar returns the engine already produced.

import { sharpe, totalReturn } from "./metrics.js";

// small deterministic PRNG (mulberry32) — seeded, so every run is identical.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Roll the OOS window across the return series in `folds` consecutive windows
 * and measure the edge in each. Returns per-window Sharpe/return plus a
 * consistency summary. `minPerFold` guards against meaningless tiny windows.
 */
export function walkForward(returns, dates, { folds = 5, minPerFold = 20 } = {}) {
  const n = returns.length;
  let k = folds;
  while (k > 2 && Math.floor(n / k) < minPerFold) k--; // shrink folds if data is short
  if (n < 2 * minPerFold) {
    return { ok: false, reason: `only ${n} bars — not enough for a walk-forward`, folds: 0, windows: [] };
  }
  const size = Math.floor(n / k);
  const windows = [];
  for (let i = 0; i < k; i++) {
    const lo = i * size;
    const hi = i === k - 1 ? n : (i + 1) * size;
    const seg = returns.slice(lo, hi);
    windows.push({
      index: i,
      bars: seg.length,
      start: dates ? dates[lo + 1] || dates[lo] : lo,
      end: dates ? dates[hi] || dates[hi - 1] : hi,
      sharpe: sharpe(seg),
      totalReturn: totalReturn(seg),
    });
  }
  const positive = windows.filter((w) => w.sharpe > 0).length;
  const positiveFraction = positive / windows.length;
  const shs = windows.map((w) => w.sharpe);
  const meanSharpe = shs.reduce((s, x) => s + x, 0) / shs.length;
  const worstSharpe = Math.min(...shs);
  return {
    ok: true,
    folds: k,
    windows,
    positive,
    positiveFraction,
    meanSharpe,
    worstSharpe,
    // "consistent" only if the edge is positive in a clear majority of windows.
    consistent: positiveFraction >= 0.6 && meanSharpe > 0,
  };
}

/**
 * Bootstrap a confidence interval on the out-of-sample result by resampling the
 * trade sequence with replacement. Deterministic given `seed`.
 * Returns CIs on total compounded return and mean per-trade return, plus
 * whether the interval straddles zero (i.e. the edge is indistinguishable from
 * no edge at this confidence).
 */
export function bootstrapCI(tradeReturns, { seed = 1234567, iters = 2000, alpha = 0.05 } = {}) {
  const nT = tradeReturns.length;
  if (nT < 5) {
    return { ok: false, reason: `only ${nT} trades — too few to bootstrap a confidence interval` };
  }
  const rng = mulberry32(seed);
  const totals = new Array(iters);
  const means = new Array(iters);
  for (let i = 0; i < iters; i++) {
    let eq = 1;
    let sum = 0;
    for (let j = 0; j < nT; j++) {
      const r = tradeReturns[(rng() * nT) | 0];
      eq *= 1 + r;
      sum += r;
    }
    totals[i] = eq - 1;
    means[i] = sum / nT;
  }
  totals.sort((a, b) => a - b);
  means.sort((a, b) => a - b);
  const q = (arr, p) => arr[Math.min(arr.length - 1, Math.max(0, Math.round(p * (arr.length - 1))))];
  const tr = { lo: q(totals, alpha / 2), median: q(totals, 0.5), hi: q(totals, 1 - alpha / 2) };
  const mt = { lo: q(means, alpha / 2), median: q(means, 0.5), hi: q(means, 1 - alpha / 2) };
  return {
    ok: true,
    iters,
    seed,
    confidence: 1 - alpha,
    trades: nT,
    totalReturn: tr,
    meanTrade: mt,
    // straddles zero → we cannot distinguish this from luck at this confidence.
    straddlesZero: tr.lo <= 0 && tr.hi >= 0,
  };
}

/** Out-of-sample trade returns from a result (trades exiting after the split). */
export function oosTradeReturns(result) {
  if (!result?.ok) return [];
  const splitDate = result.split?.splitDate;
  const trades = result.trades || [];
  if (!splitDate) return trades.map((t) => t.ret);
  return trades.filter((t) => t.exitDate > splitDate).map((t) => t.ret);
}

/** Convenience: compute both robustness measures for a backtest result. */
export function robustness(result, opts = {}) {
  if (!result?.ok) return { ok: false };
  const wf = walkForward(result.returns.strategy, result.dates, opts.walkForward);
  const boot = bootstrapCI(oosTradeReturns(result), opts.bootstrap);
  return { ok: true, walkForward: wf, bootstrap: boot };
}
