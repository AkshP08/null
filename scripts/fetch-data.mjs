// Fetches REAL, split/dividend-ADJUSTED daily OHLC and writes one normalized
// JSON per instrument into public/data/ (lazy-loaded static assets, not bundled
// into JS).
//
// This is the ONLY place market data enters the app. Every byte is genuine
// historical data from a named public source. NOTHING here is synthetic. Any
// instrument that can't be fetched is SKIPPED and disclosed — never faked.
//
// ── Durable, keyed providers (preferred for production refreshes) ───────────
// Set a provider + key via env and the fetcher uses an authenticated API that
// keys by account, not IP, so it won't rate-limit a server:
//   DATA_PROVIDER=tiingo TIINGO_API_KEY=...            (adjusted OHLC, free tier)
//   DATA_PROVIDER=fmp     FMP_API_KEY=...               (adjusted OHLC, free tier)
//   DATA_PROVIDER=alphavantage ALPHAVANTAGE_API_KEY=... (needs a key with ADJUSTED access)
//
// ── Keyless fallback ────────────────────────────────────────────────────────
// With no key, it falls back to Yahoo Finance's adjusted chart API (adjclose is
// split+dividend adjusted). Yahoo IP-rate-limits aggressively, so this path is
// paced and patient, and skips (does not fake) anything it can't get.
//
// Run:  npm run fetch-data
import { writeFile, mkdir, readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildManifest } from "./lib/manifest.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "..", "public", "data");
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const round = (x) => (x == null ? x : Math.round(x * 1e6) / 1e6);
const START = "2005-01-01"; // long adjusted history where available

// The target universe: index ETFs, liquid large-caps across sectors, bonds,
// gold, and multi-year crypto. ~15 instruments.
const UNIVERSE = [
  { id: "SPY", symbol: "SPY", name: "SPDR S&P 500 ETF", klass: "equity-etf" },
  { id: "QQQ", symbol: "QQQ", name: "Invesco QQQ (Nasdaq-100)", klass: "equity-etf" },
  { id: "IWM", symbol: "IWM", name: "iShares Russell 2000 ETF", klass: "equity-etf" },
  { id: "DIA", symbol: "DIA", name: "SPDR Dow Jones ETF", klass: "equity-etf" },
  { id: "AAPL", symbol: "AAPL", name: "Apple Inc.", klass: "equity" },
  { id: "MSFT", symbol: "MSFT", name: "Microsoft Corp.", klass: "equity" },
  { id: "NVDA", symbol: "NVDA", name: "NVIDIA Corp.", klass: "equity" },
  { id: "JPM", symbol: "JPM", name: "JPMorgan Chase (financials)", klass: "equity" },
  { id: "XOM", symbol: "XOM", name: "ExxonMobil (energy)", klass: "equity" },
  { id: "JNJ", symbol: "JNJ", name: "Johnson & Johnson (healthcare)", klass: "equity" },
  { id: "IBM", symbol: "IBM", name: "IBM", klass: "equity" },
  { id: "TLT", symbol: "TLT", name: "iShares 20+ Yr Treasury", klass: "bond-etf" },
  { id: "GLD", symbol: "GLD", name: "SPDR Gold Shares", klass: "commodity-etf" },
  { id: "BTC-USD", symbol: "BTC-USD", name: "Bitcoin / USD", klass: "crypto" },
  { id: "ETH-USD", symbol: "ETH-USD", name: "Ethereum / USD", klass: "crypto" },
];

// ── Providers ───────────────────────────────────────────────────────────────
// Each returns { rows:[{date,open,high,low,close,adjClose,volume}], adjusted, fillConvention, note }.

