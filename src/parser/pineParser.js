// ── Pine Script (subset) parser ─────────────────────────────────────────────
//
// Recognizes the common Pine v5 constructs and maps them to the strategy spec.
// Supported: ta.sma / ta.ema / ta.rsi, ta.crossover / ta.crossunder, threshold
// comparisons on those indicators, strategy.entry / strategy.close, and
// stop / limit via strategy.exit (loss=/profit= or stop=/limit=).
//
// Anything outside the subset is reported in `unsupported`, never silently
// dropped. Pine syntax varies; this parser is intentionally permissive and
// disclosing rather than a full interpreter.

const NUM = "(\\d+(?:\\.\\d+)?)";

// match `name = ta.sma(close, 50)` style variable definitions
function collectIndicatorVars(src) {
  const vars = {};
  const re =
    /(\w+)\s*=\s*ta\.(sma|ema|rsi)\s*\(\s*(?:close|hlc3|open|src|ohlc4)?\s*,?\s*(\d+)\s*\)/gi;
  let m;
  while ((m = re.exec(src))) {
    vars[m[1]] = { kind: m[2].toLowerCase(), period: parseInt(m[3], 10) };
  }
  return vars;
}

function resolveOperand(tok, vars) {
  tok = tok.trim();
  if (vars[tok]) return { ...vars[tok] };
  let m = tok.match(/ta\.(sma|ema|rsi)\s*\(\s*\w*\s*,?\s*(\d+)\s*\)/i);
  if (m) return { kind: m[1].toLowerCase(), period: parseInt(m[2], 10) };
  if (/^close$|^src$|^hlc3$|^open$/i.test(tok)) return { kind: "price" };
  if (/^\d+(\.\d+)?$/.test(tok)) return { literal: parseFloat(tok) };
  return null;
}

