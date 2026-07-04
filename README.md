# Null — an adversarial strategy-credibility tester

> On the market's side, not yours. Null would rather call your strategy a curve
> fit than flatter you into losing money.

Null takes a trading strategy described in plain English (or pasted as Pine
Script), shows you exactly how it understood it, runs a rigorous look-ahead-free
backtest on **real** historical data, splits the data so the strategy must prove
itself on history it was never fit to, charges real trading costs, and issues a
blunt, evidence-based verdict: **REJECTED / SUSPECT / PLAUSIBLE**.

The single principle behind everything here: **every number is derived from real
price data through a mathematically correct, look-ahead-free simulation. Nothing
is hardcoded, faked, or decorative.**

---

## Quick start

```bash
npm install
npm run fetch-data     # pull REAL adjusted data into public/data/ (see below)
npm run dev            # http://localhost:5173
npm test               # unit tests: engine + metrics + parsers + view-model derivations
npm run build          # production build
npm run preview        # serve the production build at http://localhost:4173
```

`public/data/` already ships with real data, so `npm run dev` works without
re-fetching.

### AI parsing (optional — three ways to power it)

The plain-English parser works **fully offline** via a deterministic grammar, so
Null never *requires* AI. When AI is available it becomes the primary parser
(tool-use → schema-validated spec, with one clarifying question when ambiguous)
and falls back to the grammar on any error (disclosed in the confirmation panel).

1. **Deployed demo — server-side proxy (recommended, no key in the browser).**
   Set the secret `ANTHROPIC_API_KEY` in your host's dashboard; the serverless
   proxy (`api/anthropic.js` · `netlify/functions/anthropic.mjs`) injects it and
   the browser calls the same-origin path in `VITE_AI_PROXY_URL` (wired by
   `vercel.json` / `netlify.toml`). The key is never in the client bundle.
2. **User's own key.** Any visitor can paste their own key in the app; it is
   stored only in their browser and used to call Anthropic directly. This path
   bypasses the proxy.
