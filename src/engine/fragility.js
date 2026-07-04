// ── The Fragility Explorer engine ───────────────────────────────────────────
//
// The honest inverse of parameter optimization. Instead of hunting for the
// settings that maximize return (the overfitting disease), we sweep the
// strategy's OWN key parameters across a grid of nearby values, run a real
// out-of-sample backtest at each, and map the landscape:
//
//   • a ROBUST edge shows a broad plateau — similar OOS results across a whole
//     neighborhood, so it doesn't depend on one lucky setting;
//   • an OVERFIT edge shows a lonely SPIKE — a single bright cell that collapses
//     the moment you nudge a parameter.
//
// It answers "how fragile is this?", NEVER "which settings win?" There is no
// best-cell, no recommendation, no apply-parameters affordance anywhere in this
// module — enforced by tests. If the user's exact parameters sit on a spike,
// that is surfaced as evidence of overfitting, not as a nearby target to chase.

import { backtest } from "./backtest.js";

const clone = (o) => JSON.parse(JSON.stringify(o));
function getAtPath(obj, path) { return path.reduce((o, k) => (o == null ? o : o[k]), obj); }
function setAtPath(obj, path, value) {
  let o = obj;
  for (let i = 0; i < path.length - 1; i++) o = o[path[i]];
  o[path[path.length - 1]] = value;
}

const round2 = (x) => Math.round(x * 100) / 100;

/** ~9 nearby integer values for a period/lookback, always including the real one. */
function gridPeriod(P) {
  const set = new Set([P]);
  for (const f of [0.5, 0.66, 0.8, 0.9, 1.15, 1.35, 1.6, 2.0]) set.add(Math.max(2, Math.round(P * f)));
  return [...set].sort((a, b) => a - b).slice(0, 11);
}
/** Nearby threshold values, always including the real one. RSI-aware clamping. */
function gridThreshold(ind, value) {
  const set = new Set([value]);
  if (ind && ind.kind === "rsi") {
    for (const d of [-15, -10, -5, 5, 10, 15]) { const v = value + d; if (v >= 5 && v <= 95) set.add(v); }
  } else if (value !== 0) {
    for (const f of [0.6, 0.8, 1.2, 1.4]) set.add(round2(value * f));
  } else {
    for (const d of [-2, -1, 1, 2]) set.add(value + d);
  }
  return [...set].sort((a, b) => a - b);
}
/** Nearby stop/target fractions, always including the real one. */
function gridStop(v) {
  const set = new Set([v]);
  for (const f of [0.5, 0.7, 1.3, 1.6, 2.0]) { const x = round2(v * f); if (x > 0 && x < 1) set.add(x); }
  return [...set].sort((a, b) => a - b);
}

const kindName = (ind) => (ind?.kind || "").toUpperCase();

