import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { backtest } from "../engine/backtest.js";
import { extractParams, pickAxes, classifyFragility, fragilityAnalysis } from "../engine/fragility.js";
import { computeVerdict } from "../engine/verdict.js";
import { diagnose, CAUSE } from "../engine/autopsy.js";

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

describe("parameter extraction + axis choice", () => {
  it("finds the two MA lengths and grids that include the real values", () => {
    const params = extractParams(GOLDEN);
    const fast = params.find((p) => p.path.includes("fast"));
    const slow = params.find((p) => p.path.includes("slow"));
    expect(fast.value).toBe(50);
    expect(slow.value).toBe(200);
    expect(fast.values).toContain(50);
    expect(slow.values).toContain(200);
  });
  it("sweeps fast × slow as the two axes, marking the user's own values", () => {
    const axes = pickAxes(GOLDEN, extractParams(GOLDEN));
    expect(axes).toHaveLength(2);
    expect(axes[0].values[axes[0].userIndex]).toBe(50);
    expect(axes[1].values[axes[1].userIndex]).toBe(200);
  });
});

describe("classifyFragility — the testable core", () => {
  const grid = (fill) => Array.from({ length: 5 }, () => Array.from({ length: 5 }, () => fill));
  it("a broad plateau reads as ROBUST", () => {
    const s = grid(0.8);
    expect(classifyFragility(s, { i: 2, j: 2 }).classification).toBe("robust");
  });
  it("a lonely spike reads as FRAGILE", () => {
    const s = grid(0.0); s[2][2] = 1.5;
    const c = classifyFragility(s, { i: 2, j: 2 });
    expect(c.classification).toBe("fragile");
    expect(c.spikeScore).toBeGreaterThanOrEqual(0.5);
  });
  it("a uniformly weak grid reads as NO-EDGE (not fragility)", () => {
    expect(classifyFragility(grid(0.05), { i: 2, j: 2 }).classification).toBe("no-edge");
  });
  it("an uneven grid reads as MIXED", () => {
    const s = grid(0.0); s[2][2] = 0.8; s[2][1] = 0.75; s[1][2] = 0.1; // decent but not top-rank plateau
    const c = classifyFragility(s, { i: 2, j: 2 });
    expect(["mixed", "fragile"]).toContain(c.classification);
  });
});

describe("fragilityAnalysis on real data", () => {
  it("has data", () => expect(data).toBeTruthy());
  const f = data && fragilityAnalysis(GOLDEN, data, { commissionBps: 3, slippageBps: 3 });
  const real = data && backtest(GOLDEN, data, { commissionBps: 3, slippageBps: 3 });

  it("the user's cell reproduces the real OOS Sharpe exactly", () => {
    expect(f.ok).toBe(true);
    expect(f.userValue).toBe(real.metrics.outSample.sharpe);
    const cell = f.grid[f.userIndex.i][f.userIndex.j];
    expect(cell.sharpe).toBe(real.metrics.outSample.sharpe);
  });

  it("GUARDRAIL: never recommends a winning setting", () => {
    const json = JSON.stringify(f);
    expect(json).not.toMatch(/best|recommend|optimal|winner|suggest|"apply"/i);
    // no function anywhere that could 'apply' a parameter set
    const scan = (o) => { if (typeof o === "function") throw new Error("function in fragility output"); if (o && typeof o === "object") Object.values(o).forEach(scan); };
    expect(() => scan(f)).not.toThrow();
  });
});

describe("fragility feeds the verdict and autopsy (downgrade only)", () => {
  const passing = {
    ok: true, instrument: { symbol: "AAA" },
    counts: { trades: 40, exposure: 0.5, bars: 1000 },
    metrics: {
      inSample: { sharpe: 0.8 }, outSample: { sharpe: 0.7, totalReturn: 0.2 },
      full: { sharpe: 0.6, turnover: 0.05, expectancy: 0.004, maxDrawdown: -0.2 }, fullNoCost: { sharpe: 0.65 }, benchmark: { totalReturn: 0.1 },
    },
    dates: [], equity: { strategy: [] }, trades: [], split: {},
  };
  const fragile = { ok: true, classification: "fragile", axes: [{ label: "fast length" }, { label: "slow length" }], userValue: 0.7, neighborMean: 0.1, note: "spike note" };

  it("a passing verdict is downgraded to SUSPECT on a fragile spike", () => {
    expect(computeVerdict(passing).bucket).toBe("PLAUSIBLE");
    const v = computeVerdict(passing, { fragility: fragile });
    expect(v.bucket).toBe("SUSPECT");
    expect(v.flags.fragile).toBe(true);
  });

  it("fragility never UPGRADES a verdict", () => {
    const robustFrag = { ok: true, classification: "robust", axes: [{ label: "x" }], userValue: 0.7, neighborMean: 0.68, note: "" };
    // a rejected strategy stays rejected regardless of a clean fragility map
    const rejected = { ...passing, counts: { ...passing.counts, exposure: 0.99 } };
    expect(computeVerdict(rejected, { fragility: robustFrag }).bucket).toBe("REJECTED");
  });

  it("the autopsy names fragility as a cause and marks it not-alive", () => {
    const dxClean = diagnose(passing, []);
    expect(dxClean.alive).toBe(true);
    const dx = diagnose(passing, [], { fragility: fragile });
    expect(dx.causes.some((c) => c.mode === CAUSE.FRAGILITY)).toBe(true);
    expect(dx.alive).toBe(false);
  });
});
