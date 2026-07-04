// ── Pure engine job runner (shared by the Web Worker and by tests) ──────────
//
// This is the exact unit of work that runs off the main thread. It contains NO
// worker/DOM APIs and NO network — just the pure engine (`backtest`) plus the
// pure robustness pass. Keeping it here (rather than inline in worker.js) means
// a test can call it synchronously and assert the worker path is byte-identical
// to running the engine directly. The worker is only a place to execute this;
// it never changes what is computed.

import { backtest } from "./backtest.js";
import { robustness } from "./robustness.js";
import { fragilityAnalysis } from "./fragility.js";

/** Filter rows to an ISO-date [from, to] window. Blank/invalid bounds are ignored. */
export function sliceByDate(rows, from, to) {
  const okFrom = /^\d{4}-\d{2}-\d{2}$/.test(from || "") ? from : null;
  const okTo = /^\d{4}-\d{2}-\d{2}$/.test(to || "") ? to : null;
  if (!okFrom && !okTo) return rows;
  return rows.filter((r) => (!okFrom || r.date >= okFrom) && (!okTo || r.date <= okTo));
}

/**
 * Run one spec across a set of already-loaded instruments.
 *
 * @param {object} job
 *   - spec: validated strategy spec
 *   - cfg:  engine config ({ commissionBps, slippageBps, isFraction })
 *   - from, to: optional ISO-date window bounds
 *   - instruments: [{ id, symbol, name, adjusted, fillConvention, source,
 *                     integrity, data|null, error|null }]
 *     where `data` is the full instrument object ({ rows, ... }) already fetched
 *     on the main thread (kept off the worker so it stays pure of network).
 * @returns { runs, robustness } — identical to computing these synchronously.
 */
export function runJob(job) {
  const { spec, cfg, from, to, instruments } = job;
  const runs = (instruments || []).map((inst) => {
    const base = {
      id: inst.id,
      symbol: inst.symbol,
      name: inst.name,
      adjusted: inst.adjusted,
      fillConvention: inst.fillConvention,
      source: inst.source,
    };
    if (!inst.data || inst.error) {
      return { ...base, result: { ok: false, reason: "load-failed", message: inst.error || "Could not load this series." } };
    }
    if (inst.integrity && !inst.integrity.ok) {
      return { ...base, integrity: inst.integrity, result: { ok: false, reason: "integrity", message: inst.integrity.issues.map((i) => i.text).join("; ") } };
    }
    const rows = sliceByDate(inst.data.rows, from, to);
    return { ...base, integrity: inst.integrity, result: backtest(spec, { ...inst.data, rows }, cfg) };
  });

  // Robustness is the other heavy pass (walk-forward + a 2000-iteration seeded
  // bootstrap). Compute it here, on the same off-thread pass, for the primary
  // (first successful) run — exactly as the main thread did before.
  const primary = runs.find((r) => r.result?.ok) || runs[0] || null;
  const robust = primary?.result?.ok ? robustness(primary.result) : null;

  // Fragility sweep (up to ~81 backtests) — also off-thread, on the primary
  // instrument, so its finding is available to feed the verdict and autopsy.
  let fragility = null;
  if (primary?.result?.ok) {
    const primInst = (instruments || []).find((x) => x.id === primary.id);
    if (primInst?.data) {
      try {
        const rows = sliceByDate(primInst.data.rows, from, to);
        fragility = fragilityAnalysis(spec, { ...primInst.data, rows }, cfg);
      } catch (e) {
        fragility = { ok: false, reason: "error", message: e?.message || String(e) };
      }
    }
  }

  return { runs, robustness: robust, fragility };
}
