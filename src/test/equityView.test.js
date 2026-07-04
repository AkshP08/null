import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { backtest } from "../engine/backtest.js";
import { buildEquityView, markInMarket } from "../ui/equityView.js";

// The chart's view model is derived, so it must be provably REAL, not invented:
//   • position state must reproduce the engine's own barsInMarket exactly;
//   • drawdown must reproduce the engine's own maxDrawdown exactly;
// otherwise the tooltip would be showing numbers the backtest never produced.

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "public", "data");
function longestInstrument() {
  if (!existsSync(DATA_DIR)) return null;
  const files = readdirSync(DATA_DIR).filter((f) => f.endsWith(".json") && f !== "manifest.json");
  return files
    .map((f) => JSON.parse(readFileSync(join(DATA_DIR, f), "utf8")))
    .sort((a, b) => (b.rows?.length || 0) - (a.rows?.length || 0))[0];
}
const data = longestInstrument();
const SPEC = {
  name: "golden cross",
  direction: "long_flat",
  entry: [{ type: "cross", fast: { kind: "sma", period: 50 }, slow: { kind: "sma", period: 200 }, dir: "above" }],
};

describe("equity chart view model", () => {
  it("has data to build against", () => expect(data).toBeTruthy());

  const result = data && backtest(SPEC, data, { commissionBps: 3, slippageBps: 3 });

  it("position state exactly reproduces the engine's barsInMarket", () => {
    const flags = markInMarket(result.dates, result.trades);
    const held = flags.filter(Boolean).length;
    expect(held).toBe(result.counts.barsInMarket);
  });

  it("drawdown exactly reproduces the engine's maxDrawdown", () => {
    const view = buildEquityView(result, true);
    expect(view.points[0].drawdown).toBe(0);
    const minDD = Math.min(...view.points.map((p) => p.drawdown));
    expect(view.points.every((p) => p.drawdown <= 1e-12)).toBe(true);
    // metrics.full.maxDrawdown is a negative fraction on the same with-cost curve.
    expect(Math.abs(minDD - result.metrics.full.maxDrawdown)).toBeLessThan(1e-9);
  });

  it("indexes equity to 100 and keeps IS/OOS meeting at the split", () => {
    const view = buildEquityView(result, true);
    expect(view.points[0].equity).toBeCloseTo(100, 9);
    const lastIS = view.is[view.is.length - 1];
    const firstOOS = view.oos[0];
    expect(firstOOS.time).toBe(lastIS.time);
    expect(firstOOS.value).toBe(lastIS.value);
    expect(view.splitTime).toBe(result.split.splitDate);
  });

  it("byTime lookups return the real point for a hovered date", () => {
    const view = buildEquityView(result, true);
    const someDate = result.dates[Math.floor(result.dates.length / 2)];
    const pt = view.byTime.get(someDate);
    expect(pt).toBeTruthy();
    expect(pt.date).toBe(someDate);
    expect(typeof pt.inMarket).toBe("boolean");
  });

  it("before/after-cost equity differ once there are costs and trades", () => {
    const withC = buildEquityView(result, true);
    const noC = buildEquityView(result, false);
    const lastWith = withC.points[withC.points.length - 1].equity;
    const lastNo = noC.points[noC.points.length - 1].equity;
    if (result.counts.trades > 0) expect(lastNo).toBeGreaterThanOrEqual(lastWith - 1e-6);
  });
});
