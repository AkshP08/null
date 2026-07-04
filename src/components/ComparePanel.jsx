import React, { useState } from "react";
import { GitCompare, X } from "lucide-react";
import { C, MONO, SANS } from "../ui/tokens.js";
import { Eyebrow } from "./Bits.jsx";
import { buildCompareView } from "../ui/compareView.js";
import { signedPct, pct, num } from "../ui/format.js";
import OverlayChart from "./OverlayChart.jsx";

// Compare mode: overlay the current strategy against buy-and-hold or a chosen
// classic/saved strategy on one chart + one metrics table, so relative
// performance is obvious. Buy-and-hold is already in the primary result (a
// view, no recompute); every other comparator is a REAL backtest recomputed
// live through the worker via `onCompare`. Nothing is cached or faked. Picking
// a comparator is a strategy change, so it (and only it) hits the worker;
// hovering the resulting chart never recomputes.
//
// Metric rows: [label, format, read, higherIsBetter]
const ROWS = [
  ["Total return", (v) => signedPct(v), (m) => m.totalReturn, true],
  ["CAGR", (v) => signedPct(v), (m) => m.cagr, true],
  ["Sharpe", (v) => num(v), (m) => m.sharpe, true],
  ["Volatility (ann.)", (v) => pct(v), (m) => m.annualizedVol, false],
  ["Max drawdown", (v) => pct(v), (m) => m.maxDrawdown, true], // less-negative is better
];

export default function ComparePanel({ result, primaryLabel, symbol, classics, saved, onCompare }) {
  const [sel, setSel] = useState(null); // { kind:'bh'|'spec', key, label, spec? }
  const [comp, setComp] = useState(null); // recomputed run for a spec comparator
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function pick(opt) {
    setError(null);
    if (sel?.key === opt.key) { setSel(null); setComp(null); return; } // toggle off
    setSel(opt);
    setComp(null);
    if (opt.kind === "bh") return; // buy-and-hold needs no recompute
    setBusy(true);
    try {
      const run = await onCompare(opt.spec); // real recompute through the worker
      if (!run) { setBusy(false); return; } // superseded — leave the picker as-is
      if (!run.result?.ok) {
        setError(run.result?.message || "That strategy couldn't run on this instrument and window.");
        setComp(null);
      } else {
        setComp(run);
      }
    } catch (e) {
      setError(e?.message || "Compare recompute failed.");
    } finally {
      setBusy(false);
    }
  }

  // Build the aligned overlay from real returns once a comparator is ready.
  let view = null;
  if (sel) {
    const A = { dates: result.dates, returns: result.returns.strategy, label: primaryLabel, color: C.neon };
    let B = null;
    if (sel.kind === "bh") {
      B = { dates: result.dates, returns: result.returns.benchmark, label: "Buy & hold", color: C.amber };
    } else if (comp?.result?.ok) {
      B = { dates: comp.result.dates, returns: comp.result.returns.strategy, label: sel.label, color: C.amber };
    }
    if (B) view = buildCompareView(A, B); // → { ok, start, end, bars, a:{label,color,line,metrics}, b:{…} }
  }

  const specOpts = [
    ...(classics || []).map((c) => ({ kind: "spec", key: `classic:${c.key}`, label: c.label, spec: c.spec })),
    ...(saved || []).map((s) => ({ kind: "spec", key: `saved:${s.id}`, label: s.spec?.name || s.name || "saved", spec: s.spec })),
  ];

  return (
    <div className="w-5xl container" style={{ marginTop: 16, padding: 0 }}>
      <div className="card" style={{ padding: "16px 18px" }}>
        <div className="row between center wrap gap2" style={{ marginBottom: 8 }}>
          <Eyebrow>Compare — {primaryLabel} on {symbol}, head to head</Eyebrow>
          <span className="mono row center" style={{ gap: 6, fontSize: 10, letterSpacing: "0.08em", color: C.muted }}>
            <GitCompare size={12} /> AFTER COSTS · RECOMPUTED LIVE
          </span>
        </div>

        {/* comparator picker */}
        <div className="row wrap" style={{ gap: 6 }}>
          <Chip on={sel?.kind === "bh"} onClick={() => pick({ kind: "bh", key: "bh", label: "Buy & hold" })} color={C.amber}>
            BUY &amp; HOLD
          </Chip>
          {specOpts.map((opt) => (
            <Chip key={opt.key} on={sel?.key === opt.key} onClick={() => pick(opt)} color={C.amber}>
              {opt.label.toUpperCase()}
            </Chip>
          ))}
        </div>

        {!sel && (
          <p style={{ fontFamily: SANS, fontSize: 12.5, color: C.muted, marginTop: 12, lineHeight: 1.55 }}>
            Pick a comparator to overlay it on the same chart and metrics — the same instrument, window and costs, recomputed live. Both curves are re-indexed to 100 at the first date they share, so the race is fair.
          </p>
        )}

        {busy && (
          <p className="mono" style={{ fontSize: 11, letterSpacing: "0.1em", color: C.neon, marginTop: 14 }}>
            RECOMPUTING {sel?.label?.toUpperCase()} ON {symbol}…
          </p>
        )}

        {error && (
          <p style={{ fontFamily: SANS, fontSize: 12.5, color: C.red, marginTop: 14, lineHeight: 1.5 }}>{error}</p>
        )}

        {view?.ok && (
          <div style={{ marginTop: 14 }}>
            <div className="row wrap" style={{ gap: 16, fontFamily: MONO, fontSize: 10.5, marginBottom: 4 }}>
              <Legend color={C.neon}>{view.a.label}</Legend>
              <Legend color={C.amber}>{view.b.label}</Legend>
              <span style={{ color: C.muted }}>· common window {view.start} → {view.end} · {view.bars} bars</span>
            </div>
            <OverlayChart
              height={230}
              series={[
                { points: view.a.line, color: C.neon, label: view.a.label },
                { points: view.b.line, color: C.amber, label: view.b.label },
              ]}
            />
            <CompareTable a={view.a} b={view.b} />
            <p style={{ fontFamily: SANS, fontSize: 11, color: C.muted, margin: "10px 0 0", lineHeight: 1.5 }}>
              Every number here is computed from each strategy's real return series over the window they share — the comparator was recomputed through the same look-ahead-free engine. Beating buy-and-hold on one instrument over one window is not proof of an edge.
            </p>
          </div>
        )}

        {sel && view && !view.ok && !busy && !error && (
          <p style={{ fontFamily: SANS, fontSize: 12.5, color: C.muted, marginTop: 14 }}>
            These two share no overlapping dates to compare on this instrument.
          </p>
        )}
      </div>
    </div>
  );
}

