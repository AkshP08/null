// ── Pure model for the chart's indicator overlays + trade drill-down ────────
//
// Everything is derived from REAL engine output:
//   • overlays are the strategy's OWN indicators (from the parsed spec),
//     recomputed with the very same indicator functions the engine used, on the
//     very same adjusted-price series the engine simulated on (result.series).
//     So the lines the user sees are byte-for-byte the signals that fired the
//     trades — not generic defaults.
//   • trades come straight from the engine's enriched trade records (entry/exit
//     price, holding period, return, cost paid).
// Pure & DOM-free, so it is unit-testable and never triggers a recompute.

import { computeIndicator, atr, rollingExtreme } from "../engine/indicators.js";

const OVERLAY_KINDS = new Set(["sma", "ema", "bbUpper", "bbLower", "bbMiddle"]);
const OSC_KINDS = new Set(["rsi", "roc", "macd", "macdSignal", "atr"]);
const PALETTE = ["#6EA8FF", "#E8B53B", "#B98CFF", "#57D9C2", "#F58BD1"];

function indKey(ind) {
  return [ind.kind, ind.period, ind.fast, ind.slow, ind.signal, ind.mult].join(":");
}
export function indLabel(ind) {
  switch (ind.kind) {
    case "price": return "Price";
    case "sma": return `SMA ${ind.period}`;
    case "ema": return `EMA ${ind.period}`;
    case "rsi": return `RSI ${ind.period}`;
    case "roc": return `ROC ${ind.period}`;
    case "macd": return `MACD ${ind.fast || 12}/${ind.slow || 26}`;
    case "macdSignal": return `MACD signal ${ind.signal || 9}`;
    case "bbUpper": return `BB upper ${ind.period || 20}·${ind.mult || 2}σ`;
    case "bbLower": return `BB lower ${ind.period || 20}·${ind.mult || 2}σ`;
    case "bbMiddle": return `BB mid ${ind.period || 20}`;
    case "atr": return `ATR ${ind.period || 14}`;
    default: return ind.kind;
  }
}

function walkConds(conds, cb) {
  for (const c of conds || []) {
    if (!c) continue;
    if (Array.isArray(c.all)) walkConds(c.all, cb);
    else if (Array.isArray(c.any)) walkConds(c.any, cb);
    else cb(c);
  }
}

/**
 * Collect the concrete indicators a spec actually uses, split into price-pane
 * overlays and oscillator subpanes, with any threshold levels that appear in
 * the spec (e.g. RSI < 30) attached to the matching oscillator.
 */
export function collectIndicators(spec) {
  const priceMap = new Map();
  const oscMap = new Map();
  const breakoutMap = new Map();

  const add = (ind) => {
    if (!ind || !ind.kind || ind.kind === "price") return;
    const key = indKey(ind);
    if (OVERLAY_KINDS.has(ind.kind) && !priceMap.has(key)) priceMap.set(key, { key, ind, label: indLabel(ind) });
    else if (OSC_KINDS.has(ind.kind) && !oscMap.has(key)) oscMap.set(key, { key, ind, label: indLabel(ind), thresholds: [] });
  };

  walkConds([...(spec.entry || []), ...(spec.exit || [])], (c) => {
    if (c.type === "cross") { add(c.fast); add(c.slow); }
    else if (c.type === "threshold") {
      add(c.indicator);
      const key = indKey(c.indicator);
      if (oscMap.has(key)) oscMap.get(key).thresholds.push({ value: c.value, op: c.op });
    } else if (c.type === "breakout") {
      const key = `breakout:${c.dir}:${c.lookback}`;
      if (!breakoutMap.has(key))
        breakoutMap.set(key, { key, ind: { kind: "breakout", dir: c.dir, lookback: c.lookback }, label: `${c.dir === "high" ? "High" : "Low"} ${c.lookback}-bar channel` });
    }
  });

  const priceOverlays = [...priceMap.values(), ...breakoutMap.values()].map((o, i) => ({
    ...o,
    color: PALETTE[i % PALETTE.length],
    dash: /bb(Upper|Lower)/.test(o.ind.kind) || o.ind.kind === "breakout",
  }));
  const oscillators = [...oscMap.values()].map((o, i) => ({ ...o, color: PALETTE[i % PALETTE.length] }));
  return { priceOverlays, oscillators };
}

function seriesFor(ind, S) {
  if (ind.kind === "breakout") return rollingExtreme(S.close, ind.lookback, ind.dir);
  if (ind.kind === "atr") return atr(S.high, S.low, S.close, ind.period || 14);
  return computeIndicator(ind, S.close);
}

/**
 * Build the price pane's plotted line + indicator overlays + oscillator subpanes
 * from a real result. Overlays warm up on the full series, then are clipped to
 * the same window as the equity/plot (so the moving average at the first plotted
 * bar is the true value, not a re-warmed stub).
 */
export function buildPriceModel(result, spec) {
  const S = result.series;
  if (!S || !S.close?.length) return null;
  const date = S.date;
  const startDate = result.dates?.[0];
  let w = startDate != null ? date.indexOf(startDate) : 0;
  if (w < 0) w = 0;
  const clip = (arr) => {
    const out = [];
    for (let i = w; i < arr.length; i++) if (arr[i] != null && Number.isFinite(arr[i])) out.push({ time: date[i], value: arr[i] });
    return out;
  };
  const { priceOverlays, oscillators } = collectIndicators(spec);
  return {
    priceLine: clip(S.close),
    overlays: priceOverlays.map((o) => ({ ...o, data: clip(seriesFor(o.ind, S)) })),
    oscillators: oscillators.map((o) => ({ ...o, data: clip(seriesFor(o.ind, S)) })),
  };
}

/** Display-ready trades from the engine's enriched records (all values real). */
export function enrichTrades(result) {
  const trades = result.trades || [];
  return trades.map((t, i) => {
    const days = dayGap(t.entryDate, t.exitDate);
    return {
      index: i,
      side: t.side,
      entryDate: t.entryDate,
      exitDate: t.exitDate,
      entryPrice: t.entryPrice,
      exitPrice: t.exitPrice,
      bars: t.bars,
      days,
      ret: t.ret,
      win: t.ret > 0,
      cost: t.cost,
      open: !!t.open,
    };
  });
}

function dayGap(a, b) {
  if (!a || !b) return null;
  const d1 = Date.parse(a), d2 = Date.parse(b);
  if (Number.isNaN(d1) || Number.isNaN(d2)) return null;
  return Math.round((d2 - d1) / 86400000);
}
