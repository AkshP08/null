// ── Strategy specification: the contract between parser and engine ──────────
//
// The parser may ONLY emit specs that validate here. The engine may ONLY
// consume specs that validate here. validateSpec() is the single gate.
//
// A spec describes a rule-based long/flat (or long/short) strategy:
//   - entry:  array of conditions, ALL must hold to be in-market
//   - exit:   optional explicit conditions, ANY of which closes the position;
//             if absent, the position closes when entry conditions stop holding
//   - stopLoss / takeProfit: optional protective exits as fractions (0.05 = 5%)

// Indicators that run on a single (adjusted-close) series need a period.
const PERIOD_KINDS = ["sma", "ema", "rsi", "roc"];
// Indicators with their own parameter shapes.
export const INDICATOR_KINDS = [
  "price", "sma", "ema", "rsi", "roc",
  "macd", "macdSignal",
  "bbUpper", "bbLower", "bbMiddle",
  "atr",
];
export const CONDITION_TYPES = ["cross", "threshold", "breakout", "volume"];
export const DIRECTIONS = ["long_flat", "long_short"];

function isInt(x) {
  return typeof x === "number" && Number.isInteger(x) && x > 0;
}
function isFiniteNum(x) {
  return typeof x === "number" && Number.isFinite(x);
}

function validateIndicator(ind, path, errors) {
  if (!ind || typeof ind !== "object") {
    errors.push(`${path}: indicator must be an object`);
    return;
  }
  if (!INDICATOR_KINDS.includes(ind.kind)) {
    errors.push(
      `${path}.kind: must be one of ${INDICATOR_KINDS.join(", ")} (got ${JSON.stringify(ind.kind)})`,
    );
    return;
  }
  if (ind.kind === "price") {
    if (ind.period != null) errors.push(`${path}: price takes no period`);
  } else if (PERIOD_KINDS.includes(ind.kind)) {
    if (!isInt(ind.period)) errors.push(`${path}.period: ${ind.kind} requires a positive integer period`);
  } else if (ind.kind === "macd" || ind.kind === "macdSignal") {
    if (ind.fast != null && !isInt(ind.fast)) errors.push(`${path}.fast: must be a positive integer`);
    if (ind.slow != null && !isInt(ind.slow)) errors.push(`${path}.slow: must be a positive integer`);
    if (ind.kind === "macdSignal" && ind.signal != null && !isInt(ind.signal)) errors.push(`${path}.signal: must be a positive integer`);
  } else if (ind.kind === "bbUpper" || ind.kind === "bbLower" || ind.kind === "bbMiddle") {
    if (ind.period != null && !isInt(ind.period)) errors.push(`${path}.period: must be a positive integer`);
    if (ind.mult != null && !(isFiniteNum(ind.mult) && ind.mult > 0)) errors.push(`${path}.mult: must be a positive number`);
  } else if (ind.kind === "atr") {
    if (ind.period != null && !isInt(ind.period)) errors.push(`${path}.period: must be a positive integer`);
  }
}

function validateCondition(c, path, errors) {
  if (!c || typeof c !== "object") {
    errors.push(`${path}: condition must be an object`);
    return;
  }
  // AND/OR groups: { all: [...] } (AND) or { any: [...] } (OR). One level deep.
  if (Array.isArray(c.all) || Array.isArray(c.any)) {
    const group = c.all || c.any;
    if (group.length === 0) errors.push(`${path}: ${c.all ? "all" : "any"} group must not be empty`);
    group.forEach((sub, i) => validateCondition(sub, `${path}.${c.all ? "all" : "any"}[${i}]`, errors));
    return;
  }
  if (!CONDITION_TYPES.includes(c.type)) {
    errors.push(
      `${path}.type: must be one of ${CONDITION_TYPES.join(", ")} (got ${JSON.stringify(c.type)})`,
    );
    return;
  }
  if (c.type === "cross") {
    validateIndicator(c.fast, `${path}.fast`, errors);
    validateIndicator(c.slow, `${path}.slow`, errors);
    if (!["above", "below"].includes(c.dir))
      errors.push(`${path}.dir: must be "above" or "below"`);
  } else if (c.type === "threshold") {
    validateIndicator(c.indicator, `${path}.indicator`, errors);
    if (![">", "<", ">=", "<="].includes(c.op))
      errors.push(`${path}.op: must be one of >, <, >=, <=`);
    if (!isFiniteNum(c.value))
      errors.push(`${path}.value: must be a finite number`);
  } else if (c.type === "breakout") {
    if (!isInt(c.lookback))
      errors.push(`${path}.lookback: must be a positive integer`);
    if (!["high", "low"].includes(c.dir))
      errors.push(`${path}.dir: must be "high" or "low"`);
  } else if (c.type === "volume") {
    if (c.period != null && !isInt(c.period)) errors.push(`${path}.period: must be a positive integer`);
    if (c.mult != null && !(isFiniteNum(c.mult) && c.mult > 0)) errors.push(`${path}.mult: must be a positive number`);
  }
}

