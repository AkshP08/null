// ── AI parser (Anthropic Messages API, tool-use / structured output) ─────────
//
// PRIMARY path for free-form English (and Pine prose) when an API key exists.
// The model's ONLY job is to translate the user's description into the EXISTING
// strategy schema — it never sees prices, never computes a number, never touches
// a metric or verdict. Everything it emits is schema-validated before it can
// reach the engine.
//
// How it stays honest and deterministic-at-the-edges:
//   • STRUCTURED OUTPUT. The model must answer through one of two tools —
//     `submit_strategy` (a spec) or `ask_clarification` (a single question).
//     Forcing a tool call removes free-text/markdown ambiguity.
//   • VALIDATE, then ONE REPAIR, then FALL BACK. Every submitted spec is run
//     through validateSpec(). If it fails, we re-prompt ONCE with the errors; if
//     it still fails we THROW, and the caller falls back to the deterministic
//     grammar parser. An unvalidated spec never leaves this module.
//   • CLARIFIER. If a MATERIAL dimension is ambiguous (entry trigger, exit,
//     direction, timeframe), the model asks ONE targeted question instead of
//     guessing. The caller collects the answer and re-parses. Capped so it can
//     never loop: at the cap we force a submit.
//
// The network call is injectable (`opts.transport`) so tests mock the model with
// recorded fixtures and never hit the wire.

import { validateSpec } from "../engine/schema.js";
import { callAnthropic, proxyUrl } from "../ai/anthropicClient.js";

const MODEL = "claude-sonnet-4-6";
const MAX_CLARIFICATIONS = 2;

const SYSTEM_PROMPT = `You translate a retail trader's plain-English (or Pine Script) strategy description into a strict strategy specification for a look-ahead-free backtest engine.

You do this by calling exactly ONE of the provided tools:
- "submit_strategy": when you can express the strategy in the schema.
- "ask_clarification": ONLY when a MATERIAL dimension is genuinely ambiguous and would change the backtest — specifically the entry trigger, the exit rule, the direction (long-only vs long/short), or the timeframe. Ask ONE short, targeted question. Do NOT ask about cosmetic details, and never ask about something the user already answered.

Never answer in prose. Always call a tool.

You are NOT given prices and you do NOT compute or judge anything — you only structure the rules.

The strategy schema (for submit_strategy):
- name: string
- direction: "long_flat" | "long_short"
- entry: [ Condition, ... ]   // ALL must hold to be in-market; >=1 required
- exit: [ Condition, ... ] | null   // ANY closes the position; null = exit when entry stops holding
- stopLoss: number | null           // fraction, e.g. 0.05 for 5%
- takeProfit: number | null          // fraction, e.g. 0.10 for 10%
- trailingStop: {"type":"atr","period":14,"mult":3} | {"type":"pct","value":0.05} | null
- unsupported: [ string, ... ]       // anything you could NOT represent — disclose, never drop silently
- assumptions: [ string, ... ]       // any reasonable inference you made that the user did not state explicitly

A Condition is one of, OR an AND/OR group:
  {"type":"cross","fast":Indicator,"slow":Indicator,"dir":"above"|"below"}
  {"type":"threshold","indicator":Indicator,"op":">"|"<"|">="|"<=","value":number}
  {"type":"breakout","lookback":integer,"dir":"high"|"low"}
  {"type":"volume","period":integer,"mult":number}   // volume > mult × its period-avg
  {"all":[Condition,...]}   // AND group
  {"any":[Condition,...]}   // OR group

Indicator is one of:
  {"kind":"price"}
  {"kind":"sma"|"ema"|"rsi"|"roc","period":integer}
  {"kind":"macd","fast":12,"slow":26}
  {"kind":"macdSignal","fast":12,"slow":26,"signal":9}
  {"kind":"bbUpper"|"bbLower"|"bbMiddle","period":20,"mult":2}
  {"kind":"atr","period":14}

Rules:
- Use ONLY these constructs. If the user asks for something not expressible (Stochastic, ADX, Ichimoku, options, scaling in/out, leverage, multi-timeframe, news/earnings, etc.), DO NOT invent a substitute — add a clear sentence to "unsupported".
- "Price above its 200-day MA" = cross of {kind:price} above {kind:sma,period:200}. "MACD crosses above signal" = cross of {kind:macd} above {kind:macdSignal}. "Price closes below the lower Bollinger band" = cross of {kind:price} below {kind:bbLower}.
- RSI oversold/overbought are threshold conditions; default RSI period is 14 unless stated.
- Be faithful. Do not add rules the user didn't state. Disclose dropped clauses in "unsupported" and inferred defaults in "assumptions".`;