3. **Local dev.** `echo 'VITE_ANTHROPIC_API_KEY=sk-ant-...' > .env.local` — a
   build-time key for local work only (it *is* public in the bundle; never use a
   real key for a public deploy — that's what the proxy is for).

**The model only ever interprets and explains — it never sees a price, computes a
number, or touches a metric or verdict.** How that wall is designed and enforced
is documented in **[ARCHITECTURE.md](./ARCHITECTURE.md)**.

---

## Architecture — four clean layers

```
input/parse  →  strategy spec  →  backtest engine  →  presentation
 (parser/)      (engine/schema)    (engine/*)          (components/)
```

The engine is **pure and independently testable**: feed it a validated spec and
prices, get back metrics, equity curves and trades. No UI, no network, no
globals, no randomness, no `Date.now()`.

Because it is pure, the engine runs **off the main thread in a Web Worker**
(`engine/worker.js` executes the pure `engine/workerCore.js`; `engine/engineClient.js`
is the main-thread request/response layer). This keeps the UI responsive during
heavy runs (walk-forward + a 2000-iteration bootstrap on long histories). The
worker only changes *where* the engine runs, never *what* it computes — a parity
test (`src/test/worker.test.js`) asserts the worker path is byte-identical to the
synchronous engine, including across the `postMessage` boundary. Stale recomputes
(e.g. the user moved on) are superseded and discarded rather than blocking the
newest one.

| Layer | Files |
|---|---|
| Parse | `parser/aiParser.js` (Claude), `parser/localParser.js` (deterministic fallback), `parser/pineParser.js` (Pine subset), `parser/index.js` (orchestration) |
| Spec | `engine/schema.js` — the validated contract between parser and engine |
| Engine | `engine/indicators.js`, `engine/metrics.js`, `engine/backtest.js`, `engine/verdict.js` |
| Data | price series live in `public/data/*.json` (static, lazy-loaded); `src/data/index.js` fetches on demand and `src/data/integrity.js` validates on load |
| Export | `parser/pineExport.js` — Pine v5 from a validated spec |
| UI | `components/*`, `App.jsx`, `styles.css` |

---

## The integrity guarantees (and how they're enforced)

- **No look-ahead.** Indicators at bar `t` use only data at indices `≤ t`
  (`indicators.js`). A signal computed through bar `t` is executed at bar
  `t+1`'s open — the signal bar and the fill bar are never the same bar
  (`backtest.js`). Proven by a test that changes only *future* prices and
  asserts earlier equity is byte-identical.
- **Self-proving benchmark.** Buy-and-hold is the raw adjusted-close ratio over
  the window, so its total return **exactly equals** the instrument's own return.
  Verified on real IBM data to machine epsilon (`~9e-16`). If it didn't match,
  the engine would be wrong.
- **Real costs.** Commission + slippage (bps) are charged on every fill;
  defaults are realistic and non-zero. Before/after-cost equity are both
  available.
- **Unit-tested metrics.** Every metric (Sharpe, Sortino, max drawdown, Calmar,
  CAGR, profit factor, …) has one source-of-truth function tested against
  hand-computed answers, including the classic Wilder RSI worked example.
- **Honest degenerate cases.** Zero trades → "never triggered." High exposure →
  "buy-and-hold in disguise." Too few trades → "N trades is noise." These are
  detected and explained, not crashed through or papered over.
- **Deterministic verdict.** The bucket and every cited reason are a pure
  function of the real metrics (in-sample→out-of-sample degradation, after-cost
  survival, trade count, cross-instrument consistency). Same inputs → same
  verdict, always. Never randomized, never softened.
- **Transparency of translation.** Before testing, the "Here's what I
  understood" panel shows the parsed rules in plain language and lists any clause
  the parser could **not** represent — disclosed, never silently dropped.

---

## Data — real, and honestly labeled

All market data is genuine historical data from named public sources, fetched by
`scripts/fetch-data.mjs`. No synthetic series is ever shown as real. (The only
synthetic data in the repo lives in `src/test/` as fixtures for testing the math,
clearly marked as such.)

**The datasets are static assets, not part of the JS bundle.** They live in
`public/data/*.json` and are lazy-loaded at runtime: a small `manifest.json`
(instrument summaries) loads at startup for the picker; each full price series is
fetched only when a backtest actually needs it. This keeps the initial JS bundle
small (it dropped from ~1.46 MB to ~725 KB once the price data was moved out).

**Every series is integrity-checked on load** (`src/data/integrity.js`,
unit-tested): NaN / zero / negative / impossible prices and too-short series are
rejected as *fatal* and disclosed rather than run; duplicate/out-of-order dates
and large calendar gaps are surfaced as warnings.

### Refreshing the data — one command, any network

```bash
npm run fetch-data
```

`scripts/fetch-data.mjs` writes split+dividend-**adjusted** daily OHLC to
`public/data/` for the target universe (~15 instruments): index ETFs
(SPY/QQQ/IWM/DIA), liquid large-caps across sectors (AAPL, MSFT, NVDA, JPM, XOM,
JNJ, IBM), a bond ETF (TLT), gold (GLD), and multi-year BTC/ETH. It rebuilds the
manifest from whatever real files exist and **skips (never fakes)** anything a
source won't return.

**Durable, keyed providers (recommended for production refreshes).** These
authenticate by account key, not IP, so they don't rate-limit a server. Set one
via env and re-run:

```bash
DATA_PROVIDER=tiingo TIINGO_API_KEY=xxxxx npm run fetch-data   # adjusted OHLC, free tier
DATA_PROVIDER=fmp    FMP_API_KEY=xxxxx    npm run fetch-data   # adjusted OHLC, free tier
DATA_PROVIDER=alphavantage ALPHAVANTAGE_API_KEY=xxxxx npm run fetch-data  # needs ADJUSTED access
```

If no key is set, it falls back to **Yahoo Finance v8** (`adjclose`, split +
dividend adjusted), which is keyless but IP-rate-limits aggressively — the
fallback is paced and patient, but a keyed provider is the reliable path.

The app runs fully **without** running the fetcher, using whatever is already in
`public/data/`. Every series is integrity-checked on load, and the engine's
buy-and-hold self-proof holds to machine epsilon on every adjusted series.

---

## Supported strategy constructs

- **Indicators:** SMA, EMA, Wilder RSI, price
- **Conditions:** MA/price crossovers, threshold comparisons, N-day breakouts
- **Risk:** fixed stop-loss and take-profit (evaluated on the close, filled next
  bar — look-ahead-free and deliberately conservative)
- **Direction:** long/flat and long/short
- **Pine subset:** `ta.sma/ema/rsi`, `ta.crossover/crossunder`, threshold
  comparisons, `strategy.entry/close`, percentage stops

Anything outside this set is reported in the confirmation step, not approximated.

---

## Deploying

Null is a **static build** — `npm run build` emits `dist/`, which any static host
serves. Two configs ship in the repo:

- **Vercel** (`vercel.json`): `npm run build` → `dist/`, SPA rewrite to
  `index.html`. Deploy with `npx vercel --prod`.
- **Netlify** (`netlify.toml`): same build/publish, SPA redirect. Deploy with
  `npx netlify deploy --prod --dir=dist` (or connect the repo in the dashboard).

Both CLIs prompt for an interactive login the first time. In a Claude Code
session you can run them yourself with the `!` prefix, e.g. `! npx vercel --prod`.

**Optional AI for the demo (server-side key).** To power the AI features on the
deployed site *without* exposing a key, set the secret **`ANTHROPIC_API_KEY`** in
your host's dashboard (Netlify: Site settings → Environment · Vercel: Project →
Environment Variables). The serverless proxy (`api/anthropic.js` ·
`netlify/functions/anthropic.mjs`) reads it server-side and the browser talks to
the same-origin proxy path (`VITE_AI_PROXY_URL`, already wired in the configs).
The proxy rate-limits per IP and caps tokens. If the key isn't set, the app
cleanly falls back to the deterministic grammar parser — no crash.

