// ── Pure, view-side reconstruction of a single walk-forward window ──────────
//
// The engine's robustness pass (src/engine/robustness.js) rolls the strategy's
// per-bar return series into `folds` consecutive windows and reports each
// window's Sharpe and total return. It does NOT retain each window's own equity
// curve. To let the user CLICK a window and inspect its individual stretch, we
// rebuild that window's equity curve here — from the SAME real returns the
// engine already produced, using the SAME slicing rule walkForward() uses.
//
// Nothing is recomputed through the engine and nothing is invented: this is a
// pure re-derivation of already-computed numbers, so selecting a window is a
// VIEW interaction (never hits the worker). The reconstruction is proven honest
// by walkForwardView.test.js, which asserts that the Sharpe and total return of
// each reconstructed slice are byte-identical to the engine's own
// wf.windows[i].sharpe / .totalReturn.

import { sharpe, totalReturn, maxDrawdown, cagr, equityCurve } from "../engine/metrics.js";

/**
 * The [lo, hi) slice of a length-`n` return series that is walk-forward window
 * `i` of `folds`. This mirrors walkForward()'s slicing EXACTLY: equal-size
 * windows of `floor(n / folds)`, with the final window absorbing the remainder.
 * If this ever drifts from the engine, the parity test fails loudly.
 */
export function windowSlice(n, folds, i) {
  const size = Math.floor(n / folds);
  const lo = i * size;
  const hi = i === folds - 1 ? n : (i + 1) * size;
  return { lo, hi };
}

/**
 * Reconstruct walk-forward window `i` from a real backtest result and the
 * engine's own walk-forward summary (`wf` = robustness.walkForward).
 *
 * Returns the window's own equity curve (indexed to 100 at the window start),
 * plus its metrics. The Sharpe and total return here are recomputed from the
 * slice with the engine's own metric functions, so they equal the engine's
 * per-window figures; maxDrawdown and cagr are additional real derivations of
 * the same slice.
 *
 * @returns null if the window index is out of range or there is no data.
 */
export function windowView(result, wf, i) {
  if (!result?.ok || !wf?.ok) return null;
  const returns = result.returns?.strategy || [];
  const dates = result.dates || [];
  const folds = wf.folds;
  if (!folds || i < 0 || i >= folds) return null;

  const { lo, hi } = windowSlice(returns.length, folds, i);
  const seg = returns.slice(lo, hi);
  if (seg.length === 0) return null;

  // returns[j] is the move from dates[j] → dates[j+1]. The window's equity
  // curve therefore anchors at dates[lo] (equity = 1) and applies seg to reach
  // dates[hi]. We include the anchor point so the curve visibly starts at 100.
  const winDates = dates.slice(lo, hi + 1); // length = seg.length + 1
  const eq = equityCurve(seg); // starts at 1, length seg.length + 1
  const points = eq.map((v, k) => ({ time: winDates[k], value: v * 100 }));

  const dd = maxDrawdown(seg);
  return {
    index: i,
    lo,
    hi,
    bars: seg.length,
    // Label the span with the engine's own window bounds (the first bar that
    // carries a return through the last), matching the summary bars.
    start: wf.windows?.[i]?.start ?? winDates[1] ?? winDates[0],
    end: wf.windows?.[i]?.end ?? winDates[winDates.length - 1],
    points,
    metrics: {
      sharpe: sharpe(seg),
      totalReturn: totalReturn(seg),
      maxDrawdown: dd.maxDrawdown,
      cagr: cagr(seg),
    },
  };
}