async function fromTiingo(inst, key) {
  const url = `https://api.tiingo.com/tiingo/daily/${inst.symbol}/prices?startDate=${START}&format=json&token=${key}`;
  const res = await fetch(url, { headers: { "Content-Type": "application/json" } });
  if (res.status === 429 || res.status >= 500) throwRetry(res.status);
  if (!res.ok) throw new Error(`Tiingo HTTP ${res.status}`);
  const arr = await res.json();
  if (!Array.isArray(arr)) throw new Error(arr?.detail || "no data");
  const rows = arr.map((r) => ({
    date: r.date.slice(0, 10),
    open: round(r.open), high: round(r.high), low: round(r.low), close: round(r.close),
    adjClose: round(r.adjClose), volume: r.volume ?? 0,
  })).filter((r) => [r.open, r.high, r.low, r.close, r.adjClose].every((x) => Number.isFinite(x) && x > 0));
  return { rows, adjusted: true, fillConvention: "nextOpen", source: "Tiingo daily (adjusted)", note: "Genuine daily OHLC, split & dividend adjusted (Tiingo adjClose)." };
}

async function fromFMP(inst, key) {
  const url = `https://financialmodelingprep.com/api/v3/historical-price-full/${inst.symbol}?from=${START}&apikey=${key}`;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (res.status === 429 || res.status >= 500) throwRetry(res.status);
  if (!res.ok) throw new Error(`FMP HTTP ${res.status}`);
  const json = await res.json();
  const hist = json?.historical;
  if (!Array.isArray(hist)) throw new Error(json?.["Error Message"] || "no data");
  const rows = hist.map((r) => ({
    date: r.date.slice(0, 10),
    open: round(r.open), high: round(r.high), low: round(r.low), close: round(r.close),
    adjClose: round(r.adjClose ?? r.close), volume: r.volume ?? 0,
  })).filter((r) => [r.open, r.high, r.low, r.close, r.adjClose].every((x) => Number.isFinite(x) && x > 0))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  return { rows, adjusted: true, fillConvention: "nextOpen", source: "Financial Modeling Prep (adjusted)", note: "Genuine daily OHLC, split & dividend adjusted (FMP adjClose)." };
}

async function fromAlphaVantage(inst, key) {
  const url = `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY_ADJUSTED&symbol=${inst.symbol}&outputsize=full&apikey=${key}`;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`AlphaVantage HTTP ${res.status}`);
  const json = await res.json();
  const ts = json["Time Series (Daily)"];
  if (!ts) throw new Error(json.Information || json.Note || json["Error Message"] || "no adjusted series (needs a premium key)");
  const rows = Object.entries(ts).map(([date, o]) => ({
    date, open: round(+o["1. open"]), high: round(+o["2. high"]), low: round(+o["3. low"]),
    close: round(+o["4. close"]), adjClose: round(+o["5. adjusted close"]), volume: +o["6. volume"],
  })).filter((r) => r.date >= START && [r.open, r.high, r.low, r.close, r.adjClose].every((x) => Number.isFinite(x) && x > 0))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  return { rows, adjusted: true, fillConvention: "nextOpen", source: "AlphaVantage TIME_SERIES_DAILY_ADJUSTED", note: "Genuine daily OHLC, split & dividend adjusted." };
}

