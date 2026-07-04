import { describe, it, expect } from "vitest";
import { validateSpec } from "../engine/schema.js";
import { backtest } from "../engine/backtest.js";

function makeData(closes, volumes) {
  return {
    id: "T", name: "T", symbol: "T",
    rows: closes.map((c, i) => ({
      date: new Date(Date.UTC(2020, 0, 1 + i)).toISOString().slice(0, 10),
      open: c, high: c * 1.01, low: c * 0.99, close: c, adjClose: c,
      volume: volumes ? volumes[i] : 1000,
    })),
  };
}
// oscillating trend so multiple indicators fire
function wave(n) {
  return Array.from({ length: n }, (_, i) => 100 + 15 * Math.sin(i / 6) + i * 0.1);
}

describe("schema accepts the widened construct set", () => {
  it("validates MACD/Bollinger/ATR indicators, volume condition, AND/OR groups, trailing stop", () => {
    const spec = {
      name: "wide",
      direction: "long_flat",
      entry: [
        { all: [
          { type: "cross", fast: { kind: "macd", fast: 12, slow: 26 }, slow: { kind: "macdSignal", fast: 12, slow: 26, signal: 9 }, dir: "above" },
          { any: [
            { type: "cross", fast: { kind: "price" }, slow: { kind: "bbLower", period: 20, mult: 2 }, dir: "below" },
            { type: "volume", period: 20, mult: 1.5 },
          ] },
        ] },
      ],
      trailingStop: { type: "atr", period: 14, mult: 3 },
    };
    const v = validateSpec(spec);
    expect(v.ok).toBe(true);
  });

  it("rejects an unknown indicator kind", () => {
    const v = validateSpec({ name: "x", direction: "long_flat", entry: [{ type: "threshold", indicator: { kind: "stochastic", period: 14 }, op: ">", value: 80 }] });
    expect(v.ok).toBe(false);
  });
});

describe("AND vs OR entry logic", () => {
  const A = { type: "cross", fast: { kind: "sma", period: 3 }, slow: { kind: "sma", period: 8 }, dir: "above" };
  const B = { type: "threshold", indicator: { kind: "rsi", period: 5 }, op: ">", value: 50 };
  const data = makeData(wave(300));

  it("OR is in-market at least as often as AND (OR ⊇ AND)", () => {
    const andRun = backtest({ name: "and", direction: "long_flat", entry: [A, B] }, data);
    const orRun = backtest({ name: "or", direction: "long_flat", entry: [{ any: [A, B] }] }, data);
    expect(andRun.ok).toBe(true);
    expect(orRun.ok).toBe(true);
    expect(orRun.counts.exposure).toBeGreaterThanOrEqual(andRun.counts.exposure - 1e-9);
  });
});

describe("volume filter is restrictive", () => {
  it("adding a volume filter never increases exposure", () => {
    const closes = wave(300);
    // volume spikes only occasionally
    const vols = closes.map((_, i) => (i % 5 === 0 ? 5000 : 1000));
    const data = makeData(closes, vols);
    const base = { type: "cross", fast: { kind: "sma", period: 5 }, slow: { kind: "sma", period: 20 }, dir: "above" };
    const noFilter = backtest({ name: "n", direction: "long_flat", entry: [base] }, data);
    const withFilter = backtest({ name: "f", direction: "long_flat", entry: [base, { type: "volume", period: 20, mult: 1.5 }] }, data);
    expect(withFilter.ok).toBe(true);
    expect(withFilter.counts.exposure).toBeLessThanOrEqual(noFilter.counts.exposure + 1e-9);
  });
});

describe("ATR trailing stop", () => {
  it("a tight ATR trailing stop cuts exposure vs no stop on a rise-then-crash series", () => {
    // rise then sharp reversal so a trailing stop should fire
    const closes = [];
    for (let i = 0; i < 120; i++) closes.push(100 + i);
    for (let i = 0; i < 80; i++) closes.push(220 - i * 2);
    const data = makeData(closes);
    const entry = [{ type: "cross", fast: { kind: "sma", period: 5 }, slow: { kind: "sma", period: 20 }, dir: "above" }];
    const noStop = backtest({ name: "n", direction: "long_flat", entry }, data);
    const trailed = backtest({ name: "t", direction: "long_flat", entry, trailingStop: { type: "atr", period: 14, mult: 1 } }, data);
    expect(trailed.ok).toBe(true);
    expect(trailed.counts.exposure).toBeLessThan(noStop.counts.exposure);
  });

  it("self-proof still holds with the widened engine (benchmark == adjClose ratio)", () => {
    const closes = wave(200);
    const data = makeData(closes);
    const res = backtest({ name: "x", direction: "long_flat", entry: [{ type: "cross", fast: { kind: "ema", period: 5 }, slow: { kind: "ema", period: 20 }, dir: "above" }] }, data, { commissionBps: 3, slippageBps: 3 });
    const w = res.window.bars;
    const a = closes;
    const expected = a[a.length - 1] / a[a.length - w - 1] - 1;
    expect(Math.abs(res.metrics.benchmark.totalReturn - expected)).toBeLessThan(1e-9);
  });
});
