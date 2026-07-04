// ── A small library of classic setups — one-tap starting points ─────────────
// These are full, validated specs (not text), so a tap goes straight to the
// confirmation step without depending on parsing. They are deliberately plain
// textbook strategies — most will NOT survive Null's gauntlet, which is the point.

export const CLASSICS = [
  {
    key: "golden-cross",
    label: "Golden cross",
    blurb: "50-day SMA crosses above the 200-day",
    spec: {
      name: "Golden cross (50/200 SMA)",
      direction: "long_flat",
      entry: [{ type: "cross", fast: { kind: "sma", period: 50 }, slow: { kind: "sma", period: 200 }, dir: "above" }],
      stopLoss: null, takeProfit: null, trailingStop: null,
    },
  },
  {
    key: "rsi-reversion",
    label: "RSI mean-reversion",
    blurb: "Buy RSI(14) < 30, sell > 60",
    spec: {
      name: "RSI(14) mean-reversion",
      direction: "long_flat",
      entry: [{ type: "threshold", indicator: { kind: "rsi", period: 14 }, op: "<", value: 30 }],
      exit: [{ type: "threshold", indicator: { kind: "rsi", period: 14 }, op: ">", value: 60 }],
      stopLoss: null, takeProfit: null, trailingStop: null,
    },
  },
  {
    key: "breakout",
    label: "50-day breakout",
    blurb: "New 50-day high, 3× ATR trailing stop",
    spec: {
      name: "50-day breakout",
      direction: "long_flat",
      entry: [{ type: "breakout", lookback: 50, dir: "high" }],
      trailingStop: { type: "atr", period: 14, mult: 3 },
      stopLoss: null, takeProfit: null,
    },
  },
  {
    key: "trend-filter",
    label: "200-day trend filter",
    blurb: "Hold while price is above the 200-day SMA",
    spec: {
      name: "Price above 200-SMA",
      direction: "long_flat",
      entry: [{ type: "cross", fast: { kind: "price" }, slow: { kind: "sma", period: 200 }, dir: "above" }],
      stopLoss: null, takeProfit: null, trailingStop: null,
    },
  },
  {
    key: "macd",
    label: "MACD cross",
    blurb: "MACD line crosses above signal",
    spec: {
      name: "MACD bullish cross",
      direction: "long_flat",
      entry: [{ type: "cross", fast: { kind: "macd", fast: 12, slow: 26 }, slow: { kind: "macdSignal", fast: 12, slow: 26, signal: 9 }, dir: "above" }],
      stopLoss: null, takeProfit: null, trailingStop: null,
    },
  },
];