async function fromYahoo(inst) {
  // 15y keeps a long adjusted history while shrinking the payload (Yahoo throttles
  // heavy `range=max` responses harder); crypto's full history is < 15y anyway.
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(inst.symbol)}?range=15y&interval=1d&events=div%2Csplit`;
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
  if (res.status === 429 || res.status === 999 || res.status >= 500) throwRetry(res.status);
  if (!res.ok) throw new Error(`Yahoo HTTP ${res.status}`);
  const r = (await res.json())?.chart?.result?.[0];
  if (!r) throw new Error("no result");
  const ts = r.timestamp || [];
  const q = r.indicators?.quote?.[0] || {};
  const adj = r.indicators?.adjclose?.[0]?.adjclose;
  const rows = [];
  for (let i = 0; i < ts.length; i++) {
    const o = q.open?.[i], h = q.high?.[i], l = q.low?.[i], c = q.close?.[i];
    const a = adj ? adj[i] : c;
    const date = new Date(ts[i] * 1000).toISOString().slice(0, 10);
    if (date < START) continue;
    if ([o, h, l, c, a].some((x) => x == null || Number.isNaN(x) || x <= 0)) continue;
    rows.push({ date, open: round(o), high: round(h), low: round(l), close: round(c), adjClose: round(a), volume: q.volume?.[i] ?? 0 });
  }
  return { rows, adjusted: true, fillConvention: "nextOpen", source: "Yahoo Finance v8 chart API (adjusted)", note: "Genuine daily OHLC, split & dividend adjusted (adjClose)." };
}

function throwRetry(status) {
  const e = new Error(`HTTP ${status}`);
  e.retryable = true;
  throw e;
}

// pick provider from env
function chooseProvider() {
  const p = (process.env.DATA_PROVIDER || "").toLowerCase();
  if (p === "tiingo" && process.env.TIINGO_API_KEY) return { name: "tiingo", fn: (i) => fromTiingo(i, process.env.TIINGO_API_KEY), spacing: 1500 };
  if (p === "fmp" && process.env.FMP_API_KEY) return { name: "fmp", fn: (i) => fromFMP(i, process.env.FMP_API_KEY), spacing: 1500 };
  if (p === "alphavantage" && process.env.ALPHAVANTAGE_API_KEY) return { name: "alphavantage", fn: (i) => fromAlphaVantage(i, process.env.ALPHAVANTAGE_API_KEY), spacing: 15000 };
  if (process.env.TIINGO_API_KEY) return { name: "tiingo", fn: (i) => fromTiingo(i, process.env.TIINGO_API_KEY), spacing: 1500 };
  if (process.env.FMP_API_KEY) return { name: "fmp", fn: (i) => fromFMP(i, process.env.FMP_API_KEY), spacing: 1500 };
  // Yahoo: pace one request per ~90s — it tends to serve the first request after
  // a cooldown, then throttle bursts. Slow but keyless.
  return { name: "yahoo (keyless fallback)", fn: fromYahoo, spacing: 90000 };
}

async function fetchPatient(prov, inst, { maxRetries = 6, waitMs = 90000 } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      const out = await prov.fn(inst);
      if (!out.rows || out.rows.length < 100) throw new Error(`only ${out.rows?.length ?? 0} rows`);
      return out;
    } catch (err) {
      if (!err.retryable || attempt >= maxRetries) throw err;
      console.log(`  ${inst.symbol}: ${err.message}, waiting ${waitMs / 1000}s (retry ${attempt + 1}/${maxRetries})`);
      await sleep(waitMs);
    }
  }
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const prov = chooseProvider();
  console.log(`Provider: ${prov.name}\n`);

  const skipped = [];
  let fetched = 0;
  for (const inst of UNIVERSE) {
    process.stdout.write(`Fetching ${inst.symbol} (adjusted)… `);
    try {
      const out = await fetchPatient(prov, inst);
      const data = {
        id: inst.id, symbol: inst.symbol, name: inst.name, klass: inst.klass,
        source: out.source, adjusted: out.adjusted, fillConvention: out.fillConvention,
        note: out.note, fetchedAt: new Date().toISOString().slice(0, 10), rows: out.rows,
      };
      await writeFile(join(OUT_DIR, `${inst.id}.json`), JSON.stringify(data));
      console.log(`ok (${out.rows.length} rows, ${out.rows[0].date} → ${out.rows.at(-1).date})`);
      fetched++;
      await sleep(prov.spacing);
    } catch (err) {
      console.log(`SKIP: ${err.message}`);
      skipped.push(`${inst.symbol} (${err.message})`);
    }
  }

  // Rebuild the manifest from whatever REAL files exist (fetched or preserved).
  const files = (await readdir(OUT_DIR)).filter((f) => f.endsWith(".json") && f !== "manifest.json");
  const datasets = [];
  for (const f of files) {
    try { datasets.push(JSON.parse(await readFile(join(OUT_DIR, f), "utf8"))); } catch {}
  }
  await writeFile(join(OUT_DIR, "manifest.json"), JSON.stringify(buildManifest(datasets), null, 2));

  console.log(`\nFetched ${fetched}; ${datasets.length} instruments total in public/data/.`);
  if (skipped.length) console.log(`Skipped (disclosed, not faked): ${skipped.join(", ")}`);
}

main();
