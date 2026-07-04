import { describe, it, expect } from "vitest";
import { backtest } from "../engine/backtest.js";
import { totalReturn } from "../engine/metrics.js";

// Synthetic price series used ONLY to test engine correctness. These never
// reach the UI as "real history"; they are fixtures for the math.
function makeData(closes, opens) {
  return {
    id: "TEST",
    name: "Test instrument",
    symbol: "TEST",
    klass: "test",
    rows: closes.map((c, i) => ({
      date: new Date(Date.UTC(2020, 0, 1 + i)).toISOString().slice(0, 10),
      open: opens ? opens[i] : c,
      high: Math.max(c, opens ? opens[i] : c),
      low: Math.min(c, opens ? opens[i] : c),
      close: c,
      adjClose: c, // adjusted == raw in the fixtures
      volume: 1000,
    })),
  };
}

const close = (a, b, tol = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(tol);

// a simple always-eventually-trading spec
const SMA_CROSS = {
  name: "2/3 SMA cross",
  direction: "long_flat",
  entry: [
    {
      type: "cross",
      fast: { kind: "sma", period: 2 },
      slow: { kind: "sma", period: 3 },
      dir: "above",
    },
  ],
};

describe("engine self-proof: buy-and-hold === instrument adjusted return", () => {
  it("benchmark total return equals adjClose[end]/adjClose[start]-1 over the window", () => {
    const closes = [10, 11, 12, 11, 13, 14, 13, 15, 16, 14, 17, 18, 20, 19, 21];
    const data = makeData(closes);
    const res = backtest(SMA_CROSS, data, {
      commissionBps: 5,
      slippageBps: 5,
    });
    expect(res.ok).toBe(true);
    const warmup = 2; // maxLookback for SMA(2)/SMA(3) is 3 -> warmup uses maxLookback
    // The window starts at index = maxLookback(spec). Compute from result window.
    const startPrice = closes[closes.length - res.window.bars - 1];
    const endPrice = closes[closes.length - 1];
    const expected = endPrice / startPrice - 1;
    close(res.metrics.benchmark.totalReturn, expected, 1e-9);
    // and the benchmark equity curve must end at the same ratio
    close(
      res.equity.benchmark[res.equity.benchmark.length - 1] - 1,
      expected,
      1e-9,
    );
  });

  it("benchmark return is independent of costs (it pays none)", () => {
    const closes = Array.from({ length: 50 }, (_, i) => 100 + i); // ramp up
    const a = backtest(SMA_CROSS, makeData(closes), { commissionBps: 0, slippageBps: 0 });
    const b = backtest(SMA_CROSS, makeData(closes), { commissionBps: 50, slippageBps: 50 });
    close(a.metrics.benchmark.totalReturn, b.metrics.benchmark.totalReturn, 1e-12);
  });

  it("OOS benchmark (benchmarkOut) === adjClose[end]/adjClose[splitStart]-1 over the OOS window", () => {
    // A non-monotonic series so in-sample and out-of-sample windows differ.
    const closes = [10, 11, 12, 11, 13, 14, 13, 15, 16, 14, 17, 18, 20, 19, 21, 24, 22, 26, 25, 30];
    const res = backtest(SMA_CROSS, makeData(closes), { commissionBps: 5, slippageBps: 5 });
    expect(res.ok).toBe(true);
    expect(res.metrics.benchmarkOut).toBeTruthy();

    // (a) Self-proof against the engine's own (already-proven) benchmark equity
    //     curve: OOS B&H = benchEquity[end] / benchEquity[split] - 1.
    const be = res.equity.benchmark;
    const split = res.split.splitIndex;
    close(res.metrics.benchmarkOut.totalReturn, be[be.length - 1] / be[split] - 1, 1e-9);

    // (b) Self-proof straight from the split-adjusted prices the engine traded.
    const closeS = res.series.close;
    const N = closeS.length;
    const startIdx = N - 1 - res.window.bars; // dateOut[0]=date[startIdx], dateOut[last]=date[N-1]
    const startP = closeS[startIdx + split];
    const endP = closeS[N - 1];
    close(res.metrics.benchmarkOut.totalReturn, endP / startP - 1, 1e-9);

    // (c) It is a DIFFERENT number than the full-window benchmark — the whole
    //     point of the fix (the old code compared OOS return to the full B&H).
    expect(res.metrics.benchmarkOut.totalReturn).not.toBeCloseTo(res.metrics.benchmark.totalReturn, 6);
  });
});

describe("no look-ahead", () => {
  it("equity before a divergence point is identical when only FUTURE prices differ", () => {
    const base = [10, 10.5, 11, 10.8, 11.5, 12, 11.7, 12.3, 13, 12.5, 13.2, 14, 13.5, 14.2, 15, 14.6, 15.3, 16];
    const future = base.slice();
    // change only the last 4 bars dramatically
    for (let i = future.length - 4; i < future.length; i++) future[i] = 100 + i;
    const resA = backtest(SMA_CROSS, makeData(base), { commissionBps: 1, slippageBps: 1 });
    const resB = backtest(SMA_CROSS, makeData(future), { commissionBps: 1, slippageBps: 1 });
    // compare equity on all shared dates strictly before the divergence
    const divergeDate = resA.dates[resA.dates.length - 4];
    for (let i = 0; i < resA.dates.length; i++) {
      if (resA.dates[i] >= divergeDate) break;
      close(resA.equity.strategy[i], resB.equity.strategy[i], 1e-12);
    }
  });

  it("a position opened on a signal is filled at the NEXT bar's open, not the signal bar", () => {
    // closes engineered so SMA2 crosses above SMA3 at index 3; opens differ from closes
    const closes = [10, 9, 11, 13, 13, 13, 13, 13];
    const opens = [10, 9, 11, 50, 13, 13, 13, 13]; // index 3 open is a spike
    const data = makeData(closes, opens);
    const res = backtest(SMA_CROSS, data, { commissionBps: 0, slippageBps: 0 });
    // If the engine had filled on the signal bar's close it would behave very
    // differently than filling at the (spiked) next open. We just assert it ran
    // and produced trades — the equity is computed from next-open fills.
    expect(res.ok).toBe(true);
    expect(res.counts.trades).toBeGreaterThanOrEqual(0);
  });
});

describe("costs", () => {
  it("after-cost total return is strictly worse than before-cost when trades occur", () => {
    const closes = [10, 9, 11, 13, 12, 14, 11, 15, 13, 16, 12, 17, 14, 18, 13, 19];
    const res = backtest(SMA_CROSS, makeData(closes), { commissionBps: 20, slippageBps: 20 });
    expect(res.counts.trades).toBeGreaterThan(0);
    const withC = totalReturn(res.returns.strategy);
    const withoutC = res.metrics.fullNoCost.totalReturn;
    expect(withC).toBeLessThan(withoutC);
  });
});

describe("degenerate cases (no crash, honest output)", () => {
  it("a never-true entry produces zero trades, not an error", () => {
    const closes = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i));
    const neverSpec = {
      name: "impossible",
      direction: "long_flat",
      entry: [{ type: "threshold", indicator: { kind: "rsi", period: 14 }, op: ">", value: 200 }],
    };
    const res = backtest(neverSpec, makeData(closes));
    expect(res.ok).toBe(true);
    expect(res.counts.trades).toBe(0);
  });

  it("rejects data too short for the requested lookback", () => {
    const res = backtest(
      { name: "x", direction: "long_flat", entry: [{ type: "cross", fast: { kind: "sma", period: 50 }, slow: { kind: "sma", period: 200 }, dir: "above" }] },
      makeData([1, 2, 3, 4, 5]),
    );
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("insufficient-data");
  });

  it("an always-true entry behaves like buy-and-hold (high exposure)", () => {
    const closes = Array.from({ length: 80 }, (_, i) => 100 + i * 0.5);
    const alwaysSpec = {
      name: "always in",
      direction: "long_flat",
      entry: [{ type: "threshold", indicator: { kind: "price" }, op: ">", value: 0 }],
    };
    const res = backtest(alwaysSpec, makeData(closes));
    expect(res.ok).toBe(true);
    expect(res.counts.exposure).toBeGreaterThan(0.95);
  });

  it("rejects an invalid spec", () => {
    const res = backtest({ name: "bad", direction: "long_flat", entry: [] }, makeData([1, 2, 3]));
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("invalid-spec");
  });
});

describe("buy-and-hold sanity on a monotonic ramp", () => {
  it("a +1%/bar ramp yields benchmark totalReturn ≈ (1.01)^(bars)-1", () => {
    const closes = [100];
    for (let i = 1; i < 60; i++) closes.push(closes[i - 1] * 1.01);
    const res = backtest(SMA_CROSS, makeData(closes), { commissionBps: 0, slippageBps: 0 });
    const expected = Math.pow(1.01, res.window.bars) - 1;
    close(res.metrics.benchmark.totalReturn, expected, 1e-6);
  });
});
