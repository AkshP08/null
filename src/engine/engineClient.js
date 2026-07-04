// ── Main-thread client for the engine Web Worker ────────────────────────────
//
// A tiny request/response layer with single-flight cancellation. The engine
// worker is single-threaded, so a stale job (e.g. the user moved a slider and
// moved on) would otherwise sit ahead of a fresh recompute in the worker's
// queue and delay it. So when a new run supersedes an in-flight one, we
// TERMINATE the worker — killing the stale job outright — and spawn a fresh one
// for the new request. This guarantees the newest recompute never waits behind
// abandoned work. The superseded promise rejects with { superseded: true },
// which callers ignore.
//
// If the environment has no Worker (SSR / tests), callers should fall back to
// the synchronous engine; `workerSupported()` reports that.

import { runJob } from "./workerCore.js";

let worker = null;
let inflight = null; // { id, resolve, reject }
let seq = 0;

export function workerSupported() {
  return typeof Worker !== "undefined";
}

function spawn() {
  const w = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
  w.onmessage = (e) => {
    const msg = e.data || {};
    if (!inflight || msg.id !== inflight.id) return; // stale / cancelled — discard
    const { resolve, reject } = inflight;
    inflight = null;
    if (msg.ok) resolve({ runs: msg.runs, robustness: msg.robustness, fragility: msg.fragility });
    else reject(new Error(msg.error || "engine worker failed"));
  };
  w.onerror = (e) => {
    if (!inflight) return;
    const { reject } = inflight;
    inflight = null;
    reject(new Error(e?.message || "engine worker crashed"));
  };
  return w;
}

/** True if an error came from a run being superseded by a newer one. */
export function isSuperseded(err) {
  return !!(err && err.superseded);
}

/**
 * Run a job on the worker, superseding any in-flight run. Returns a promise of
 * { runs, robustness }. If the environment lacks Worker support, runs the pure
 * engine synchronously (still off no thread, but identical results).
 */
export function runEngine(job) {
  if (!workerSupported()) {
    return Promise.resolve(runJob(job));
  }
  // Supersede: kill the stale job so it can't block this one.
  if (inflight) {
    const stale = inflight;
    inflight = null;
    if (worker) {
      worker.terminate();
      worker = null;
    }
    stale.reject(Object.assign(new Error("superseded"), { superseded: true }));
  }
  if (!worker) worker = spawn();
  const id = ++seq;
  return new Promise((resolve, reject) => {
    inflight = { id, resolve, reject };
    worker.postMessage({ id, job });
  });
}
