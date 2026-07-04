import { describe, it, expect } from "vitest";
import { roc, macdLine, macdSignal, bollinger, atr, computeIndicator } from "../engine/indicators.js";

const close = (a, b, tol = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(tol);

describe("roc", () => {
  it("is percent change over the lookback (null during warmup)", () => {
    const out = roc([100, 110, 121], 1);
    expect(out[0]).toBeNull();
    close(out[1], 10); // 110/100 - 1
    close(out[2], 10); // 121/110 - 1
    close(roc([100, 110, 121], 2)[2], 21); // 121/100 - 1
  });
});

describe("macdLine / macdSignal (hand-computed with fast=2, slow=3)", () => {
  // ema2([1,2,3,4,5]) = [-, 1.5, 2.5, 3.5, 4.5]; ema3 = [-, -, 2, 3, 4]
  it("MACD line = EMA(fast) − EMA(slow)", () => {
    const line = macdLine([1, 2, 3, 4, 5], 2, 3);
    expect(line[0]).toBeNull();
    expect(line[1]).toBeNull();
    close(line[2], 0.5);
    close(line[3], 0.5);
    close(line[4], 0.5);
  });
  it("signal line = EMA(signal) of the MACD line", () => {
    // macd compact = [0.5,0.5,0.5]; ema2 of it = [-,0.5,0.5] → full [-,-,-,0.5,0.5]
    const sig = macdSignal([1, 2, 3, 4, 5], 2, 3, 2);
    expect(sig[2]).toBeNull();
    close(sig[3], 0.5);
    close(sig[4], 0.5);
  });
  it("MACD of a constant series is zero", () => {
    const line = macdLine([5, 5, 5, 5, 5, 5], 2, 3);
    close(line[5], 0);
  });
});

describe("bollinger (period=3, mult=2)", () => {
  it("middle is SMA and bands are ±mult·population σ", () => {
    const { middle, upper, lower } = bollinger([2, 4, 6, 8, 10], 3, 2);
    expect(middle[1]).toBeNull();
    close(middle[2], 4); // (2+4+6)/3
    const sd = Math.sqrt(((2 - 4) ** 2 + 0 + (6 - 4) ** 2) / 3); // sqrt(8/3)
    close(upper[2], 4 + 2 * sd);
    close(lower[2], 4 - 2 * sd);
  });
});

describe("atr (Wilder, period=2)", () => {
  it("matches a hand-computed true-range sequence", () => {
    const high = [10, 12, 11, 13];
    const low = [8, 9, 9, 10];
    const cls = [9, 11, 10, 12];
    // TR = [2, 3, 2, 3]; first ATR (period 2) = mean(TR[1..2]) = 2.5; next = (2.5+3)/2 = 2.75
    const out = atr(high, low, cls, 2);
    expect(out[1]).toBeNull();
    close(out[2], 2.5);
    close(out[3], 2.75);
  });
});

describe("computeIndicator routes the new close-based kinds", () => {
  it("resolves roc / macd / bollinger bands via computeIndicator", () => {
    const s = [1, 2, 3, 4, 5, 6];
    expect(computeIndicator({ kind: "roc", period: 1 }, s)[2]).not.toBeNull();
    expect(computeIndicator({ kind: "macd", fast: 2, slow: 3 }, s)[3]).not.toBeNull();
    expect(computeIndicator({ kind: "bbUpper", period: 3, mult: 2 }, s)[3]).not.toBeNull();
    expect(computeIndicator({ kind: "bbLower", period: 3, mult: 2 }, s)[3]).not.toBeNull();
  });
});
