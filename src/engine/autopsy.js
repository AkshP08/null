// ── The Autopsy: forensic diagnosis of WHY a strategy failed ────────────────
//
// Pure and unit-tested. Given a real backtest result (and, optionally, the
// cross-instrument runs), it names the specific failure mode(s) that produced
// the verdict, each anchored to the actual figures the engine computed. Nothing
// here is fabricated and nothing here coaches toward a passing result — it is a
// diagnosis, never a fix. `answerLocal()` answers follow-up questions from the
// same computed diagnostics; if the user asks how to make it pass, the honest
// answer is that chasing a green verdict by tweaking is the very overfitting
// this tool exists to expose.

import { THRESHOLDS } from "./verdict.js";

export const CAUSE = {
  NEVER_TRIGGERED: "never_triggered",
  BUY_AND_HOLD: "buy_and_hold",
  TOO_FEW_TRADES: "too_few_trades",
  COST_DRAG: "cost_drag",
  OVERFIT: "overfit",
  OOS_LOSS: "oos_loss",
  UNDERPERFORMS_BENCH: "underperforms_bench",
  INSTRUMENT_DEPENDENCE: "instrument_dependence",
  FRAGILITY: "fragility",
};

// local, self-contained formatters (engine stays independent of the UI layer)
const f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : "—");
const pf = (x, d = 1) => (Number.isFinite(x) ? `${(x * 100).toFixed(d)}%` : "—");
const spf = (x, d = 1) => (Number.isFinite(x) ? `${x >= 0 ? "+" : ""}${(x * 100).toFixed(d)}%` : "—");

/**
 * Compute the concrete spots on the chart that prove the diagnosis — the worst
 * drawdown window and the single worst trade — from the REAL result. Pure and
 * fully defensive (returns null pieces when the data isn't present). These let
 * the autopsy's words link to the exact picture.
 */
export function chartAnchors(result) {
  if (!result?.ok) return null;
  const dates = result.dates || [];
  const eq = result.equity?.strategy || [];
  const trades = result.trades || [];
  let drawdown = null;
  if (dates.length && eq.length === dates.length) {
    let peak = eq[0], peakIdx = 0, maxDD = 0, ddPeakIdx = 0, ddTroughIdx = 0;
    for (let i = 1; i < eq.length; i++) {
      if (eq[i] > peak) { peak = eq[i]; peakIdx = i; }
      const dd = eq[i] / peak - 1;
      if (dd < maxDD) { maxDD = dd; ddPeakIdx = peakIdx; ddTroughIdx = i; }
    }
    // recovery = first bar after the trough back to the pre-drop peak, else end
    let recIdx = eq.length - 1;
    for (let i = ddTroughIdx; i < eq.length; i++) { if (eq[i] >= eq[ddPeakIdx]) { recIdx = i; break; } }
    if (maxDD < 0) {
      drawdown = {
        depth: maxDD,
        peakDate: dates[ddPeakIdx], troughDate: dates[ddTroughIdx], endDate: dates[recIdx],
        from: dates[ddPeakIdx], to: dates[recIdx],
      };
    }
  }
  let worstTrade = null;
  if (trades.length) {
    let w = 0;
    for (let i = 1; i < trades.length; i++) if (trades[i].ret < trades[w].ret) w = i;
    if (trades[w].ret < 0) {
      const t = trades[w];
      const totalLoss = trades.filter((x) => x.ret < 0).reduce((s, x) => s + x.ret, 0);
      worstTrade = {
        index: w, ret: t.ret, entryDate: t.entryDate, exitDate: t.exitDate,
        from: t.entryDate, to: t.exitDate,
        shareOfLosses: totalLoss < 0 ? t.ret / totalLoss : null,
      };
    }
  }
  return {
    drawdown,
    worstTrade,
    splitDate: result.split?.splitDate || null,
    endDate: dates.length ? dates[dates.length - 1] : null,
  };
}

/**
 * Diagnose a single-instrument result. crossRuns is the array of sibling runs
 * ({ id, symbol, result }) used to detect instrument dependence.
 * Returns { alive, causes:[{mode,severity,title,text,evidence,focus?}], primary,
 * stats, anchors }.
 */
