// ── The backtest engine, running in a Web Worker ────────────────────────────
//
// The engine is pure and unchanged; this file only decides WHERE it executes.
// The main thread posts { id, job }; we run the pure `runJob` and post back
// { id, ok, runs, robustness } (or { id, ok:false, error }). The `id` lets the
// client match responses and discard stale ones (see engineClient.js).

import { runJob } from "./workerCore.js";

self.onmessage = (e) => {
  const { id, job } = e.data || {};
  try {
    const out = runJob(job);
    self.postMessage({ id, ok: true, runs: out.runs, robustness: out.robustness, fragility: out.fragility });
  } catch (err) {
    self.postMessage({ id, ok: false, error: err?.message || String(err) });
  }
};
