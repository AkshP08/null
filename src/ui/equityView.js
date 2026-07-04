// ── Pure, view-side derivation of the equity-chart series ───────────────────
//
// Everything here is read straight from a REAL backtest result — nothing is
// interpolated or invented:
//   • equity        — the simulated strategy curve (with or without costs).
//   • buy & hold     — the self-proving benchmark curve.
//   • drawdown       — the running-peak definition applied to the real equity.
//   • position state — read from the engine's own trade records: a bar is "in
//     market" iff it lies inside a trade's holding period [entry, exit). The
//     count of in-market bars this produces equals the engine's own
//     `counts.barsInMarket` exactly (asserted in tests), so it is the engine's
//     truth, not a reconstruction that could drift.
//
// This is pure (no DOM, no lightweight-charts) so it is unit-testable on its
// own and so hover/zoom/pan never need to recompute anything.

/** Mark which bars the strategy actually held a position, from real trades. */
export function markInMarket(dates, trades) {
  const flags = new Array(dates.length).fill(false);
  const idx = new Map(dates.map((d, i) => [d, i]));
  for (const t of trades || []) {
    const a = idx.get(t.entryDate);
    if (a == null) continue;
    let b = idx.get(t.exitDate);
    if (b == null) b = dates.length;
    // A closed trade exits at the exit bar's OPEN, so that bar is already flat
    // by its close; an open trade is still held on its final bar.
    const end = t.open ? Math.min(b + 1, dates.length) : b;
    for (let i = a; i < end; i++) flags[i] = true;
  }
  return flags;
}

/**
 * Build the full per-point view model plus the three plotted line series.
 * @param {object} result  a successful backtest result
 * @param {boolean} showCosts  after-cost (true) vs before-cost equity
 */
export function buildEquityView(result, showCosts = true) {
  const dates = result.dates;
  const eq = showCosts ? result.equity.strategy : result.equity.strategyNoCosts;
  const bh = result.equity.benchmark;
  const splitIdx = result.split.splitIndex;
  const inMarket = markInMarket(dates, result.trades);

  let peak = -Infinity;
  const points = dates.map((date, i) => {
    if (eq[i] > peak) peak = eq[i];
    return {
      time: date,
      date,
      equity: eq[i] * 100, // indexed to 100 at the start
      bh: bh[i] * 100,
      drawdown: eq[i] / peak - 1, // <= 0, from the real curve
      inMarket: inMarket[i],
      phase: i <= splitIdx ? "is" : "oos",
    };
  });

  const line = (p) => ({ time: p.time, value: p.equity });
  return {
    points,
    byTime: new Map(points.map((p) => [p.time, p])),
    splitIdx,
    splitTime: dates[splitIdx],
    // IS and OOS share the split point so the two coloured lines meet exactly.
    is: points.slice(0, splitIdx + 1).map(line),
    oos: points.slice(splitIdx).map(line),
    bhLine: points.map((p) => ({ time: p.time, value: p.bh })),
  };
}