export function diagnose(result, crossRuns = [], opts = {}) {
  if (!result || !result.ok) {
    return { alive: false, causes: [], primary: null, unusable: true, message: result?.message || "This run could not be evaluated." };
  }
  const m = result.metrics;
  const c = result.counts;
  const isS = m.inSample.sharpe;
  const oosS = m.outSample.sharpe;
  const fullS = m.full.sharpe;
  const noCostS = m.fullNoCost.sharpe;
  const oosRet = m.outSample.totalReturn;
  const benchRet = m.benchmark.totalReturn;
  // Buy-and-hold over the SAME out-of-sample window (engine self-proof value) —
  // the apples-to-apples yardstick for the OOS strategy return.
  const benchOosRet = (m.benchmarkOut ?? m.benchmark).totalReturn;
  const trades = c.trades;
  const exposure = c.exposure;
  const turnover = m.full.turnover;
  const expectancy = m.full.expectancy;
  const sym = result.instrument?.symbol || "this instrument";

  const stats = { isS, oosS, fullS, noCostS, oosRet, benchRet, benchOosRet, trades, exposure, turnover, expectancy, sym };
  const anchors = chartAnchors(result);
  const oosRange = anchors?.splitDate && anchors?.endDate
    ? { type: "range", from: anchors.splitDate, to: anchors.endDate, label: "the out-of-sample stretch" }
    : null;
  const worstTradeFocus = anchors?.worstTrade
    ? { type: "trade", index: anchors.worstTrade.index, label: "the worst trade" }
    : null;
  const causes = [];

  // ── Never triggered — dominates everything. ──────────────────────────────
  if (trades === 0) {
    causes.push({
      mode: CAUSE.NEVER_TRIGGERED, severity: "fatal",
      title: "It never traded",
      text: `Across ${c.bars} bars of ${sym} the entry conditions were never all true at once, so no position was ever taken. There is no performance to autopsy — the rules, as written, simply don't fire on this data.`,
      evidence: [["Trades", "0"], ["Bars tested", `${c.bars}`]],
    });
    return { alive: false, causes, primary: causes[0], stats, anchors };
  }

  // ── Effectively buy-and-hold. ─────────────────────────────────────────────
  if (exposure >= THRESHOLDS.alwaysInExposure) {
    causes.push({
      mode: CAUSE.BUY_AND_HOLD, severity: "fatal",
      title: "It's buy-and-hold wearing a costume",
      text: `The strategy held a position ${pf(exposure)} of the time — it almost never steps aside. Its return is just ${sym}'s return (${spf(benchRet)} buy-and-hold over the window), not timing skill. Any "edge" here is the market's, not the rules'.`,
      evidence: [["Time in market", pf(exposure)], ["Buy-and-hold return", spf(benchRet)]],
    });
  }

  // ── Too few trades — luck, not edge. ──────────────────────────────────────
  if (trades < THRESHOLDS.minTrades) {
    causes.push({
      mode: CAUSE.TOO_FEW_TRADES, severity: "fatal",
      title: "Too few trades to mean anything",
      text: `Only ${trades} trade${trades === 1 ? "" : "s"} occurred. Every metric derived from that — Sharpe, win rate, profit factor — is a small-sample coin-flip, not evidence of an edge. This isn't a verdict on the idea; there's simply not enough data to have one.`,
      evidence: [["Trades", `${trades}`], ["Needed for signal", `≥ ${THRESHOLDS.minTrades}`]],
    });
  }

  // ── Cost drag — the edge dies on contact with real costs. ─────────────────
  if (noCostS > 0.2 && fullS <= 0) {
    causes.push({
      mode: CAUSE.COST_DRAG, severity: "fatal",
      title: "The edge dies on trading costs",
      text: `Before costs the full-sample Sharpe is ${f2(noCostS)} — a real signal. After realistic commission + slippage it falls to ${f2(fullS)}. The whole edge is consumed by the cost of trading it (${f2(turnover)} fills per bar across ${trades} trades). On paper it works; in a real account it doesn't.`,
      evidence: [["Sharpe before costs", f2(noCostS)], ["Sharpe after costs", f2(fullS)], ["Turnover (fills/bar)", f2(turnover)]],
    });
  } else if (noCostS - fullS > 0.5) {
    causes.push({
      mode: CAUSE.COST_DRAG, severity: "warn",
      title: "Costs take a heavy cut",
      text: `Costs drag the full-sample Sharpe from ${f2(noCostS)} to ${f2(fullS)} — the strategy trades a lot relative to its edge (${f2(turnover)} fills per bar). It survives, but a large share of the gross edge is spent on execution.`,
      evidence: [["Sharpe before costs", f2(noCostS)], ["Sharpe after costs", f2(fullS)], ["Turnover (fills/bar)", f2(turnover)]],
    });
  }

  // ── Overfit — in-sample shine, out-of-sample collapse. ────────────────────
  const decay = isS > 1e-9 ? (isS - oosS) / isS : null;
  if (isS > 0.3 && oosS <= THRESHOLDS.deadOosSharpe) {
    causes.push({
      mode: CAUSE.OVERFIT, severity: "fatal",
      title: "Overfit — the edge was fit to the past",
      text: `In-sample Sharpe of ${f2(isS)} collapsed to ${f2(oosS)} on the out-of-sample data the strategy never saw — ${decay != null ? `${(decay * 100).toFixed(0)}% of the apparent edge evaporated` : "the edge evaporated"}. Performance that lives only on the data it was shaped by is the textbook signature of a curve fit.`,
      evidence: [["In-sample Sharpe", f2(isS)], ["Out-of-sample Sharpe", f2(oosS)], ["Edge lost", decay != null ? `${(decay * 100).toFixed(0)}%` : "—"]],
      focus: oosRange,
    });
  } else if (decay != null && decay > THRESHOLDS.bigDegradation && oosS < THRESHOLDS.goodOosSharpe) {
    causes.push({
      mode: CAUSE.OVERFIT, severity: "warn",
      title: "Degrades sharply out-of-sample",
      text: `Out-of-sample Sharpe (${f2(oosS)}) is ${(decay * 100).toFixed(0)}% below in-sample (${f2(isS)}). The edge doesn't carry forward cleanly onto unseen data — a warning sign that some of the in-sample result was fit to noise.`,
      evidence: [["In-sample Sharpe", f2(isS)], ["Out-of-sample Sharpe", f2(oosS)], ["Edge lost", `${(decay * 100).toFixed(0)}%`]],
      focus: oosRange,
    });
  }

  // ── Beaten by buy-and-hold over the SAME out-of-sample window. ────────────
  // The one benchmark that matters: if simply holding the instrument beat the
  // active strategy over the window it's judged on, the trading destroyed value
  // — a cause of death in its own right, no matter how positive the raw return
  // looks. Compared like-for-like (OOS vs OOS) on the engine's self-proven B&H.
  const benchGap = benchOosRet - oosRet; // >0 ⇒ buy-and-hold won
  const beatenByHold =
    exposure < THRESHOLDS.alwaysInExposure &&
    Number.isFinite(benchOosRet) && benchOosRet > 0 &&
    benchGap >= THRESHOLDS.benchMaterialGap;
  if (beatenByHold) {
    const capture = oosRet / benchOosRet;
    const severe = oosRet <= 0 || capture < THRESHOLDS.benchDeadCapture;
    causes.push({
      mode: CAUSE.UNDERPERFORMS_BENCH, severity: severe ? "fatal" : "warn",
      title: `Beaten by simply holding ${sym}`,
      text: `Out-of-sample the strategy returned ${spf(oosRet)} while holding ${sym} over the same window returned ${spf(benchOosRet)} — it underperformed buy-and-hold by ${pf(benchGap)}. The active trading destroyed value versus doing nothing. That is the cause of death, not a dial to tune.`,
      evidence: [["OOS strategy", spf(oosRet)], [`Buy-and-hold ${sym}`, spf(benchOosRet)], ["Shortfall vs hold", pf(benchGap)]],
      focus: oosRange,
    });
  }

  // ── Lost money out-of-sample (only note it if not already the overfit or
  //    beaten-by-hold story). ─────────────────────────────────────────────────
  const hasOverfitFatal = causes.some((x) => x.mode === CAUSE.OVERFIT && x.severity === "fatal");
  if (oosRet < 0 && trades >= THRESHOLDS.minTrades && !hasOverfitFatal && !beatenByHold) {
    causes.push({
      mode: CAUSE.OOS_LOSS, severity: "warn",
      title: "Lost money on unseen data",
      text: `Out-of-sample the strategy returned ${spf(oosRet)} while simply holding ${sym} returned ${spf(benchOosRet)} over the same window. Whatever worked in-sample did not pay on data it hadn't seen.`,
      evidence: [["Out-of-sample return", spf(oosRet)], ["Buy-and-hold", spf(benchOosRet)]],
      focus: worstTradeFocus || oosRange,
    });
  }

  // ── Instrument dependence — works on one market, breaks on the rest. ──────
  const dep = instrumentDependence(crossRuns);
  if (dep) causes.push(dep);

  // ── Fragility — the edge exists only at one parameter setting. ────────────
  const frag = opts.fragility;
  if (frag && frag.ok && frag.classification === "fragile") {
    causes.push({
      mode: CAUSE.FRAGILITY, severity: "warn",
      title: "Fragile — the edge lives on a single parameter spike",
      text: frag.note,
      evidence: [
        ["Your OOS Sharpe", f2(frag.userValue)],
        ["Neighbors keep", `${Math.round((frag.neighborMean / frag.userValue) * 100)}%`],
        ["Swept", frag.axes.map((a) => a.label).join(" × ")],
      ],
    });
  }

  const primary = causes.find((x) => x.severity === "fatal") || causes[0] || null;
  const alive =
    !causes.some((x) => x.severity === "fatal") &&
    !causes.some((x) => x.mode === CAUSE.FRAGILITY) &&
    !causes.some((x) => x.mode === CAUSE.UNDERPERFORMS_BENCH) &&
    oosS >= THRESHOLDS.goodOosSharpe && fullS > 0;
  return { alive, causes, primary, stats, anchors };
}