// ── tool definitions (structured output) ────────────────────────────────────
const INDICATOR_SCHEMA = {
  type: "object",
  properties: {
    kind: { type: "string", enum: ["price", "sma", "ema", "rsi", "roc", "macd", "macdSignal", "bbUpper", "bbLower", "bbMiddle", "atr"] },
    period: { type: "integer" },
    fast: { type: "integer" }, slow: { type: "integer" }, signal: { type: "integer" }, mult: { type: "number" },
  },
  required: ["kind"],
};
const CONDITION_SCHEMA = { type: "object", description: "A single condition {type,...} or an AND/OR group {all:[...]}|{any:[...]}." };
const SUBMIT_TOOL = {
  name: "submit_strategy",
  description: "Submit the fully-structured strategy specification.",
  input_schema: {
    type: "object",
    properties: {
      name: { type: "string" },
      direction: { type: "string", enum: ["long_flat", "long_short"] },
      entry: { type: "array", items: CONDITION_SCHEMA, minItems: 1 },
      exit: { type: ["array", "null"], items: CONDITION_SCHEMA },
      stopLoss: { type: ["number", "null"] },
      takeProfit: { type: ["number", "null"] },
      trailingStop: { type: ["object", "null"] },
      unsupported: { type: "array", items: { type: "string" } },
      assumptions: { type: "array", items: { type: "string" } },
    },
    required: ["name", "direction", "entry"],
  },
};
const CLARIFY_TOOL = {
  name: "ask_clarification",
  description: "Ask ONE short question about a materially ambiguous dimension, instead of guessing.",
  input_schema: {
    type: "object",
    properties: {
      question: { type: "string" },
      dimension: { type: "string", enum: ["entry", "exit", "direction", "timeframe", "other"] },
    },
    required: ["question"],
  },
};
// avoid unused-var noise while keeping the schema self-documenting
void INDICATOR_SCHEMA;

const KEY_STORE = "null_anthropic_key";

function getApiKey() {
  try {
    return (
      import.meta.env?.VITE_ANTHROPIC_API_KEY ||
      (typeof localStorage !== "undefined" &&
        (localStorage.getItem(KEY_STORE) || localStorage.getItem("redteam_anthropic_key"))) ||
      null
    );
  } catch {
    return null;
  }
}

/** Persist a user-supplied key in THIS browser only (never sent anywhere but the API). */
export function setApiKey(key) {
  try {
    if (key && key.trim()) localStorage.setItem(KEY_STORE, key.trim());
    else localStorage.removeItem(KEY_STORE);
  } catch {}
}

/** True only if the key came from the build env (can't be cleared in-app). */
export function keyFromEnv() {
  try { return !!import.meta.env?.VITE_ANTHROPIC_API_KEY; } catch { return false; }
}

export function aiAvailable() {
  // AI is available via the user's own key OR the server-side proxy (demo default).
  return !!getApiKey() || !!proxyUrl();
}

export { getApiKey };

// ── request building + transport ────────────────────────────────────────────

function userContent(text, clarifications, repair) {
  let content = `Strategy description:\n${(text || "").trim()}`;
  if (clarifications && clarifications.length) {
    content +=
      `\n\nClarifications already provided (use these; do not re-ask):\n` +
      clarifications.map((c, i) => `Q${i + 1}: ${c.question}\nA${i + 1}: ${c.answer}`).join("\n");
  }
  if (repair) {
    content +=
      `\n\nYour previous submit_strategy call FAILED schema validation with these errors:\n${repair.errors.join("\n")}\n` +
      `Previous (invalid) input was:\n${JSON.stringify(repair.prevInput)}\n` +
      `Call submit_strategy again with a corrected specification that fixes every error.`;
  }
  return content;
}

