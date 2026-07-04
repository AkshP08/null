// ── The backtest engine ─────────────────────────────────────────────────────
//
// Pure: feed it (validatedSpec, instrumentData, config) → get back metrics,
// equity curves, and trades. No UI, no network, no globals, no randomness.
//
// Guarantees (enforced in code, not just claimed):
//   1. NO LOOK-AHEAD. A signal computed from data through bar t only ever uses
//      indicator values at indices <= t. The resulting position change is
//      executed at bar t+1's OPEN. The signal bar and the fill bar are never
//      the same bar.
//   2. REAL COSTS. Commission + slippage (bps) are charged on every fill's
//      notional. "Before costs" runs the identical path with zero costs.
//   3. SELF-PROVING BENCHMARK. Buy-and-hold is the raw adjusted-close ratio
//      over the window, so its total return exactly equals the instrument's
//      own adjusted return (no costs) — the engine's built-in sanity check.
//
// Conventions:
//   - All prices used are SPLIT/DIVIDEND-ADJUSTED. Raw OHLC is scaled by
//     adjClose/close so open/high/low live on the same adjusted basis.
//   - Fills at next bar's OPEN.
//   - Stop-loss / take-profit are evaluated on the CLOSE (information available
//     at the bar) and filled at the next open — look-ahead-free and
//     deliberately conservative (no optimistic intrabar stop fills).
//   - Sizing: fully invested. Long = 100% of equity; flat = 0%; short
//     (long_short mode) = 100% notional short, collateralized, no leverage.

import { computeIndicator, rollingExtreme, atr, sma } from "./indicators.js";
import { computeMetrics } from "./metrics.js";
import { maxLookback, validateSpec } from "./schema.js";

export const DEFAULT_CONFIG = {
  commissionBps: 2, // 0.02% per fill — realistic discount-broker/ETF level
  slippageBps: 3, // 0.03% per fill
  isFraction: 0.7, // chronological in-sample fraction
  rfAnnual: 0, // annual risk-free rate
};

/** Build adjusted OHLC(V) arrays from raw rows. */
function adjustedSeries(rows) {
  const date = [],
    open = [],
    high = [],
    low = [],
    close = [],
    adjClose = [],
    volume = [];
  for (const r of rows) {
    const factor = r.close ? r.adjClose / r.close : 1;
    date.push(r.date);
    open.push(r.open * factor);
    high.push(r.high * factor);
    low.push(r.low * factor);
    close.push(r.close * factor); // === adjClose by construction
    adjClose.push(r.adjClose);
    volume.push(r.volume ?? 0);
  }
  return {
    date,
    open,
    high,
    low,
    close: adjClose,
    openAdj: open,
    highAdj: high,
    lowAdj: low,
    volume,
  };
}

/** Resolve any indicator (incl. ATR, which needs OHLC) to a value series. */
function resolveIndicator(ind, S) {
  if (ind.kind === "atr") return atr(S.highAdj, S.lowAdj, S.close, ind.period || 14);
  return computeIndicator(ind, S.close);
}

/** Evaluate a single condition (or AND/OR group) to a boolean series (look-ahead-free). */
function conditionSeries(cond, S) {
  const n = S.close.length;
  if (Array.isArray(cond.all)) return andSeries(cond.all.map((c) => conditionSeries(c, S)), n);
  if (Array.isArray(cond.any)) return orSeries(cond.any.map((c) => conditionSeries(c, S)), n);
  const out = new Array(n).fill(false);
  if (cond.type === "cross") {
    const fast = resolveIndicator(cond.fast, S);
    const slow = resolveIndicator(cond.slow, S);
    for (let i = 1; i < n; i++) {
      const f0 = fast[i - 1],
        s0 = slow[i - 1],
        f1 = fast[i],
        s1 = slow[i];
      if (f0 == null || s0 == null || f1 == null || s1 == null) continue;
      if (cond.dir === "above") out[i] = f0 <= s0 && f1 > s1;
      else out[i] = f0 >= s0 && f1 < s1;
    }
  } else if (cond.type === "threshold") {
    const v = resolveIndicator(cond.indicator, S);
    for (let i = 0; i < n; i++) {
      if (v[i] == null) continue;
      switch (cond.op) {
        case ">":
          out[i] = v[i] > cond.value;
          break;
        case "<":
          out[i] = v[i] < cond.value;
          break;
        case ">=":
          out[i] = v[i] >= cond.value;
          break;
        case "<=":
          out[i] = v[i] <= cond.value;
          break;
      }
    }
  } else if (cond.type === "breakout") {
    const ext = rollingExtreme(S.close, cond.lookback, cond.dir);
    for (let i = 0; i < n; i++) {
      if (ext[i] == null) continue;
      out[i] = cond.dir === "high" ? S.close[i] > ext[i] : S.close[i] < ext[i];
    }
  } else if (cond.type === "volume") {
    // volume above `mult`× its own trailing average — a relative filter, so it
    // is robust to split-adjustment scale changes.
    const avg = sma(S.volume, cond.period || 20);
    const mult = cond.mult || 1.5;
    for (let i = 0; i < n; i++) {
      if (avg[i] == null || avg[i] === 0) continue;
      out[i] = S.volume[i] > mult * avg[i];
    }
  }
  return out;
}

