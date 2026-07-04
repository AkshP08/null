import React, { useState, useRef } from "react";
import { ShieldAlert } from "lucide-react";
import { C, MONO, SANS, SERIF } from "../ui/tokens.js";
import { Eyebrow } from "./Bits.jsx";
import { num } from "../ui/format.js";

const BADGE = {
  fragile: { color: C.red, word: "FRAGILE — LONELY SPIKE" },
  robust: { color: C.neon, word: "ROBUST — BROAD PLATEAU" },
  mixed: { color: C.amber, word: "MIXED — UNEVEN LANDSCAPE" },
  "no-edge": { color: C.muted, word: "NO EDGE TO BE FRAGILE ABOUT" },
  insufficient: { color: C.muted, word: "INCONCLUSIVE" },
};

// hex → {r,g,b}
function rgb(hex) {
  const h = hex.replace("#", "");
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}
function mix(a, b, w) {
  const x = rgb(a), y = rgb(b);
  const c = (k) => Math.round(x[k] + (y[k] - x[k]) * Math.max(0, Math.min(1, w)));
  return `rgb(${c("r")},${c("g")},${c("b")})`;
}
// map an OOS Sharpe to a colour on Null's palette (red → neutral → neon)
function cellColor(s) {
  if (s == null || !Number.isFinite(s)) return "#0E1322"; // no valid backtest here
  if (s <= 0) return mix(C.surface, C.red, 0.18 + 0.5 * Math.min(1, -s / 1.0));
  return mix(C.surface, C.neon, 0.12 + 0.6 * Math.min(1, s / 1.2));
}

