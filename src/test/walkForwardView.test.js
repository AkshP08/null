import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { backtest } from "../engine/backtest.js";
import { robustness } from "../engine/robustness.js";
import { windowSlice, windowView } from "../ui/walkForwardView.js";

// Interactive walk-forward (Prompt 13): clicking a window loads that window's
// own equity curve + metrics. Those are reconstructed VIEW-side from the real
// return series — never recomputed through the engine. This test proves the
// reconstruction is honest: each reconstructed window's Sharpe and total return
// must be byte-identical to the engine's own robustness.walkForward figures,
// and the windows must tile the whole series with no gaps or overlaps.

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

describe("walk-forward window view", () => {
  it("has data to build against", () => expect(data).toBeTruthy());

  const result = data && backtest(SPEC, data, { commissionBps: 3, slippageBps: 3 });
  const robust = result && robustness(result);
  const wf = robust?.walkForward;

  it("the fixture produced a usable walk-forward", () => {
    expect(wf?.ok).toBe(true);
    expect(wf.folds).toBeGreaterThanOrEqual(2);
  });

  it("windowSlice tiles the whole return series with no gaps or overlaps", () => {
    const n = result.returns.strategy.length;
    let covered = 0;
    let prevHi = 0;
    for (let i = 0; i < wf.folds; i++) {
      const { lo, hi } = windowSlice(n, wf.folds, i);
      expect(lo).toBe(prevHi); // contiguous
      expect(hi).toBeGreaterThan(lo);
      covered += hi - lo;
      prevHi = hi;
    }
    expect(prevHi).toBe(n); // last window absorbs the remainder
    expect(covered).toBe(n);
  });

  it("each reconstructed window's Sharpe + total return equal the engine's exactly", () => {
    for (let i = 0; i < wf.folds; i++) {
      const v = windowView(result, wf, i);
      expect(v).toBeTruthy();
      // Byte-identical to the engine's own per-window figures — proves the
      // VIEW reconstruction uses the same slice the engine measured.
      expect(v.metrics.sharpe).toBe(wf.windows[i].sharpe);
      expect(v.metrics.totalReturn).toBe(wf.windows[i].totalReturn);
      expect(v.bars).toBe(wf.windows[i].bars);
    }
  });

  it("the window equity curve starts at 100 and ends at the window's real total return", () => {
    for (let i = 0; i < wf.folds; i++) {
      const v = windowView(result, wf, i);
      expect(v.points[0].value).toBeCloseTo(100, 9);
      const last = v.points[v.points.length - 1].value;
      expect(last).toBeCloseTo(100 * (1 + wf.windows[i].totalReturn), 6);
      // one anchor point + one point per bar in the window
      expect(v.points.length).toBe(v.bars + 1);
    }
  });

  it("returns null for out-of-range window indices", () => {
    expect(windowView(result, wf, -1)).toBe(null);
    expect(windowView(result, wf, wf.folds)).toBe(null);
  });
});