/** AND a set of condition series together. Empty set → all false. */
function andSeries(list, n) {
  if (!list || list.length === 0) return new Array(n).fill(false);
  const out = new Array(n).fill(true);
  for (const s of list) for (let i = 0; i < n; i++) out[i] = out[i] && s[i];
  return out;
}
/** OR a set of condition series together. Empty set → all false. */
function orSeries(list, n) {
  const out = new Array(n).fill(false);
  for (const s of list) for (let i = 0; i < n; i++) out[i] = out[i] || s[i];
  return out;
}

/**
 * Cross conditions are momentary (true only on the crossing bar). For deciding
 * whether to ENTER, that's right. But ANDing two momentary signals almost never
 * lines up. So for the entry gate we treat a cross as "the regime it implies":
 * a cross-above means fast>slow holds; cross-below means fast<slow holds. This
 * makes multi-condition entries behave the way a human means them.
 */
function entryStateSeries(cond, S) {
  const n = S.close.length;
  if (Array.isArray(cond.all)) return andSeries(cond.all.map((c) => entryStateSeries(c, S)), n);
  if (Array.isArray(cond.any)) return orSeries(cond.any.map((c) => entryStateSeries(c, S)), n);
  if (cond.type !== "cross") return conditionSeries(cond, S);
  const fast = resolveIndicator(cond.fast, S);
  const slow = resolveIndicator(cond.slow, S);
  const out = new Array(n).fill(false);
  for (let i = 0; i < n; i++) {
    if (fast[i] == null || slow[i] == null) continue;
    out[i] = cond.dir === "above" ? fast[i] > slow[i] : fast[i] < slow[i];
  }
  return out;
}

/**
 * Run the simulation.
 * @param {object} spec  a strategy spec (will be validated)
 * @param {object} data  instrument data: { id, name, rows:[{date,open,high,low,close,adjClose}] }
 * @param {object} cfg   overrides for DEFAULT_CONFIG
 * @returns full result object (see bottom) — never throws on degenerate input;
 *          instead returns { ok:false, reason } for unusable inputs.
 */