export default function FragilityExplorer({ fragility }) {
  const f = fragility;
  const mapRef = useRef(null);
  const [hover, setHover] = useState(null); // {i,j}
  const [tip, setTip] = useState({ x: 0, y: 0 }); // pointer pos, relative to the map

  if (!f) return null;
  if (!f.ok) {
    return (
      <div className="w-5xl container" style={{ marginBottom: 16 }}>
        <div className="card" style={{ padding: "14px 16px" }}>
          <Eyebrow>Fragility explorer</Eyebrow>
          <p style={{ fontFamily: SANS, fontSize: 12.5, color: C.muted, margin: "6px 0 0", lineHeight: 1.55 }}>
            {f.reason === "no-tunable-params"
              ? "This strategy has no numeric parameters to sweep, so there's no fragility landscape to map."
              : "The fragility sweep couldn't be computed for this run."}
          </p>
        </div>
      </div>
    );
  }

  const badge = BADGE[f.classification] || BADGE.insufficient;
  const ax0 = f.axes[0]; // rows (i) — vertical axis
  const ax1 = f.axes[1] || null; // cols (j) — horizontal axis; null for 1D
  const cols = ax1 ? ax1.values.length : ax0.values.length;
  const rows = ax1 ? ax0.values.length : 1;
  const cellAt = (i, j) => (ax1 ? f.grid[i][j] : f.grid[0][j]);
  const isUser = (i, j) => (ax1 ? i === f.userIndex.i && j === f.userIndex.j : j === f.userIndex.j);

  // Axis identity, stated explicitly so each axis is unmistakable.
  const rowLabel = ax0.label.toUpperCase();            // vertical (only in 2D)
  const colLabel = (ax1 ? ax1 : ax0).label.toUpperCase(); // horizontal
  const colValues = ax1 ? ax1.values : ax0.values;
  const userCol = f.userIndex.j;
  const rotateTicks = cols > 6; // avoid overlap when many columns (e.g. at 390px)

  // readout panel (persistent) mirrors the hovered/selected cell, else your params
  const shown = hover || f.userIndex;
  const showCell = ax1 ? cellAt(shown.i, shown.j) : cellAt(0, shown.j);
  const showParams = ax1
    ? `${rowLabel} = ${ax0.values[shown.i]}, ${colLabel} = ${ax1.values[shown.j]}`
    : `${colLabel} = ${ax0.values[shown.j]}`;

  const relPos = (e) => {
    const r = mapRef.current?.getBoundingClientRect();
    return r ? { x: e.clientX - r.left, y: e.clientY - r.top } : { x: 0, y: 0 };
  };
  // inspect a cell on hover / tap — NEVER applies or recommends it (guardrail).
  const inspect = (i, j, e) => { setHover({ i, j }); setTip(relPos(e)); };

  const hoverCell = hover ? (ax1 ? cellAt(hover.i, hover.j) : cellAt(0, hover.j)) : null;

  return (
    <div className="w-5xl container" style={{ marginBottom: 16 }}>
      <div className="card" style={{ padding: "16px 18px" }}>
        <div className="row between center wrap gap2" style={{ marginBottom: 6 }}>
          <Eyebrow>Fragility explorer · out-of-sample Sharpe</Eyebrow>
          <span className="mono" style={{ fontSize: 10, letterSpacing: "0.1em", color: badge.color, border: `1px solid ${badge.color}55`, borderRadius: 100, padding: "3px 10px" }}>
            {badge.word}
          </span>
        </div>

        <p style={{ fontFamily: SANS, fontSize: 13, color: C.text, lineHeight: 1.6, margin: "2px 0 14px" }}>{f.note}</p>

        <div className="row wrap" style={{ gap: 20, alignItems: "flex-start" }}>
          {/* the map */}
          <div style={{ flex: "1 1 320px", minWidth: 268 }}>
            <div className="row" style={{ gap: 8, alignItems: "stretch" }}>
              {/* vertical-axis TITLE (2D only) — reads bottom-to-top */}
              {ax1 && (
                <div className="col center" style={{ justifyContent: "center" }}>
                  <span className="mono" title={rowLabel} style={{ fontSize: 9, letterSpacing: "0.08em", color: C.muted, writingMode: "vertical-rl", transform: "rotate(180deg)", whiteSpace: "nowrap" }}>
                    ↑ {rowLabel}
                  </span>
                </div>
              )}
              {/* vertical-axis value ticks (2D only) */}
              {ax1 && (
                <div className="col" style={{ justifyContent: "space-between", paddingTop: 2, paddingBottom: 2 }}>
                  {ax0.values.map((v, i) => (
                    <span key={i} className="mono" style={{ fontSize: 9, color: i === f.userIndex.i ? C.text : C.muted, height: `${100 / rows}%`, display: "flex", alignItems: "center" }}>{v}</span>
                  ))}
                </div>
              )}

              <div ref={mapRef} style={{ flex: 1, position: "relative" }}>
                <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 3 }}>
                  {Array.from({ length: rows * cols }).map((_, idx) => {
                    const i = Math.floor(idx / cols), j = idx % cols;
                    const cell = ax1 ? cellAt(i, j) : cellAt(0, j);
                    const user = isUser(i, j);
                    return (
                      <div
                        key={idx}
                        role="button"
                        aria-label={`${showParamsFor(ax0, ax1, rowLabel, colLabel, i, j)} — OOS Sharpe ${num(cell?.sharpe)}`}
                        onMouseEnter={(e) => inspect(i, j, e)}
                        onMouseMove={(e) => setTip(relPos(e))}
                        onMouseLeave={() => setHover(null)}
                        onClick={(e) => inspect(i, j, e)} /* tap-to-INSPECT only — never applies */
                        style={{
                          aspectRatio: "1 / 1", background: cellColor(cell?.sharpe), borderRadius: 2,
                          border: user ? `2px solid ${C.text}` : `1px solid ${C.border}`,
                          boxShadow: user ? `0 0 0 2px ${C.canvas}, 0 0 8px ${C.text}55` : "none",
                          cursor: "pointer", position: "relative",
                        }}
                      >
                        {user && <span style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", color: C.text, fontSize: 11, lineHeight: 1 }}>◆</span>}
                      </div>
                    );
                  })}
                </div>

                {/* horizontal-axis value ticks (rotated when crowded) */}
                <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 3, marginTop: 4, height: rotateTicks ? 24 : "auto" }}>
                  {colValues.map((v, j) => (
                    <span key={j} className="mono" style={{
                      fontSize: 8.5, color: j === userCol ? C.text : C.muted, whiteSpace: "nowrap",
                      textAlign: "center",
                      ...(rotateTicks ? { transform: "rotate(-45deg)", transformOrigin: "center top", alignSelf: "start" } : {}),
                    }}>{v}</span>
                  ))}
                </div>

                {/* floating tooltip — the hovered/tapped cell's exact params + OOS Sharpe */}
                {hover && (
                  <CellTip
                    lines={ax1
                      ? [`${rowLabel} = ${ax0.values[hover.i]}`, `${colLabel} = ${ax1.values[hover.j]}`]
                      : [`${colLabel} = ${ax0.values[hover.j]}`]}
                    cell={hoverCell} x={tip.x} y={tip.y} mapW={mapRef.current?.clientWidth || 280}
                  />
                )}
              </div>
            </div>

            {/* horizontal-axis TITLE */}
            <div className="mono" style={{ fontSize: 9.5, color: C.muted, textAlign: "center", marginTop: rotateTicks ? 12 : 6, letterSpacing: "0.08em" }}>
              {colLabel} →
            </div>

            {/* legend: what ◆ means + how the colour maps to Sharpe */}
            <div className="row center wrap" style={{ gap: 14, marginTop: 12 }}>
              <span className="row center" style={{ gap: 5 }}>
                <span style={{ color: C.text, fontSize: 11, lineHeight: 1 }}>◆</span>
                <span className="mono" style={{ fontSize: 9, color: C.muted, letterSpacing: "0.06em" }}>YOUR PARAMETERS</span>
              </span>
              <span className="row center" style={{ gap: 6 }}>
                <span className="mono" style={{ fontSize: 9, color: C.red }}>LOWER</span>
                <div style={{ width: 64, height: 8, borderRadius: 4, background: `linear-gradient(90deg, ${mix(C.surface, C.red, 0.6)}, ${C.surface}, ${mix(C.surface, C.neon, 0.7)})` }} />
                <span className="mono" style={{ fontSize: 9, color: C.neon }}>HIGHER OOS SHARPE</span>
              </span>
            </div>
          </div>

          {/* persistent readout + guardrail */}
          <div style={{ flex: "1 1 220px", minWidth: 200 }}>
            <div className="card" style={{ background: C.raised, padding: "10px 12px", marginBottom: 10 }}>
              <p className="mono" style={{ fontSize: 9.5, letterSpacing: "0.1em", color: C.muted, margin: "0 0 6px" }}>
                {hover ? "HOVERED CELL" : "◆ YOUR PARAMETERS"}
              </p>
              <div className="mono" style={{ fontSize: 12, color: C.text, lineHeight: 1.6 }}>
                <div>{showParams}</div>
                <div className="row between" style={{ marginTop: 4 }}><span style={{ color: C.muted }}>OOS Sharpe</span><span style={{ color: cellColor(showCell?.sharpe), fontWeight: 500 }}>{num(showCell?.sharpe)}</span></div>
                <div className="row between"><span style={{ color: C.muted }}>OOS trades</span><span>{showCell?.trades ?? "—"}</span></div>
              </div>
            </div>

            <p className="row gap2" style={{ fontFamily: SANS, fontSize: 11, color: C.muted, lineHeight: 1.5, alignItems: "flex-start" }}>
              <ShieldAlert size={13} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>This maps <em>fragility</em>, not the “best” settings. The brightest cell is <strong>not</strong> a recommendation — a peak that exists at one setting and collapses around it is exactly the overfitting Null exists to catch. Hovering only inspects a cell; there is no “use best parameters” here by design.</span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// aria label for a cell, so the params are legible to assistive tech too.