function buildRequest({ text, clarifications, forceSubmit, repair }) {
  return {
    model: MODEL,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    tools: [SUBMIT_TOOL, CLARIFY_TOOL],
    tool_choice: forceSubmit ? { type: "tool", name: "submit_strategy" } : { type: "any" },
    messages: [{ role: "user", content: userContent(text, clarifications, repair) }],
  };
}

/** Real transport — direct with the user's key, else via the server proxy. */
async function httpTransport(request, { key, signal, timeoutMs = 20000 } = {}) {
  return callAnthropic(request, { userKey: key, signal, timeoutMs });
}

/** First tool_use block in an API response, or null. */
function findToolUse(data) {
  const blocks = Array.isArray(data?.content) ? data.content : [];
  return blocks.find((b) => b && b.type === "tool_use") || null;
}

function splitSubmit(input) {
  const unsupported = Array.isArray(input?.unsupported)
    ? input.unsupported.filter((s) => typeof s === "string" && s.trim())
    : [];
  const assumptions = Array.isArray(input?.assumptions)
    ? input.assumptions.filter((s) => typeof s === "string" && s.trim())
    : [];
  const { unsupported: _u, assumptions: _a, ...specRaw } = input || {};
  return { specRaw, unsupported, assumptions };
}

function success(spec, unsupported, assumptions, clarifications) {
  return { ok: true, spec, notes: describeSpec(spec), unsupported, assumptions, source: "ai", clarifications };
}

/**
 * Parse a description into a validated spec via the model.
 * @param {string} text
 * @param {object} opts
 *   - clarifications: [{question, answer}] already collected (default [])
 *   - forceSubmit: skip the clarifier and demand a spec (used after a skip)
 *   - transport: injected async (request, ctx) => apiData  (tests / custom)
 *   - key, signal, timeoutMs, maxClarifications
 * @returns
 *   - { ok:true, spec, notes, unsupported, assumptions, source:'ai', clarifications }
 *   - { ok:false, clarify:{question,dimension}, clarifications, source:'ai' }  (needs a question)
 * @throws on missing key, network/HTTP/timeout error, or an invalid spec that
 *   survives one repair — the caller then falls back to the grammar parser.
 */
export async function parseAI(text, opts = {}) {
  const {
    clarifications = [],
    maxClarifications = MAX_CLARIFICATIONS,
    forceSubmit = false,
    transport,
    key: keyOpt,
    signal,
    timeoutMs = 20000,
  } = opts;

  const key = keyOpt || getApiKey();
  // A backend exists if we have a user key OR the server proxy is configured.
  if (!transport && !key && !proxyUrl()) throw new Error("No Anthropic API key or proxy configured.");
  const call = transport || httpTransport;
  const ctx = { key, signal, timeoutMs };

  const capReached = forceSubmit || clarifications.length >= maxClarifications;

  const data = await call(buildRequest({ text, clarifications, forceSubmit: capReached }), ctx);
  const tu = findToolUse(data);
  if (!tu) throw new Error("Model returned no structured tool output.");

  if (tu.name === "ask_clarification" && !capReached) {
    const question = typeof tu.input?.question === "string" ? tu.input.question.trim() : "";
    if (question) {
      return {
        ok: false,
        clarify: { question: question.slice(0, 240), dimension: tu.input?.dimension || "other" },
        clarifications,
        source: "ai",
      };
    }
    // malformed question — force a submit rather than looping.
    const forced = await call(buildRequest({ text, clarifications, forceSubmit: true }), ctx);
    return finalizeSubmit(findToolUse(forced), { text, clarifications, call, ctx });
  }

  return finalizeSubmit(tu, { text, clarifications, call, ctx });
}

