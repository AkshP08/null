// ── Pure, view-side alignment of two strategies for side-by-side compare ─────
//
// Compare mode overlays two equity curves (e.g. a strategy vs buy-and-hold, or
// vs a classic setup) so relative performance is obvious. The SECOND strategy
// is a real backtest recomputed through the worker; this module only performs
// the pure, view-side work of putting the two on a common footing:
//
//   • restrict both to the date range they share (their warmups differ, so
//     their series start on different bars);
//   • re-index each to 100 at the first shared bar, so the lines start together
//     and the comparison is apples-to-apples;
//   • recompute each side's window metrics with the ENGINE's own metric
//     functions applied to the ENGINE's own returns.
//
// Nothing is invented or interpolated. When the two series share the same dates
// (a strategy vs its own buy-and-hold benchmark), the metrics computed here are
// byte-identical to the engine's metrics.full / metrics.benchmark — asserted in
// compareView.test.js.

import { sharpe, totalReturn, maxDrawdown, cagr, annualizedVol } from "../engine/metrics.js";

/** The engine metric bundle over one real returns slice (single source: metrics.js). */
export function compareMetrics(returns) {
  const dd = maxDrawdown(returns);
  return {
    totalReturn: totalReturn(returns),
    cagr: cagr(returns),
    sharpe: sharpe(returns),
    annualizedVol: annualizedVol(returns),
    maxDrawdown: dd.maxDrawdown,
    bars: returns.length,
  };
}

/**
 * The inclusive date range shared by two date arrays that are both subsequences
 * of the same trading calendar. Returns { start, end } or null if disjoint.
 */
export function commonRange(datesA, datesB) {
  if (!datesA?.length || !datesB?.length) return null;
  const start = datesA[0] > datesB[0] ? datesA[0] : datesB[0];
  const end = datesA[datesA.length - 1] < datesB[datesB.length - 1] ? datesA[datesA.length - 1] : datesB[datesB.length - 1];
  if (start > end) return null;
  return { start, end };
}

// The [lo, hi] index span of `dates` that falls inside [start, end] (inclusive).
function spanFor(dates, start, end) {
  let lo = 0;
  while (lo < dates.length && dates[lo] < start) lo++;
  let hi = dates.length - 1;
  while (hi >= 0 && dates[hi] > end) hi--;
  return { lo, hi };
}

// Re-index a returns series to an equity line starting at 100 over [lo, hi].
function lineFrom(dates, returns, lo, hi) {
  const pts = [{ time: dates[lo], value: 100 }];
  let eq = 1;
  for (let j = lo; j < hi; j++) {
    eq *= 1 + returns[j];
    pts.push({ time: dates[j + 1], value: eq * 100 });
  }
  return pts;
}

/**
 * Align two strategies over their shared window.
 * @param {{dates:string[], returns:number[], label:string, color?:string}} a
 * @param {{dates:string[], returns:number[], label:string, color?:string}} b
 *   where `dates.length === returns.length + 1` (dates[i]→dates[i+1] is returns[i]).
 * @returns { ok, start, end, bars, a:{label,color,line,metrics}, b:{...} } or { ok:false }.
 */
export function buildCompareView(a, b) {
  const range = commonRange(a.dates, b.dates);
  if (!range) return { ok: false, reason: "no-overlap" };
  const sa = spanFor(a.dates, range.start, range.end);
  const sb = spanFor(b.dates, range.start, range.end);
  if (sa.hi <= sa.lo || sb.hi <= sb.lo) return { ok: false, reason: "empty-window" };

  const lineA = lineFrom(a.dates, a.returns, sa.lo, sa.hi);
  const lineB = lineFrom(b.dates, b.returns, sb.lo, sb.hi);
  const metricsA = compareMetrics(a.returns.slice(sa.lo, sa.hi));
  const metricsB = compareMetrics(b.returns.slice(sb.lo, sb.hi));

  return {
    ok: true,
    start: range.start,
    end: range.end,
    bars: sa.hi - sa.lo,
    a: { label: a.label, color: a.color, line: lineA, metrics: metricsA },
    b: { label: b.label, color: b.color, line: lineB, metrics: metricsB },
  };
}
