// ── Hallucination guard for the autopsy: grounding by construction ──────────
//
// The autopsy's LLM phrasing may reference ONLY facts the engine computed. This
// module ENFORCES that in code rather than trusting the prompt: it derives the
// exact set of numbers present in the diagnostic payload, then checks that every
// number in the model's output maps to one of them. If the model introduces any
// unsupported number, the output is rejected and the caller uses the
// deterministic templated explanation instead. Grounding is therefore
// guaranteed by code, not by the model's good behavior.
//
// Direction of safety: when in doubt, REJECT. A false rejection just falls back
// to the (always-grounded) template; a false acceptance would let an ungrounded
// number through, which is the one thing we must never allow. Rounding variants
// of a real figure are still that figure — allowing them does not admit any new
// fact.

// Canonical string key for a number (4 dp; kills -0).
function canon(v) {
  const r = Math.round(v * 10000) / 10000;
  return String(r === 0 ? 0 : r);
}

/** Every numeric literal in a string, as floats (handles commas, %, sign). */
export function extractNumbers(text) {
  const out = [];
  const re = /-?\d[\d,]*(?:\.\d+)?/g;
  let m;
  while ((m = re.exec(String(text || ""))) !== null) {
    const v = parseFloat(m[0].replace(/,/g, ""));
    if (Number.isFinite(v)) out.push(v);
  }
  return out;
}

/**
 * The set of numbers the model is allowed to use, derived from the serialized
 * payload. For each figure we admit the value itself plus its 0/1/2-dp
 * roundings and absolute value — a model that rounds "0.40" to "0.4" or "49.3%"
 * to "49%" is still grounded; it has introduced no new fact.
 */
export function allowedNumberSet(payload) {
  const set = new Set();
  const add = (v) => {
    if (!Number.isFinite(v)) return;
    for (const w of [v, Math.abs(v)]) {
      set.add(canon(w));
      set.add(canon(Math.round(w)));
      set.add(canon(Math.round(w * 10) / 10));
      set.add(canon(Math.round(w * 100) / 100));
    }
  };
  const json = typeof payload === "string" ? payload : JSON.stringify(payload ?? {});
  const re = /\d[\d,]*(?:\.\d+)?/g;
  let m;
  while ((m = re.exec(json)) !== null) add(parseFloat(m[0].replace(/,/g, "")));
  return set;
}

/**
 * True iff EVERY number in `text` maps to a number in the payload (or a set
 * built from it). Text with no numbers is trivially grounded.
 */
export function isGrounded(text, payloadOrSet) {
  const allowed = payloadOrSet instanceof Set ? payloadOrSet : allowedNumberSet(payloadOrSet);
  for (const n of extractNumbers(text)) {
    if (!allowed.has(canon(n)) && !allowed.has(canon(Math.abs(n)))) return false;
  }
  return true;
}

// The first ungrounded number (for diagnostics/tests), or null if fully grounded.
export function firstUngrounded(text, payloadOrSet) {
  const allowed = payloadOrSet instanceof Set ? payloadOrSet : allowedNumberSet(payloadOrSet);
  for (const n of extractNumbers(text)) {
    if (!allowed.has(canon(n)) && !allowed.has(canon(Math.abs(n)))) return n;
  }
  return null;
}

// Secondary guard: catch OUTPUT that coaches toward a pass (explicit parameter
// changes / "to make it pass"), even if the question itself slipped past the
// input gate. Deliberately narrow to avoid flagging plain description.
const COACH_OUT_RE = new RegExp(
  [
    "\\bto (make|get) (it|this|the strategy)\\b[^.?!]{0,24}\\b(pass|profitable|green|work|survive|win)\\b",
    "\\b(set|change|increase|decrease|raise|lower|widen|tighten|bump)\\b[^.?!]{0,24}\\b(to|up to|down to)\\b\\s*-?\\d",
    "\\b(you|i'?d|we)\\s+(could|should|might|can)\\s+(try|set|use|switch to|increase|decrease|raise|lower)\\b[^.?!]{0,24}\\b\\d",
  ].join("|"),
  "i",
);

export function looksLikeCoaching(text) {
  return COACH_OUT_RE.test(String(text || ""));
}