/** Collect the strategy's tunable numeric parameters, each with a nearby grid. */
export function extractParams(spec) {
  const out = [];
  const addInd = (ind, indPath, tag) => {
    if (!ind) return;
    if (["sma", "ema", "rsi", "roc"].includes(ind.kind) && Number.isInteger(ind.period)) {
      out.push({ path: [...indPath, "period"], label: `${tag ? tag + " " : ""}${kindName(ind)} length`, value: ind.period, kind: "period", values: gridPeriod(ind.period) });
    } else if (["bbUpper", "bbLower", "bbMiddle"].includes(ind.kind) && Number.isInteger(ind.period)) {
      out.push({ path: [...indPath, "period"], label: `BB length`, value: ind.period, kind: "period", values: gridPeriod(ind.period) });
    }
  };
  const eachLeaf = (conds, base) => {
    (conds || []).forEach((c, i) => {
      const p = [...base, i];
      if (Array.isArray(c.all)) return eachLeaf(c.all, [...p, "all"]);
      if (Array.isArray(c.any)) return eachLeaf(c.any, [...p, "any"]);
      if (c.type === "cross") { addInd(c.fast, [...p, "fast"], "fast"); addInd(c.slow, [...p, "slow"], "slow"); }
      else if (c.type === "threshold") {
        addInd(c.indicator, [...p, "indicator"]);
        if (Number.isFinite(c.value)) out.push({ path: [...p, "value"], label: `${kindName(c.indicator)} threshold`, value: c.value, kind: "threshold", ind: c.indicator, values: gridThreshold(c.indicator, c.value) });
      } else if (c.type === "breakout" && Number.isInteger(c.lookback)) {
        out.push({ path: [...p, "lookback"], label: `breakout lookback`, value: c.lookback, kind: "lookback", values: gridPeriod(c.lookback) });
      }
    });
  };
  eachLeaf(spec.entry, ["entry"]);
  eachLeaf(spec.exit, ["exit"]);
  if (Number.isFinite(spec.stopLoss)) out.push({ path: ["stopLoss"], label: "stop-loss", value: spec.stopLoss, kind: "stop", values: gridStop(spec.stopLoss) });
  if (Number.isFinite(spec.takeProfit) && spec.takeProfit < 1) out.push({ path: ["takeProfit"], label: "take-profit", value: spec.takeProfit, kind: "stop", values: gridStop(spec.takeProfit) });
  // keep only params whose grid has real variety
  return out.filter((p) => p.values.length >= 3);
}

const withUser = (p) => ({ ...p, userIndex: Math.max(0, p.values.indexOf(p.value)) });

/** Choose the 1–2 most telling axes to sweep. Diverse, meaningful knobs. */
export function pickAxes(spec, params) {
  if (!params.length) return [];
  const fast = params.find((p) => p.path.includes("fast"));
  const slow = params.find((p) => p.path.includes("slow"));
  if (fast && slow) return [withUser(fast), withUser(slow)];
  const periods = params.filter((p) => p.kind === "period" || p.kind === "lookback");
  const thresholds = params.filter((p) => p.kind === "threshold");
  let axes;
  if (periods.length && thresholds.length) axes = [periods[0], thresholds[0]];
  else if (periods.length >= 2) axes = [periods[0], periods[1]];
  else if (params.length >= 2) axes = [params[0], params[1]];
  else axes = [params[0]];
  return axes.map(withUser);
}

/**
 * Classify a fragility surface (2D array of OOS Sharpe; use one row for 1D)
 * around the user's cell. Pure and deterministic — the testable core.
 * Returns { classification, spikeScore, plateauFraction, neighborMean, rank, userValue }.
 *   classification ∈ 'robust' | 'fragile' | 'mixed' | 'no-edge' | 'insufficient'
 */
export function classifyFragility(surface, ui) {
  const rows = surface.length, cols = surface[0]?.length || 0;
  const flat = surface.flat().filter((v) => v != null && Number.isFinite(v));
  const userValue = surface[ui.i]?.[ui.j];
  if (flat.length < 3 || userValue == null || !Number.isFinite(userValue)) {
    return { classification: "insufficient", userValue: userValue ?? null, spikeScore: null, plateauFraction: null, neighborMean: null, rank: null };
  }
  const nb = [];
  for (const [di, dj] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
    const v = surface[ui.i + di]?.[ui.j + dj];
    if (v != null && Number.isFinite(v)) nb.push(v);
  }
  const neighborMean = nb.length ? nb.reduce((s, x) => s + x, 0) / nb.length : userValue;
  const rank = flat.filter((v) => v <= userValue).length / flat.length;
  const plateauFraction = flat.filter((v) => v >= 0.5 * userValue).length / flat.length;
  const spikeScore = (userValue - neighborMean) / Math.max(Math.abs(userValue), 0.5);

  let classification;
  if (userValue < 0.3) classification = "no-edge"; // no edge to be fragile about
  else if (spikeScore >= 0.5 && rank >= 0.8) classification = "fragile";
  else if (plateauFraction >= 0.55) classification = "robust";
  else classification = "mixed";
  return { classification, spikeScore, plateauFraction, neighborMean, rank, userValue };
}