function instrumentDependence(crossRuns) {
  const valid = (crossRuns || []).filter((r) => r?.result?.ok && r.result.counts.trades >= THRESHOLDS.minTrades);
  if (valid.length < 2) return null;
  const passers = valid.filter((r) => r.result.metrics.outSample.sharpe > THRESHOLDS.goodOosSharpe);
  if (passers.length === 0 || passers.length >= valid.length) return null; // uniformly dead or uniformly fine — not "dependence"
  if (passers.length / valid.length > 0.5) return null;
  const names = passers.map((r) => r.symbol).join(", ");
  const severity = passers.length === 1 && valid.length >= 3 ? "fatal" : "warn";
  return {
    mode: CAUSE.INSTRUMENT_DEPENDENCE, severity,
    title: "Instrument-dependent — it works on one market, not the rest",
    text: `The out-of-sample edge shows up on ${passers.length} of ${valid.length} instruments tested (${names}) and breaks on the others. An edge that lives on a single history is usually a property of that history — a regime, a lucky run — not a repeatable effect you can trust elsewhere.`,
    evidence: [["Instruments passing OOS", `${passers.length} / ${valid.length}`], ["Where it held", names]],
  };
}

// ── Follow-up Q&A, grounded in the diagnostics. No coaching, ever. ──────────

