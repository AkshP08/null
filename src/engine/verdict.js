// ── The verdict ─────────────────────────────────────────────────────────────
//
// Deterministic. No randomness, no softening. The bucket and the reasons are a
// pure function of the real metrics. The same inputs always produce the same
// verdict. Every reason cites a specific number.
//
// Buckets: REJECTED  — the evidence says this is not a tradeable edge.
//          SUSPECT   — it might be real, but the evidence is weak/contradictory.
//          PLAUSIBLE — it survives out-of-sample and after costs; still not proof.

const fmt = (x, d = 2) =>
  x == null || !Number.isFinite(x) ? "—" : x.toFixed(d);
const pct = (x, d = 1) =>
  x == null || !Number.isFinite(x) ? "—" : `${(x * 100).toFixed(d)}%`;

// thresholds — stated openly so the user can judge them.
export const THRESHOLDS = {
  minTrades: 10, // below this, results are noise
  tooFewTrades: 30, // below this, treat conclusions cautiously
  alwaysInExposure: 0.98, // at/above this exposure, it's basically buy-and-hold
  goodOosSharpe: 0.5, // out-of-sample Sharpe we'd want to see
  deadOosSharpe: 0.0, // at/below this OOS, the edge is gone
  bigDegradation: 0.6, // fraction of IS Sharpe lost OOS that screams overfit
};

/**
 * Compute the verdict from a single-instrument backtest result.
 * Returns { bucket, headline, reasons:[{level,text}], flags:{} }.
 */
