import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { backtest } from "../engine/backtest.js";
import { sma } from "../engine/indicators.js";
import { collectIndicators, buildPriceModel, enrichTrades } from "../ui/overlays.js";
import { chartAnchors } from "../engine/autopsy.js";

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "public", "data");
function longest() {
  if (!existsSync(DATA_DIR)) return null;
  return readdirSync(DATA_DIR)
    .filter((f) => f.endsWith(".json") && f !== "manifest.json")
    .map((f) => JSON.parse(readFileSync(join(DATA_DIR, f), "utf8")))
    .sort((a, b) => (b.rows?.length || 0) - (a.rows?.length || 0))[0];
}
const data = longest();
const GOLDEN = {
  name: "golden cross", direction: "long_flat",
  entry: [{ type: "cross", fast: { kind: "sma", period: 50 }, slow: { kind: "sma", period: 200 }, dir: "above" }],
};
const RSI = {
  name: "rsi reversion", direction: "long_flat",
  entry: [{ type: "threshold", indicator: { kind: "rsi", period: 14 }, op: "<", value: 30 }],
  exit: [{ type: "threshold", indicator: { kind: "rsi", period: 14 }, op: ">", value: 55 }],
};

describe("indicator collection reflects the parsed spec (not defaults)", () => {
  it("golden cross → the two SMAs it actually uses, no oscillator", () => {
    const { priceOverlays, oscillators } = collectIndicators(GOLDEN);
    expect(priceOverlays.map((o) => o.label).sort()).toEqual(["SMA 200", "SMA 50"]);
    expect(oscillators).toHaveLength(0);
  });

  it("rsi strategy → an RSI oscillator carrying the spec's own thresholds", () => {
    const { priceOverlays, oscillators } = collectIndicators(RSI);
    expect(priceOverlays).toHaveLength(0);
    expect(oscillators).toHaveLength(1);
    expect(oscillators[0].label).toBe("RSI 14");
    const vals = oscillators[0].thresholds.map((t) => t.value).sort((a, b) => a - b);
    expect(vals).toEqual([30, 55]);
  });
});

describe("overlays are the engine's real indicator values", () => {
  it("has data", () => expect(data).toBeTruthy());
  const result = data && backtest(GOLDEN, data, { commissionBps: 3, slippageBps: 3 });

  it("SMA overlay equals sma() on the engine's own adjusted close, aligned to the window", () => {
    const model = buildPriceModel(result, GOLDEN);
    const sma50 = model.overlays.find((o) => o.label === "SMA 50");
    expect(sma50.data.length).toBeGreaterThan(0);
    const ref = sma(result.series.close, 50);
    const w = result.series.date.indexOf(result.dates[0]);
    // first plotted overlay point should be the true (fully warmed) value
    const first = sma50.data[0];
    const idx = result.series.date.indexOf(first.time);
    expect(idx).toBeGreaterThanOrEqual(w);
    expect(first.value).toBe(ref[idx]);
    // price line starts at the window start
    expect(model.priceLine[0].time).toBe(result.dates[0]);
  });
});

describe("trade drill-down values are the engine's real records", () => {
  const result = data && backtest(GOLDEN, data, { commissionBps: 3, slippageBps: 3 });

  it("entry/exit prices are the adjusted opens the engine filled at", () => {
    const trades = enrichTrades(result);
    if (!trades.length) return;
    const closed = result.trades.find((t) => !t.open);
    if (closed) {
      expect(closed.entryPrice).toBe(result.series.open[closed.entryIndex]);
      expect(closed.exitPrice).toBe(result.series.open[closed.exitIndex]);
    }
  });

  it("cost paid is a real, positive round-trip cost of the right magnitude", () => {
    const closed = (result.trades || []).find((t) => !t.open);
    if (!closed) return;
    const costRate = 6 / 10000; // 3bps comm + 3bps slip
    expect(closed.cost).toBeGreaterThan(0);
    // entry+exit ≈ 2× the one-way rate (looser bound for large price moves)
    expect(closed.cost).toBeGreaterThan(costRate * 0.9);
    expect(closed.cost).toBeLessThan(costRate * 6);
  });

  it("win flag agrees with the sign of the real return", () => {
    for (const t of enrichTrades(result)) expect(t.win).toBe(t.ret > 0);
  });
});

describe("chart anchors point at the real worst spots", () => {
  const result = data && backtest(GOLDEN, data, { commissionBps: 3, slippageBps: 3 });

  it("worst-drawdown depth equals the engine's maxDrawdown; dates are ordered", () => {
    const a = chartAnchors(result);
    if (!a.drawdown) return;
    expect(Math.abs(a.drawdown.depth - result.metrics.full.maxDrawdown)).toBeLessThan(1e-9);
    expect(a.drawdown.peakDate <= a.drawdown.troughDate).toBe(true);
    expect(a.drawdown.troughDate <= a.drawdown.endDate).toBe(true);
  });

  it("worst trade is the real minimum-return trade", () => {
    const a = chartAnchors(result);
    if (!a.worstTrade) return;
    const minRet = Math.min(...result.trades.map((t) => t.ret));
    expect(a.worstTrade.ret).toBe(minRet);
  });
});