const OPTIMIZE_RE =
  /\b(make|get|help|turn).{0,24}(pass|green|survive|work|profitable|alive)\b|how.{0,24}(do i|can i|to)?.{0,10}(fix|improve|better|beat|salvage|save)\b|optimi[sz]e|auto.?tune|\btune\b|\btweak\b|what (should|do|can) i (change|adjust|try|use)|better (param|setting|value)|which (param|setting|value)|best (param|setting|value)|should i (use|try|change|set)/i;

// Asking for a recommendation, a preference, an alternative, or "what to do /
// try instead" is coaching too — the coroner names the cause of death, it does
// not prescribe a better strategy. This closes the gap where "what strategy
// would you prefer instead?" slipped past the pass/optimize gate and fell into
// the same generic-summary bucket as "why did it die?". Catches: recommend /
// suggest / advise / prefer; "what would you do/use/try/build (instead/next)";
// "a better/different/alternative strategy|approach|indicator|rule|setup"; and
// "…instead of this".
const COACH_ALT_RE =
  /\b(recommend|suggest|advise|prefer)\b|\bwhat (would|should|do|can) (you|i)\b[^?.!]{0,40}\b(prefer|recommend|suggest|advise|do|use|try|build|pick|choose|change|instead|different|better|next)\b|\b(better|different|alternative|another|other|new)\b[^?.!]{0,20}\b(strateg(y|ies)|approach(es)?|idea|ideas|rules?|indicators?|setups?|systems?|methods?|signals?|models?|entr(y|ies)|exits?|hypothes[ie]s)\b|\b(what|which)\b[^?.!]{0,30}\b(strateg(y|ies)|approach|indicator|setup|system|rules?|idea)\b[^?.!]{0,25}\b(instead|should|would|to use|better|best|try|next)\b|\binstead of (this|that|it|these|those)\b|\bwhat.{0,20}(else|other).{0,25}(strateg|approach|try|use|do|build)\b/i;