export function computeVerdict(result, opts = {}) {
  if (!result || !result.ok) {
    return {
      bucket: "REJECTED",
      headline: "Could not run",
      reasons: [
        {
          level: "fatal",
          text:
            result?.message ||
            "The strategy could not be simulated on this data.",
        },
      ],
      flags: {},
    };
  }

  const m = result.metrics;
  const reasons = [];
  const flags = {};
  const nTrades = result.counts.trades;
  const exposure = result.counts.exposure;
  const isSharpe = m.inSample.sharpe;
  const oosSharpe = m.outSample.sharpe;
  const oosReturn = m.outSample.totalReturn;
  const fullSharpe = m.full.sharpe;
  const noCostSharpe = m.fullNoCost.sharpe;

  // ── Degenerate cases first — these dominate everything else. ──────────────
  // Order matters: an always-in strategy has high exposure but few CLOSED
  // trades, so the buy-and-hold check must precede the trade-count checks, and
  // "never triggered" must be guarded by low exposure.
  if (exposure >= THRESHOLDS.alwaysInExposure) {
    flags.buyAndHold = true;
    return {
      bucket: "REJECTED",
      headline: "This is buy-and-hold in disguise",
      reasons: [
        {
          level: "fatal",
          text: `The strategy is in the market ${pct(exposure)} of the time — it never meaningfully steps aside, so it is effectively buy-and-hold. Any "edge" here is just ${result.instrument.symbol}'s own return, not timing skill. Judge it against the benchmark, because that is what it is.`,
        },
      ],
      flags,
    };
  }

  if (nTrades === 0) {
    flags.neverTriggered = true;
    return {
      bucket: "REJECTED",
      headline: "This strategy never triggered",
      reasons: [
        {
          level: "fatal",
          text: `Across ${result.counts.bars} bars of ${result.instrument.symbol}, the entry conditions were never satisfied. There is nothing to evaluate — the rules, as written, produce no trades on this data.`,
        },
      ],
      flags,
    };
  }

  if (nTrades < THRESHOLDS.minTrades) {
    flags.tooFewTrades = true;
    return {
      bucket: "REJECTED",
      headline: `${nTrades} trade${nTrades === 1 ? "" : "s"} is not enough to conclude anything`,
      reasons: [
        {
          level: "fatal",
          text: `Only ${nTrades} trade${nTrades === 1 ? "" : "s"} occurred. With a sample this small, any metric — Sharpe, win rate, profit factor — is noise, not signal. Treat this result as meaningless until the strategy trades enough to have a distribution.`,
        },
      ],
      flags,
    };
  }
  if (nTrades < THRESHOLDS.tooFewTrades) {
    flags.lowSample = true;
    reasons.push({
      level: "warn",
      text: `Only ${nTrades} trades — a small sample. The numbers below are directional at best; don't bet on the second decimal place.`,
    });
  }

  // ── Cost survival. ────────────────────────────────────────────────────────
  if (noCostSharpe > 0 && fullSharpe <= 0) {
    flags.diesOnCosts = true;
    reasons.push({
      level: "fatal",
      text: `Before costs the full-sample Sharpe is ${fmt(noCostSharpe)}, but after realistic commission + slippage it falls to ${fmt(fullSharpe)}. The "edge" is entirely consumed by trading costs — it does not survive contact with the real world.`,
    });
  } else if (noCostSharpe - fullSharpe > 0.5) {
    reasons.push({
      level: "warn",
      text: `Costs cut the full-sample Sharpe from ${fmt(noCostSharpe)} to ${fmt(fullSharpe)} — a heavy drag. The strategy trades a lot relative to its edge.`,
    });
  }

  // ── In-sample → out-of-sample degradation: the heart of the test. ─────────
  const degradation = isSharpe > 0 ? (isSharpe - oosSharpe) / isSharpe : null;

  if (isSharpe > 0.3 && oosSharpe <= THRESHOLDS.deadOosSharpe) {
    flags.curveFit = true;
    reasons.push({
      level: "fatal",
      text: `In-sample Sharpe of ${fmt(isSharpe)} collapsed to ${fmt(oosSharpe)} out-of-sample. The strategy looks good only on the data it was shaped by, and fails on data it has never seen. This is the signature of a curve fit.`,
    });
  } else if (
    degradation != null &&
    degradation > THRESHOLDS.bigDegradation &&
    oosSharpe < THRESHOLDS.goodOosSharpe
  ) {
    flags.weakOos = true;
    reasons.push({
      level: "warn",
      text: `Out-of-sample Sharpe (${fmt(oosSharpe)}) is ${pct(degradation)} below in-sample (${fmt(isSharpe)}). Performance degrades sharply on unseen data — a warning sign of overfitting.`,
    });
  }

  if (oosReturn < 0) {
    flags.oosLoss = true;
    reasons.push({
      level: "warn",
      text: `The out-of-sample period actually lost money (${pct(oosReturn)}). Whatever worked in-sample did not carry forward.`,
    });
  }

  // ── Did it even beat buy-and-hold out-of-sample? ──────────────────────────
  const benchReturn = m.benchmark.totalReturn;
  if (oosReturn < benchReturn && exposure < THRESHOLDS.alwaysInExposure) {
    reasons.push({
      level: "info",
      text: `Out-of-sample the strategy returned ${pct(oosReturn)} while simply holding ${result.instrument.symbol} returned ${pct(benchReturn)} over the full window. The active strategy did not beat doing nothing.`,
    });
  }

  // ── Decide the bucket. ────────────────────────────────────────────────────
  const hasFatal =
    reasons.some((r) => r.level === "fatal") ||
    flags.curveFit ||
    flags.diesOnCosts ||
    flags.buyAndHold;
  let bucket, headline;

  if (hasFatal) {
    bucket = "REJECTED";
    headline = flags.curveFit
      ? "Curve fit: the edge vanishes out-of-sample"
      : flags.diesOnCosts
        ? "The edge dies after trading costs"
        : flags.buyAndHold
          ? "This is buy-and-hold in disguise"
          : "Rejected on the evidence";
  } else if (
    oosSharpe >= THRESHOLDS.goodOosSharpe &&
    fullSharpe > 0 &&
    !flags.weakOos
  ) {
    bucket = "PLAUSIBLE";
    headline = "Plausible edge — survives out-of-sample and costs";
    reasons.unshift({
      level: "good",
      text: `Out-of-sample Sharpe is ${fmt(oosSharpe)} (in-sample ${fmt(isSharpe)}), and the edge survives realistic costs (after-cost Sharpe ${fmt(fullSharpe)}). That is the profile of a real edge.`,
    });
    reasons.push({
      level: "warn",
      text: `Caution: this is one instrument and one split. One out-of-sample window passing is encouraging, not proof. Run it across instruments and walk-forward before risking capital.`,
    });
  } else {
    bucket = "SUSPECT";
    headline = "Suspect — the evidence is weak or mixed";
    reasons.unshift({
      level: "info",
      text: `Out-of-sample Sharpe is ${fmt(oosSharpe)} with ${nTrades} trades — not clearly an edge, not clearly nothing. The strategy neither convincingly passes nor outright fails.`,
    });
  }

  // ── Robustness can only DOWNGRADE a passing verdict, never upgrade. ───────
  // Deeper evidence makes the bar harder to clear, not easier — a strategy
  // that shines on one split but not across walk-forward windows, or whose
  // out-of-sample confidence interval includes zero, is not plausible.
  const rob = opts.robustness;
  if (rob && bucket === "PLAUSIBLE") {
    const wf = rob.walkForward;
    const boot = rob.bootstrap;
    if (wf && wf.ok && !wf.consistent) {
      flags.walkForwardInconsistent = true;
      bucket = "SUSPECT";
      headline = "Suspect — the edge doesn't hold across time windows";
      reasons.push({
        level: "warn",
        text: `Walk-forward: the edge is positive in only ${wf.positive} of ${wf.folds} time windows (mean window Sharpe ${fmt(wf.meanSharpe)}, worst ${fmt(wf.worstSharpe)}). A real edge shows up across history, not in one lucky stretch — downgraded from plausible.`,
      });
    }
    if (boot && boot.ok && boot.straddlesZero) {
      flags.ciStraddlesZero = true;
      reasons.push({
        level: "warn",
        text: `Bootstrap (${Math.round(boot.confidence * 100)}% CI, seed ${boot.seed}): resampling the out-of-sample trades puts total return between ${pct(boot.totalReturn.lo)} and ${pct(boot.totalReturn.hi)} — an interval that includes zero. At this confidence the result is indistinguishable from luck.`,
      });
      if (bucket === "PLAUSIBLE") {
        bucket = "SUSPECT";
        headline = "Suspect — the out-of-sample confidence interval straddles zero";
      }
    }
  }

  // ── Fragility can only DOWNGRADE, never upgrade. ──────────────────────────
  // If the user's exact parameters sit on a lonely spike — a result that exists
  // at one setting and collapses all around it — that is overfitting by
  // definition, no matter how good the single OOS number looks.
  const frag = opts.fragility;
  if (frag && frag.ok && frag.classification === "fragile" && bucket === "PLAUSIBLE") {
    flags.fragile = true;
    bucket = "SUSPECT";
    headline = "Suspect — the edge sits on a fragile parameter spike";
    reasons.push({
      level: "warn",
      text: `Fragility sweep: nudging ${frag.axes.map((a) => a.label).join(" and ")} collapses the out-of-sample Sharpe (neighbors keep only ${Math.round((frag.neighborMean / frag.userValue) * 100)}% of it). An edge that exists at exactly these settings and nowhere around them is a curve fit — downgraded from plausible.`,
    });
  }

  return {
    bucket,
    headline,
    reasons,
    flags,
    evidence: {
      inSampleSharpe: isSharpe,
      outSampleSharpe: oosSharpe,
      fullSharpe,
      noCostSharpe,
      oosReturn,
      benchReturn,
      nTrades,
      exposure,
    },
  };
}