export function backtest(spec, data, cfg = {}) {
  const config = { ...DEFAULT_CONFIG, ...cfg };
  const v = validateSpec(spec);
  if (!v.ok) return { ok: false, reason: "invalid-spec", errors: v.errors };
  spec = v.spec;

  const rows = data.rows || [];
  const need = maxLookback(spec) + 2;
  if (rows.length < need) {
    return {
      ok: false,
      reason: "insufficient-data",
      message: `Need at least ${need} bars for these lookbacks; have ${rows.length}.`,
    };
  }
  const S = adjustedSeries(rows);
  const n = S.close.length;

  // ── Build look-ahead-free signal series ──────────────────────────────────
  const entryGate = andSeries(
    spec.entry.map((c) => entryStateSeries(c, S)),
    n,
  );
  // an entry "edge" — only the bars where the gate flips false→true — so a
  // single-condition cross still behaves as an entry trigger.
  const entrySignal = new Array(n).fill(false);
  for (let i = 1; i < n; i++)
    entrySignal[i] = entryGate[i] && !entryGate[i - 1];

  const hasExplicitExit = spec.exit && spec.exit.length > 0;
  const exitGate = hasExplicitExit
    ? orSeries(
        spec.exit.map((c) => conditionSeries(c, S)),
        n,
      )
    : null;

  // first bar at which the entry gate can be evaluated with full warmup
  const warmup = maxLookback(spec);

  // ── Stateful next-open simulation ────────────────────────────────────────
  const longShort = spec.direction === "long_short";

  // ATR series for an ATR-based trailing stop (evaluated on the close,
  // look-ahead-free; applies to the long leg only).
  const trail = spec.trailingStop;
  const trailAtr = trail && trail.type === "atr" ? atr(S.highAdj, S.lowAdj, S.close, trail.period || 14) : null;

  function simulate(costRate) {
    let cash = 1,
      units = 0; // start equity = 1
    let pos = 0; // -1 short, 0 flat, +1 long (currently held)
    let entryPx = null;
    let entryEquity = null;
    let entryIdx = null;
    let entryCostAbs = null; // commission+slippage paid to OPEN the current trade
    let peak = null; // highest close since entry (for the trailing stop)
    let pendingTarget = 0;
    const equity = new Array(n).fill(null);
    const trades = [];
    let barsInMarket = 0;
    let fillCount = 0;
    let firstActiveIdx = null;

    for (let i = warmup; i < n; i++) {
      const openPx = S.openAdj[i];
      const closePx = S.close[i];

      // 1) Execute the target decided at the prior bar's close, at THIS open.
      if (pendingTarget !== pos) {
        // liquidate current position to cash (cash becomes full equity)
        if (pos !== 0) {
          const notional = Math.abs(units) * openPx;
          const exitCostAbs = notional * costRate;
          cash += units * openPx; // long: receive; short: pay to cover (units<0)
          cash -= exitCostAbs;
          fillCount++;
          trades.push({
            entryDate: S.date[entryIdx],
            exitDate: S.date[i],
            side: pos > 0 ? "long" : "short",
            ret: cash / entryEquity - 1,
            // ── real per-trade forensics (additive; unused by any metric) ──
            entryIndex: entryIdx,
            exitIndex: i,
            entryPrice: entryPx, // adjusted OPEN we actually filled at
            exitPrice: openPx, // adjusted OPEN we exited at
            bars: i - entryIdx, // holding period, in bars
            cost: (entryCostAbs + exitCostAbs) / entryEquity, // fraction of trade capital
          });
          units = 0;
        }
        // deploy full equity into the new target
        if (pendingTarget !== 0) {
          const E = cash;
          const U = E / (openPx * (1 + costRate));
          if (pendingTarget > 0) {
            cash = E - U * openPx * (1 + costRate); // ≈ 0
            units = U;
          } else {
            cash = E + U * openPx * (1 - costRate); // collateral + net short proceeds
            units = -U;
          }
          fillCount++;
          entryIdx = i;
          entryPx = openPx;
          entryCostAbs = U * openPx * costRate; // cost paid to enter this trade
          peak = openPx; // reset the trailing-stop reference at entry
          entryEquity = cash + units * openPx; // = E/(1+costRate) either side
        }
        pos = pendingTarget;
        if (pos !== 0 && firstActiveIdx == null) firstActiveIdx = i;
      }

      // 2) Mark to market at the close.
      equity[i] = cash + units * closePx;
      if (pos !== 0) barsInMarket++;

      // 3) Decide the target for the NEXT bar using info through this close.
      let wantLong;
      if (pos > 0) {
        peak = peak == null ? closePx : Math.max(peak, closePx); // trail the high
        let exitNow = hasExplicitExit ? exitGate[i] : !entryGate[i];
        if (spec.stopLoss != null && closePx <= entryPx * (1 - spec.stopLoss))
          exitNow = true;
        if (
          spec.takeProfit != null &&
          closePx >= entryPx * (1 + spec.takeProfit)
        )
          exitNow = true;
        // trailing stop (long leg): drop from the running peak
        if (trail && trail.type === "pct" && closePx <= peak * (1 - trail.value))
          exitNow = true;
        if (trail && trail.type === "atr" && trailAtr[i] != null && closePx <= peak - (trail.mult || 3) * trailAtr[i])
          exitNow = true;
        wantLong = !exitNow;
      } else if (pos < 0) {
        // short leg (long_short only): cover when the long entry regime returns
        wantLong = entryGate[i];
      } else {
        wantLong = entrySignal[i] || (entryGate[i] && warmup === i); // enter on trigger
      }
      pendingTarget = wantLong ? 1 : longShort ? -1 : 0;
    }

    // record any still-open position as a trade, marked to the final close (no
    // extra fill cost — it is not actually closed) so trade counts and stats
    // reflect time spent in the market.
    if (pos !== 0 && entryEquity != null) {
      trades.push({
        entryDate: S.date[entryIdx],
        exitDate: S.date[n - 1],
        side: pos > 0 ? "long" : "short",
        ret: equity[n - 1] / entryEquity - 1,
        entryIndex: entryIdx,
        exitIndex: n - 1,
        entryPrice: entryPx,
        exitPrice: S.close[n - 1], // marked to the final close (not an actual fill)
        bars: n - 1 - entryIdx,
        cost: entryCostAbs / entryEquity, // only the entry fill was paid
        open: true,
      });
    }

    const returns = [];
    let started = false;
    let prevEq = null;
    const eqOut = [];
    const dateOut = [];
    for (let i = warmup; i < n; i++) {
      if (equity[i] == null) continue;
      if (!started) {
        prevEq = equity[i];
        started = true;
        eqOut.push(1);
        dateOut.push(S.date[i]);
        continue;
      }
      returns.push(equity[i] / prevEq - 1);
      prevEq = equity[i];
      eqOut.push(equity[i] / equity[warmup]);
      dateOut.push(S.date[i]);
    }
    return {
      returns,
      eqOut,
      dateOut,
      trades,
      barsInMarket,
      fillCount,
      firstActiveIdx,
    };
  }

  const costRate = (config.commissionBps + config.slippageBps) / 10000;
  const withCosts = simulate(costRate);
  const noCosts = simulate(0);

  // ── Benchmark: buy-and-hold over the SAME window, cost-free. ──────────────
  // Self-proof: total return must equal adjClose[end]/adjClose[start]-1.
  const benchDates = withCosts.dateOut;
  const startIdx = warmup;
  const benchEquity = [];
  const benchReturns = [];
  for (let k = 0; k < benchDates.length; k++) {
    const i = startIdx + k;
    benchEquity.push(S.close[i] / S.close[startIdx]);
    if (k > 0) benchReturns.push(S.close[i] / S.close[i - 1] - 1);
  }

  // ── Chronological in-sample / out-of-sample split ─────────────────────────
  const m = withCosts.returns.length;
  const splitAt = Math.floor(m * config.isFraction);
  const rfPerPeriod = config.rfAnnual / 252;

  function sliceMetrics(sim, lo, hi) {
    const returns = sim.returns.slice(lo, hi);
    // trades whose EXIT falls in [lo,hi) window — count trades by exit date
    const winStartDate = sim.dateOut[lo + 1] || sim.dateOut[lo];
    const winEndDate = sim.dateOut[hi] || sim.dateOut[sim.dateOut.length - 1];
    const trades = sim.trades.filter(
      (t) => t.exitDate > winStartDate && t.exitDate <= winEndDate,
    );
    // exposure within the slice
    return computeMetrics(returns, trades, {
      barsInMarket: undefined,
      totalBars: returns.length,
      fillCount: undefined,
      rfPerPeriod,
    });
  }

  // exposure/turnover are most meaningful full-sample:
  const full = computeMetrics(withCosts.returns, withCosts.trades, {
    barsInMarket: withCosts.barsInMarket,
    totalBars: withCosts.returns.length,
    fillCount: withCosts.fillCount,
    rfPerPeriod,
  });
  const fullNoCost = computeMetrics(noCosts.returns, noCosts.trades, {
    barsInMarket: noCosts.barsInMarket,
    totalBars: noCosts.returns.length,
    fillCount: noCosts.fillCount,
    rfPerPeriod,
  });

  const inSample = sliceMetrics(withCosts, 0, splitAt);
  const outSample = sliceMetrics(withCosts, splitAt, m);

  const benchFull = computeMetrics(benchReturns, [], {
    totalBars: benchReturns.length,
    rfPerPeriod,
  });

  return {
    ok: true,
    spec,
    config,
    instrument: {
      id: data.id,
      name: data.name,
      symbol: data.symbol,
      klass: data.klass,
    },
    window: {
      start: benchDates[0],
      end: benchDates[benchDates.length - 1],
      bars: m,
    },
    split: {
      fraction: config.isFraction,
      splitIndex: splitAt,
      splitDate: withCosts.dateOut[splitAt],
    },
    dates: withCosts.dateOut,
    // The exact SPLIT/DIVIDEND-ADJUSTED prices the engine simulated on, full
    // length (so overlays can warm up before the plotted window). This is the
    // engine's own basis — the chart draws and recomputes indicators from it, so
    // what the user sees is provably what the strategy actually traded on.
    series: { date: S.date, open: S.open, high: S.high, low: S.low, close: S.close },
    equity: {
      strategy: withCosts.eqOut,
      strategyNoCosts: noCosts.eqOut,
      benchmark: benchEquity,
    },
    returns: { strategy: withCosts.returns, benchmark: benchReturns },
    trades: withCosts.trades,
    metrics: { full, fullNoCost, inSample, outSample, benchmark: benchFull },
    counts: {
      trades: withCosts.trades.length,
      bars: m,
      barsInMarket: withCosts.barsInMarket,
      exposure: full.exposure,
    },
  };
}