/** Validate the submitted spec; on failure, ONE repair re-prompt; else throw. */
async function finalizeSubmit(tu, { text, clarifications, call, ctx }) {
  if (!tu || tu.name !== "submit_strategy") throw new Error("Model did not submit a strategy.");

  const { specRaw, unsupported, assumptions } = splitSubmit(tu.input);
  const v = validateSpec(specRaw);
  if (v.ok) return success(v.spec, unsupported, assumptions, clarifications);

  // ── one repair attempt ────────────────────────────────────────────────────
  const repaired = await call(
    buildRequest({ text, clarifications, forceSubmit: true, repair: { errors: v.errors, prevInput: tu.input } }),
    ctx,
  );
  const tu2 = findToolUse(repaired);
  if (!tu2 || tu2.name !== "submit_strategy") throw new Error(`Model produced an invalid spec: ${v.errors.join("; ")}`);
  const s2 = splitSubmit(tu2.input);
  const v2 = validateSpec(s2.specRaw);
  if (!v2.ok) throw new Error(`Model produced an invalid spec after repair: ${v2.errors.join("; ")}`);
  return success(v2.spec, s2.unsupported, s2.assumptions, clarifications);
}

/** Human-readable name for any indicator, including the widened set. */
export function indicatorLabel(i) {
  if (!i) return "?";
  switch (i.kind) {
    case "price": return "price";
    case "macd": return `MACD(${i.fast || 12},${i.slow || 26})`;
    case "macdSignal": return `MACD signal(${i.signal || 9})`;
    case "bbUpper": return `upper Bollinger band(${i.period || 20},${i.mult || 2}σ)`;
    case "bbLower": return `lower Bollinger band(${i.period || 20},${i.mult || 2}σ)`;
    case "bbMiddle": return `Bollinger midline(${i.period || 20})`;
    case "atr": return `ATR(${i.period || 14})`;
    default: return `${i.period}-period ${i.kind.toUpperCase()}`;
  }
}

/** Describe one condition or AND/OR group in plain language. */
export function describeCondition(c) {
  if (Array.isArray(c.all)) return `(${c.all.map(describeCondition).join(" AND ")})`;
  if (Array.isArray(c.any)) return `(${c.any.map(describeCondition).join(" OR ")})`;
  if (c.type === "cross") return `${indicatorLabel(c.fast)} crosses ${c.dir} ${indicatorLabel(c.slow)}`;
  if (c.type === "threshold") return `${indicatorLabel(c.indicator)} ${c.op} ${c.value}`;
  if (c.type === "breakout") return `price makes a new ${c.lookback}-day ${c.dir}`;
  if (c.type === "volume") return `volume is above ${c.mult || 1.5}× its ${c.period || 20}-day average`;
  return JSON.stringify(c);
}

/** Turn a validated spec into human-readable bullet notes (shared shape). */
export function describeSpec(spec) {
  const notes = [];
  notes.push(`Direction: ${spec.direction === "long_short" ? "long & short" : "long / flat"}.`);
  notes.push(`Enter when ${spec.entry.map(describeCondition).join(" AND ")}.`);
  if (spec.exit && spec.exit.length) notes.push(`Exit when ${spec.exit.map(describeCondition).join(" OR ")}.`);
  else notes.push("Exit when the entry conditions stop holding.");
  if (spec.stopLoss != null) notes.push(`Stop loss at ${(spec.stopLoss * 100).toFixed(1)}% (evaluated on the close).`);
  if (spec.takeProfit != null) notes.push(`Take profit at ${(spec.takeProfit * 100).toFixed(1)}% (evaluated on the close).`);
  if (spec.trailingStop) {
    notes.push(spec.trailingStop.type === "atr"
      ? `Trailing stop: ${spec.trailingStop.mult || 3}× ATR(${spec.trailingStop.period || 14}) below the running peak (long leg, on the close).`
      : `Trailing stop: ${((spec.trailingStop.value || 0) * 100).toFixed(1)}% below the running peak (long leg, on the close).`);
  }
  return notes;
}
