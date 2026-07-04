import { describe, it, expect } from "vitest";
import { checkIntegrity } from "../data/integrity.js";
import { buildManifest } from "../../scripts/lib/manifest.mjs";
import { backtest } from "../engine/backtest.js";

// helper: build a clean daily series of `n` bars
function series(n, klass = "equity", startPrice = 100) {
  const rows = [];
  let p = startPrice;
  for (let i = 0; i < n; i++) {
    p *= 1.001;
    rows.push({
      date: new Date(Date.UTC(2020, 0, 1 + i)).toISOString().slice(0, 10),
      open: +p.toFixed(4), high: +(p * 1.01).toFixed(4), low: +(p * 0.99).toFixed(4),
      close: +p.toFixed(4), adjClose: +p.toFixed(4), volume: 1000,
    });
  }
  return { id: "T", symbol: "T", name: "T", klass, rows };
}

describe("checkIntegrity", () => {
  it("passes a clean, long-enough series", () => {
    const r = checkIntegrity(series(100));
    expect(r.ok).toBe(true);
    expect(r.issues.length).toBe(0);
    expect(r.bars).toBe(100);
  });

  it("fails a series that is too short (fatal)", () => {
    const r = checkIntegrity(series(10));
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.level === "fatal" && /too short/.test(i.text))).toBe(true);
  });

  it("fails on NaN / zero / negative prices (fatal)", () => {
    const d = series(100);
    d.rows[5].close = NaN;
    d.rows[6].open = -3;
    d.rows[7].adjClose = 0;
    const r = checkIntegrity(d);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.level === "fatal" && /NaN|zero|negative/.test(i.text))).toBe(true);
  });

  it("warns (not fatal) on duplicate / out-of-order dates", () => {
    const d = series(100);
    d.rows[50].date = d.rows[49].date; // duplicate
    const r = checkIntegrity(d);
    expect(r.ok).toBe(true);
    expect(r.issues.some((i) => i.level === "warn" && /out-of-order|duplicate/.test(i.text))).toBe(true);
  });

  it("flags a large calendar gap for equities, with a looser limit for crypto", () => {
    const eq = series(100, "equity");
    // shift the second half forward by ~30 days → a big single gap at the seam
    for (let i = 60; i < eq.rows.length; i++) {
      eq.rows[i].date = new Date(Date.UTC(2020, 6, 1 + (i - 60))).toISOString().slice(0, 10);
    }
    expect(checkIntegrity(eq).issues.some((i) => /calendar gap/.test(i.text))).toBe(true);

    // a controlled 3-day gap on a crypto series must NOT flag (crypto limit = 4d)
    const c = series(100, "crypto");
    c.rows[70].date = new Date(new Date(c.rows[69].date).getTime() + 3 * 86400000)
      .toISOString().slice(0, 10);
    for (let i = 71; i < c.rows.length; i++) {
      c.rows[i].date = new Date(new Date(c.rows[i - 1].date).getTime() + 86400000)
        .toISOString().slice(0, 10);
    }
    expect(checkIntegrity(c).issues.some((i) => /calendar gap/.test(i.text))).toBe(false);
  });
});

describe("buildManifest", () => {
  it("summarizes, sorts by history length desc, and drops empty datasets", () => {
    const m = buildManifest([
      { id: "A", symbol: "A", name: "A", klass: "equity", adjusted: true, fillConvention: "nextOpen", source: "src", rows: [{ date: "2020-01-01" }, { date: "2020-01-02" }] },
      { id: "B", symbol: "B", name: "B", klass: "crypto", adjusted: true, fillConvention: "nextClose", source: "cg", rows: [{ date: "2019-01-01" }, { date: "2019-01-02" }, { date: "2019-01-03" }] },
      { id: "EMPTY", symbol: "E", name: "E", rows: [] },
      null,
    ]);
    expect(m.map((x) => x.id)).toEqual(["B", "A"]); // B has more rows
    expect(m[0]).toMatchObject({ id: "B", bars: 3, start: "2019-01-01", end: "2019-01-03", fillConvention: "nextClose" });
    expect(m.find((x) => x.id === "EMPTY")).toBeUndefined();
  });
});

describe("engine self-proof on an ADJUSTED series (adjClose ≠ close)", () => {
  it("buy-and-hold equals the adjusted-close ratio to machine epsilon", () => {
    // dividends: adjClose grows faster than raw close — the two diverge.
    const rows = [];
    let close = 100, adj = 100;
    for (let i = 0; i < 90; i++) {
      close *= 1.003;
      adj *= 1.0035;
      rows.push({
        date: new Date(Date.UTC(2020, 0, 1 + i)).toISOString().slice(0, 10),
        open: +(close * 0.999).toFixed(4), high: +(close * 1.01).toFixed(4),
        low: +(close * 0.99).toFixed(4), close: +close.toFixed(4), adjClose: +adj.toFixed(4), volume: 1000,
      });
    }
    const spec = { name: "x", direction: "long_flat", entry: [{ type: "cross", fast: { kind: "sma", period: 2 }, slow: { kind: "sma", period: 3 }, dir: "above" }] };
    const res = backtest(spec, { id: "T", name: "T", symbol: "T", rows });
    const w = res.window.bars;
    const a = rows.map((r) => r.adjClose);
    const expected = a[a.length - 1] / a[a.length - w - 1] - 1;
    expect(Math.abs(res.metrics.benchmark.totalReturn - expected)).toBeLessThan(1e-12);
  });
});
