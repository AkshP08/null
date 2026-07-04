# Null — Architecture

> The one rule everything else follows: **the AI interprets and explains; the
> engine computes and judges.** The language model never sees a price, never
> computes a number, never touches a metric or a verdict. Every number Null
> shows is produced by a deterministic, look-ahead-free simulation and a
> unit-tested function — never by an LLM.

This document is for a technical reader who wants to understand *why* Null is
built this way and *how* the guarantees are enforced in code rather than
promised in prose.

---

## 1. Why there is a wall

LLMs are excellent at reading a messy human description of a trading idea and
turning it into structure. They are **unreliable at arithmetic** and worse at
multi-step numerical simulation: they will confidently produce a Sharpe ratio, a
drawdown, or a "backtested return" that is plausible and wrong. For a tool whose
entire value proposition is *honest numbers*, letting a model anywhere near the
math would be fatal.

So Null splits the problem along the line the model is good at:

| The model is GOOD at | The model is BAD at |
|---|---|
| Reading free-form English / Pine | Arithmetic, compounding, drawdown |
| Mapping intent → a known schema | Look-ahead-free simulation |
| Phrasing a diagnosis in plain words | Being trusted with a metric or verdict |

The model does the first column. A pure, deterministic engine does the second.
Between them is a **wall**: two narrow, typed, validated crossing points and
nothing else.

```
        INTERPRET  (may use an LLM)                 COMPUTE / JUDGE  (pure, deterministic)
   ┌───────────────────────────────────┐      ┌──────────────────────────────────────────┐
   │  src/parser/*  ·  src/ai/*         │      │  src/engine/*                              │
   │                                    │      │                                            │
   │  English/Pine ─▶ strategy spec ────┼─────▶│  validateSpec()  ── the ONLY way in        │
   │                 (schema-validated) │ gate │      │                                     │
   │                                    │      │      ▼                                     │
   │                                    │      │  backtest() → metrics → verdict            │
   │                                    │      │      │  (real prices, look-ahead-free)     │
   │  autopsy phrasing ◀── facts payload┼──────┼──────┘  diagnose() → structured FACTS      │
   │        │  (numbers only)      gate │ out  │                                            │
   │        ▼                           │      │                                            │
   │  grounding guard: every number     │      │  the engine imports NOTHING from the       │
   │  must map to a provided fact       │      │  interpret side, and never calls a model   │
   └───────────────────────────────────┘      └──────────────────────────────────────────┘
```

The model receives, at most: **the user's text + the schema** (going in) and **a
payload of already-computed facts** (coming out). It never receives a price
series, an equity curve, or a metric function.

---

## 2. The wall is enforced structurally, not by convention

`src/test/moduleBoundary.test.js` fails the build if the boundary is crossed. It
statically analyzes every module's imports and asserts:

- **The engine (`src/engine/*`)** imports nothing from `src/ai/*`, `src/parser/*`,
  or `src/data/*`, and contains no `fetch(`, no `api.anthropic.com`, no
  `x-api-key`. It is handed no free text and can reach no model.
- **The interpret side (`src/ai/*`, `src/parser/*`)** imports **none** of the
  engine's price/metric compute core — `backtest`, `metrics`, `indicators`,
  `robustness`, `fragility`, `workerCore`, `engineClient`, `worker` — and never
  imports `src/data/*`. Its *only* permitted engine imports are the two crossing
  points: `schema.js` (the validation gate) and `autopsy.js` / `verdict.js` (the
  diagnostic facts). It literally cannot call a function that computes a number.

If someone later writes `import { sharpe } from "../engine/metrics.js"` inside
the AI layer, this test goes red. The guarantee can't silently rot.

---

## 3. The gate IN — schema validation

`src/engine/schema.js` defines the strategy spec: the sole contract between
parser and engine. `validateSpec(raw)` is the **only** way a strategy enters the
engine.

- The AI parser (`src/parser/aiParser.js`) uses Anthropic **tool-use / structured
  output** to force the model to emit a spec-shaped object, then runs it through
  `validateSpec`. If it fails, the parser re-prompts **once** with the concrete
  errors; if it still fails, it **throws**, and the orchestrator
  (`src/parser/index.js`) falls back to the deterministic grammar parser
  (`localParser.js`). **An unvalidated spec never reaches `backtest()`.**
- If the model is ambiguous on a material dimension (entry, exit, direction,
  timeframe) it asks **one** clarifying question (capped at two) instead of
  guessing.
- The parsed spec then passes the **mandatory, editable "What I understood"
  confirmation gate** (`ConfirmScreen.jsx`). The model can't bypass it; the user
  sees every rule, every assumption the model made, and everything the parser
  could not represent — disclosed, never silently dropped.

Because the spec is a small, validated, serializable object, **it — not any
model output — is the durable, cached artifact.** Backtests are recomputed from
the spec deterministically; nothing about a result depends on the model that
produced the spec.

## 4. The guarantee OUT — grounding

When the model phrases the *autopsy* (why a strategy died), it is given only a
structured **facts payload** built by `buildAutopsyPayload()` in
`src/engine/autopsy.js`: which failure modes fired, and the exact figures the
engine computed (IS/OOS/full/pre-cost Sharpe, returns, exposure, turnover,
expectancy, drawdown, trade count, instrument dependence). No prices, no equity.

Then the output is **verified in code** before the user ever sees it
(`src/ai/grounding.js`, applied in `src/ai/autopsyChat.js`):

