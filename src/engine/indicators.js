// ── Point-in-time technical indicators ─────────────────────────────────────
//
// CRITICAL: every value at index t is computed using ONLY data at indices <= t.
// There is no look-ahead anywhere in this file. Where a value cannot yet be
// computed (insufficient warmup), the output is `null` — never a guess, never a
// forward-filled future value.

/** Simple moving average. out[t] = mean(values[t-period+1 .. t]) or null. */
export function sma(values, period) {
  const out = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/** Exponential moving average, seeded with the first SMA(period) for stability. */
export function ema(values, period) {
  const out = new Array(values.length).fill(null);
  const k = 2 / (period + 1);
  let prev = null;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i === period - 1) {
      prev = sum / period; // seed with SMA
      out[i] = prev;
    } else if (i >= period) {
      prev = values[i] * k + prev * (1 - k);
      out[i] = prev;
    }
  }
  return out;
}

/**
 * Wilder's RSI (the standard). out[t] in [0,100] or null during warmup.
 * Uses Wilder smoothing of average gains/losses.
 */
export function rsi(values, period) {
  const out = new Array(values.length).fill(null);
  if (values.length <= period) return out;
  let avgGain = 0;
  let avgLoss = 0;
  // first averages: simple mean of the first `period` changes
  for (let i = 1; i <= period; i++) {
    const change = values[i] - values[i - 1];
    if (change >= 0) avgGain += change;
    else avgLoss -= change;
  }
  avgGain /= period;
  avgLoss /= period;
  out[period] = rsiFrom(avgGain, avgLoss);
  for (let i = period + 1; i < values.length; i++) {
    const change = values[i] - values[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = rsiFrom(avgGain, avgLoss);
  }
  return out;
}

function rsiFrom(avgGain, avgLoss) {
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/**
 * Rolling extreme over the PRIOR `lookback` bars (strictly excluding the
 * current bar) — used for breakout conditions so "new high" means higher than
 * the previous N bars, not including today. out[t] = max/min of [t-lookback .. t-1].
 */
export function rollingExtreme(values, lookback, kind /* 'high'|'low' */) {
  const out = new Array(values.length).fill(null);
  for (let i = 0; i < values.length; i++) {
    if (i < lookback) continue;
    let ext = values[i - lookback];
    for (let j = i - lookback + 1; j <= i - 1; j++) {
      if (kind === "high") ext = Math.max(ext, values[j]);
      else ext = Math.min(ext, values[j]);
    }
    out[i] = ext;
  }
  return out;
}

/** Rate of change: out[t] = (v[t]/v[t-period] - 1) * 100. Point-in-time. */
export function roc(values, period) {
  const out = new Array(values.length).fill(null);
  for (let i = period; i < values.length; i++) {
    if (values[i - period] === 0) continue;
    out[i] = (values[i] / values[i - period] - 1) * 100;
  }
  return out;
}

/** MACD line = EMA(fast) − EMA(slow). Null until both EMAs exist. */
export function macdLine(values, fast = 12, slow = 26) {
  const ef = ema(values, fast);
  const es = ema(values, slow);
  return values.map((_, i) => (ef[i] == null || es[i] == null ? null : ef[i] - es[i]));
}

/** MACD signal line = EMA(signal) of the MACD line (seeded like any EMA). */
export function macdSignal(values, fast = 12, slow = 26, signal = 9) {
  const line = macdLine(values, fast, slow);
  // EMA over the defined portion of the MACD line, mapped back to full length.
  const startIdx = line.findIndex((x) => x != null);
  if (startIdx < 0) return new Array(values.length).fill(null);
  const compact = line.slice(startIdx);
  const sig = ema(compact.map((x) => (x == null ? 0 : x)), signal);
  const out = new Array(values.length).fill(null);
  for (let i = 0; i < sig.length; i++) out[startIdx + i] = sig[i];
  return out;
}

/**
 * Bollinger Bands. mid = SMA(period); upper/lower = mid ± mult·σ, where σ is
 * the POPULATION standard deviation over the same trailing window (the standard
 * definition). Returns { middle, upper, lower } arrays. Point-in-time.
 */
export function bollinger(values, period = 20, mult = 2) {
  const middle = sma(values, period);
  const upper = new Array(values.length).fill(null);
  const lower = new Array(values.length).fill(null);
  for (let i = period - 1; i < values.length; i++) {
    let sumSq = 0;
    const m = middle[i];
    for (let j = i - period + 1; j <= i; j++) sumSq += (values[j] - m) * (values[j] - m);
    const sd = Math.sqrt(sumSq / period);
    upper[i] = m + mult * sd;
    lower[i] = m - mult * sd;
  }
  return { middle, upper, lower };
}

/**
 * Average True Range (Wilder). TR[t] = max(high−low, |high−prevClose|,
 * |low−prevClose|); ATR = Wilder-smoothed TR over `period`. Point-in-time.
 */
export function atr(high, low, close, period = 14) {
  const n = close.length;
  const out = new Array(n).fill(null);
  if (n <= period) return out;
  const tr = new Array(n).fill(null);
  tr[0] = high[0] - low[0];
  for (let i = 1; i < n; i++) {
    tr[i] = Math.max(high[i] - low[i], Math.abs(high[i] - close[i - 1]), Math.abs(low[i] - close[i - 1]));
  }
  // first ATR = simple mean of first `period` TRs (TR[1..period])
  let sum = 0;
  for (let i = 1; i <= period; i++) sum += tr[i];
  let prev = sum / period;
  out[period] = prev;
  for (let i = period + 1; i < n; i++) {
    prev = (prev * (period - 1) + tr[i]) / period;
    out[i] = prev;
  }
  return out;
}

/**
 * Resolve a close-based indicator spec to a per-bar series.
 * `series` is the adjusted-close series. (ATR and volume need OHLCV and are
 * resolved in the engine, which has the full series object.)
 */
export function computeIndicator(ind, series) {
  switch (ind.kind) {
    case "price":
      return series.slice();
    case "sma":
      return sma(series, ind.period);
    case "ema":
      return ema(series, ind.period);
    case "rsi":
      return rsi(series, ind.period);
    case "roc":
      return roc(series, ind.period);
    case "macd":
      return macdLine(series, ind.fast || 12, ind.slow || 26);
    case "macdSignal":
      return macdSignal(series, ind.fast || 12, ind.slow || 26, ind.signal || 9);
    case "bbUpper":
      return bollinger(series, ind.period || 20, ind.mult || 2).upper;
    case "bbLower":
      return bollinger(series, ind.period || 20, ind.mult || 2).lower;
    case "bbMiddle":
      return bollinger(series, ind.period || 20, ind.mult || 2).middle;
    default:
      throw new Error(`unknown indicator kind: ${ind.kind}`);
  }
}
