import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { backtest } from "../engine/backtest.js";
import { robustness } from "../engine/robustness.js";
import { runJob, sliceByDate } from "../engine/workerCore.js";

// Prompt 9 parity guard: moving the engine into a Web Worker must NOT change
// what it computes. `runJob` is the exact unit the worker executes; here we run
// it and compare, field-for-field, against calling the engine synchronously the
// old way — and then against the same object after a structuredClone round-trip
// (the postMessage boundary the worker actually crosses). Everything must be
// byte-identical to machine epsilon: same numbers, same trades, same robustness.

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "public", "data");

function loadInstruments() {
  if (!existsSync(DATA_DIR)) return [];
  return readdirSync(DATA_DIR)
    .filter((f) => f.endsWith(".json") && f !== "manifest.json")
    .map((f) => JSON.parse(readFileSync(join(DATA_DIR, f), "utf8")))
    // longest history first — the heaviest, most worth exercising
    .sort((a, b) => (b.rows?.length || 0) - (a.rows?.length || 0));
}

const instruments = loadInstruments();
const data = instruments[0];

const SPEC = {
  name: "golden cross",
  direction: "long_flat",
  entry: [{ type: "cross", fast: { kind: "sma", period: 50 }, slow: { kind: "sma", period: 200 }, dir: "above" }],
};
const CFG = { commissionBps: 3, slippageBps: 3, isFraction: 0.7 };

describe("engine worker parity", () => {
  it("has a bundled instrument to test against", () => {
    expect(data, "no bundled data found in public/data").toBeTruthy();
  });

  it("runJob is byte-identical to the synchronous engine", () => {
    // Synchronous reference, computed independently of runJob.
    const refResult = backtest(SPEC, data, CFG);
    const refRobust = robustness(refResult);

    // The worker path.
    const inst = {
      id: data.id, symbol: data.symbol, name: data.name,
      adjusted: data.adjusted, fillConvention: data.fillConvention,
      source: data.source, integrity: { ok: true, issues: [] }, error: null, data,
    };
    const out = runJob({ spec: SPEC, cfg: CFG, from: "", to: "", instruments: [inst] });

    expect(out.runs).toHaveLength(1);
    expect(out.runs[0].result).toStrictEqual(refResult);
    expect(out.robustness).toStrictEqual(refRobust);
  });

  it("survives the postMessage (structuredClone) boundary unchanged", () => {
    const refResult = backtest(SPEC, data, CFG);
    const inst = {
      id: data.id, symbol: data.symbol, name: data.name,
      adjusted: data.adjusted, fillConvention: data.fillConvention,
      source: data.source, integrity: { ok: true, issues: [] }, error: null, data,
    };
    const out = runJob({ spec: SPEC, cfg: CFG, from: "", to: "", instruments: [inst] });
    const cloned = structuredClone({ runs: out.runs, robustness: out.robustness });

    // Every number the client will read must round-trip exactly.
    expect(cloned.runs[0].result).toStrictEqual(refResult);
    expect(cloned.runs[0].result.metrics.full.sharpe).toBe(refResult.metrics.full.sharpe);
    expect(cloned.runs[0].result.equity.strategy).toStrictEqual(refResult.equity.strategy);
    expect(cloned.robustness).toStrictEqual(out.robustness);
  });

  it("date-window slicing matches the engine's own windowing", () => {
    const rows = data.rows;
    const from = rows[Math.floor(rows.length * 0.25)].date;
    const to = rows[Math.floor(rows.length * 0.75)].date;

    const sliced = sliceByDate(rows, from, to);
    const refResult = backtest(SPEC, { ...data, rows: sliced }, CFG);

    const inst = {
      id: data.id, symbol: data.symbol, name: data.name,
      adjusted: data.adjusted, fillConvention: data.fillConvention,
      source: data.source, integrity: { ok: true, issues: [] }, error: null, data,
    };
    const out = runJob({ spec: SPEC, cfg: CFG, from, to, instruments: [inst] });
    expect(out.runs[0].result).toStrictEqual(refResult);
  });

  it("passes load errors and integrity failures through without running the engine", () => {
    const bad = runJob({
      spec: SPEC, cfg: CFG, from: "", to: "",
      instruments: [
        { id: "X", symbol: "X", name: "X", error: "boom", data: null },
        { id: "Y", symbol: "Y", name: "Y", error: null, data: { rows: [] }, integrity: { ok: false, issues: [{ text: "too short" }] } },
      ],
    });
    expect(bad.runs[0].result.ok).toBe(false);
    expect(bad.runs[0].result.reason).toBe("load-failed");
    expect(bad.runs[1].result.ok).toBe(false);
    expect(bad.runs[1].result.reason).toBe("integrity");
    expect(bad.robustness).toBe(null);
  });
});
