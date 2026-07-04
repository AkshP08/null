// ── Parser orchestration ────────────────────────────────────────────────────
//
// English: when an API path exists, the LLM is the PRIMARY parser; the keyword
// grammar is the fallback. The AI path may either return a validated spec, or
// ask ONE clarifying question (passed straight through for the UI to answer and
// re-parse). On ANY hard failure — no key, network error, or an invalid spec
// that survives one repair — we fall back silently to the deterministic local
// parser and mark that parsing was local. Pine Script always uses the
// deterministic Pine subset parser.
//
// Every returned object shares the shape:
//   { ok, spec, notes:[], unsupported:[], source, fellBack? }
// or, when the model needs input:
//   { ok:false, clarify:{question,dimension}, clarifications, source:'ai' }

import { parseAI, aiAvailable } from "./aiParser.js";
import { parseLocal } from "./localParser.js";
import { parsePine } from "./pineParser.js";

export { aiAvailable };

export async function parseStrategy(
  text,
  mode /* 'english' | 'pine' */,
  opts = {},
) {
  if (mode === "pine") {
    return parsePine(text);
  }

  // AI is primary whenever a key is configured (or a transport is injected for
  // deterministic, offline tests). Otherwise the grammar parser is primary.
  const useAI = !!opts.transport || aiAvailable();
  if (useAI) {
    try {
      const r = await parseAI(text, opts);
      // A clarify result is NOT a failure — surface it for the UI to answer.
      return { ...r, fellBack: false };
    } catch (err) {
      const local = parseLocal(text);
      return {
        ...local,
        source: "local",
        fellBack: true,
        fallbackReason: err?.message || "AI parsing failed",
      };
    }
  }

  // No key configured — local is the primary, fully-supported path.
  return { ...parseLocal(text), fellBack: false };
}