**Secret handling.** `.env`, `.env.local`, and `.env.*.local` are git-ignored.
`ANTHROPIC_API_KEY` has **no `VITE_` prefix**, so it is read only server-side and
is never bundled into client JS. Any `VITE_*` value *is* public in the bundle, so
the only `VITE_` Anthropic key (`VITE_ANTHROPIC_API_KEY`) is for local dev only
and must never hold a production key. The built client bundle is verified to
contain no `sk-ant-` token. Design + rationale: **[ARCHITECTURE.md](./ARCHITECTURE.md)**.

## Progressive Web App (installable, offline-capable)

Null ships an installable app shell so it can become a phone app later with
near-zero rework:

- `public/manifest.webmanifest` — name, standalone display, theme color, and
  three real icons (`icons/icon-192.png`, `icons/icon-512.png`,
  `icons/maskable-512.png`) generated from the ∅ mark, with a maskable safe-zone.
- `public/sw.js` — a service worker registered in production (`src/main.jsx`).
  **Navigations are network-first** (a fresh deploy is always picked up; the
  cached shell is the offline fallback); **static assets and the bundled real
  price data are cache-first** so the tool works offline; **cross-origin requests
  — the Anthropic API and analytics — are never cached** and always hit the
  network.

Installability (manifest linked, `display: standalone`, ≥2 icons + a maskable
icon, all assets `200`, service worker registered) is asserted headlessly by
`_smoke_p14.mjs` at desktop and 390px.

## Privacy-respecting analytics & error monitoring — all env-gated, no PII

Both are **off by default** and ship no third-party SDK in the bundle. Configure
them per-deploy with build-time env vars (never secrets):

| Variable | Effect |
|---|---|
| `VITE_PLAUSIBLE_DOMAIN` | Enables cookieless [Plausible](https://plausible.io) analytics for that domain. Unset → analytics is a no-op. |
| `VITE_PLAUSIBLE_HOST` | Optional self-hosted Plausible origin (default `https://plausible.io`). |
| `VITE_ERROR_ENDPOINT` | Optional URL that receives a coarse JSON error beacon. Unset → errors log to console + the visible fallback only. |

**What's measured** (`src/analytics.js`): which *kinds* of strategies and which
public instruments get tested, and where users drop off in the funnel. **What's
never sent:** the user's strategy text, any free-form input, or anything
identifying. Only an allow-listed set of short structural fields leaves the page
(direction, entry-condition *types*, public tickers, verdict bucket, screen
name), enforced by `sanitizeProps` and covered by `src/test/marketReadiness.test.js`.

**Error monitoring** (`src/monitoring.js` + `components/ErrorBoundary.jsx`):
uncaught errors, unhandled promise rejections, and React render crashes are
caught, logged, signaled coarsely to analytics, and (if `VITE_ERROR_ENDPOINT` is
set) beaconed out — and a **visible, in-voice fallback** replaces the white
screen. Real failures surface instead of dying silently.

## Human QA checklist — the three-strategy divergence test

Automated tests prove the math; this is the **manual smoke test the maintainer
runs by hand** before shipping, to confirm the verdicts and autopsies genuinely
*diverge* by strategy quality (not a template that always says the same thing).
Run all three on a long-history instrument (e.g. **IBM**), reveal the truth, and
read the verdict + autopsy:

1. **Obvious survivor** — a broadly sensible trend rule, e.g. *"go long when the
   50-day SMA crosses above the 200-day, exit when it crosses back below"* (the
   Golden Cross classic). Expect: **SURVIVED** or a well-reasoned **SHAKY** — and
   an autopsy that talks about the *actual* trade record, not failure boilerplate.
2. **Obvious curve-fit** — an over-tuned rule with oddly specific numbers, e.g.
   *"buy when RSI(2) < 5, sell when RSI(2) > 95"* or a breakout with a hyper-tuned
   lookback. Expect: **DEAD** (or **SHAKY**) with the autopsy naming the
   in-sample→out-of-sample collapse and/or a fragile parameter spike.
3. **Nonsense strategy** — a rule with no economic basis or one that barely
   trades, e.g. *"go long every time RSI(14) equals exactly 50"* or *"buy on a
   200-day new low and hold forever."* Expect: **DEAD** with a *degenerate-case*
   autopsy — "never triggered", "N trades is noise", or "buy-and-hold in disguise".

**Pass criteria:** the three produce **materially different verdicts and
different autopsy language**, each citing that run's real numbers. If any two read
the same, the diagnosis logic — not the wording — needs a look. A DEAD verdict
here is the tool *working*: it caught the curve-fit/nonsense before it cost real
money.

---

*This is one tool's opinion, computed from one data history and one split. A
PLAUSIBLE verdict is encouraging, not proof. Nothing here is investment advice.*
