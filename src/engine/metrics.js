// ── Performance metrics: single source of truth ────────────────────────────
//
// Conventions (stated, applied consistently, and unit-tested in src/test):
//   - Inputs are arrays of per-bar SIMPLE returns r_t = equity_t / equity_{t-1} - 1.
//   - Daily data; annualization factor 252.
//   - Risk-free rate default 0 (per-period). Pass a per-period rf to override.
//
// These functions are deliberately small and pure so they can be checked
// against hand-computed answers. If you change a formula, change the test.

export const TRADING_DAYS = 252;

function mean(xs) {
  if (xs.length === 0) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

/** Population-style stdev (divide by N). Matches the textbook Sharpe convention. */
function stdev(xs) {
  if (xs.length === 0) return 0;
  const m = mean(xs);
  let s = 0;
  for (const x of xs) s += (x - m) * (x - m);
  return Math.sqrt(s / xs.length);
}

/** Total compounded return over a returns series. */
export function totalReturn(returns) {
  let eq = 1;
  for (const r of returns) eq *= 1 + r;
  return eq - 1;
}

/** Build an equity curve (starting at 1) from a returns series. */
export function equityCurve(returns, start = 1) {
  const out = new Array(returns.length + 1);
  out[0] = start;
  for (let i = 0; i < returns.length; i++)
    out[i + 1] = out[i] * (1 + returns[i]);
  return out;
}

/** Geometric CAGR given a returns series of daily bars. */
export function cagr(returns, periodsPerYear = TRADING_DAYS) {
  if (returns.length === 0) return 0;
  const tr = totalReturn(returns);
  const years = returns.length / periodsPerYear;
  if (years <= 0) return 0;
  const growth = 1 + tr;
  if (growth <= 0) return -1; // wiped out
  return Math.pow(growth, 1 / years) - 1;
}

/** Annualized volatility = per-period stdev × sqrt(periodsPerYear). */
export function annualizedVol(returns, periodsPerYear = TRADING_DAYS) {
  return stdev(returns) * Math.sqrt(periodsPerYear);
}

/** Sharpe ratio = mean(excess) / stdev(excess) × sqrt(periodsPerYear). */
export function sharpe(
  returns,
  rfPerPeriod = 0,
  periodsPerYear = TRADING_DAYS,
) {
  if (returns.length === 0) return 0;
  const excess = returns.map((r) => r - rfPerPeriod);
  const sd = stdev(excess);
  // Guard against catastrophic cancellation: a stdev this small is numerical
  // noise (constant series), and Sharpe carries no risk-adjusted information.
  if (sd <= 1e-12) return 0;
  return (mean(excess) / sd) * Math.sqrt(periodsPerYear);
}

/**
 * Sortino ratio = mean(excess) / downsideDeviation × sqrt(periodsPerYear).
 * Downside deviation uses returns below the target (rf), with the sum divided
 * by the FULL count N (the standard MAR-based definition).
 */
export function sortino(
  returns,
  rfPerPeriod = 0,
  periodsPerYear = TRADING_DAYS,
) {
  if (returns.length === 0) return 0;
  const excess = returns.map((r) => r - rfPerPeriod);
  let dsq = 0;
  for (const e of excess) {
    if (e < 0) dsq += e * e;
  }
  const dd = Math.sqrt(dsq / returns.length);
  if (dd <= 1e-12) return 0;
  return (mean(excess) / dd) * Math.sqrt(periodsPerYear);
}

/**
 * Maximum drawdown from a returns series.
 * Returns { maxDrawdown (negative fraction), peakIndex, troughIndex,
 *           durationBars } where duration is peak→recovery (or peak→end if
 *           never recovered) measured in bars.
 */
export function maxDrawdown(returns) {
  const eq = equityCurve(returns);
  let peak = eq[0];
  let peakIdx = 0;
  let maxDD = 0;
  let mddPeakIdx = 0;
  let mddTroughIdx = 0;
  for (let i = 1; i < eq.length; i++) {
    if (eq[i] > peak) {
      peak = eq[i];
      peakIdx = i;
    }
    const dd = eq[i] / peak - 1;
    if (dd < maxDD) {
      maxDD = dd;
      mddPeakIdx = peakIdx;
      mddTroughIdx = i;
    }
  }
  // duration: from the peak that preceded the max drawdown to recovery of that peak.
  let recoveryIdx = eq.length - 1;
  const peakVal = eq[mddPeakIdx];
  for (let i = mddTroughIdx; i < eq.length; i++) {
    if (eq[i] >= peakVal) {
      recoveryIdx = i;
      break;
    }
  }
  return {
    maxDrawdown: maxDD,
    peakIndex: mddPeakIdx,
    troughIndex: mddTroughIdx,
    durationBars: recoveryIdx - mddPeakIdx,
  };
}

/** Calmar = CAGR / |max drawdown|. Returns 0 if no drawdown. */
export function calmar(returns, periodsPerYear = TRADING_DAYS) {
  const dd = Math.abs(maxDrawdown(returns).maxDrawdown);
  if (dd === 0) return 0;
  return cagr(returns, periodsPerYear) / dd;
}

/**
 * Trade-level statistics from a list of closed trades.
 * Each trade: { ret } where ret is the trade's net return fraction.
 * Returns counts, win rate, avg win/loss, profit factor, expectancy.
 */
export function tradeStats(trades) {
  const n = trades.length;
  if (n === 0) {
    return {
      count: 0,
      winRate: 0,
      avgWin: 0,
      avgLoss: 0,
      profitFactor: 0,
      expectancy: 0,
    };
  }
  const wins = trades.filter((t) => t.ret > 0);
  const losses = trades.filter((t) => t.ret <= 0);
  const grossWin = wins.reduce((s, t) => s + t.ret, 0);
  const grossLoss = losses.reduce((s, t) => s + t.ret, 0); // <= 0
  const profitFactor =
    grossLoss === 0
      ? grossWin > 0
        ? Infinity
        : 0
      : grossWin / Math.abs(grossLoss);
  return {
    count: n,
    winRate: wins.length / n,
    avgWin: wins.length ? grossWin / wins.length : 0,
    avgLoss: losses.length ? grossLoss / losses.length : 0,
    profitFactor,
    expectancy: trades.reduce((s, t) => s + t.ret, 0) / n,
  };
}

/**
 * Compute the full metric bundle for a returns series + trade list.
 * `barsInMarket` / `totalBars` give exposure; `fillCount` gives turnover.
 */
export function computeMetrics(
  returns,
  trades,
  { barsInMarket, totalBars, fillCount, rfPerPeriod = 0 } = {},
) {
  const dd = maxDrawdown(returns);
  return {
    totalReturn: totalReturn(returns),
    cagr: cagr(returns),
    annualizedVol: annualizedVol(returns),
    sharpe: sharpe(returns, rfPerPeriod),
    sortino: sortino(returns, rfPerPeriod),
    maxDrawdown: dd.maxDrawdown,
    drawdownDurationBars: dd.durationBars,
    calmar: calmar(returns),
    exposure: totalBars ? (barsInMarket ?? 0) / totalBars : 0,
    turnover: totalBars ? (fillCount ?? 0) / totalBars : 0,
    bars: returns.length,
    ...tradeStats(trades || []),
  };
}
