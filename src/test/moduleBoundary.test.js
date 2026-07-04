import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// AI-3: the interpret/compute WALL, enforced structurally. This test fails if a
// module imports across the boundary — so the guarantee can't silently rot:
//   • The ENGINE (compute) never imports the AI/parser (interpret) layer, never
//     touches price data, and never calls a model. It computes and judges; it is
//     handed no free text and reaches no LLM.
//   • The AI/parser (interpret) layer never imports the engine's price/metric
//     COMPUTE CORE and never touches price data. It may import ONLY the
//     schema-validation gate (schema.js), the deterministic diagnostic facts
//     (autopsy.js) and verdict labels (verdict.js). It interprets and explains;
//     it computes no number.

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");

function jsFiles(dir) {
  const abs = join(SRC, dir);
  if (!existsSync(abs)) return [];
  return readdirSync(abs, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".js") && !e.name.endsWith(".test.js"))
    .map((e) => ({ name: `${dir}/${e.name}`, code: readFileSync(join(abs, e.name), "utf8") }));
}
// import specifiers (strings after `from` / bare imports)
function importSpecifiers(code) {
  const out = [];
  const re = /\bimport\b[^;]*?\bfrom\s*["']([^"']+)["']|\bimport\s*["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(code)) !== null) out.push(m[1] || m[2]);
  return out;
}

const ENGINE = jsFiles("engine");
const INTERPRET = [...jsFiles("ai"), ...jsFiles("parser")];

// The engine's price/metric COMPUTE CORE — the AI side must never import these.
const COMPUTE_CORE = /engine\/(backtest|metrics|indicators|robustness|fragility|workerCore|engineClient|worker)(\.js)?$/;

describe("interpret/compute wall — enforced by import analysis", () => {
  it("found modules on both sides", () => {
    expect(ENGINE.length).toBeGreaterThan(5);
    expect(INTERPRET.length).toBeGreaterThan(3);
  });

  it("the ENGINE never imports the AI/parser/data layers", () => {
    for (const f of ENGINE) {
      for (const spec of importSpecifiers(f.code)) {
        expect(spec, `${f.name} imports ${spec}`).not.toMatch(/\/ai\//);
        expect(spec, `${f.name} imports ${spec}`).not.toMatch(/\/parser\//);
        expect(spec, `${f.name} imports ${spec}`).not.toMatch(/\/data\//);
        expect(spec, `${f.name} imports ${spec}`).not.toMatch(/anthropicClient|autopsyChat|grounding/);
      }
    }
  });

  it("the ENGINE never calls a model / network (no fetch, no Anthropic)", () => {
    for (const f of ENGINE) {
      expect(f.code, `${f.name}`).not.toMatch(/\bfetch\s*\(/);
      expect(f.code, `${f.name}`).not.toMatch(/api\.anthropic\.com/);
      expect(f.code, `${f.name}`).not.toMatch(/x-api-key/);
    }
  });

  it("the AI/parser layer never imports the engine's price/metric compute core", () => {
    for (const f of INTERPRET) {
      for (const spec of importSpecifiers(f.code)) {
        expect(spec, `${f.name} imports compute core ${spec}`).not.toMatch(COMPUTE_CORE);
        expect(spec, `${f.name} imports price data ${spec}`).not.toMatch(/\/data\//);
      }
    }
  });

  it("the AI/parser layer's ONLY engine imports are the gate + facts (schema/autopsy/verdict)", () => {
    const allowed = /engine\/(schema|autopsy|verdict)(\.js)?$/;
    for (const f of INTERPRET) {
      for (const spec of importSpecifiers(f.code)) {
        if (/\/engine\//.test(spec)) {
          expect(spec, `${f.name} imports non-allowed engine module ${spec}`).toMatch(allowed);
        }
      }
    }
  });
});
