import React, { useState, useMemo } from "react";
import { AlertTriangle, Pencil, RotateCcw } from "lucide-react";
import { C, SERIF, MONO, SANS } from "../ui/tokens.js";
import { Eyebrow } from "./Bits.jsx";
import { describeSpec } from "../parser/aiParser.js";
import { validateSpec } from "../engine/schema.js";

const inputStyle = { background: C.raised, color: C.text, border: `1px solid ${C.border}`, borderRadius: 6, fontFamily: MONO, fontSize: 12, padding: "6px 8px", outline: "none" };

const PERIOD_KINDS = { sma: "SMA", ema: "EMA", rsi: "RSI", roc: "ROC" };
const KIND_OPTS = { price: "Price", sma: "SMA", ema: "EMA", rsi: "RSI", roc: "ROC", macd: "MACD", macdSignal: "MACD signal", bbUpper: "BB upper", bbLower: "BB lower", bbMiddle: "BB mid", atr: "ATR" };

// immutable set-at-path
function setAt(obj, path, value) {
  const next = structuredClone(obj);
  let node = next;
  for (let i = 0; i < path.length - 1; i++) node = node[path[i]];
  node[path[path.length - 1]] = value;
  return next;
}

function NumIn({ value, path, onEdit, min = 1, step = 1, w = 58 }) {
  return (
    <input type="number" value={value ?? ""} min={min} step={step}
      onChange={(e) => onEdit(path, e.target.value === "" ? undefined : Number(e.target.value))}
      style={{ ...inputStyle, width: w }} />
  );
}
function Sel({ value, path, onEdit, opts }) {
  return (
    <select value={value} onChange={(e) => onEdit(path, e.target.value)} style={{ ...inputStyle }}>
      {Object.entries(opts).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
    </select>
  );
}

function IndicatorEditor({ ind, base, onEdit }) {
  const kind = ind.kind;
  const setKind = (k) => {
    // switch kind, seeding sensible defaults so the spec stays valid
    const seed = { price: {}, sma: { period: 50 }, ema: { period: 20 }, rsi: { period: 14 }, roc: { period: 10 },
      macd: { fast: 12, slow: 26 }, macdSignal: { fast: 12, slow: 26, signal: 9 },
      bbUpper: { period: 20, mult: 2 }, bbLower: { period: 20, mult: 2 }, bbMiddle: { period: 20 }, atr: { period: 14 } }[k];
    onEdit(base, { kind: k, ...seed });
  };
  return (
    <span className="row center" style={{ gap: 6, flexWrap: "wrap" }}>
      <select value={kind} onChange={(e) => setKind(e.target.value)} style={inputStyle}>
        {Object.entries(KIND_OPTS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </select>
      {PERIOD_KINDS[kind] && <NumIn value={ind.period} path={[...base, "period"]} onEdit={onEdit} />}
      {(kind === "macd" || kind === "macdSignal") && <>
        <NumIn value={ind.fast ?? 12} path={[...base, "fast"]} onEdit={onEdit} />
        <NumIn value={ind.slow ?? 26} path={[...base, "slow"]} onEdit={onEdit} />
        {kind === "macdSignal" && <NumIn value={ind.signal ?? 9} path={[...base, "signal"]} onEdit={onEdit} />}
      </>}
      {(kind === "bbUpper" || kind === "bbLower" || kind === "bbMiddle") && <>
        <NumIn value={ind.period ?? 20} path={[...base, "period"]} onEdit={onEdit} />
        {kind !== "bbMiddle" && <NumIn value={ind.mult ?? 2} path={[...base, "mult"]} onEdit={onEdit} step={0.5} />}
      </>}
      {kind === "atr" && <NumIn value={ind.period ?? 14} path={[...base, "period"]} onEdit={onEdit} />}
    </span>
  );
}

function ConditionEditor({ cond, path, onEdit }) {
  const t = cond.type;
  if (t === "cross") {
    return (
      <span className="row center" style={{ gap: 6, flexWrap: "wrap" }}>
        <IndicatorEditor ind={cond.fast} base={[...path, "fast"]} onEdit={onEdit} />
        <Sel value={cond.dir} path={[...path, "dir"]} onEdit={onEdit} opts={{ above: "crosses above", below: "crosses below" }} />
        <IndicatorEditor ind={cond.slow} base={[...path, "slow"]} onEdit={onEdit} />
      </span>
    );
  }
  if (t === "threshold") {
    return (
      <span className="row center" style={{ gap: 6, flexWrap: "wrap" }}>
        <IndicatorEditor ind={cond.indicator} base={[...path, "indicator"]} onEdit={onEdit} />
        <Sel value={cond.op} path={[...path, "op"]} onEdit={onEdit} opts={{ ">": ">", "<": "<", ">=": "≥", "<=": "≤" }} />
        <NumIn value={cond.value} path={[...path, "value"]} onEdit={onEdit} step={1} min={-1e9} />
      </span>
    );
  }
  if (t === "breakout") {
    return (
      <span className="row center" style={{ gap: 6, flexWrap: "wrap" }}>
        <span style={{ fontFamily: SANS, fontSize: 12.5, color: C.muted }}>new</span>
        <NumIn value={cond.lookback} path={[...path, "lookback"]} onEdit={onEdit} />
        <span style={{ fontFamily: SANS, fontSize: 12.5, color: C.muted }}>-day</span>
        <Sel value={cond.dir} path={[...path, "dir"]} onEdit={onEdit} opts={{ high: "high", low: "low" }} />
      </span>
    );
  }
  if (t === "volume") {
    return (
      <span className="row center" style={{ gap: 6, flexWrap: "wrap" }}>
        <span style={{ fontFamily: SANS, fontSize: 12.5, color: C.muted }}>volume &gt;</span>
        <NumIn value={cond.mult ?? 1.5} path={[...path, "mult"]} onEdit={onEdit} step={0.1} />
        <span style={{ fontFamily: SANS, fontSize: 12.5, color: C.muted }}>× avg of</span>
        <NumIn value={cond.period ?? 20} path={[...path, "period"]} onEdit={onEdit} />
      </span>
    );
  }
  return <span className="mono" style={{ fontSize: 12, color: C.muted }}>{JSON.stringify(cond)}</span>;
}

function collectLeaves(entry = []) {
  const leaves = [];
  entry.forEach((c, i) => {
    if (Array.isArray(c.all)) c.all.forEach((sub, j) => leaves.push({ cond: sub, path: ["entry", i, "all", j], group: "AND" }));
    else if (Array.isArray(c.any)) c.any.forEach((sub, j) => leaves.push({ cond: sub, path: ["entry", i, "any", j], group: "OR" }));
    else leaves.push({ cond: c, path: ["entry", i], group: null });
  });
  return leaves;
}

function tagFor(note) {
  const lead = note.split(/[:.]/)[0].trim().toUpperCase();
  if (/ENTRY|ENTER/.test(lead)) return "ENTRY";
  if (/EXIT/.test(lead)) return "EXIT";
  if (/STOP/.test(lead)) return "STOP";
  if (/TAKE|PROFIT|TARGET/.test(lead)) return "TARGET";
  if (/TRAIL/.test(lead)) return "TRAIL";
  if (/DIRECTION/.test(lead)) return "MODE";
  return "RULE";
}

export default function ConfirmScreen({ parsed, onConfirm, onEdit, busy }) {
  const ok = parsed?.ok;
  const [spec, setSpec] = useState(() => (ok ? structuredClone(parsed.spec) : null));
  const [editing, setEditing] = useState(false);

  const edit = (path, value) => setSpec((prev) => setAt(prev, path, value));
  const validation = useMemo(() => (spec ? validateSpec(spec) : { ok: false }), [spec]);
  const notes = useMemo(() => (validation.ok ? describeSpec(validation.spec) : []), [validation]);
  const rows = validation.ok ? notes.map((n) => ({ type: tagFor(n), desc: n })) : [];
  const flags = parsed?.unsupported || [];
  const assumptions = parsed?.assumptions || [];
  const leaves = ok ? collectLeaves(spec.entry) : [];

  return (
    <div className="screen container w-2xl">
      <div style={{ paddingTop: 16, marginBottom: 22 }}>
        <Eyebrow>Parsing result</Eyebrow>
        <h1 className="serif" style={{ color: C.text, fontSize: "1.9rem" }}>What I understood</h1>
      </div>

      {parsed?.fellBack && (
        <div className="card" style={{ borderColor: `${C.amber}66`, background: `${C.amber}12`, padding: "12px 16px", marginBottom: 16 }}>
          <p style={{ fontFamily: SANS, fontSize: 12.5, color: C.amber, margin: 0 }}>
            The AI parser was unavailable ({parsed.fallbackReason}); parsed locally by the deterministic grammar.
          </p>
        </div>
      )}

      {!ok ? (
        <div className="card" style={{ borderColor: `${C.red}66`, background: `${C.red}10`, padding: "16px 18px", marginBottom: 24 }}>
          <p style={{ fontFamily: SANS, fontSize: 13.5, color: C.red, margin: 0, lineHeight: 1.6 }}>
            I couldn’t extract a testable rule. Try “go long when the 50-day SMA crosses above the 200-day SMA, exit on a 5% stop.”
          </p>
          {flags.length > 0 && (
            <ul style={{ margin: "10px 0 0", paddingLeft: 18, color: C.red, fontFamily: SANS, fontSize: 12.5 }}>
              {flags.map((u, i) => <li key={i} style={{ margin: "4px 0" }}>{u}</li>)}
            </ul>
          )}
        </div>
      ) : (
        <>
          {/* read-only interpretation */}
          <div className="card" style={{ overflow: "hidden", marginBottom: 14 }}>
            {rows.map((r, i) => (
              <div key={i} className="row" style={{ gap: 16, alignItems: "flex-start", padding: "13px 18px", borderBottom: i < rows.length - 1 ? `1px solid ${C.border}` : "none" }}>
                <span className="mono" style={{ fontSize: 10.5, letterSpacing: "0.14em", color: C.muted, flexShrink: 0, width: "4.5rem", paddingTop: 2 }}>{r.type}</span>
                <span style={{ fontFamily: SANS, fontSize: 13.5, color: C.text, lineHeight: 1.55 }}>{r.desc}</span>
              </div>
            ))}
          </div>

          <div className="row gap2" style={{ marginBottom: 16 }}>
            <button onClick={() => setEditing((e) => !e)} className="btn btn-ghost row center" style={{ gap: 8, padding: "9px 14px", fontSize: 11 }}>
              <Pencil size={13} /> {editing ? "Hide editor" : "Edit rules"}
            </button>
            {editing && (
              <button onClick={() => setSpec(structuredClone(parsed.spec))} className="btn btn-ghost row center" style={{ gap: 8, padding: "9px 14px", fontSize: 11 }}>
                <RotateCcw size={13} /> Reset to parsed
              </button>
            )}
          </div>

          {/* inline editor — correct a misread rule without retyping */}
          {editing && (
            <div className="card" style={{ padding: "16px 18px", marginBottom: 16 }}>
              <Eyebrow>Edit the rules directly</Eyebrow>
              <div className="col" style={{ gap: 12, marginTop: 8 }}>
                <label className="row center" style={{ gap: 10 }}>
                  <span className="mono" style={{ fontSize: 11, color: C.muted, width: 90 }}>DIRECTION</span>
                  <Sel value={spec.direction} path={["direction"]} onEdit={edit} opts={{ long_flat: "long / flat", long_short: "long & short" }} />
                </label>

                {leaves.map((leaf, i) => (
                  <div key={i} className="row" style={{ gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    <span className="mono" style={{ fontSize: 11, color: C.muted, width: 90 }}>
                      {i === 0 ? "ENTRY" : leaf.group || "AND"}
                    </span>
                    <ConditionEditor cond={leaf.cond} path={leaf.path} onEdit={edit} />
                  </div>
                ))}

                <div className="row center" style={{ gap: 10, flexWrap: "wrap" }}>
                  <span className="mono" style={{ fontSize: 11, color: C.muted, width: 90 }}>STOP / TARGET</span>
                  <span className="row center" style={{ gap: 6 }}>
                    <span style={{ fontFamily: SANS, fontSize: 12, color: C.muted }}>stop %</span>
                    <NumIn value={spec.stopLoss != null ? +(spec.stopLoss * 100).toFixed(2) : ""} path={["stopLoss"]} onEdit={(p, v) => edit(p, v === undefined ? null : v / 100)} min={0} step={0.5} />
                    <span style={{ fontFamily: SANS, fontSize: 12, color: C.muted }}>take %</span>
                    <NumIn value={spec.takeProfit != null ? +(spec.takeProfit * 100).toFixed(2) : ""} path={["takeProfit"]} onEdit={(p, v) => edit(p, v === undefined ? null : v / 100)} min={0} step={0.5} />
                  </span>
                </div>

                <div className="row center" style={{ gap: 10, flexWrap: "wrap" }}>
                  <span className="mono" style={{ fontSize: 11, color: C.muted, width: 90 }}>TRAILING</span>
                  <Sel value={spec.trailingStop?.type || "none"} path={["trailingStop"]}
                    onEdit={(p, v) => edit(p, v === "none" ? null : v === "atr" ? { type: "atr", period: 14, mult: 3 } : { type: "pct", value: 0.05 })}
                    opts={{ none: "none", atr: "ATR trailing", pct: "% trailing" }} />
                  {spec.trailingStop?.type === "atr" && <>
                    <NumIn value={spec.trailingStop.mult ?? 3} path={["trailingStop", "mult"]} onEdit={edit} step={0.5} />
                    <span style={{ fontFamily: SANS, fontSize: 12, color: C.muted }}>× ATR</span>
                    <NumIn value={spec.trailingStop.period ?? 14} path={["trailingStop", "period"]} onEdit={edit} />
                  </>}
                  {spec.trailingStop?.type === "pct" && <>
                    <NumIn value={+(((spec.trailingStop.value ?? 0.05) * 100).toFixed(2))} path={["trailingStop", "value"]} onEdit={(p, v) => edit(p, (v || 0) / 100)} step={0.5} />
                    <span style={{ fontFamily: SANS, fontSize: 12, color: C.muted }}>%</span>
                  </>}
                </div>
              </div>

              {!validation.ok && (
                <p style={{ fontFamily: SANS, fontSize: 12, color: C.red, marginTop: 12 }}>
                  {validation.errors?.[0] || "The edited rules are not valid yet."}
                </p>
              )}
            </div>
          )}

          {assumptions.length > 0 && (
            <div className="card" style={{ overflow: "hidden", marginBottom: 16 }}>
              <div style={{ padding: "12px 18px 6px" }}><Eyebrow>Assumptions I made — edit above if any are wrong</Eyebrow></div>
              {assumptions.map((a, i) => (
                <div key={i} className="row" style={{ gap: 12, alignItems: "flex-start", padding: "8px 18px 12px" }}>
                  <span className="mono" style={{ fontSize: 11, color: C.muted, flexShrink: 0, marginTop: 1 }}>·</span>
                  <span style={{ fontFamily: SANS, fontSize: 12.5, color: C.text, lineHeight: 1.55 }}>{a}</span>
                </div>
              ))}
            </div>
          )}

          {flags.length > 0 && (
            <div className="card" style={{ borderColor: `${C.amber}55`, background: `${C.amber}10`, overflow: "hidden", marginBottom: 16 }}>
              <div style={{ padding: "12px 18px 6px" }}><Eyebrow>Not included in the test — disclosed, not dropped</Eyebrow></div>
              {flags.map((u, i) => (
                <div key={i} className="row" style={{ gap: 12, alignItems: "flex-start", padding: "8px 18px 12px" }}>
                  <AlertTriangle size={14} style={{ color: C.amber, flexShrink: 0, marginTop: 2 }} />
                  <span style={{ fontFamily: SANS, fontSize: 12.5, color: "#ECD9A8", lineHeight: 1.55 }}>{u}</span>
                </div>
              ))}
            </div>
          )}

          <p style={{ fontFamily: MONO, fontSize: 10.5, color: C.muted, marginBottom: 22, letterSpacing: "0.04em" }}>
            PARSED BY {parsed.source === "ai" ? "CLAUDE (claude-sonnet-4-6)" : parsed.source === "pine" ? "PINE SUBSET PARSER" : "LOCAL GRAMMAR PARSER"} · VALIDATED AGAINST SCHEMA
          </p>
        </>
      )}

      <div className="row gap3 wrap">
        {ok && (
          <button onClick={() => onConfirm(validation.spec)} disabled={busy || !validation.ok} className="btn btn-neon" style={{ flex: 1, minWidth: 220 }}>
            {busy ? "RUNNING…" : "LOOKS RIGHT — TEST IT"}
          </button>
        )}
        <button onClick={onEdit} disabled={busy} className="btn btn-ghost" style={{ padding: "14px 28px" }}>← RE-TYPE</button>
      </div>
    </div>
  );
}
