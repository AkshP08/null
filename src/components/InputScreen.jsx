import React, { useState } from "react";
import { C, SERIF, MONO, SANS } from "../ui/tokens.js";
import { Eyebrow } from "./Bits.jsx";
import { setApiKey, keyFromEnv } from "../parser/aiParser.js";

const EXAMPLES = {
  english: [
    { label: "50/200 SMA crossover", text: "Go long when the 50-day moving average crosses above the 200-day moving average, exit when it crosses back below, with an 8% stop loss." },
    { label: "RSI(14) mean reversion", text: "Buy when RSI(14) drops below 30, and sell when RSI rises above 60." },
    { label: "50-day breakout", text: "Go long when price breaks above the 50-day high. Use a 10% stop and a 20% take profit." },
    { label: "200-day trend filter", text: "Go long when price is above its 200-day moving average." },
  ],
  pine: [
    { label: "SMA cross", text: `//@version=5\nstrategy("SMA cross", overlay=true)\nfast = ta.sma(close, 20)\nslow = ta.sma(close, 50)\nif ta.crossover(fast, slow)\n    strategy.entry("Long", strategy.long)\nif ta.crossunder(fast, slow)\n    strategy.close("Long")` },
    { label: "RSI", text: `//@version=5\nstrategy("RSI", overlay=true)\nr = ta.rsi(close, 14)\nif r < 30\n    strategy.entry("Long", strategy.long)\nif r > 70\n    strategy.close("Long")` },
  ],
};

const inputStyle = {
  background: C.raised,
  color: C.text,
  border: `1px solid ${C.border}`,
  borderRadius: 8,
  fontFamily: SANS,
};

