# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

<!-- Web app, built as an installable PWA (manifest + service worker, network-first
navigations, cache-first assets). A PWA shell does not make the design language
native, so the platform is `web`. Responsive down to 390px is a confirmed, tested
constraint (headless smoke tests capture desktop 1280 and mobile 390). -->

## Stack

Vite + React 18 (SPA), pure JS backtest engine running off-thread in a Web Worker.
Charting via `lightweight-charts` and `recharts`; motion via `motion`; icons via
`lucide-react`. Static build (`dist/`) deployable to Vercel or Netlify. Optional
AI parsing calls Anthropic through a serverless same-origin proxy (`api/anthropic.js`,
`netlify/functions/anthropic.mjs`) or a user-pasted key. Established by the existing
codebase — not a greenfield decision.

## Users

*(inferred — the AskUserQuestion probe timed out; confirm or correct.)*

Self-directed traders who have a strategy — one they built, found online, or tuned
in a charting tool — and want to know whether it is real before risking money on it.
The deterministic plain-English parser plus a Pine Script subset importer, the
built-in classics library, and the maintainer's "three-strategy divergence" QA test
all point to retail and systematic-hobbyist traders, including TradingView/Pine
users, as the primary audience. They are comfortable with strategy rules but are
exactly the people a flattering backtest can hurt.

## Product Purpose

Null is an adversarial strategy-credibility tester. It takes a trading strategy
described in plain English (or pasted as Pine Script), shows the user precisely how
it understood the rules, runs a rigorous look-ahead-free backtest on real historical
data, splits the data so the strategy must prove itself out-of-sample, charges real
trading costs, and issues a blunt, evidence-based verdict. Success is the user
trusting a hard "no" — the tool catching a curve-fit or nonsense strategy *before*
it costs real money is the tool working, not failing.

## Positioning

"On the market's side, not yours." Null is deliberately adversarial: it would rather
call a strategy a curve fit than flatter the user into losing money. The defensible
mechanism is total computational honesty — **every number is derived from real price
data through a mathematically correct, look-ahead-free simulation; nothing is
hardcoded, faked, or decorative.** The AI only ever interprets and explains English
or Pine into a validated spec; it never sees a price, computes a number, or touches a
metric or verdict. A neighboring "backtest your idea" product cannot truthfully copy
the adversarial stance, the enforced AI/math wall, or the self-proving guarantees.

## Operating Context

The user's journey is a single linear flow:
landing → input (English or Pine) → parsing → confirm ("here's what I understood,"
including any clause that could not be represented) → results (deliberately **locked**,
then **revealed**) → verdict → export (Pine v5). The "reveal the truth" beat is an
intentional dramatic moment, not just a screen transition. Users compare a strategy
against buy-and-hold and across instruments, inspect equity curves, drawdown, cost
impact, robustness/fragility, and an AI-written "autopsy" grounded in the real run.

## Capabilities and Constraints

- **Verdict buckets:** REJECTED / SUSPECT / PLAUSIBLE — a deterministic pure function
  of real metrics (in-sample→out-of-sample degradation, after-cost survival, trade
  count, cross-instrument consistency). Same inputs → same verdict, always.
- **Supported constructs:** indicators SMA, EMA, Wilder RSI, price; conditions
  MA/price crossovers, threshold comparisons, N-day breakouts; risk fixed stop-loss
  and take-profit (evaluated on close, filled next bar); direction long/flat and
  long/short; a Pine subset (`ta.sma/ema/rsi`, `ta.crossover/crossunder`, threshold
  comparisons, `strategy.entry/close`, percentage stops). Anything outside this set is
  **reported in the confirm step, never approximated.**
- **Degenerate cases are named, not hidden:** zero trades → "never triggered"; high
  exposure → "buy-and-hold in disguise"; too few trades → "N trades is noise."
- **Data:** ~15 real, named-source, split+dividend-adjusted daily series
  (SPY/QQQ/IWM/DIA, AAPL/MSFT/NVDA/JPM/XOM/JNJ/IBM, TLT, GLD, BTC/ETH), static and
  lazy-loaded, integrity-checked on load. No synthetic series is ever shown as real.
- **Offline-capable PWA**, responsive to 390px.
- **AI is optional:** the deterministic grammar parser works fully offline; AI, when
  available, becomes primary with a graceful fallback disclosed in the confirm panel.

## Brand Commitments

- **Name:** Null. **Mark:** the ∅ (empty-set / null) glyph, already the logo and PWA
  icon source.
- **Voice:** blunt, skeptical, evidence-first, never flattering. "On the market's
  side, not yours." A hard verdict is delivered plainly, not softened.
- `prefers-reduced-motion` is already honored in the stylesheet — an existing,
  binding motion commitment.

## Evidence on Hand

- Real market data in `public/data/*.json` from named public sources (keyed providers
  or Yahoo v8 fallback), each integrity-checked; buy-and-hold self-proof holds to
  machine epsilon (~9e-16) on every adjusted series.
- A built-in classics library (`src/classics.js`) of reference strategies.
- Full unit test suite over engine, metrics, parsers, and view-model derivations
  (`src/test/`); the only synthetic data lives there as clearly-marked fixtures.
- **Absences future work must not fabricate:** no testimonials, no customer logos, no
  user counts, no pricing, no performance/track-record claims about real trading. Null
  makes no investment-advice or profit claims — a PLAUSIBLE verdict is explicitly
  "encouraging, not proof."

## Product Principles

1. **Every number is real and look-ahead-free, or it is not shown.** Nothing hardcoded,
   faked, or decorative.
2. **The AI interprets; the engine judges.** The model never sees a price or produces a
   metric — the wall between translation and computation is the product.
3. **Be adversarial on the user's behalf.** A blunt "no" that saves money beats a
   flattering "yes." Catching the curve-fit is the win condition.
4. **Disclose, never silently drop.** Unrepresentable clauses, parser fallbacks,
   degenerate cases, and data warnings are surfaced in plain language.
5. **Deterministic and reproducible.** Same inputs always produce the same verdict and
   the same autopsy reasoning.

## Accessibility & Inclusion

*(inferred — probe timed out; no formal standard confirmed.)* No formal conformance
target has been established. Observed existing commitments to preserve: honored
`prefers-reduced-motion`, and a responsive layout tested to 390px. Treat WCAG 2.1 AA
(contrast, keyboard operability, visible focus) as best-effort until the user sets a
binding target.