export function parsePine(src) {
  const raw = (src || "").trim();
  if (!raw)
    return {
      ok: false,
      spec: null,
      notes: [],
      unsupported: [],
      source: "pine",
      error: "Empty input.",
    };

  const notes = [];
  const unsupported = [];
  const entry = [];
  const exit = [];
  let stopLoss = null;
  let takeProfit = null;
  let direction = "long_flat";
  const vars = collectIndicatorVars(raw);

  // strategy name
  const nameM = raw.match(/strategy\s*\(\s*["']([^"']+)["']/);
  let name = nameM ? nameM[1] : "Pine strategy";

  // ── crossover / crossunder ────────────────────────────────────────────────
  const crossRe =
    /ta\.(crossover|crossunder)\s*\(\s*([^,]+?)\s*,\s*([^)]+?)\s*\)/gi;
  let cm;
  while ((cm = crossRe.exec(raw))) {
    const a = resolveOperand(cm[2], vars);
    const b = resolveOperand(cm[3], vars);
    const dir = cm[1].toLowerCase() === "crossover" ? "above" : "below";
    if (a && b && a.kind && b.kind && !a.literal && !b.literal) {
      entry.push({ type: "cross", fast: a, slow: b, dir });
      notes.push(
        `ta.${cm[1]}(${cm[2].trim()}, ${cm[3].trim()}) → ${a.kind.toUpperCase()}(${a.period ?? "·"}) crosses ${dir} ${b.kind.toUpperCase()}(${b.period ?? "·"}).`,
      );
    } else if (a && b && (a.literal != null || b.literal != null)) {
      // crossover against a constant → threshold
      const ind = a.literal != null ? b : a;
      const lit = a.literal != null ? a.literal : b.literal;
      entry.push({
        type: "threshold",
        indicator: ind,
        op: dir === "above" ? ">" : "<",
        value: lit,
      });
      notes.push(
        `ta.${cm[1]} against ${lit} → ${ind.kind.toUpperCase()} ${dir === "above" ? ">" : "<"} ${lit}.`,
      );
    } else {
      unsupported.push(
        `Could not resolve operands of ta.${cm[1]}(${cm[2].trim()}, ${cm[3].trim()}).`,
      );
    }
  }

  // ── explicit threshold comparisons feeding entries (rsi < 30 etc.) ────────
  // look for `... rsi ... < 30` patterns in entry conditions
  const cmpRe = new RegExp(
    `(\\w+|ta\\.rsi\\s*\\([^)]*\\))\\s*(<=|>=|<|>)\\s*${NUM}`,
    "gi",
  );
  let pm;
  while ((pm = cmpRe.exec(raw))) {
    const ind = resolveOperand(pm[1], vars);
    if (ind && ind.kind && !ind.literal) {
      const cond = {
        type: "threshold",
        indicator: ind,
        op: pm[2],
        value: parseFloat(pm[3]),
      };
      // heuristic: oversold-type (< value) is entry; overbought (> value on same indicator) is exit
      if (
        entry.some(
          (e) =>
            e.type === "threshold" &&
            JSON.stringify(e.indicator) === JSON.stringify(ind),
        )
      ) {
        exit.push(cond);
        notes.push(
          `Exit condition: ${ind.kind.toUpperCase()} ${pm[2]} ${pm[3]}.`,
        );
      } else {
        entry.push(cond);
        notes.push(
          `Entry condition: ${ind.kind.toUpperCase()} ${pm[2]} ${pm[3]}.`,
        );
      }
    }
  }

  // ── stop / take profit via strategy.exit ──────────────────────────────────
  // loss=/profit= are in ticks/points in real Pine; we accept a percent form
  // loss=close*0.05 or a stop=/limit= and DISCLOSE the interpretation.
  const pctStop =
    raw.match(/stop(?:loss)?\s*[:=]\s*(\d+(?:\.\d+)?)\s*%/i) ||
    raw.match(/(\d+(?:\.\d+)?)\s*%\s*stop/i);
  if (pctStop) {
    stopLoss = parseFloat(pctStop[1]) / 100;
    notes.push(`Stop loss ≈ ${pctStop[1]}% (from Pine exit).`);
  } else if (/strategy\.exit/i.test(raw) && /(loss|stop)\s*=/.test(raw)) {
    unsupported.push(
      'A strategy.exit stop in ticks/points was found. Express stops as a percentage (e.g. "5% stop") so the engine can apply them precisely.',
    );
  }
  const pctTp =
    raw.match(/(?:take ?profit|profit|target)\s*[:=]\s*(\d+(?:\.\d+)?)\s*%/i) ||
    raw.match(/(\d+(?:\.\d+)?)\s*%\s*(?:take ?profit|target)/i);
  if (pctTp) {
    takeProfit = parseFloat(pctTp[1]) / 100;
    notes.push(`Take profit ≈ ${pctTp[1]}%.`);
  }

  // ── direction ─────────────────────────────────────────────────────────────
  if (/strategy\.entry\s*\([^)]*strategy\.short|strategy\.short/i.test(raw)) {
    direction = "long_short";
    notes.push("strategy.short detected → long/short mode.");
  }

  // ── disclose unsupported constructs ───────────────────────────────────────
  const unsup = [
    [
      /ta\.(macd|bb|bbw|stoch|atr|adx|vwap|obv|wma|hma|supertrend|sar)\b/i,
      "an unsupported ta.* indicator",
    ],
    [
      /request\.security|security\(/i,
      "multi-timeframe request.security() (not modeled)",
    ],
    [
      /\bfor\b|\bwhile\b|array\.|matrix\./i,
      "loops / arrays (the engine evaluates declarative conditions only)",
    ],
    [
      /strategy\.exit[^)]*trail/i,
      "a trailing stop (only fixed % stop/target supported)",
    ],
    [
      /input\./i,
      "input() parameters — values are read as written; nothing is optimized",
    ],
  ];
  for (const [re, label] of unsup) {
    if (re.test(raw))
      unsupported.push(`Pine uses ${label}. That part was NOT translated.`);
  }

  const ok = entry.length > 0;
  if (!ok)
    unsupported.push(
      "No supported entry condition (ta.crossover/crossunder or a threshold comparison) was found.",
    );

  return {
    ok,
    spec: ok
      ? {
          name,
          direction,
          entry,
          exit: exit.length ? exit : null,
          stopLoss,
          takeProfit,
        }
      : null,
    notes,
    unsupported,
    source: "pine",
  };
}
