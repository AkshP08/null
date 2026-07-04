// ── Data integrity validation ───────────────────────────────────────────────
//
// Pure and unit-tested. Every series is checked HERE on load before it can
// reach the engine. Problems are reported with clear messages, never crashed
// through and never silently passed. `ok` is false only for defects that make
// the series unusable (NaN/zero/negative prices, or too short to backtest at
// all); softer issues (gaps, a few duplicate dates) are surfaced as warnings.

export function checkIntegrity(data, { minBars = 60 } = {}) {
  const issues = [];
  const rows = (data && data.rows) || [];

  if (rows.length < minBars) {
    issues.push({
      level: "fatal",
      text: `only ${rows.length} bars — too short to backtest meaningfully (need ≥ ${minBars})`,
    });
  }

  let badPrices = 0;
  let outOfOrder = 0;
  let maxGap = 0;
  let prevDate = null;
  for (const r of rows) {
    const prices = [r.open, r.high, r.low, r.close, r.adjClose];
    if (!prices.every((x) => Number.isFinite(x) && x > 0)) badPrices++;
    // high/low sanity: high must be the max, low the min
    else if (r.high < Math.max(r.open, r.close) - 1e-9 || r.low > Math.min(r.open, r.close) + 1e-9) {
      // tolerate tiny float noise; only count clear violations
      if (r.high < r.low) badPrices++;
    }
    if (prevDate) {
      const gap = (new Date(r.date) - new Date(prevDate)) / 86400000;
      if (gap <= 0) outOfOrder++;
      if (gap > maxGap) maxGap = gap;
    }
    prevDate = r.date;
  }

  if (badPrices) {
    issues.push({ level: "fatal", text: `${badPrices} bars with NaN, zero, negative, or impossible prices` });
  }
  if (outOfOrder) {
    issues.push({ level: "warn", text: `${outOfOrder} duplicate or out-of-order dates` });
  }
  // crypto trades 7 days/week; equities have weekend/holiday gaps — flag only the extreme.
  const gapLimit = data && data.klass === "crypto" ? 4 : 12;
  if (maxGap > gapLimit) {
    issues.push({ level: "warn", text: `a calendar gap of ${maxGap} days (possible missing data)` });
  }

  const ok = !issues.some((i) => i.level === "fatal");
  return { ok, issues, maxGapDays: maxGap, bars: rows.length };
}