import { describe, it, expect } from "vitest";
import { parseAI } from "../parser/aiParser.js";
import { parseStrategy } from "../parser/index.js";
import { validateSpec } from "../engine/schema.js";

// AI-1 (offline, mocked): the LLM is the primary parser, but every path here is
// deterministic — the model is replaced by RECORDED FIXTURE responses through an
// injected transport, so tests never touch the network and never depend on a
// key. We assert: golden descriptions → expected schema-valid specs; an invalid
// model output triggers one repair then falls back to grammar; and an ambiguous
// description triggers exactly one clarifying question.

// ── recorded fixtures (shape of a real Anthropic tool-use response) ──────────
const submitResp = (input) => ({ content: [{ type: "tool_use", name: "submit_strategy", input }] });
const clarifyResp = (question, dimension) => ({ content: [{ type: "tool_use", name: "ask_clarification", input: { question, dimension } }] });

const GOLDEN_CROSS = {
  name: "Golden cross (50/200 SMA)", direction: "long_flat",
  entry: [{ type: "cross", fast: { kind: "sma", period: 50 }, slow: { kind: "sma", period: 200 }, dir: "above" }],
  exit: null, stopLoss: null, takeProfit: null,
  unsupported: [], assumptions: ["Used simple (not exponential) moving averages, as the user didn't specify."],
};
const RSI_REVERSION = {
  name: "RSI(14) mean-reversion", direction: "long_flat",
  entry: [{ type: "threshold", indicator: { kind: "rsi", period: 14 }, op: "<", value: 30 }],
  exit: [{ type: "threshold", indicator: { kind: "rsi", period: 14 }, op: ">", value: 60 }],
  stopLoss: null, takeProfit: null, unsupported: [], assumptions: [],
};
// An intentionally invalid spec (bad indicator kind + missing cross dir).
const INVALID_SPEC = {
  name: "broken", direction: "long_flat",
  entry: [{ type: "cross", fast: { kind: "supertrend", period: 10 }, slow: { kind: "sma", period: 200 } }],
  exit: null, stopLoss: null, takeProfit: null,
};

// A transport that replays queued fixtures in order and records each request.
function mockTransport(queue) {
  const calls = [];
  const fn = async (request) => {
    calls.push(request);
    const r = queue[calls.length - 1];
    if (r === undefined) throw new Error("mock transport: no more queued responses");
    if (r instanceof Error) throw r;
    return r;
  };
  fn.calls = calls;
  return fn;
}

describe("AI parser — golden descriptions → expected specs", () => {
  it("maps a golden-cross description to the exact schema-valid spec", async () => {
    const t = mockTransport([submitResp(GOLDEN_CROSS)]);
    const r = await parseAI("go long when the 50-day SMA crosses above the 200-day", { transport: t, key: "test" });
    expect(r.ok).toBe(true);
    expect(r.source).toBe("ai");
    expect(validateSpec(r.spec).ok).toBe(true);
    expect(r.spec.entry[0]).toMatchObject({ type: "cross", dir: "above" });
    expect(r.spec.entry[0].fast).toMatchObject({ kind: "sma", period: 50 });
    expect(r.spec.entry[0].slow).toMatchObject({ kind: "sma", period: 200 });
    expect(r.assumptions.length).toBe(1); // surfaced, not hidden
    expect(t.calls).toHaveLength(1);
  });

  it("maps an RSI mean-reversion description to entry + exit thresholds", async () => {
    const t = mockTransport([submitResp(RSI_REVERSION)]);
    const r = await parseAI("buy when RSI(14) drops below 30, sell when it rises above 60", { transport: t, key: "test" });
    expect(r.ok).toBe(true);
    expect(r.spec.entry[0]).toMatchObject({ type: "threshold", op: "<", value: 30 });
    expect(r.spec.exit[0]).toMatchObject({ type: "threshold", op: ">", value: 60 });
  });

  it("only ever passes the user's TEXT + schema to the model — never prices/results", async () => {
    const t = mockTransport([submitResp(GOLDEN_CROSS)]);
    await parseAI("golden cross on IBM", { transport: t, key: "test" });
    const req = t.calls[0];
    expect(req.messages).toHaveLength(1);
    expect(req.messages[0].role).toBe("user");
    expect(typeof req.messages[0].content).toBe("string");
    expect(req.messages[0].content).toMatch(/golden cross on IBM/);
    // no price series, no metrics, no verdict fields ever leave for the model
    expect(req).not.toHaveProperty("prices");
    expect(req).not.toHaveProperty("data");
    expect(JSON.stringify(req)).not.toMatch(/sharpe|drawdown|equity|verdict/i);
    // structured output is enforced via tools
    expect(req.tools.map((x) => x.name)).toEqual(["submit_strategy", "ask_clarification"]);
  });
});

