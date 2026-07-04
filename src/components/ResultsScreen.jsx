import React, { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Lock, ChevronRight, MapPin } from "lucide-react";
import { C, SERIF, MONO, SANS } from "../ui/tokens.js";
import { Eyebrow, MetricRow, Disclaimer } from "./Bits.jsx";
import ChartWorkspace from "./ChartWorkspace.jsx";
import Robustness from "./Robustness.jsx";
import FragilityExplorer from "./FragilityExplorer.jsx";
import ComparePanel from "./ComparePanel.jsx";
import { diagnose } from "../engine/autopsy.js";
import { costAwareMetrics } from "../ui/costView.js";
import { signedPct, pct, num } from "../ui/format.js";

function formatPanel(m) {
  return [
    { label: "Total Return", value: signedPct(m.totalReturn), good: m.totalReturn >= 0 },
    { label: "CAGR", value: signedPct(m.cagr), good: m.cagr >= 0 },
    { label: "Sharpe Ratio", value: num(m.sharpe), good: m.sharpe >= 0.5 },
    { label: "Max Drawdown", value: pct(m.maxDrawdown), good: false },
    { label: "Win Rate", value: pct(m.winRate, 0), good: m.winRate >= 0.5 },
    { label: "Profit Factor", value: m.profitFactor === Infinity ? "∞" : num(m.profitFactor), good: m.profitFactor >= 1 },
  ];
}