export function isOptimizeQuestion(q) {
  return OPTIMIZE_RE.test(q || "") || COACH_ALT_RE.test(q || "");
}

// Questions the backtest simply cannot answer — predictions, buy/sell advice,
// price targets, anything about the future or outside this one history. The
// honest answer is that the backtest doesn't show that.
const OUT_OF_SCOPE_RE =
  /\b(next (year|month|week|day)|going forward|in the future|will it (go|make|rise|fall|drop|keep|continue|work)|what.{0,20}(happen|do).{0,20}(next|future|tomorrow)|predict|forecast|price target|target price|should i (buy|sell|invest|trade|hold|short)|is it a good (investment|buy|stock|trade|idea to trade)|worth (buying|trading|investing)|guarantee|how much (money )?(will|would) i (make|earn|lose))\b/i;

export function isOutOfScope(q) {
  return OUT_OF_SCOPE_RE.test(q || "");
}

export const OUT_OF_SCOPE =
  "The backtest doesn't show that. It measures how these exact rules would have performed on real past data, look-ahead-free — it can't tell you what happens next, whether to trade, or anything beyond this one history and split. Ask me why it performed the way it did, and I'll answer from the numbers.";

const REFUSAL =
  "I won't tell you how to make this pass. Tuning parameters until the past turns green is exactly the overfitting Null exists to catch — you'd be fitting to noise and calling it an edge. The autopsy tells you why this idea died on unseen data; a passing verdict has to be earned by a genuinely different hypothesis tested fresh, not by grinding this one against the same history until it looks good. That's diagnosis, not a cheat code.";

/**
 * Answer a follow-up question from the computed diagnosis. Pure, deterministic,
 * always grounded in the real numbers. Never suggests parameters or coaches.
 */
export function answerLocal(question, diagnosis, result) {
  const q = (question || "").toLowerCase();
  if (isOptimizeQuestion(q)) return REFUSAL;
  if (isOutOfScope(q)) return OUT_OF_SCOPE;
  if (!diagnosis || diagnosis.unusable) return diagnosis?.message || "There's nothing to diagnose on this run.";

  const s = diagnosis.stats;
  const has = (mode) => diagnosis.causes.find((c) => c.mode === mode);

  // costs vs overfitting comparison
  if (/(cost|slippage|commission|fees?).*(or|vs|versus|rather).*(overfit|fit)|(overfit|fit).*(or|vs|versus|rather).*(cost|slippage)|which (killed|hurt|mattered|was worse)/.test(q)) {
    const costGap = s.noCostS - s.fullS;
    const decay = s.isS > 1e-9 ? (s.isS - s.oosS) / s.isS : null;
    return `Both, but weigh them: costs cut the full-sample Sharpe by ${f2(costGap)} (from ${f2(s.noCostS)} to ${f2(s.fullS)}), while out-of-sample the Sharpe went from ${f2(s.isS)} in-sample to ${f2(s.oosS)} unseen${decay != null ? ` (${(decay * 100).toFixed(0)}% of the edge lost)` : ""}. ${
      Math.abs(costGap) > (decay ? Math.abs(s.isS - s.oosS) : 0)
        ? "Costs did more of the damage here."
        : "The out-of-sample collapse did more of the damage here — this reads more like overfitting than a cost problem."
    }`;
  }
  // costs
  if (/cost|slippage|commission|fees?/.test(q)) {
    const c = has(CAUSE.COST_DRAG);
    if (c) return c.text;
    return `Costs weren't the killer here: full-sample Sharpe is ${f2(s.noCostS)} before costs and ${f2(s.fullS)} after — barely moved. Turnover is ${f2(s.turnover)} fills per bar. Look elsewhere for the cause of death.`;
  }
  // overfit
  if (/overfit|curve.?fit|in.?sample|out.?of.?sample|unseen|generali/.test(q)) {
    const c = has(CAUSE.OVERFIT);
    if (c) return c.text;
    const decay = s.isS > 1e-9 ? (s.isS - s.oosS) / s.isS : null;
    return `This doesn't look mainly like overfitting: in-sample Sharpe ${f2(s.isS)} vs out-of-sample ${f2(s.oosS)}${decay != null ? ` (${(decay * 100).toFixed(0)}% change)` : ""}. The edge held up across the split about as well as it started — the problem, if any, is elsewhere.`;
  }
  // trades / sample size
  if (/fewer trades|more trades|trade count|too few|sample|how many trades|trade less|trade more/.test(q)) {
    return `You have ${s.trades} trades with a per-trade expectancy of ${spf(s.expectancy, 2)} after costs. Fewer trades wouldn't create an edge — it would only shrink an already ${s.trades < THRESHOLDS.minTrades ? "too-small" : "modest"} sample and make the result noisier. Trading less only helps if there's a real per-trade edge being eaten by costs; here the after-cost expectancy is ${spf(s.expectancy, 2)}, so there's little to protect. (And no — I won't suggest a trade count to target; that's optimizing to the past.)`;
  }
  // buy and hold
  if (/buy.?and.?hold|just the market|passive|hold(ing)?|beat the market/.test(q)) {
    const c = has(CAUSE.BUY_AND_HOLD);
    if (c) return c.text;
    return `Exposure is ${pf(s.exposure)} of the time, so it isn't simply buy-and-hold. For reference, holding ${s.sym} over the same out-of-sample window returned ${spf(s.benchOosRet)} versus the strategy's ${spf(s.oosRet)}.`;
  }
  // instrument dependence
  if (/instrument|ticker|other markets?|cross|another (stock|asset)|robust/.test(q)) {
    const c = has(CAUSE.INSTRUMENT_DEPENDENCE);
    if (c) return c.text;
    return `Cross-instrument dependence isn't the headline here — either too few instruments were tested together, or the result was consistent across them. Run it on more instruments to pressure-test that.`;
  }

  // default: summarize the cause(s) of death
  return summarize(diagnosis);
}

