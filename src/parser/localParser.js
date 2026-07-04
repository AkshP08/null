// ── Deterministic local parser (plain English → strategy spec) ──────────────
//
// No network. This is the guaranteed fallback: the tool must work offline and
// must never hard-fail because an API was unreachable. It recognizes the
// supported construct set via keyword/grammar matching and HONESTLY reports any
// clause it could not represent in `unsupported`, rather than silently dropping
// it.

const NUM = "(\\d+(?:\\.\\d+)?)";

function indicatorFromWords(periodStr, kindHint) {
  const period = parseInt(periodStr, 10);
  let kind = "sma";
  if (/\bema\b|exponential/i.test(kindHint)) kind = "ema";
  else if (/\bsma\b|simple|moving average|\bma\b|average/i.test(kindHint))
    kind = "sma";
  return { kind, period };
}

/**
 * Parse plain English into a spec + disclosure of what was/wasn't understood.
 * @returns { ok, spec, notes:[], unsupported:[], source:'local' }
 */
export function parseLocal(text) {
  const raw = (text || "").trim();
  const t = raw.toLowerCase();
  const notes = [];
  const unsupported = [];
  const entry = [];
  let exit = [];
  let direction = "long_flat";
  let stopLoss = null;
  let takeProfit = null;
  let trailingStop = null;
  let name = "Parsed strategy";

  if (!raw)
    return {
      ok: false,
      spec: null,
      notes: [],
      unsupported: [],
      source: "local",
      error: "Empty input.",
    };

  // ── Direction ─────────────────────────────────────────────────────────────
  if (/\b(short|long\/short|long-short|go short)\b/.test(t)) {
    direction = "long_short";
    notes.push(
      "Detected long/short: the strategy will hold a short position when not long.",
    );
  }

  // ── MA crossover (incl. "golden cross" / "death cross") ───────────────────
  // e.g. "50-day average crosses above the 200-day"
  const crossRe = new RegExp(
    `${NUM}[ -]?(?:day|period|bar)?\\s*(sma|ema|simple moving average|exponential moving average|moving average|ma|average)?\\s*(?:crosses?|cross)\\s*(above|over|below|under)\\s*(?:the\\s*)?${NUM}[ -]?(?:day|period|bar)?\\s*(sma|ema|simple moving average|exponential moving average|moving average|ma|average)?`,
    "i",
  );
  const crossM = raw.match(crossRe);
  if (crossM) {
    const fast = indicatorFromWords(
      crossM[1],
      (crossM[2] || "") + " " + (crossM[5] || ""),
    );
    const slow = indicatorFromWords(
      crossM[4],
      (crossM[5] || "") + " " + (crossM[2] || ""),
    );
    const dir = /above|over/i.test(crossM[3]) ? "above" : "below";
    entry.push({ type: "cross", fast, slow, dir });
    name = `${fast.period}/${slow.period} ${fast.kind.toUpperCase()} crossover`;
    notes.push(
      `Entry: ${fast.period}-period ${fast.kind.toUpperCase()} crosses ${dir} ${slow.period}-period ${slow.kind.toUpperCase()}.`,
    );
  } else if (/golden cross/.test(t)) {
    entry.push({
      type: "cross",
      fast: { kind: "sma", period: 50 },
      slow: { kind: "sma", period: 200 },
      dir: "above",
    });
    name = "Golden cross (50/200 SMA)";
    notes.push('Interpreted "golden cross" as 50-SMA crossing above 200-SMA.');
  } else if (/death cross/.test(t)) {
    entry.push({
      type: "cross",
      fast: { kind: "sma", period: 50 },
      slow: { kind: "sma", period: 200 },
      dir: "below",
    });
    name = "Death cross (50/200 SMA)";
    notes.push('Interpreted "death cross" as 50-SMA crossing below 200-SMA.');
  }

  // ── Price vs MA threshold ("price above the 200-day average") ──────────────
  if (entry.length === 0) {
    const pmaRe = new RegExp(
      `price\\s*(?:is\\s*)?(above|over|below|under)\\s*(?:the\\s+|its\\s+|their\\s+|a\\s+|an\\s+)?${NUM}[ -]?(?:day|period|bar)?\\s*(sma|ema|moving average|ma|average)?`,
      "i",
    );
    const pmaM = raw.match(pmaRe);
    if (pmaM) {
      const ind = indicatorFromWords(pmaM[2], pmaM[3] || "");
      // price>MA expressed as a cross-state of price vs MA
      const dir = /above|over/i.test(pmaM[1]) ? "above" : "below";
      entry.push({ type: "cross", fast: { kind: "price" }, slow: ind, dir });
      name = `Price ${dir} ${ind.period}-${ind.kind.toUpperCase()}`;
      notes.push(
        `Entry: price ${dir} its ${ind.period}-period ${ind.kind.toUpperCase()}.`,
      );
    }
  }

  // ── RSI thresholds (entry + matching exit) ────────────────────────────────
  // entry: "RSI below 30" / "RSI < 30" ; exit: "RSI above 70" / "exit ... 70"
  const rsiPeriodM = raw.match(
    new RegExp(`rsi\\s*\\(?\\s*${NUM}\\s*\\)?\\s*(?:period|day)?`, "i"),
  );
  const rsiPeriod =
    rsiPeriodM &&
    parseInt(rsiPeriodM[1], 10) < 100 &&
    /period|day|\(/.test(rsiPeriodM[0])
      ? parseInt(rsiPeriodM[1], 10)
      : 14;

  const rsiBelow = raw.match(
    new RegExp(
      `rsi[^.]*?(?:below|under|<|less than|drops? below|dips? below)\\s*${NUM}`,
      "i",
    ),
  );
  const rsiAbove = raw.match(
    new RegExp(
      `rsi[^.]*?(?:above|over|>|greater than|rises? above|exceeds?)\\s*${NUM}`,
      "i",
    ),
  );
  if (rsiBelow) {
    const v = parseFloat(rsiBelow[1]);
    entry.push({
      type: "threshold",
      indicator: { kind: "rsi", period: rsiPeriod },
      op: "<",
      value: v,
    });
    name = `RSI(${rsiPeriod}) mean-reversion`;
    notes.push(`Entry: RSI(${rsiPeriod}) below ${v} (oversold).`);
    if (rsiAbove) {
      const ev = parseFloat(rsiAbove[1]);
      exit.push({
        type: "threshold",
        indicator: { kind: "rsi", period: rsiPeriod },
        op: ">",
        value: ev,
      });
      notes.push(`Exit: RSI(${rsiPeriod}) above ${ev} (overbought).`);
    }
  } else if (rsiAbove && !crossM) {
    const v = parseFloat(rsiAbove[1]);
    entry.push({
      type: "threshold",
      indicator: { kind: "rsi", period: rsiPeriod },
      op: ">",
      value: v,
    });
    name = `RSI(${rsiPeriod}) momentum`;
    notes.push(`Entry: RSI(${rsiPeriod}) above ${v}.`);
  }

  // ── Breakout ("breaks above the 20-day high", "20-day high breakout") ──────
  const breakoutM = raw.match(
    new RegExp(
      `${NUM}[ -]?(?:day|period|bar)\\s*(high|low)\\s*breakout|break(?:s|out)?\\s*(?:above|to a new|out (?:above|to))?\\s*(?:the\\s*)?${NUM}[ -]?(?:day|period|bar)\\s*(high|low)`,
      "i",
    ),
  );
  if (breakoutM) {
    const lookback = parseInt(breakoutM[1] || breakoutM[3], 10);
    const dir = (breakoutM[2] || breakoutM[4] || "high").toLowerCase();
    entry.push({ type: "breakout", lookback, dir });
    if (entry.length === 1) name = `${lookback}-day ${dir} breakout`;
    notes.push(`Entry: price makes a new ${lookback}-day ${dir} (breakout).`);
  }

  // ── Stop loss / take profit ───────────────────────────────────────────────
  const stopM = raw.match(
    new RegExp(
      `${NUM}\\s*%?\\s*stop(?:[ -]?loss)?|stop(?:[ -]?loss)?\\s*(?:of|at)?\\s*${NUM}\\s*%`,
      "i",
    ),
  );
  if (stopM) {
    const pctv = parseFloat(stopM[1] || stopM[2]);
    if (Number.isFinite(pctv) && pctv > 0 && pctv < 100) {
      stopLoss = pctv / 100;
      notes.push(
        `Stop loss: exit if price falls ${pctv}% below entry (evaluated on the close).`,
      );
    }
  }
  const tpM = raw.match(
    new RegExp(
      `${NUM}\\s*%?\\s*(?:take[ -]?profit|profit target|target)|(?:take[ -]?profit|profit target|target)\\s*(?:of|at)?\\s*${NUM}\\s*%`,
      "i",
    ),
  );
  if (tpM) {
    const pctv = parseFloat(tpM[1] || tpM[2]);
    if (Number.isFinite(pctv) && pctv > 0) {
      takeProfit = pctv / 100;
      notes.push(
        `Take profit: exit if price rises ${pctv}% above entry (evaluated on the close).`,
      );
    }
  }

  // ── MACD line crossing its signal line ────────────────────────────────────
  if (/\bmacd\b/i.test(t)) {
    const dir = /(above|over|up|bullish)/i.test(t) ? "above" : /(below|under|down|bearish)/i.test(t) ? "below" : null;
    if (dir) {
      entry.push({ type: "cross", fast: { kind: "macd", fast: 12, slow: 26 }, slow: { kind: "macdSignal", fast: 12, slow: 26, signal: 9 }, dir });
      if (entry.length === 1) name = `MACD ${dir === "above" ? "bullish" : "bearish"} cross`;
      notes.push(`Entry: MACD line crosses ${dir} its signal line (12/26/9).`);
    }
  }

  // ── Bollinger band touches ────────────────────────────────────────────────
  if (/bollinger|\bbb\b|bands?\b/i.test(t) && !/\bband\s*of\b/i.test(t)) {
    if (/lower/i.test(t)) {
      entry.push({ type: "cross", fast: { kind: "price" }, slow: { kind: "bbLower", period: 20, mult: 2 }, dir: "below" });
      if (entry.length === 1) name = "Bollinger lower-band reversion";
      notes.push("Entry: price crosses below the lower Bollinger band (20, 2σ).");
    } else if (/upper/i.test(t)) {
      entry.push({ type: "cross", fast: { kind: "price" }, slow: { kind: "bbUpper", period: 20, mult: 2 }, dir: "above" });
      if (entry.length === 1) name = "Bollinger upper-band breakout";
      notes.push("Entry: price crosses above the upper Bollinger band (20, 2σ).");
    }
  }

  // ── Rate of change threshold ──────────────────────────────────────────────
  const rocM = raw.match(/(?:roc|rate of change)\s*\(?\s*(\d+)?\s*\)?[^.]{0,20}?(above|over|below|under|>|<)\s*(-?\d+(?:\.\d+)?)/i);
  if (rocM) {
    const period = rocM[1] ? parseInt(rocM[1], 10) : 10;
    const op = /above|over|>/i.test(rocM[2]) ? ">" : "<";
    entry.push({ type: "threshold", indicator: { kind: "roc", period }, op, value: parseFloat(rocM[3]) });
    if (entry.length === 1) name = `ROC(${period}) momentum`;
    notes.push(`Entry: ${period}-day rate of change ${op} ${parseFloat(rocM[3])}%.`);
  }

  // ── Volume filter ─────────────────────────────────────────────────────────
  if (/volume\s*(?:is\s*)?(?:above|over|greater|>|spik|surg|expand|high)/i.test(t)) {
    const mM = raw.match(/(\d+(?:\.\d+)?)\s*(?:x|times|\*)\s*(?:the\s*)?(?:average|avg|normal)?\s*volume|volume[^.]{0,15}?(\d+(?:\.\d+)?)\s*(?:x|times)/i);
    const mult = mM ? parseFloat(mM[1] || mM[2]) : 1.5;
    entry.push({ type: "volume", period: 20, mult: Number.isFinite(mult) && mult > 0 ? mult : 1.5 });
    notes.push(`Entry filter: volume above ${Number.isFinite(mult) && mult > 0 ? mult : 1.5}× its 20-day average.`);
  }

  // ── ATR / % trailing stop ─────────────────────────────────────────────────
  const atrTrailM = raw.match(/(\d+(?:\.\d+)?)\s*(?:x|times|\*)?\s*atr\s*trail|atr\s*trailing\s*stop\s*(?:of|at)?\s*(\d+(?:\.\d+)?)|trailing\s*stop\s*(?:of|at)?\s*(\d+(?:\.\d+)?)\s*(?:x|times)?\s*atr/i);
  if (atrTrailM) {
    const mult = parseFloat(atrTrailM[1] || atrTrailM[2] || atrTrailM[3] || "3");
    trailingStop = { type: "atr", period: 14, mult: Number.isFinite(mult) && mult > 0 ? mult : 3 };
    notes.push(`Trailing stop: ${trailingStop.mult}× ATR(14) below the running peak (long leg, on the close).`);
  } else {
    const pctTrailM = raw.match(/(\d+(?:\.\d+)?)\s*%\s*trailing\s*stop|trailing\s*stop\s*(?:of|at)?\s*(\d+(?:\.\d+)?)\s*%/i);
    if (pctTrailM) {
      const v = parseFloat(pctTrailM[1] || pctTrailM[2]);
      if (v > 0 && v < 100) {
        trailingStop = { type: "pct", value: v / 100 };
        notes.push(`Trailing stop: ${v}% below the running peak (long leg, on the close).`);
      }
    }
  }

  // ── Combine multiple entry conditions with OR when the text says "or" ──────
  if (entry.length > 1 && /\bor\b/i.test(t) && !/\band\b/i.test(t)) {
    const combined = { any: entry.slice() };
    entry.length = 0;
    entry.push(combined);
    notes.push("Multiple conditions combined with OR (any one triggers entry).");
  }

  // ── Honest disclosure of genuinely unsupported language ───────────────────
  const unsupportedPatterns = [
    [
      /\b(stochastic|adx|vwap|obv|ichimoku|fibonacci|pivot|supertrend|keltner|cci|williams|mfi)\b/i,
      "an indicator not yet supported (available: SMA, EMA, RSI, ROC, MACD, Bollinger, ATR, price, breakout, volume)",
    ],
    [
      /\b(earnings|news|sentiment|open interest|order book)\b/i,
      "a data input outside daily OHLCV, which this engine does not model",
    ],
    [
      /\b(scal(e|ing) (in|out)|pyramid|add to (the )?position|partial (fill|exit))\b/i,
      "position scaling / partial fills (the engine trades all-in / all-out)",
    ],
    [
      /\b(options?|futures spread|leverage|margin call|\d+x\s*(leverage|long|short))\b/i,
      "leverage or derivatives (sizing is fully-invested, unleveraged)",
    ],
  ];
  for (const [re, label] of unsupportedPatterns) {
    if (re.test(t))
      unsupported.push(
        `Your description mentions ${label}. That part was NOT included in the test.`,
      );
  }

  const ok = entry.length > 0;
  if (!ok) {
    unsupported.push(
      'No recognizable entry rule was found. Try phrasing like "buy when the 50-day SMA crosses above the 200-day SMA" or "go long when RSI(14) is below 30".',
    );
  }

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
          trailingStop,
        }
      : null,
    notes,
    unsupported,
    source: "local",
  };
}