function showParamsFor(ax0, ax1, rowLabel, colLabel, i, j) {
  return ax1 ? `${rowLabel} = ${ax0.values[i]}, ${colLabel} = ${ax1.values[j]}` : `${colLabel} = ${ax0.values[j]}`;
}

// The per-cell hover/tap tooltip: exact params + OOS Sharpe, clamped to the map.
function CellTip({ lines, cell, x, y, mapW }) {
  const TIPW = 152;
  const left = Math.min(Math.max(4, x + 12), Math.max(4, mapW - TIPW - 2));
  const top = Math.max(2, y - 54);
  return (
    <div className="mono" style={{
      position: "absolute", left, top, width: TIPW, zIndex: 6, pointerEvents: "none",
      background: `${C.canvas}f2`, border: `1px solid ${C.border}`, borderRadius: 6, padding: "6px 8px",
      fontSize: 10.5, backdropFilter: "blur(4px)",
    }}>
      {lines.map((l, k) => <div key={k} style={{ color: C.text }}>{l}</div>)}
      <div className="row between" style={{ gap: 10, marginTop: 4 }}>
        <span style={{ color: C.muted }}>OOS Sharpe</span>
        <span style={{ color: cellColor(cell?.sharpe), fontWeight: 600 }}>{num(cell?.sharpe)}</span>
      </div>
      <div className="row between" style={{ gap: 10 }}>
        <span style={{ color: C.muted }}>OOS trades</span>
        <span style={{ color: C.text }}>{cell?.trades ?? "—"}</span>
      </div>
    </div>
  );
}
