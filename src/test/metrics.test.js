import { describe, it, expect } from 'vitest';
import {
  totalReturn, equityCurve, cagr, annualizedVol, sharpe, sortino,
  maxDrawdown, calmar, tradeStats, computeMetrics, TRADING_DAYS,
} from '../engine/metrics.js';

const close = (a, b, tol = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(tol);

describe('totalReturn', () => {
  it('compounds correctly', () => {
    close(totalReturn([0.1, 0.1]), 0.21); // 1.1*1.1 - 1
  });
  it('handles a loss to zero', () => {
    close(totalReturn([-1]), -1);
  });
  it('empty series → 0', () => {
    close(totalReturn([]), 0);
  });
});

describe('equityCurve', () => {
  it('starts at 1 and tracks compounding', () => {
    const eq = equityCurve([0.1, -0.5]);
    expect(eq.length).toBe(3);
    close(eq[0], 1);
    close(eq[1], 1.1);
    close(eq[2], 0.55);
  });
});

describe('cagr', () => {
  it('doubling over exactly one trading year → 100%', () => {
    const r = Math.pow(2, 1 / TRADING_DAYS) - 1;
    const returns = Array(TRADING_DAYS).fill(r);
    close(cagr(returns), 1.0, 1e-6);
  });
  it('flat returns → 0% CAGR', () => {
    close(cagr(Array(TRADING_DAYS).fill(0)), 0);
  });
});

describe('annualizedVol', () => {
  it('constant returns have zero volatility', () => {
    close(annualizedVol(Array(100).fill(0.01)), 0);
  });
  it('alternating ±x scales by sqrt(252)', () => {
    // returns alternate +0.01 / -0.01 → per-bar stdev = 0.01 (population)
    const r = Array.from({ length: 100 }, (_, i) => (i % 2 ? -0.01 : 0.01));
    close(annualizedVol(r), 0.01 * Math.sqrt(252), 1e-9);
  });
});

describe('sharpe', () => {
  it('zero-stdev series → 0 (no risk-adjusted info)', () => {
    close(sharpe(Array(50).fill(0.001)), 0);
  });
  it('matches a hand-computed example', () => {
    // returns: +1%, -1%, +2%, 0% ; rf=0
    const r = [0.01, -0.01, 0.02, 0.0];
    const mean = (0.01 - 0.01 + 0.02 + 0) / 4; // 0.005
    const variance = ((0.01 - mean) ** 2 + (-0.01 - mean) ** 2 + (0.02 - mean) ** 2 + (0 - mean) ** 2) / 4;
    const sd = Math.sqrt(variance);
    const expected = (mean / sd) * Math.sqrt(252);
    close(sharpe(r), expected, 1e-12);
  });
});

describe('sortino', () => {
  it('no downside → 0 (per our guard)', () => {
    close(sortino([0.01, 0.02, 0.0]), 0);
  });
  it('matches hand-computed downside deviation', () => {
    const r = [0.02, -0.01, 0.03, -0.02];
    const mean = (0.02 - 0.01 + 0.03 - 0.02) / 4; // 0.005
    const dsq = ((-0.01) ** 2 + (-0.02) ** 2) / 4; // only negatives, divided by N
    const dd = Math.sqrt(dsq);
    close(sortino(r), (mean / dd) * Math.sqrt(252), 1e-12);
  });
});

describe('maxDrawdown', () => {
  it('computes the worst peak-to-trough', () => {
    // equity: 1 → 1.2 → 0.9 → 1.0   (returns below)
    const returns = [0.2, 0.9 / 1.2 - 1, 1.0 / 0.9 - 1];
    const dd = maxDrawdown(returns);
    close(dd.maxDrawdown, 0.9 / 1.2 - 1, 1e-9); // -0.25
  });
  it('monotonic up → no drawdown', () => {
    close(maxDrawdown([0.01, 0.01, 0.01]).maxDrawdown, 0);
  });
  it('reports duration from peak to recovery', () => {
    // 1 → 1.2(peak,idx1) → 0.9 → 1.0 → 1.3(recovered, idx4)
    const eq = [1, 1.2, 0.9, 1.0, 1.3];
    const returns = eq.slice(1).map((v, i) => v / eq[i] - 1);
    const dd = maxDrawdown(returns);
    expect(dd.peakIndex).toBe(1);
    expect(dd.durationBars).toBe(3); // idx1 → idx4
  });
});

describe('calmar', () => {
  it('is CAGR over |maxDD|', () => {
    const returns = [0.2, 0.9 / 1.2 - 1, 1.0 / 0.9 - 1];
    const expected = cagr(returns) / Math.abs(maxDrawdown(returns).maxDrawdown);
    close(calmar(returns), expected, 1e-9);
  });
});

describe('tradeStats', () => {
  it('computes win rate, profit factor and expectancy', () => {
    const trades = [{ ret: 0.1 }, { ret: -0.05 }, { ret: 0.2 }, { ret: -0.05 }];
    const s = tradeStats(trades);
    expect(s.count).toBe(4);
    close(s.winRate, 0.5);
    close(s.avgWin, 0.15); // (0.1+0.2)/2
    close(s.avgLoss, -0.05);
    close(s.profitFactor, 0.3 / 0.1); // grossWin/|grossLoss| = 0.3/0.1 = 3
    close(s.expectancy, (0.1 - 0.05 + 0.2 - 0.05) / 4);
  });
  it('empty → zeros', () => {
    const s = tradeStats([]);
    expect(s.count).toBe(0);
    expect(s.profitFactor).toBe(0);
  });
});

describe('computeMetrics', () => {
  it('reports exposure and turnover from counts', () => {
    const m = computeMetrics([0.01, -0.01], [], { barsInMarket: 1, totalBars: 2, fillCount: 2 });
    close(m.exposure, 0.5);
    close(m.turnover, 1);
  });
});