function validateTrailingStop(ts, errors) {
  if (ts == null) return;
  if (typeof ts !== "object") { errors.push("trailingStop: must be an object or null"); return; }
  if (ts.type === "atr") {
    if (ts.period != null && !isInt(ts.period)) errors.push("trailingStop.period: must be a positive integer");
    if (ts.mult != null && !(isFiniteNum(ts.mult) && ts.mult > 0)) errors.push("trailingStop.mult: must be a positive number");
  } else if (ts.type === "pct") {
    if (!(isFiniteNum(ts.value) && ts.value > 0 && ts.value < 1)) errors.push("trailingStop.value: must be a fraction in (0,1)");
  } else {
    errors.push('trailingStop.type: must be "atr" or "pct"');
  }
}

/**
 * Validate a strategy spec. Returns { ok, errors:[], spec } where spec is a
 * normalized clone when ok. Never throws.
 */
export function validateSpec(raw) {
  const errors = [];
  if (!raw || typeof raw !== "object") {
    return { ok: false, errors: ["spec must be an object"], spec: null };
  }
  const spec = {
    name:
      typeof raw.name === "string" && raw.name.trim()
        ? raw.name.trim()
        : "Untitled strategy",
    direction: DIRECTIONS.includes(raw.direction) ? raw.direction : "long_flat",
    entry: Array.isArray(raw.entry) ? raw.entry : null,
    exit: Array.isArray(raw.exit) ? raw.exit : null,
    stopLoss: raw.stopLoss == null ? null : raw.stopLoss,
    takeProfit: raw.takeProfit == null ? null : raw.takeProfit,
    trailingStop: raw.trailingStop == null ? null : raw.trailingStop,
  };

  if (!DIRECTIONS.includes(raw.direction)) {
    errors.push(
      `direction: must be one of ${DIRECTIONS.join(", ")} (defaulted to long_flat)`,
    );
  }
  if (!spec.entry || spec.entry.length === 0) {
    errors.push("entry: at least one entry condition is required");
  } else {
    spec.entry.forEach((c, i) => validateCondition(c, `entry[${i}]`, errors));
  }
  if (spec.exit) {
    spec.exit.forEach((c, i) => validateCondition(c, `exit[${i}]`, errors));
  }
  if (
    spec.stopLoss != null &&
    !(isFiniteNum(spec.stopLoss) && spec.stopLoss > 0 && spec.stopLoss < 1)
  ) {
    errors.push("stopLoss: must be a fraction in (0,1), e.g. 0.05 for 5%");
  }
  if (
    spec.takeProfit != null &&
    !(isFiniteNum(spec.takeProfit) && spec.takeProfit > 0)
  ) {
    errors.push("takeProfit: must be a positive fraction, e.g. 0.10 for 10%");
  }
  validateTrailingStop(spec.trailingStop, errors);

  // a fatal error is anything that isn't a recovered default.
  const fatal = errors.filter((e) => !e.includes("defaulted"));
  return {
    ok: fatal.length === 0,
    errors,
    spec: fatal.length === 0 ? spec : null,
  };
}

/** Warmup bars an indicator needs before it produces a value. */
function indicatorLookback(ind) {
  if (!ind) return 1;
  switch (ind.kind) {
    case "price": return 1;
    case "macd": return (ind.slow || 26) + 1;
    case "macdSignal": return (ind.slow || 26) + (ind.signal || 9) + 1;
    case "bbUpper": case "bbLower": case "bbMiddle": return (ind.period || 20) + 1;
    case "atr": return (ind.period || 14) + 1;
    default: return (ind.period || 1) + 1;
  }
}

/** Longest indicator lookback in a spec — used to size the warmup window. */
export function maxLookback(spec) {
  let m = 1;
  const consider = (ind) => { m = Math.max(m, indicatorLookback(ind)); };
  const walk = (c) => {
    if (!c) return;
    if (Array.isArray(c.all)) { c.all.forEach(walk); return; }
    if (Array.isArray(c.any)) { c.any.forEach(walk); return; }
    if (c.type === "cross") { consider(c.fast); consider(c.slow); }
    else if (c.type === "threshold") consider(c.indicator);
    else if (c.type === "breakout") m = Math.max(m, c.lookback + 1);
    else if (c.type === "volume") m = Math.max(m, (c.period || 20) + 1);
  };
  (spec.entry || []).forEach(walk);
  (spec.exit || []).forEach(walk);
  return m;
}