export default function InputScreen({
  mode, setMode, text, setText,
  instruments, selected, toggleInstrument,
  config, setConfig, onRun, busy, aiOn,
  classics = [], onPickClassic, saved = [], onOpenSaved, onDeleteSaved, onKeyChange,
}) {
  const canRun = text.trim().length > 3 && selected.length > 0 && !busy;
  const [keyOpen, setKeyOpen] = useState(false);
  const [keyInput, setKeyInput] = useState("");
  const envKey = keyFromEnv();

  return (
    <div className="screen container w-2xl">
      <div style={{ paddingTop: 16, marginBottom: 22 }}>
        <Eyebrow>Strategy</Eyebrow>
        <h1 className="serif" style={{ color: C.text, fontSize: "1.9rem" }}>Describe your edge</h1>
      </div>

      {/* Classic setups — one tap goes straight to the confirmation step */}
      {classics.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <Eyebrow>Classic setups — one tap to test</Eyebrow>
          <div className="row wrap gap2">
            {classics.map((c) => (
              <button key={c.key} onClick={() => onPickClassic(c.spec)} title={c.blurb}
                className="row" style={{ flexDirection: "column", alignItems: "flex-start", gap: 2, padding: "8px 12px", border: `1px solid ${C.border}`, borderRadius: 8, background: C.raised }}>
                <span style={{ fontFamily: SANS, fontSize: 12.5, color: C.text }}>{c.label}</span>
                <span className="mono" style={{ fontSize: 10, color: C.muted }}>{c.blurb}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Saved library — reopened runs are recomputed live, never stored */}
      {saved.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <Eyebrow>Saved — reopens &amp; recomputes live</Eyebrow>
          <div className="col" style={{ gap: 6 }}>
            {saved.slice(0, 6).map((s) => (
              <div key={s.id} className="row between center" style={{ padding: "8px 12px", border: `1px solid ${C.border}`, borderRadius: 8, background: C.raised }}>
                <button onClick={() => onOpenSaved(s)} className="row" style={{ flex: 1, textAlign: "left", gap: 10, alignItems: "baseline" }}>
                  <span style={{ fontFamily: SANS, fontSize: 13, color: C.text }}>{s.name}</span>
                  <span className="mono" style={{ fontSize: 10, color: C.muted }}>{(s.selected || []).join(", ")}</span>
                </button>
                <button onClick={() => onDeleteSaved(s.id)} aria-label="Delete saved strategy" className="mono" style={{ fontSize: 11, color: C.muted, padding: "2px 8px" }}>✕</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Mode toggle */}
      <div className="row" style={{ background: C.raised, border: `1px solid ${C.border}`, borderRadius: 8, padding: 4, marginBottom: 18 }}>
        {["english", "pine"].map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className="mono"
            style={{
              flex: 1, padding: "9px 0", fontSize: 11, letterSpacing: "0.1em", borderRadius: 6,
              background: mode === m ? C.text : "transparent",
              color: mode === m ? C.canvas : C.muted,
            }}
          >
            {m === "english" ? "ENGLISH" : "PINE SCRIPT"}
          </button>
        ))}
      </div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={6}
        aria-label="Strategy description"
        placeholder={mode === "english"
          ? "e.g. go long when the 50-day average crosses above the 200-day; exit on a 5% stop"
          : `// paste your Pine Script strategy here\nstrategy("My Strategy", overlay=true)`}
        style={{ ...inputStyle, width: "100%", padding: 16, fontSize: 14, resize: "vertical", lineHeight: 1.7, fontFamily: mode === "pine" ? MONO : SANS }}
      />

      {/* Example chips */}
      <div className="row wrap gap2" style={{ marginTop: 12, marginBottom: 30 }}>
        {EXAMPLES[mode].map((ex) => (
          <button
            key={ex.label}
            onClick={() => setText(ex.text)}
            className="mono"
            style={{ padding: "7px 12px", fontSize: 11, color: C.muted, border: `1px solid ${C.border}`, borderRadius: 6 }}
          >
            {ex.label}
          </button>
        ))}
      </div>

      {/* Instruments */}
      <div style={{ marginBottom: 26 }}>
        <Eyebrow>Instruments — real data, test on more than one</Eyebrow>
        <div className="row wrap gap2">
          {instruments.map((d) => {
            const active = selected.includes(d.id);
            return (
              <button
                key={d.id}
                onClick={() => toggleInstrument(d.id)}
                role="checkbox"
                aria-checked={active}
                title={`${d.name} · ${d.bars.toLocaleString()} bars · ${d.start}→${d.end}${d.adjusted ? "" : " · unadjusted"}${d.fillConvention === "nextClose" ? " · close-fill" : ""}`}
                className="mono"
                style={{
                  padding: "8px 12px", fontSize: 12, borderRadius: 6,
                  background: active ? `${C.neon}18` : "transparent",
                  color: active ? C.neon : C.muted,
                  border: `1px solid ${active ? C.neon + "55" : C.border}`,
                }}
              >
                {d.symbol}
              </button>
            );
          })}
        </div>
        <p style={{ fontFamily: MONO, fontSize: 10.5, color: C.muted, marginTop: 10, lineHeight: 1.6 }}>
          {selected.length === 0 ? "Select at least one instrument." : instruments
            .filter((d) => selected.includes(d.id))
            .map((d) => `${d.symbol}: ${d.bars.toLocaleString()} bars ${d.start}→${d.end}${d.adjusted ? "" : " (unadjusted)"}${d.fillConvention === "nextClose" ? " (close-fill)" : ""}`)
            .join("  ·  ")}
        </p>
      </div>

      {/* Date range */}
      <div className="grid2" style={{ marginBottom: 18 }}>
        <div>
          <Eyebrow>From (blank = full history)</Eyebrow>
          <input
            type="text" inputMode="numeric" placeholder="YYYY-MM-DD"
            value={config.from} onChange={(e) => setConfig({ ...config, from: e.target.value })}
            style={{ ...inputStyle, width: "100%", padding: "10px 12px", fontSize: 13, fontFamily: MONO }}
          />
        </div>
        <div>
          <Eyebrow>To</Eyebrow>
          <input
            type="text" inputMode="numeric" placeholder="YYYY-MM-DD"
            value={config.to} onChange={(e) => setConfig({ ...config, to: e.target.value })}
            style={{ ...inputStyle, width: "100%", padding: "10px 12px", fontSize: 13, fontFamily: MONO }}
          />
        </div>
      </div>

      {/* Costs */}
      <div className="grid3" style={{ marginBottom: 34 }}>
        {[
          { key: "commissionBps", label: "Commission bps" },
          { key: "slippageBps", label: "Slippage bps" },
          { key: "isPct", label: "In-sample %" },
        ].map((f) => (
          <div key={f.key}>
            <Eyebrow>{f.label}</Eyebrow>
            <input
              type="number"
              value={f.key === "isPct" ? Math.round(config.isFraction * 100) : config[f.key]}
              min={f.key === "isPct" ? 40 : 0}
              max={f.key === "isPct" ? 90 : undefined}
              step={f.key === "isPct" ? 5 : 0.5}
              onChange={(e) => {
                if (f.key === "isPct") setConfig({ ...config, isFraction: Math.min(0.9, Math.max(0.4, +e.target.value / 100)) });
                else setConfig({ ...config, [f.key]: +e.target.value });
              }}
              style={{ ...inputStyle, width: "100%", padding: "10px 12px", fontSize: 13, fontFamily: MONO }}
            />
          </div>
        ))}
      </div>

      <button onClick={onRun} disabled={!canRun} className="btn btn-neon" style={{ width: "100%", padding: 16 }}>
        {busy ? "READING…" : "RUN THE TEST"}
      </button>
      <p style={{ fontFamily: SANS, fontSize: 11.5, color: C.muted, marginTop: 12, textAlign: "center" }}>
        Costs are charged on every fill and default to realistic non-zero values ·{" "}
        {aiOn ? <span style={{ color: C.neon }}>AI parsing on</span> : "local grammar parser (no key needed)"}
        {!envKey && (
          <> · <button onClick={() => setKeyOpen((o) => !o)} className="mono" style={{ color: C.muted, textDecoration: "underline", fontSize: 11 }}>{aiOn ? "manage key" : "add AI key (optional)"}</button></>
        )}
      </p>

      {keyOpen && !envKey && (
        <div className="card" style={{ padding: "14px 16px", marginTop: 10 }}>
          <Eyebrow>Anthropic API key — optional</Eyebrow>
          <p style={{ fontFamily: SANS, fontSize: 12, color: C.muted, lineHeight: 1.55, margin: "2px 0 10px" }}>
            Null works fully without a key using its deterministic grammar parser. A key only makes the plain-English parser
            and the autopsy follow-up more fluent. Your key is stored <b>only in this browser</b> and sent directly to
            Anthropic — never to any Null server. Don’t use a shared/production key.
          </p>
          <div className="row gap2 wrap">
            <input type="password" value={keyInput} onChange={(e) => setKeyInput(e.target.value)} placeholder="sk-ant-…"
              style={{ flex: 1, minWidth: 200, background: C.raised, color: C.text, border: `1px solid ${C.border}`, borderRadius: 6, padding: "9px 11px", fontFamily: MONO, fontSize: 12 }} />
            <button className="btn btn-ghost" style={{ padding: "9px 14px", fontSize: 11 }}
              onClick={() => { setApiKey(keyInput); setKeyInput(""); onKeyChange && onKeyChange(); }}>Save key</button>
            {aiOn && (
              <button className="btn btn-ghost" style={{ padding: "9px 14px", fontSize: 11 }}
                onClick={() => { setApiKey(""); onKeyChange && onKeyChange(); }}>Remove</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
