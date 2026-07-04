import { describe, it, expect } from 'vitest';
import { sma, ema, rsi, rollingExtreme } from '../engine/indicators.js';

const close = (a, b, tol = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(tol);

describe('sma', () => {
  it('is null during warmup, then the trailing mean (point-in-time)', () => {
    const out = sma([1, 2, 3, 4, 5], 3);
    expect(out[0]).toBeNull();
    expect(out[1]).toBeNull();
    close(out[2], 2); // (1+2+3)/3
    close(out[3], 3); // (2+3+4)/3
    close(out[4], 4); // (3+4+5)/3
  });
  it('uses only data up to index t (no look-ahead)', () => {
    // changing a FUTURE value must not change an earlier output
    const a = sma([1, 2, 3, 100, 5], 3);
    const b = sma([1, 2, 3, 4, 5], 3);
    close(a[2], b[2]); // index 2 identical despite differing index 3
  });
});

describe('ema', () => {
  it('seeds with SMA then applies the smoothing constant', () => {
    const out = ema([1, 2, 3, 4], 3);
    expect(out[1]).toBeNull();
    close(out[2], 2); // seed = SMA(1,2,3) = 2
    const k = 2 / (3 + 1);
    close(out[3], 4 * k + 2 * (1 - k)); // next EMA
  });
});

describe('rsi', () => {
  it('is 100 when every change is a gain', () => {
    const out = rsi([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16], 14);
    expect(out[14]).toBe(100);
  });
  it('matches the classic Wilder worked example (~70.46)', () => {
    // canonical 15-close example used in TA references
    const closes = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28];
    const out = rsi(closes, 14);
    close(out[14], 70.46, 0.1);
  });
  it('warmup entries are null', () => {
    const out = rsi([1, 2, 3], 14);
    expect(out[2]).toBeNull();
  });
});

describe('rollingExtreme', () => {
  it('looks at the PRIOR n bars only (excludes current)', () => {
    const out = rollingExtreme([1, 5, 3, 2, 9], 2, 'high');
    expect(out[0]).toBeNull();
    expect(out[1]).toBeNull();
    close(out[2], 5); // max of [1,5]
    close(out[3], 5); // max of [5,3]
    close(out[4], 3); // max of [3,2]  (excludes the 9 at idx4)
  });
});
