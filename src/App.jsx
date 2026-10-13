import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { C, SANS } from "./ui/tokens.js";
import { NavBar } from "./components/Bits.jsx";
import Landing from "./components/Landing.jsx";
import InputScreen from "./components/InputScreen.jsx";
import Parsing from "./components/Parsing.jsx";
import ConfirmScreen from "./components/ConfirmScreen.jsx";
import ClarifyScreen from "./components/ClarifyScreen.jsx";
import ResultsScreen from "./components/ResultsScreen.jsx";
import VerdictScreen from "./components/VerdictScreen.jsx";
import ExportScreen from "./components/ExportScreen.jsx";
import { loadManifest, loadInstruments } from "./data/index.js";
import { parseStrategy, aiAvailable } from "./parser/index.js";
import { describeSpec } from "./parser/aiParser.js";
import { DEFAULT_CONFIG } from "./engine/backtest.js";
import { runEngine, isSuperseded } from "./engine/engineClient.js";
import { computeVerdict, crossInstrumentVerdict } from "./engine/verdict.js";
import { listSaved, saveStrategy, deleteSaved, storageAvailable } from "./storage.js";
import { shareUrl, decodeShare, readShareFromLocation } from "./share.js";
import { CLASSICS } from "./classics.js";
import { initAnalytics, track, strategyDescriptor } from "./analytics.js";

