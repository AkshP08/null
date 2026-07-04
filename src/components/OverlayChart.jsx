import React, { useEffect, useMemo, useRef, useState } from "react";
import { C, MONO } from "../ui/tokens.js";

// A small, self-contained SVG line-overlay used by compare mode and the
// interactive walk-forward. It plots one or more already-derived equity lines
// (each point is a REAL value read from a backtest result — nothing here
// interpolates or invents) and offers a hover crosshair that reads the real
// value of every line at the pointed-to date. Investigation only: hovering
// never recomputes anything. Fully responsive — it measures its own width and
// redraws, so it reads correctly on desktop and at 390px.
//
// series: [{ points: [{ time, value }], color, label, dashed? }]
export default function OverlayChart({ series, height = 210, baseline = 100, caption }) {
  const wrapRef = useRef(null);
  const [w, setW] = useState(640);
  const [hoverIdx, setHoverIdx] = useState(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth || 640));
    ro.observe(el);
    setW(el.clientWidth || 640);
    return () => ro.disconnect();
  }, []);

  const padL = 46, padR = 14, padT = 12, padB = 24;
  const iw = Math.max(10, w - padL - padR);
  const ih = Math.max(10, height - padT - padB);

  // Shared x-axis = the union of every series' dates, in order. Compare curves
  // share a calendar so this is just their common axis; a single walk-forward
  // window is simply its own dates.
  const times = useMemo(() => {
    const set = new Set();
    for (const s of series || []) for (const p of s.points) set.add(p.time);
    return [...set].sort();
  }, [series]);
  const timeIndex = useMemo(() => new Map(times.map((t, i) => [t, i])), [times]);

  const vals = [];
  for (const s of series || []) for (const p of s.points) if (Number.isFinite(p.value)) vals.push(p.value);
  if (baseline != null) vals.push(baseline);
  let vmin = vals.length ? Math.min(...vals) : 0;
  let vmax = vals.length ? Math.max(...vals) : 1;
  if (vmin === vmax) { vmin -= 1; vmax += 1; }
  const range = vmax - vmin;
  vmin -= range * 0.06;
  vmax += range * 0.06;

  const xOf = (i) => padL + (times.length <= 1 ? iw / 2 : (i / (times.length - 1)) * iw);
  const yOf = (v) => padT + (1 - (v - vmin) / (vmax - vmin)) * ih;

  const pathFor = (pts) => {
    let d = "";
    for (const p of pts) {
      const i = timeIndex.get(p.time);
      if (i == null || !Number.isFinite(p.value)) continue;
      d += `${d ? "L" : "M"}${xOf(i).toFixed(2)},${yOf(p.value).toFixed(2)}`;
    }
    return d;
  };

  const onMove = (e) => {
    const rect = wrapRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    if (times.length === 0) return;
    const t = Math.max(0, Math.min(1, (x - padL) / iw));
    setHoverIdx(Math.round(t * (times.length - 1)));
  };
  const clearHover = () => setHoverIdx(null);

  const hoverTime = hoverIdx != null ? times[hoverIdx] : null;
  const hoverRows = hoverTime
    ? (series || []).map((s) => {
        const p = s.points.find((q) => q.time === hoverTime);
        return { label: s.label, color: s.color, value: p ? p.value : null };
      })
    : [];

  const baseY = baseline != null ? yOf(baseline) : null;
  const tipLeft = hoverIdx != null ? Math.min(Math.max(xOf(hoverIdx) + 10, 6), w - 150) : 0;

  return (
    <div ref={wrapRef} style={{ position: "relative", width: "100%" }}>
      <svg
        width={w} height={height}
        onMouseMove={onMove} onMouseLeave={clearHover}
        style={{ display: "block", touchAction: "none", cursor: "crosshair" }}
      >
        {/* break-even baseline */}
        {baseY != null && (
          <>
            <line x1={padL} y1={baseY} x2={w - padR} y2={baseY} stroke={C.border} strokeDasharray="3 3" strokeWidth="1" />
            <text x={padL - 6} y={baseY + 3} textAnchor="end" fontFamily={MONO} fontSize="9" fill={C.muted}>{baseline}</text>
          </>
        )}
        {/* y bounds */}
        <text x={padL - 6} y={yOf(vmax) + 3} textAnchor="end" fontFamily={MONO} fontSize="9" fill={C.muted}>{vmax.toFixed(0)}</text>
        <text x={padL - 6} y={yOf(vmin) + 3} textAnchor="end" fontFamily={MONO} fontSize="9" fill={C.muted}>{vmin.toFixed(0)}</text>

        {/* x bounds */}
        {times.length > 0 && (
          <>
            <text x={padL} y={height - 8} textAnchor="start" fontFamily={MONO} fontSize="9" fill={C.muted}>{times[0]}</text>
            <text x={w - padR} y={height - 8} textAnchor="end" fontFamily={MONO} fontSize="9" fill={C.muted}>{times[times.length - 1]}</text>
          </>
        )}

        {/* the lines */}
        {(series || []).map((s, k) => (
          <path key={k} d={pathFor(s.points)} fill="none" stroke={s.color}
            strokeWidth={s.width || 1.75} strokeDasharray={s.dashed ? "5 3" : "none"}
            strokeLinejoin="round" strokeLinecap="round" opacity={s.dashed ? 0.85 : 1} />
        ))}

        {/* hover crosshair + dots */}
        {hoverIdx != null && (
          <>
            <line x1={xOf(hoverIdx)} y1={padT} x2={xOf(hoverIdx)} y2={padT + ih} stroke={C.muted} strokeWidth="1" opacity="0.5" />
            {hoverRows.map((r, k) =>
              r.value == null ? null : (
                <circle key={k} cx={xOf(hoverIdx)} cy={yOf(r.value)} r="3.2" fill={r.color} stroke={C.canvas} strokeWidth="1" />
              ),
            )}
          </>
        )}
      </svg>

      {caption && (
        <div className="mono" style={{ fontSize: 9, letterSpacing: "0.08em", color: C.muted, textAlign: "center", marginTop: 2 }}>
          {caption}
        </div>
      )}

      {hoverIdx != null && hoverRows.some((r) => r.value != null) && (
        <div style={{
          position: "absolute", left: tipLeft, top: 6, width: 142, pointerEvents: "none", zIndex: 4,
          background: `${C.canvas}f2`, border: `1px solid ${C.border}`, borderRadius: 6, padding: "6px 8px",
          fontFamily: MONO, fontSize: 10.5, backdropFilter: "blur(4px)",
        }}>
          <div style={{ color: C.text, marginBottom: 4 }}>{hoverTime}</div>
          {hoverRows.map((r, k) => (
            <div key={k} className="row between" style={{ gap: 10 }}>
              <span className="row center" style={{ gap: 5, color: C.muted }}>
                <span style={{ width: 9, height: 2, background: r.color, display: "inline-block" }} />{r.label}
              </span>
              <span style={{ color: r.color }}>{r.value == null ? "—" : r.value.toFixed(1)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
