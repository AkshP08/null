// ── Autopsy follow-up: optional AI phrasing over PROVABLY-grounded facts ────
//
// The engine computes the diagnosis (facts). This layer optionally routes a
// follow-up question through Claude for phrasing IF a key is present — but the
// model receives ONLY the structured payload (no prices, no equity, no ability
// to compute), is told to reference only those facts, and its output is then
// VERIFIED IN CODE before the user ever sees it:
//   Gate 1 — coaching questions ("how do I make it pass") never reach the model.
//   Gate 2 — unanswerable questions (predictions, buy/sell, price targets) get
//            "the backtest doesn't show that", also without the model.
//   Gate 3 — the model's answer is checked by the grounding guard: every number
//            must map to a provided fact. Any ungrounded number → discard the AI
//            answer and use the deterministic template.
//   Gate 4 — output that coaches (parameter changes / "to make it pass") → the
//            honest refusal.
// With no key (or any failure) it falls back to the deterministic templated
// answer from engine/autopsy.js. Grounding is guaranteed by code, not trust.

import {
  answerLocal, isOptimizeQuestion, isOutOfScope, REFUSAL, OUT_OF_SCOPE,
  buildAutopsyPayload,
} from "../engine/autopsy.js";
import { isGrounded, looksLikeCoaching } from "./grounding.js";
import { getApiKey } from "../parser/aiParser.js";
import { callAnthropic, proxyUrl } from "./anthropicClient.js";

const MODEL = "claude-sonnet-4-6";

const SYSTEM = `You are the "autopsy" of Null, an adversarial backtest-credibility tester. The user's strategy has already been tested on real data; you explain WHY it performed as it did, using ONLY the numbers provided to you.

Absolute rules:
- Use ONLY the figures in the DIAGNOSIS payload. Never invent, compute, estimate, or infer a number. Quote figures as given. If a figure isn't provided, say you don't have it.
- NEVER suggest parameter values, settings, thresholds, or any change to try. NEVER tell the user how to make the strategy pass, improve, or optimize. You are a coroner, not a coach.
- If the user asks how to make it pass/improve/optimize, tell them plainly that chasing a green verdict by tweaking parameters against the same history IS the overfitting this tool exists to catch — refuse to help tune.
- If the question is about the future, predictions, price targets, or whether to buy/sell/trade, say the backtest doesn't show that.
- This is a credibility stress-test, not investment advice and not a trading signal.
- Be blunt, specific, and concise (under 110 words). Cite the actual provided figures.`;

/** Build the request body sent to the model. Only text + the facts payload. */
function buildRequest(question, payload) {
  return {
    model: MODEL,
    max_tokens: 400,
    system: SYSTEM,
    messages: [{
      role: "user",
      content: `DIAGNOSIS (the ONLY numbers you may use):\n${JSON.stringify(payload, null, 2)}\n\nUser question: ${question}`,
    }],
  };
}

/** Real transport → direct with the user's key, else via the server proxy. */
async function httpTransport(request, { key, timeoutMs = 20000 } = {}) {
  return callAnthropic(request, { userKey: key, timeoutMs });
}

function extractText(data) {
  return (Array.isArray(data?.content) ? data.content : [])
    .filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
}

/**
 * Answer a follow-up question. Returns { text, source:'ai'|'local', ... }.
 * Never throws. `opts.transport` injects the model for offline tests.
 */
export async function askAutopsy(question, { diagnosis, result }, opts = {}) {
  const { timeoutMs = 20000, transport } = opts;

  // Gate 1 & 2 — never reach the model.
  if (isOptimizeQuestion(question)) return { text: REFUSAL, source: "local", reason: "coaching" };
  if (isOutOfScope(question)) return { text: OUT_OF_SCOPE, source: "local", reason: "out-of-scope" };

  const key = getApiKey();
  const payload = buildAutopsyPayload(diagnosis);

  // No backend (no key, no proxy) and no injected transport → deterministic
  // templated answer from the facts.
  if (!transport && !key && !proxyUrl()) return { text: answerLocal(question, diagnosis, result), source: "local" };

  const call = transport || httpTransport;
  try {
    const data = await call(buildRequest(question, payload), { key, timeoutMs });
    const text = extractText(data);
    if (!text) throw new Error("Empty response");

    // Gate 3 — enforced grounding: every number must map to a provided fact.
    if (!isGrounded(text, payload)) {
      return { text: answerLocal(question, diagnosis, result), source: "local", fellBack: true, guard: "ungrounded-number" };
    }
    // Gate 4 — output-side anti-coaching.
    if (looksLikeCoaching(text)) {
      return { text: REFUSAL, source: "local", fellBack: true, guard: "coaching-output" };
    }
    return { text, source: "ai" };
  } catch {
    return { text: answerLocal(question, diagnosis, result), source: "local", fellBack: true };
  }
}