export function summarize(diagnosis) {
  if (diagnosis.alive) {
    const s = diagnosis.stats;
    return `No cause of death — it's still standing. Out-of-sample Sharpe ${f2(s.oosS)} (in-sample ${f2(s.isS)}) and it survives costs (after-cost Sharpe ${f2(s.fullS)}). That's the profile of a real edge, but it's one instrument and one split — encouraging, not proof.`;
  }
  if (!diagnosis.causes.length) {
    const s = diagnosis.stats || {};
    return `No single failure mode dominates. Out-of-sample Sharpe is ${f2(s.oosS)} on ${s.trades} trades (in-sample ${f2(s.isS)}) — not clearly an edge, not clearly broken. That ambiguity is itself the finding: there isn't enough separation here to trust the result either way.`;
  }
  const parts = diagnosis.causes.map((c) => c.text);
  const lead = diagnosis.primary ? `Primary cause of death: ${diagnosis.primary.title.toLowerCase()}. ` : "";
  return lead + parts.join(" ");
}

/**
 * The deterministic structured payload of DIAGNOSTIC FACTS the AI layer is
 * allowed to phrase. Pure and engine-authoritative: every figure here is one
 * the engine already computed. This is the ONLY thing the model ever sees about
 * a run — no prices, no equity curve, no ability to compute anything. The AI
 * grounding guard (src/ai/grounding.js) treats the numbers in this payload as
 * the sole set of facts the model may reference.
 */
export function buildAutopsyPayload(diagnosis) {
  if (!diagnosis || diagnosis.unusable) {
    return { unusable: true, message: diagnosis?.message || "This run could not be evaluated." };
  }
  const s = diagnosis.stats || {};
  const a = diagnosis.anchors || {};
  const figures = {
    instrument: s.sym,
    trades: s.trades,
    inSampleSharpe: f2(s.isS),
    outSampleSharpe: f2(s.oosS),
    fullSampleSharpe: f2(s.fullS),
    sharpeBeforeCosts: f2(s.noCostS),
    outSampleReturn: spf(s.oosRet),
    buyAndHoldReturn: spf(s.benchRet),
    buyAndHoldReturnOOS: spf(s.benchOosRet),
    timeInMarket: pf(s.exposure),
    turnoverFillsPerBar: f2(s.turnover),
    perTradeExpectancy: spf(s.expectancy, 2),
    worstDrawdown: a.drawdown ? pf(a.drawdown.depth) : null,
    outOfSampleStart: a.splitDate || null,
    windowEnd: a.endDate || null,
  };
  return {
    verdictAlive: !!diagnosis.alive,
    causesOfDeath: (diagnosis.causes || []).map((c) => ({
      mode: c.mode,
      severity: c.severity,
      title: c.title,
      evidence: Object.fromEntries(c.evidence || []),
    })),
    figures,
  };
}

export { REFUSAL };