1. **Coaching questions** ("how do I make it pass?") never reach the model — they
   get a fixed refusal. Null diagnoses the cause of death; it never coaches you
   toward a passing verdict, because tuning until the past turns green *is* the
   overfitting it exists to catch.
2. **Unanswerable questions** (predictions, price targets, buy/sell) get "the
   backtest doesn't show that" — also without a model call.
3. **Grounding guard.** Every number in the model's answer must map to a number
   in the facts payload (allowing only rounding/abs variants of a real figure).
   If the model introduces *any* unsupported number, the entire AI answer is
   discarded and the deterministic templated explanation (built from the same
   facts) is shown instead. Direction of safety: **when in doubt, reject** — a
   false rejection just falls back to the always-grounded template.
4. **Output-side anti-coaching.** If the phrasing itself suggests parameter
   changes, it's replaced with the refusal.

The result: it is **structurally impossible** for the autopsy to surface a number
the engine didn't compute. `src/test/autopsyGrounding.test.js` proves it —
including that an injected fabricated Sharpe is caught and replaced.

---

## 5. Determinism strategy

Null's numbers must be reproducible to the last decimal, forever, independent of
any model.

- **The engine is pure.** No DOM, no network, no globals, no `Math.random()`, no
  `Date.now()`. Same `(spec, prices, config)` → same result, always. It runs
  off-thread in a Web Worker (`worker.js` executing `workerCore.js`); a parity
  test asserts the worker path is byte-identical to the synchronous engine,
  across the `postMessage` boundary.
- **The spec is the cached artifact, not the model output.** Sharing, saving,
  and reopening a strategy all carry the validated spec and recompute live from
  real data. Two people opening the same share link get identical numbers.
- **Randomness is seeded.** The robustness bootstrap uses a fixed-seed PRNG
  (`mulberry32`), so its confidence interval is reproducible.
- **Model calls are mocked in tests.** Every AI test (`aiParser.test.js`,
  `autopsyGrounding.test.js`) injects a transport that replays **recorded fixture
  responses** — no network, no key, fully deterministic. The tests exercise the
  real validation, repair, fallback, clarifier, and grounding logic against fixed
  model outputs.
- **The self-proof.** Buy-and-hold is computed as the raw adjusted-close ratio,
  so its total return must exactly equal the instrument's own return — a built-in
  check that the engine's arithmetic is correct, verified to machine epsilon.

---

## 6. Shipping AI safely — the serverless proxy

The deployed demo lets anyone use the AI features **without exposing a key in the
browser**.

- **Server-side key.** `api/anthropic.js` (Vercel) and
  `netlify/functions/anthropic.mjs` (Netlify) hold `ANTHROPIC_API_KEY` as a
  server env var (no `VITE_` prefix → never bundled into client JS). The browser
  POSTs its Messages-API request to the same-origin proxy path
  (`VITE_AI_PROXY_URL`); the **server** injects the key and forwards to Anthropic.
- **Abuse controls.** Both functions share `src/server/proxyCore.mjs` (pure,
  unit-tested in `proxyCore.test.js`): it **hard-caps `max_tokens`**, **forces a
  known model**, whitelists the forwarded fields (dropping anything else a client
  sends), and applies a **per-IP sliding-window rate limit**.
- **Transport selection** (`src/ai/anthropicClient.js`): if the user supplied
  their own key (stored only in their browser), the client calls Anthropic
  **directly** with it; otherwise it uses the **proxy** and sends no credential
  from the browser at all. The proxy is the demo default; the user-key path is
  optional. `anthropicClient.test.js` proves the client never puts a key on the
  wire when using the proxy.
- **Graceful degrade.** If no key is configured anywhere, `aiAvailable()` is
  false and Null runs fully on its deterministic grammar parser and templated
  autopsy — the tool never *requires* AI.

---

## 7. End-to-end data flow

```
 user text ──▶ parseAI (tool-use) ──▶ validateSpec ──▶ [confirm gate, editable]
                     │  (LLM: text+schema only)             │
                     └─ ambiguous? ask ONE question         ▼
                                                    backtest() on REAL prices
                                                    (off-thread, look-ahead-free)
                                                            │
                                          metrics · robustness · fragility · verdict
                                                            │
                                                    diagnose() → FACTS
                                                            │
                        buildAutopsyPayload (numbers only) ─┴─▶ autopsy phrasing (LLM)
                                                                     │
                                                       grounding guard: reject any
                                                       ungrounded number → template
```

## 8. Where the code lives

| Concern | Files |
|---|---|
| Interpret (LLM) | `src/parser/aiParser.js` (tool-use → spec), `src/parser/localParser.js` (grammar fallback), `src/parser/pineParser.js`, `src/parser/index.js` (orchestration) |
| Explain (LLM) | `src/ai/autopsyChat.js` (gated, grounded phrasing), `src/ai/grounding.js` (the guard) |
| AI transport | `src/ai/anthropicClient.js` (proxy vs user-key), `src/server/proxyCore.mjs` + `api/anthropic.js` + `netlify/functions/anthropic.mjs` |
| The gate | `src/engine/schema.js` (`validateSpec`) |
| Compute / judge | `src/engine/backtest.js`, `metrics.js`, `indicators.js`, `robustness.js`, `fragility.js`, `verdict.js`, `autopsy.js`, worker plumbing |
| Wall enforcement | `src/test/moduleBoundary.test.js` |

---

*Null is a credibility stress-test, not investment advice. Every number on the
page is real, computed, and never touched by a language model.*