describe("AI parser — invalid output triggers repair, then fallback", () => {
  it("repairs an invalid spec on one re-prompt (forced submit + errors sent)", async () => {
    const t = mockTransport([submitResp(INVALID_SPEC), submitResp(GOLDEN_CROSS)]);
    const r = await parseAI("some strategy", { transport: t, key: "test" });
    expect(r.ok).toBe(true);
    expect(validateSpec(r.spec).ok).toBe(true);
    expect(t.calls).toHaveLength(2);
    // the repair request forces a submit and includes the validation errors
    expect(t.calls[1].tool_choice).toEqual({ type: "tool", name: "submit_strategy" });
    expect(t.calls[1].messages[0].content).toMatch(/FAILED schema validation/i);
  });

  it("throws when the spec is still invalid after the single repair", async () => {
    const t = mockTransport([submitResp(INVALID_SPEC), submitResp(INVALID_SPEC)]);
    await expect(parseAI("some strategy", { transport: t, key: "test" })).rejects.toThrow(/invalid spec/i);
    expect(t.calls).toHaveLength(2); // exactly one repair, no more
  });

  it("parseStrategy falls back to the grammar parser when AI stays invalid", async () => {
    const t = mockTransport([submitResp(INVALID_SPEC), submitResp(INVALID_SPEC)]);
    // text the deterministic grammar CAN parse, so the fallback yields a real spec
    const r = await parseStrategy("50-day sma crosses above the 200-day sma", "english", { transport: t, key: "test" });
    expect(r.source).toBe("local");
    expect(r.fellBack).toBe(true);
    expect(r.ok).toBe(true);
    expect(validateSpec(r.spec).ok).toBe(true);
  });

  it("no key and no transport → throws (caller falls back)", async () => {
    await expect(parseAI("anything", {})).rejects.toThrow(/No Anthropic API key/i);
  });
});

describe("AI parser — clarifier", () => {
  it("returns exactly one clarifying question on a materially ambiguous input", async () => {
    const t = mockTransport([clarifyResp("Long-only, or also short when the trend flips?", "direction")]);
    const r = await parseAI("trade the trend", { transport: t, key: "test" });
    expect(r.ok).toBe(false);
    expect(r.clarify.question).toMatch(/short/i);
    expect(r.clarify.dimension).toBe("direction");
    expect(t.calls).toHaveLength(1);
  });

  it("re-parses into a spec once the answer is supplied", async () => {
    const t = mockTransport([submitResp(GOLDEN_CROSS)]);
    const r = await parseAI("trade the trend", {
      transport: t, key: "test",
      clarifications: [{ question: "Long-only or long/short?", answer: "long only" }],
    });
    expect(r.ok).toBe(true);
    expect(validateSpec(r.spec).ok).toBe(true);
    // the prior Q&A is forwarded to the model
    expect(t.calls[0].messages[0].content).toMatch(/long only/i);
  });

  it("caps clarifications: at the cap it forces a submit instead of asking again", async () => {
    // Even if the model WOULD ask, at the cap tool_choice forces submit_strategy.
    const t = mockTransport([submitResp(GOLDEN_CROSS)]);
    const r = await parseAI("trade the trend", {
      transport: t, key: "test",
      clarifications: [{ question: "q1", answer: "a1" }, { question: "q2", answer: "a2" }],
    });
    expect(r.ok).toBe(true);
    expect(t.calls[0].tool_choice).toEqual({ type: "tool", name: "submit_strategy" });
  });

  it("parseStrategy passes a clarify result straight through (not a fallback)", async () => {
    const t = mockTransport([clarifyResp("What closes the position?", "exit")]);
    const r = await parseStrategy("buy strong stocks", "english", { transport: t, key: "test" });
    expect(r.clarify).toBeTruthy();
    expect(r.fellBack).toBe(false);
    expect(r.source).toBe("ai");
  });
});
