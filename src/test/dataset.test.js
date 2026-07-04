import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { backtest } from "../engine/backtest.js";
import { checkIntegrity } from "../data/integrity.js";

// Guards the SHIPPED data itself: every bundled instrument must pass the
// engine's buy-and-hold self-proof (benchmark == the series' own adjusted-close
// ratio, to machine epsilon) and its on-load integrity check. This is a code
// invariant that must hold no matter which instruments happen to be bundled, so
// it does not hard-code a count — the count is a data outcome reported separately.

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "public", "data");
const SPEC = {
  name: "self-proof probe",
  direction: "long_flat",
  entry: [{ type: "cross", fast: { kind: "sma", period: 5 }, slow: { kind: "sma", period: 20 }, dir: "above" }],
};

function loadInstruments() {
  if (!existsSync(DATA_DIR)) return [];
  return readdirSync(DATA_DIR)
    .filter((f) => f.endsWith(".json") && f !== "manifest.json")
    .map((f) => JSON.parse(readFileSync(join(DATA_DIR, f), "utf8")));
}

const instruments = loadInstruments();

describe("bundled dataset integrity", () => {
  it("there is at least one real instrument bundled", () => {
    expect(instruments.length).toBeGreaterThan(0);
  });

  for (const data of instruments) {
    describe(`${data.id}`, () => {
      it("passes the on-load integrity check", () => {
        expect(checkIntegrity(data).ok, checkIntegrity(data).issues.map((i) => i.text).join("; ")).toBe(true);
      });

      it("buy-and-hold self-proof matches its adjClose ratio to machine epsilon", () => {
        const res = backtest(SPEC, data, { commissionBps: 3, slippageBps: 3 });
        expect(res.ok, res.message || res.reason).toBe(true);
        const w = res.window.bars;
        const a = data.rows.map((r) => r.adjClose);
        const expected = a[a.length - 1] / a[a.length - w - 1] - 1;
        expect(Math.abs(res.metrics.benchmark.totalReturn - expected)).toBeLessThan(1e-9);
      });

      it("declares its source and adjustment status honestly", () => {
        expect(typeof data.source).toBe("string");
        expect(data.source.length).toBeGreaterThan(0);
        expect(typeof data.adjusted).toBe("boolean");
        expect(["nextOpen", "nextClose"]).toContain(data.fillConvention);
      });
    });
  }
});