/**
 * Cross-instrument robustness verdict: given per-instrument results, judge
 * whether an edge is consistent or only appears on one ticker.
 */
export function crossInstrumentVerdict(results) {
  const valid = results.filter(
    (r) => r.result?.ok && r.result.counts.trades >= THRESHOLDS.minTrades,
  );
  if (valid.length < 2) return null;
  const positive = valid.filter(
    (r) => r.result.metrics.outSample.sharpe > THRESHOLDS.goodOosSharpe,
  );
  const ratio = positive.length / valid.length;
  let level, text;
  if (ratio >= 0.6) {
    level = "good";
    text = `The edge holds out-of-sample on ${positive.length} of ${valid.length} instruments tested. Consistency across markets is a point in its favor.`;
  } else if (positive.length === 1 && valid.length >= 3) {
    level = "fatal";
    text = `The out-of-sample edge appears on only 1 of ${valid.length} instruments (${positive[0].instrument}). An edge that lives on a single ticker and dies on the rest is almost always a fluke of that one history, not a real effect.`;
  } else {
    level = "warn";
    text = `Out-of-sample, the edge shows up on ${positive.length} of ${valid.length} instruments — inconsistent. A robust edge should generalize better than this.`;
  }
  return { level, text, ratio, tested: valid.length, passed: positive.length };
}
