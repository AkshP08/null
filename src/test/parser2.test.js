import { describe, it, expect } from "vitest";
import { parseLocal } from "../parser/localParser.js";
import { validateSpec } from "../engine/schema.js";
import { toPineScript } from "../parser/pineExport.js";
import { describeSpec } from "../parser/aiParser.js";

const parse = (s) => { const r = parseLocal(s); expect(r.ok).toBe(true); expect(validateSpec(r.spec).ok).toBe(true); return r.spec; };

describe("local parser — widened constructs", () => {
  it("MACD bullish cross", () => {
    const spec = parse("go long when the MACD crosses above its signal line");
    expect(spec.entry[0]).toMatchObject({ type: "cross", dir: "above" });
    expect(spec.entry[0].fast.kind).toBe("macd");
    expect(spec.entry[0].slow.kind).toBe("macdSignal");
  });

  it("Bollinger lower-band reversion", () => {
    const spec = parse("buy when price closes below the lower Bollinger band");
    expect(spec.entry[0].slow.kind).toBe("bbLower");
    expect(spec.entry[0].dir).toBe("below");
  });

  it("ROC threshold", () => {
    const spec = parse("go long when the 10-day rate of change is above 5");
    expect(spec.entry[0]).toMatchObject({ type: "threshold", op: ">", value: 5 });
    expect(spec.entry[0].indicator).toMatchObject({ kind: "roc", period: 10 });
  });

  it("volume filter combined with a cross (AND)", () => {
    const spec = parse("go long when the 50 sma crosses above the 200 sma and volume is above average");
    const types = spec.entry.map((c) => c.type);
    expect(types).toContain("cross");
    expect(types).toContain("volume");
  });

  it("ATR trailing stop", () => {
    const spec = parse("go long when the 20 sma crosses above the 50 sma with a 3x ATR trailing stop");
    expect(spec.trailingStop).toMatchObject({ type: "atr", mult: 3 });
  });

  it("OR combination", () => {
    const spec = parse("go long when RSI(14) is below 30 or price crosses below the lower bollinger band");
    expect(spec.entry.length).toBe(1);
    expect(Array.isArray(spec.entry[0].any)).toBe(true);
    expect(spec.entry[0].any.length).toBeGreaterThanOrEqual(2);
  });

  it("still discloses genuinely unsupported indicators", () => {
    const r = parseLocal("buy when the stochastic crosses up and ADX is above 25, 50/200 sma cross");
    expect(r.unsupported.join(" ")).toMatch(/stochastic|adx|not yet supported/i);
  });
});

describe("Pine export — widened constructs emit valid v5", () => {
  it("MACD + volume + ATR trailing stop export", () => {
    const spec = parse("go long when the MACD crosses above its signal and volume is above average, 3x ATR trailing stop");
    const code = toPineScript(spec);
    expect(code).toContain("//@version=5");
    expect(code).toContain("ta.ema(close, 12) - ta.ema(close, 26)");
    expect(code).toContain("ta.sma(volume, 20)");
    expect(code).toContain("ta.atr(14)");
    expect(code).toMatch(/strategy\.close\("Long", comment="ATR trail"\)/);
  });
  it("Bollinger export uses stdev bands", () => {
    const spec = parse("buy when price closes below the lower bollinger band");
    expect(toPineScript(spec)).toContain("ta.stdev(close, 20)");
  });
});

describe("describeSpec renders the widened set", () => {
  it("describes MACD, OR groups and trailing stops", () => {
    const spec = parse("go long when RSI(14) is below 30 or the MACD crosses above its signal, 5% trailing stop");
    const notes = describeSpec(spec).join(" ");
    expect(notes).toMatch(/OR/);
    expect(notes).toMatch(/MACD/);
    expect(notes).toMatch(/Trailing stop/i);
  });
});