function noteFor(cls, axes) {
  const names = axes.map((a) => a.label).join(" × ");
  switch (cls.classification) {
    case "fragile":
      return `Your exact parameters sit on a lonely spike. Nudging ${names} makes the out-of-sample edge collapse — neighboring settings keep only ${Math.round((cls.neighborMean / cls.userValue) * 100)}% of it. A result that exists at one point and nowhere around it is the fingerprint of a curve fit, not a durable edge.`;
    case "robust":
      return `The out-of-sample edge holds across a broad plateau of nearby ${names} — it doesn't hinge on one lucky setting. That's what robustness looks like (still one instrument, one split — not proof).`;
    case "no-edge":
      return `There's no out-of-sample edge to be fragile about: the result is weak across the whole ${names} neighborhood. Fragility isn't the story here — the absence of an edge is.`;
    case "mixed":
      return `The ${names} landscape is uneven — neither a clean plateau nor a single spike. The edge is sensitive to these choices; treat any single setting with suspicion.`;
    default:
      return `Not enough valid backtests across the ${names} grid to judge fragility.`;
  }
}

function pack(dims, axes, grid, ui, cls) {
  return {
    ok: true,
    dims,
    metric: "oosSharpe",
    axes: axes.map((a) => ({ label: a.label, values: a.values, userIndex: a.userIndex, kind: a.kind })),
    grid, // grid[i][j] = { sharpe, trades, ret }  (i over axes[0], j over axes[1])
    userIndex: ui,
    userValue: cls.userValue,
    classification: cls.classification,
    spikeScore: cls.spikeScore,
    plateauFraction: cls.plateauFraction,
    neighborMean: cls.neighborMean,
    note: noteFor(cls, axes),
    // NOTE: intentionally NO best/optimal/recommended/winner cell — this maps
    // fragility, it does not recommend settings. (Enforced by tests.)
  };
}

/**
 * Run the sweep on real data. Heavy (up to ~81 backtests) — intended to run in
 * the Web Worker alongside the main run. Never throws on bad cells.
 */
export function fragilityAnalysis(spec, data, cfg = {}) {
  const params = extractParams(spec);
  const axes = pickAxes(spec, params);
  if (!axes.length) return { ok: false, reason: "no-tunable-params" };

  const oos = (r) => (r && r.ok ? r.metrics.outSample.sharpe : null);
  const runCell = (assignments) => {
    const s = clone(spec);
    for (const { path, value } of assignments) setAtPath(s, path, value);
    const r = backtest(s, data, cfg);
    return { sharpe: oos(r), trades: r?.ok ? r.counts.trades : 0, ret: r?.ok ? r.metrics.outSample.totalReturn : null };
  };

  if (axes.length === 1) {
    const ax = axes[0];
    const row = ax.values.map((v) => runCell([{ path: ax.path, value: v }]));
    const surface = [row.map((c) => c.sharpe)];
    const ui = { i: 0, j: ax.userIndex };
    return pack(1, [ax], [row], ui, classifyFragility(surface, ui));
  }

  const [ax0, ax1] = axes;
  const grid = [];
  const surface = [];
  for (let i = 0; i < ax0.values.length; i++) {
    const row = [], srow = [];
    for (let j = 0; j < ax1.values.length; j++) {
      const c = runCell([{ path: ax0.path, value: ax0.values[i] }, { path: ax1.path, value: ax1.values[j] }]);
      row.push(c); srow.push(c.sharpe);
    }
    grid.push(row); surface.push(srow);
  }
  const ui = { i: ax0.userIndex, j: ax1.userIndex };
  return pack(2, [ax0, ax1], grid, ui, classifyFragility(surface, ui));
}
