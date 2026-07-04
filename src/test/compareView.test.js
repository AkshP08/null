import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { backtest } from "../engine/backtest.js";
import { commonRange, compareMetrics, buildCompareView } from "../ui/compareView.js";

// Compare mode (Prompt 13): overlay two strategies (or a strategy vs
// buy-and-hold / a classic) on one chart + metrics table. The comparator is a
// REAL backtest recomputed through the worker; this module only aligns and
// re-indexes the two curves view-side. The tests below prove the alignment is
// honest by tying the compare metrics back to the engine's OWN metric outputs.

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "public", "data");
function longestInstrument() {
  if (!existsSync(DATA_DIR)) return null;
  const files = readdirSync(DATA_DIR).filter((f) => f.endsWith(".json") && f !== "manifest.json");
  return files
    .map((f) => JSON.parse(readFileSync(join(DATA_DIR, f), "utf8")))
    .sort((a, b) => (b.rows?.length || 0) - (a.rows?.length || 0))[0];
}
const data = longestInstrument();
const CFG = { commissionBps: 3, slippageBps: 3 };
const GOLDEN = {
  name: "golden cross",
  direction: "long_flat",
  entry: [{ type: "cross", fast: { kind: "sma", period: 50 }, slow: { kind: "sma", period: 200 }, dir: "above" }],
};
const RSI = {
  name: "rsi reversion",
  direction: "long_flat",
  entry: [{ type: "threshold", indicator: { kind: "rsi", period: 14 }, op: "<", value: 30 }],
  exit: [{ type: "threshold", indicator: { kind: "rsi", period: 14 }, op: ">", value: 60 }],
};

describe("compare view alignment", () => {
  it("has data to build against", () => expect(data).toBeTruthy());

  const A = data && backtest(GOLDEN, data, CFG);
  const B = data && backtest(RSI, data, CFG);

  it("commonRange is the overlap of two subsequences of the same calendar", () => {
    const r = commonRange(A.dates, B.dates);
    expect(r.start).toBe(A.dates[0] > B.dates[0] ? A.dates[0] : B.dates[0]);
    expect(r.end).toBe(A.dates.at(-1) < B.dates.at(-1) ? A.dates.at(-1) : B.dates.at(-1));
    expect(commonRange(["2020-01-02"], ["2019-01-01"])).toBe(null);
  });

  // The strongest honesty check: strategy vs its OWN buy-and-hold share dates,
  // so the common window IS the full window and compareMetrics must reproduce
  // the engine's metrics.full / metrics.benchmark to machine epsilon.
  it("strategy-vs-buy&hold metrics equal the engine's metrics.full / benchmark exactly", () => {
    const view = buildCompareView(
      { dates: A.dates, returns: A.returns.strategy, label: "strategy" },
      { dates: A.dates, returns: A.returns.benchmark, label: "buy & hold" },
    );
    expect(view.ok).toBe(true);
    for (const k of ["totalReturn", "cagr", "sharpe", "annualizedVol", "maxDrawdown"]) {
      expect(view.a.metrics[k]).toBe(A.metrics.full[k]);
      expect(view.b.metrics[k]).toBe(A.metrics.benchmark[k]);
    }
  });

  it("compareMetrics is exactly the engine metric functions over the same returns", () => {
    const m = compareMetrics(A.returns.strategy);
    expect(m.totalReturn).toBe(A.metrics.full.totalReturn);
    expect(m.sharpe).toBe(A.metrics.full.sharpe);
    expect(m.maxDrawdown).toBe(A.metrics.full.maxDrawdown);
    expect(m.bars).toBe(A.returns.strategy.length);
  });

  it("both lines re-index to 100 at the shared start and align date-for-date", () => {
    const view = buildCompareView(
      { dates: A.dates, returns: A.returns.strategy, label: "golden" },
      { dates: B.dates, returns: B.returns.strategy, label: "rsi" },
    );
    expect(view.ok).toBe(true);
    expect(view.a.line[0].value).toBeCloseTo(100, 9);
    expect(view.b.line[0].value).toBeCloseTo(100, 9);
    expect(view.a.line[0].time).toBe(view.start);
    expect(view.b.line[0].time).toBe(view.start);
    // Same shared calendar → identical time axis for both overlaid lines.
    expect(view.a.line.length).toBe(view.b.line.length);
    for (let k = 0; k < view.a.line.length; k++) {
      expect(view.a.line[k].time).toBe(view.b.line[k].time);
    }
    expect(view.a.line.at(-1).time).toBe(view.end);
  });

  it("the re-indexed line endpoint matches the window's compounded return", () => {
    const view = buildCompareView(
      { dates: A.dates, returns: A.returns.strategy, label: "golden" },
      { dates: B.dates, returns: B.returns.strategy, label: "rsi" },
    );
    const last = view.a.line.at(-1).value;
    expect(last).toBeCloseTo(100 * (1 + view.a.metrics.totalReturn), 6);
  });

  it("reports no-overlap rather than inventing data for disjoint series", () => {
    const view = buildCompareView(
      { dates: ["2000-01-01", "2000-01-02"], returns: [0.01], label: "x" },
      { dates: ["2010-01-01", "2010-01-02"], returns: [0.01], label: "y" },
    );
    expect(view.ok).toBe(false);
    expect(view.reason).toBe("no-overlap");
  });
});