// Run one spec across the selected instruments — the single place a backtest
// is computed. Data is loaded (network) on the main thread; the pure engine
// runs OFF-thread in a Web Worker (engineClient), which also returns robustness.
// Never stores results; always recomputes from real data. Resolves to
// { runs, robustness }, or null if this run was superseded by a newer one.
async function computeRuns(spec, cfgState, sel, summaries) {
  const cfg = { commissionBps: cfgState.commissionBps, slippageBps: cfgState.slippageBps, isFraction: cfgState.isFraction };
  const loaded = await loadInstruments(sel);
  const summaryById = Object.fromEntries((summaries || []).map((s) => [s.id, s]));
  const instruments = sel.map((id) => {
    const meta = summaryById[id] || { id, symbol: id, name: id };
    const data = loaded[id];
    return {
      id,
      symbol: meta.symbol,
      name: meta.name,
      adjusted: meta.adjusted,
      fillConvention: meta.fillConvention,
      source: meta.source,
      integrity: data?.integrity,
      error: data && !data.error ? null : data?.error || "Could not load this series.",
      data: data && !data.error ? data : null,
    };
  });
  try {
    return await runEngine({ spec, cfg, from: cfgState.from, to: cfgState.to, instruments });
  } catch (e) {
    if (isSuperseded(e)) return null; // a newer recompute replaced this one
    throw e;
  }
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

export default function App() {
  const [aiOn, setAiOn] = useState(() => aiAvailable());

  // The instrument summaries are loaded lazily from a static manifest (the
  // price series themselves are NOT in the JS bundle).
  const [summaries, setSummaries] = useState(null);
  const [dataError, setDataError] = useState(null);

  // screens: landing → input → parsing → confirm → results-locked → results-revealed → verdict → export
  const [screen, setScreen] = useState("landing");
  const [mode, setMode] = useState("english");
  const [text, setText] = useState("");
  const [selected, setSelected] = useState([]);
  const [config, setConfig] = useState({
    from: "", to: "",
    commissionBps: DEFAULT_CONFIG.commissionBps,
    slippageBps: DEFAULT_CONFIG.slippageBps,
    isFraction: DEFAULT_CONFIG.isFraction,
  });
  const [parsed, setParsed] = useState(null);
  const [clarify, setClarify] = useState(null); // pending clarifying question + accumulated Q&A
  const [runs, setRuns] = useState([]);
  const [robust, setRobust] = useState(null); // robustness for the primary run (from the worker)
  const [fragility, setFragility] = useState(null); // parameter-fragility sweep (from the worker)
  const [currentSpec, setCurrentSpec] = useState(null); // the spec actually tested
  const [showCosts, setShowCosts] = useState(true);
  const [busy, setBusy] = useState(false);
  // Non-blocking "recomputing…" state: true while an off-thread engine run is
  // in flight. The UI stays interactive; a subtle chip signals work.
  const [recomputing, setRecomputing] = useState(false);
  const [savedList, setSavedList] = useState(() => listSaved());
  const [savedFlash, setSavedFlash] = useState(false);
  // how many strategies tested this session — powers the p-hacking reminder.
  const [testCount, setTestCount] = useState(() => {
    try { return Number(localStorage.getItem("null_test_count")) || 0; } catch { return 0; }
  });

  // Load the manifest once on mount; default-select the 3 longest histories.
  // If the URL carries a share token, reproduce that exact run (recomputed live).
  useEffect(() => {
    let alive = true;
    loadManifest()
      .then(async (m) => {
        if (!alive) return;
        setSummaries(m);
        const defaults = m.slice(0, 3).map((d) => d.id);
        setSelected(defaults);

        const token = readShareFromLocation();
        if (token) {
          const { ok, state, error } = decodeShare(token);
          if (ok) {
            const sel = state.selected.filter((id) => m.some((s) => s.id === id));
            const usedSel = sel.length ? sel : defaults;
            const cfg = {
              from: state.config.from || "", to: state.config.to || "",
              commissionBps: state.config.commissionBps ?? DEFAULT_CONFIG.commissionBps,
              slippageBps: state.config.slippageBps ?? DEFAULT_CONFIG.slippageBps,
              isFraction: state.config.isFraction ?? DEFAULT_CONFIG.isFraction,
            };
            setMode(state.mode); setText(state.text); setConfig(cfg); setSelected(usedSel);
            setParsed({ ok: true, spec: state.spec, notes: describeSpec(state.spec), unsupported: [], source: "shared" });
            setBusy(true); setRecomputing(true); setScreen("parsing");
            await delay(500);
            const out = await computeRuns(state.spec, cfg, usedSel, m);
            if (!alive || !out) return;
            setCurrentSpec(state.spec); setRuns(out.runs); setRobust(out.robustness); setFragility(out.fragility);
            setBusy(false); setRecomputing(false);
            setScreen("results-locked");
          } else {
            setDataError(error);
          }
        }
      })
      .catch((e) => alive && setDataError(e?.message || "Could not load market data."));
    return () => {
      alive = false;
    };
  }, []);

  // Load analytics once (no-op unless configured). Cookieless; no PII.
  useEffect(() => { initAnalytics(); }, []);

  const navigate = (s) => {
    setScreen(s);
    track("screen", { screen: s }); // funnel / drop-off — only the screen name
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const toggleInstrument = (id) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  // input → parsing → (clarify?) → confirm  (real parse). The AI path may ask
  // ONE clarifying question; when it does we route to the clarify screen instead
  // of confirm, collect the answer, and re-parse with the accumulated Q&A.
  async function doParse(clarifications, { forceSubmit } = {}) {
    setBusy(true);
    navigate("parsing");
    const started = Date.now();
    let p;
    try {
      p = await parseStrategy(text, mode, { timeoutMs: 20000, clarifications, forceSubmit });
    } catch (e) {
      p = { ok: false, notes: [], unsupported: [e?.message || "Parsing failed."], source: mode === "pine" ? "pine" : "local" };
    }
    // keep the spinner up briefly so the transition reads, then advance
    const elapsed = Date.now() - started;
    if (elapsed < 1100) await delay(1100 - elapsed);
    setBusy(false);

    if (p.clarify) {
      setClarify({ ...p.clarify, clarifications: p.clarifications || clarifications || [] });
      navigate("clarify");
      return;
    }
    setClarify(null);
    setParsed(p);
    navigate("confirm");
  }

  async function onRun() {
    setClarify(null);
    await doParse([]);
  }

  async function onClarifyAnswer(answer) {
    const prev = clarify?.clarifications || [];
    await doParse([...prev, { question: clarify.question, answer }]);
  }

  async function onClarifySkip() {
    const prev = clarify?.clarifications || [];
    // Take the model's best guess (it must disclose the assumption), and force a
    // spec so we never loop on questions.
    await doParse([...prev, { question: clarify.question, answer: "No preference — use your best judgment and disclose the assumption." }], { forceSubmit: true });
  }

  // The one real-backtest path — reused by confirm, share-open and saved-open.
  // Everything is recomputed live from real data; no result is ever stored.
  async function runBacktests({ spec, config: cfgState, selected: sel, currentSpec }) {
    setRecomputing(true);
    const out = await computeRuns(spec, cfgState, sel, summaries);
    if (!out) { setBusy(false); return; } // superseded by a newer run
    setCurrentSpec(currentSpec || spec);
    setRuns(out.runs);
    setRobust(out.robustness);
    setFragility(out.fragility);
    setShowCosts(true);
    setBusy(false);
    setRecomputing(false);
    setTestCount((n) => {
      const next = n + 1;
      try { localStorage.setItem("null_test_count", String(next)); } catch {}
      return next;
    });
    // Which strategies / instruments get tested — structural + public tickers
    // only, never the user's strategy text.
    track("tested", { source: parsed?.source || mode, count: sel.length, instruments: sel.join(","), ...strategyDescriptor(spec) });
    navigate("results-locked");
  }

  // Compare mode: recompute ONE comparator spec on the primary instrument,
  // through the same worker path as any backtest (real data, look-ahead-free,
  // same window + costs). Returns the recomputed run, or null if superseded.
  // Never mutates the primary result — it only hands the comparator back to the
  // results screen to overlay. This is the sole compare path; nothing is cached.
  async function onCompare(spec) {
    if (!primary) return null;
    setRecomputing(true);
    try {
      const out = await computeRuns(spec, config, [primary.id], summaries);
      return out ? out.runs[0] || null : null;
    } finally {
      setRecomputing(false);
    }
  }

  // confirm → results. `specOverride` carries any inline edits from the confirm screen.
  async function onConfirm(specOverride) {
    const spec = specOverride || parsed?.spec;
    if (!spec) return;
    setBusy(true);
    await delay(30); // let the button state paint
    await runBacktests({ spec, config, selected });
  }

  function restart() {
    setParsed(null);
    setClarify(null);
    setRuns([]);
    setCurrentSpec(null);
    // drop any share token so a refresh doesn't re-open it
    if (typeof window !== "undefined" && window.location.hash) {
      try { history.replaceState(null, "", window.location.pathname + window.location.search); } catch {}
    }
    navigate("input");
  }

  // ── Persistence: save / open / share ─────────────────────────────────────
  function onSave() {
    const spec = currentSpec || parsed?.spec;
    if (!spec) return;
    saveStrategy({ name: spec.name, mode, text, spec, config, selected }, Date.now());
    setSavedList(listSaved());
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1800);
  }

  async function onCopyLink() {
    const spec = currentSpec || parsed?.spec;
    if (!spec) return "";
    const url = shareUrl({ spec, config, selected, mode, text, name: spec.name });
    // reflect the token in the address bar so the URL itself is shareable/bookmarkable
    try { if (typeof window !== "undefined") history.replaceState(null, "", url); } catch {}
    try { await navigator.clipboard.writeText(url); } catch {}
    return url;
  }

  async function openSaved(rec) {
    const cfg = { ...config, ...rec.config };
    const sel = (rec.selected || []).filter((id) => (summaries || []).some((s) => s.id === id));
    setMode(rec.mode || "english");
    setText(rec.text || "");
    setConfig(cfg);
    setSelected(sel.length ? sel : selected);
    setParsed({ ok: true, spec: rec.spec, notes: describeSpec(rec.spec), unsupported: [], source: "saved" });
    setBusy(true);
    navigate("parsing");
    await delay(400);
    await runBacktests({ spec: rec.spec, config: cfg, selected: sel.length ? sel : selected });
  }

  function pickClassic(spec) {
    setParsed({ ok: true, spec, notes: describeSpec(spec), unsupported: [], source: "classic" });
    navigate("confirm");
  }

  // Guided first run — the golden cross on the longest-history instrument
  // (IBM), the path guaranteed to produce a meaningful, honest verdict.
  async function onGuidedExample() {
    try { localStorage.setItem("null_seen_onboarding", "1"); } catch {}
    const list = summaries || [];
    const ibm = list.find((s) => s.id === "IBM") || list[0];
    const sel = ibm ? [ibm.id] : selected;
    const spec = CLASSICS.find((c) => c.key === "golden-cross").spec;
    setSelected(sel);
    setText("Go long when the 50-day SMA crosses above the 200-day SMA, exit when it crosses back below.");
    setParsed({ ok: true, spec, notes: describeSpec(spec), unsupported: [], source: "guided" });
    setBusy(true);
    navigate("parsing");
    await delay(500);
    await runBacktests({ spec, config, selected: sel });
  }
  const firstRun = (() => { try { return !localStorage.getItem("null_seen_onboarding"); } catch { return false; } })();

  const primary = runs.find((r) => r.result?.ok) || runs[0] || null;
  const verdict = primary?.result?.ok ? computeVerdict(primary.result, { robustness: robust, fragility }) : null;
  const xVerdict = runs.length > 1 ? crossInstrumentVerdict(runs) : null;
  const revealed = screen === "results-revealed";
  const motionKey = screen.startsWith("results") ? "results" : screen;

  // Which verdicts users actually reach (bucket only — no strategy detail).
  useEffect(() => {
    if (screen === "verdict" && verdict) track("verdict", { bucket: verdict.bucket });
  }, [screen, verdict?.bucket]);

  return (
    <div style={{ minHeight: "100vh", background: C.canvas, color: C.text, fontFamily: SANS }}>
      {screen !== "landing" && (
        <NavBar onHome={() => navigate("landing")} onTest={restart} showTest={screen !== "input"} />
      )}

      <AnimatePresence mode="wait">
        <motion.div key={motionKey} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
          {screen === "landing" && <Landing onStart={() => navigate("input")} onGuided={onGuidedExample} firstRun={firstRun} dataReady={!!summaries} dataError={dataError} />}

          {screen === "input" && dataError && (
            <div className="screen container w-2xl">
              <div className="card" style={{ borderColor: `${C.red}66`, background: `${C.red}10`, padding: 18 }}>
                <p style={{ fontFamily: SANS, color: C.red, margin: 0, lineHeight: 1.6 }}>
                  Couldn’t load the market-data manifest ({dataError}). The data lives in <code>public/data/</code> and is served statically; run <code>npm run fetch-data</code> to (re)generate it.
                </p>
              </div>
            </div>
          )}

          {screen === "input" && !dataError && !summaries && (
            <Parsing label="LOADING REAL MARKET DATA…" />
          )}

          {screen === "input" && !dataError && summaries && (
            <InputScreen
              mode={mode} setMode={setMode} text={text} setText={setText}
              instruments={summaries} selected={selected} toggleInstrument={toggleInstrument}
              config={config} setConfig={setConfig} onRun={onRun} busy={busy} aiOn={aiOn}
              onKeyChange={() => setAiOn(aiAvailable())}
              classics={CLASSICS} onPickClassic={pickClassic}
              saved={savedList} onOpenSaved={openSaved}
              onDeleteSaved={(id) => { deleteSaved(id); setSavedList(listSaved()); }}
            />
          )}

          {screen === "parsing" && (
            <Parsing label={aiOn && mode === "english" ? "ASKING CLAUDE TO READ YOUR STRATEGY…" : "READING YOUR STRATEGY…"} />
          )}

          {screen === "clarify" && clarify && (
            <ClarifyScreen clarify={clarify} onAnswer={onClarifyAnswer} onSkip={onClarifySkip} onEdit={() => navigate("input")} busy={busy} />
          )}

          {screen === "confirm" && (
            <ConfirmScreen parsed={parsed} onConfirm={onConfirm} onEdit={() => navigate("input")} busy={busy} />
          )}

          {(screen === "results-locked" || screen === "results-revealed") && primary && (
            <ResultsScreen
              runs={runs} primary={primary} revealed={revealed}
              onReveal={() => navigate("results-revealed")}
              showCosts={showCosts} setShowCosts={setShowCosts}
              onVerdict={() => navigate("verdict")} xVerdict={xVerdict}
              robustness={robust} fragility={fragility} testCount={testCount}
              onCompare={onCompare} classics={CLASSICS} saved={savedList}
            />
          )}

          {screen === "verdict" && primary && verdict && (
            <VerdictScreen
              verdict={verdict} result={primary.result} instrumentSymbol={primary.symbol} crossRuns={runs}
              fragility={fragility}
              onExport={() => navigate("export")} onRestart={restart}
              onSave={onSave} onCopyLink={onCopyLink} savedFlash={savedFlash}
            />
          )}

          {screen === "export" && primary?.result?.ok && (
            <ExportScreen spec={primary.result.spec} onRestart={restart} />
          )}
        </motion.div>
      </AnimatePresence>

      {(screen === "results-locked" || screen === "results-revealed" || screen === "verdict") && (
        <footer className="w-5xl container" style={{ marginTop: 8, paddingTop: 16, paddingBottom: 40, fontFamily: SANS, fontSize: 11, color: C.muted, lineHeight: 1.6, borderTop: `1px solid ${C.border}` }}>
          Real data only — no metric on this page is hardcoded. Each is computed from a look-ahead-free
          simulation and produced by a unit-tested function; buy-and-hold equals the instrument’s exact
          return (the engine’s self-check). This is one tool’s opinion from one history and one split, not investment advice.
        </footer>
      )}

      <RecomputingChip active={recomputing} />
    </div>
  );
}

// A subtle, non-blocking indicator that the engine is running off-thread. It
// never covers or disables the UI — the whole point of the worker is that the
// page stays interactive while this is up.
function RecomputingChip({ active }) {
  return (
    <AnimatePresence>
      {active && (
        <motion.div
          initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}
          transition={{ duration: 0.2 }}
          role="status" aria-live="polite"
          style={{
            position: "fixed", right: 18, bottom: 18, zIndex: 50,
            display: "flex", alignItems: "center", gap: 8,
            padding: "8px 14px", borderRadius: 999,
            background: `${C.canvas}ee`, border: `1px solid ${C.border}`,
            fontFamily: "var(--mono, monospace)", fontSize: 11, letterSpacing: "0.1em",
            color: C.muted, backdropFilter: "blur(6px)",
          }}
        >
          <motion.span
            animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1.1, repeat: Infinity }}
            style={{ width: 7, height: 7, borderRadius: "50%", background: C.neon, display: "inline-block" }}
          />
          RECOMPUTING…
        </motion.div>
      )}
    </AnimatePresence>
  );
}