function CompareTable({ a, b }) {
  const better = (read, higher) => {
    const va = read(a.metrics), vb = read(b.metrics);
    if (!Number.isFinite(va) || !Number.isFinite(vb) || va === vb) return 0;
    const aWins = higher ? va > vb : va < vb;
    return aWins ? -1 : 1; // -1 → A, +1 → B
  };
  return (
    <div style={{ overflowX: "auto", marginTop: 12 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: MONO, fontSize: 12 }}>
        <thead>
          <tr style={{ color: C.muted }}>
            {["Metric", a.label, b.label].map((h, i) => (
              <th key={i} style={{ textAlign: i === 0 ? "left" : "right", padding: "7px 8px", borderBottom: `1px solid ${C.border}`, fontSize: 10, letterSpacing: "0.06em", textTransform: "uppercase", fontWeight: 400, color: i === 1 ? C.neon : i === 2 ? C.amber : C.muted }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ROWS.map(([label, fmt, read, higher]) => {
            const win = better(read, higher);
            const cell = (side, val) => (
              <td style={{ textAlign: "right", padding: "7px 8px", borderBottom: `1px solid ${C.border}`, color: win === side ? (side === -1 ? C.neon : C.amber) : C.text, fontWeight: win === side ? 600 : 400 }}>
                {fmt(val)}{win === side ? " ◂" : ""}
              </td>
            );
            return (
              <tr key={label}>
                <td style={{ textAlign: "left", padding: "7px 8px", borderBottom: `1px solid ${C.border}`, color: C.muted }}>{label}</td>
                {cell(-1, read(a.metrics))}
                {cell(1, read(b.metrics))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Legend({ color, children }) {
  return (
    <span className="row center" style={{ gap: 6, color: C.text }}>
      <span style={{ width: 14, height: 2, background: color, display: "inline-block" }} />{children}
    </span>
  );
}

function Chip({ on, onClick, color, children }) {
  return (
    <button onClick={onClick} className="mono row center" style={{
      gap: 6, padding: "6px 11px", fontSize: 10, letterSpacing: "0.06em", borderRadius: 100, cursor: "pointer",
      background: on ? `${color}1a` : "transparent",
      border: `1px solid ${on ? color : C.border}`,
      color: on ? color : C.muted,
    }}>
      {on && <X size={11} />}{children}
    </button>
  );
}