function CrossTable({ runs, primaryId, xVerdict }) {
  const valid = runs.filter((r) => r.result?.ok);
  if (valid.length < 2) return null;
  const cellColor = (v) => (v >= 0.5 ? C.neon : v < 0 ? C.red : C.text);
  return (
    <div className="w-5xl container" style={{ marginTop: 16, padding: 0 }}>
      <div className="card" style={{ padding: "16px 18px" }}>
        <Eyebrow>Robustness across instruments</Eyebrow>
        {xVerdict && (
          <p style={{ fontFamily: SANS, fontSize: 13, color: xVerdict.level === "good" ? C.neon : xVerdict.level === "fatal" ? C.red : C.amber, lineHeight: 1.55, margin: "4px 0 14px" }}>
            {xVerdict.text}
          </p>
        )}
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: MONO, fontSize: 12 }}>
            <thead>
              <tr style={{ color: C.muted }}>
                {["Instrument", "Trades", "OOS Sharpe", "OOS Return", "vs Buy&Hold", "Max DD"].map((h, i) => (
                  <th key={h} style={{ textAlign: i === 0 ? "left" : "right", padding: "8px 8px", borderBottom: `1px solid ${C.border}`, fontSize: 10, letterSpacing: "0.06em", textTransform: "uppercase", fontWeight: 400 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => {
                const me = r.id === primaryId;
                if (!r.result?.ok) {
                  return (
                    <tr key={r.id}>
                      <td style={{ textAlign: "left", padding: "8px", borderBottom: `1px solid ${C.border}`, color: C.text }}>{r.symbol}{me ? " ◂" : ""}</td>
                      <td colSpan={5} style={{ textAlign: "right", padding: "8px", borderBottom: `1px solid ${C.border}`, color: C.muted }}>{r.result?.message || "could not run"}</td>
                    </tr>
                  );
                }
                const m = r.result.metrics;
                const beat = m.outSample.totalReturn - m.benchmark.totalReturn;
                const td = (content, color = C.text) => <td style={{ textAlign: "right", padding: "8px", borderBottom: `1px solid ${C.border}`, color }}>{content}</td>;
                return (
                  <tr key={r.id} style={{ background: me ? C.raised : "transparent" }}>
                    <td style={{ textAlign: "left", padding: "8px", borderBottom: `1px solid ${C.border}`, color: C.text }}>{r.symbol}{me ? " ◂" : ""}</td>
                    {td(r.result.counts.trades)}
                    {td(num(m.outSample.sharpe), cellColor(m.outSample.sharpe))}
                    {td(signedPct(m.outSample.totalReturn))}
                    {td(signedPct(beat), beat >= 0 ? C.neon : C.red)}
                    {td(pct(m.full.maxDrawdown), C.muted)}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// The bridge between the autopsy's words and the chart's picture: each finding
// that maps to a concrete spot gets a "show me" button that jumps the chart.
function AutopsyLinks({ result, runs, fragility, onJump }) {
  const dx = diagnose(result, runs, { fragility });
  const linked = (dx.causes || []).filter((c) => c.focus);
  const a = dx.anchors;
  if (!linked.length && !a?.drawdown && !a?.worstTrade) return null;
  return (
    <div className="w-5xl container" style={{ marginBottom: 16 }}>
      <div className="card" style={{ padding: "12px 16px" }}>
        <Eyebrow>See it on the chart</Eyebrow>
        <div className="col" style={{ gap: 8, marginTop: 8 }}>
          {linked.map((c, i) => (
            <button key={i} onClick={() => onJump(c.focus)} className="row center gap2"
              style={{ textAlign: "left", background: "transparent", border: `1px solid ${C.border}`, borderRadius: 6, padding: "8px 11px", cursor: "pointer" }}>
              <MapPin size={13} style={{ color: c.severity === "fatal" ? C.red : C.amber, flexShrink: 0 }} />
              <span style={{ fontFamily: SANS, fontSize: 12.5, color: C.text }}>
                {c.title} <span style={{ color: C.muted }}>— show {c.focus.label || "on chart"}</span>
              </span>
            </button>
          ))}
          <div className="row wrap gap2">
            {a?.drawdown && (
              <button onClick={() => onJump({ type: "drawdown" })} className="mono"
                style={{ fontSize: 11, color: C.muted, border: `1px solid ${C.border}`, borderRadius: 100, padding: "6px 11px" }}>
                → jump to worst drawdown ({pct(a.drawdown.depth, 0)})
              </button>
            )}
            {a?.worstTrade && (
              <button onClick={() => onJump({ type: "trade", index: a.worstTrade.index })} className="mono"
                style={{ fontSize: 11, color: C.muted, border: `1px solid ${C.border}`, borderRadius: 100, padding: "6px 11px" }}>
                → jump to worst trade ({signedPct(a.worstTrade.ret, 1)})
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ResultsScreen({ runs, primary, revealed, onReveal, showCosts, setShowCosts, onVerdict, xVerdict, robustness, fragility, testCount, onCompare, classics, saved }) {
  const result = primary.result;
  // A focus request the chart consumes to jump/highlight (set by the autopsy
  // links below and by the chart's own toolbar). New object each time so the
  // chart's effect refires even when jumping to the same spot twice.
  const [focus, setFocus] = useState(null);
  const jump = (f) => setFocus({ ...f, _n: (focus?._n || 0) + 1 });

  if (!result.ok) {
    return (
      <div className="screen container w-2xl">
        <div className="card" style={{ borderColor: `${C.red}66`, background: `${C.red}10`, padding: "18px" }}>
          <p style={{ fontFamily: SANS, color: C.red, margin: 0 }}>
            Couldn’t test on {primary.symbol}. {result.message || (result.reason === "invalid-spec" ? "The parsed strategy didn’t validate." : "Unknown problem.")}
          </p>
        </div>
      </div>
    );
  }

  const inst = result.instrument;
  const meta = runs.find((r) => r.id === inst.id);
  // Pure view swap: after-cost = the engine's authoritative IS/OOS metrics;
  // before-cost = derived from the engine's own no-cost curve (no recompute).
  const costMetrics = costAwareMetrics(result, showCosts);
  const isMetrics = formatPanel(costMetrics.inSample);
  const oosMetrics = formatPanel(costMetrics.outSample);
  const yIS = `${result.window.start?.slice(0, 4)}–${result.split.splitDate?.slice(0, 4)}`;
  const yOOS = `${result.split.splitDate?.slice(0, 4)}–${result.window.end?.slice(0, 4)}`;

  return (
    <div className="screen" style={{ paddingLeft: 0, paddingRight: 0 }}>
      {/* header */}
      <div className="w-5xl container" style={{ paddingTop: 16, marginBottom: 18 }}>
        <div className="row between center wrap gap2" style={{ marginBottom: 6 }}>
          <Eyebrow>{inst.symbol} · {result.window.start} → {result.window.end} · {result.spec.name}</Eyebrow>
          <Disclaimer />
        </div>
        <div className="row between center wrap gap3">
          <h1 className="serif" style={{ color: C.text, fontSize: "clamp(1.5rem,4vw,1.9rem)" }}>
            {revealed ? (showCosts ? "The truth, after costs" : "Gross — before costs") : "In-sample performance"}
          </h1>
          <div className="row" style={{ background: C.raised, border: `1px solid ${C.border}`, borderRadius: 6, padding: 2 }}>
            {[["after", true], ["before", false]].map(([lbl, val]) => (
              <button key={lbl} onClick={() => setShowCosts(val)} className="mono"
                style={{ padding: "6px 14px", fontSize: 11, letterSpacing: "0.08em", borderRadius: 4,
                  background: showCosts === val ? C.surface : "transparent",
                  color: showCosts === val ? C.text : C.muted,
                  border: showCosts === val ? `1px solid ${C.border}` : "1px solid transparent" }}>
                {lbl.toUpperCase()} COSTS
              </button>
            ))}
          </div>
        </div>
        <p style={{ fontFamily: MONO, fontSize: 10.5, color: C.muted, marginTop: 8, lineHeight: 1.6 }}>
          REAL DATA · {meta?.source?.split("(")[0].trim()}
          {meta && !meta.adjusted ? " · UNADJUSTED FOR DIVIDENDS" : ""}
          {meta?.fillConvention === "nextClose" ? " · FILLS AT NEXT CLOSE" : " · FILLS AT NEXT OPEN"}
          {` · ${result.config.commissionBps}BPS COMM + ${result.config.slippageBps}BPS SLIP`}
        </p>
      </div>

      {/* chart workspace — price + the strategy's own indicators, equity reveal,
          oscillator, drawdown, trade drill-down */}
      <div className="w-5xl container" style={{ marginBottom: 16 }}>
        <ChartWorkspace result={result} spec={result.spec} revealed={revealed} showCosts={showCosts} focus={focus} />
      </div>

      {/* autopsy → chart: jump the picture to the spot that proves each finding */}
      {revealed && <AutopsyLinks result={result} runs={runs} fragility={fragility} onJump={jump} />}

      {/* fragility explorer — how sensitive is the edge to its own parameters */}
      {revealed && <FragilityExplorer fragility={fragility} />}

      {/* metric panels */}
      <div className="w-5xl container">
        <div className="grid2">
          {/* in-sample */}
          <div className="card" style={{ overflow: "hidden", borderTop: `2px solid ${C.neon}` }}>
            <div style={{ padding: "14px 18px 12px", borderBottom: `1px solid ${C.border}` }}>
              <p className="mono" style={{ fontSize: 11, letterSpacing: "0.12em", color: C.neon, margin: 0 }}>IN-SAMPLE · {yIS}</p>
              <p style={{ fontFamily: SANS, fontSize: 12, color: C.muted, margin: "4px 0 0" }}>Data the strategy was judged on first</p>
            </div>
            <div style={{ padding: "2px 18px" }}>
              {isMetrics.map((m, i) => <MetricRow key={i} {...m} />)}
            </div>
          </div>

          {/* out-of-sample (locked) */}
          <div className="card" style={{ overflow: "hidden", position: "relative", borderTop: `2px solid ${revealed ? C.red : C.border}`, transition: "border-top-color 0.5s" }}>
            <div style={{ padding: "14px 18px 12px", borderBottom: `1px solid ${C.border}` }}>
              <p className="mono" style={{ fontSize: 11, letterSpacing: "0.12em", color: revealed ? C.red : C.muted, margin: 0, transition: "color 0.4s" }}>OUT-OF-SAMPLE · {yOOS}</p>
              <p style={{ fontFamily: SANS, fontSize: 12, color: C.muted, margin: "4px 0 0" }}>Data the strategy has never seen</p>
            </div>
            <div style={{ padding: "2px 18px" }}>
              {oosMetrics.map((m, i) => <MetricRow key={i} {...m} blur={!revealed} />)}
            </div>
            <AnimatePresence>
              {!revealed && (
                <motion.div initial={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.5 }}
                  className="col center" style={{ position: "absolute", inset: 0, justifyContent: "center", gap: 16, background: `${C.surface}D0`, backdropFilter: "blur(6px)" }}>
                  <Lock size={18} style={{ color: C.muted }} />
                  <p style={{ fontFamily: SANS, fontSize: 12.5, color: C.muted, maxWidth: "18rem", textAlign: "center", lineHeight: 1.6, padding: "0 16px" }}>
                    The real test is data it was never fit to. You haven’t earned this number yet.
                  </p>
                  <button onClick={onReveal} className="btn btn-red" style={{ padding: "12px 22px", fontSize: 11 }}>REVEAL THE TRUTH</button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* cross-instrument + verdict CTA after reveal */}
      <AnimatePresence>
        {revealed && (
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.6, duration: 0.4 }}>
            <Robustness robustness={robustness} testCount={testCount} result={result} />
            {onCompare && (
              <ComparePanel
                result={result} primaryLabel={result.spec.name} symbol={inst.symbol}
                classics={classics} saved={saved} onCompare={onCompare}
              />
            )}
            <CrossTable runs={runs} primaryId={primary.id} xVerdict={xVerdict} />
            <div className="w-5xl container row" style={{ justifyContent: "flex-end", marginTop: 18 }}>
              <button onClick={onVerdict} className="btn btn-ghost" style={{ padding: "12px 22px" }}>
                SEE VERDICT <ChevronRight size={13} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
