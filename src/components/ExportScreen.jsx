import React, { useState } from "react";
import { Copy, Check } from "lucide-react";
import { C, SERIF, MONO, SANS } from "../ui/tokens.js";
import { Eyebrow } from "./Bits.jsx";
import { toPineScript } from "../parser/pineExport.js";

export default function ExportScreen({ spec, onRestart }) {
  const [copied, setCopied] = useState(false);
  const code = toPineScript(spec);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="screen container w-3xl">
      <div style={{ paddingTop: 16, marginBottom: 28 }}>
        <Eyebrow>Export</Eyebrow>
        <h1 className="serif" style={{ color: C.text, fontSize: "1.9rem" }}>Pine Script</h1>
      </div>

      <div className="card" style={{ overflow: "hidden", background: C.raised }}>
        <div className="row between center" style={{ padding: "12px 18px", borderBottom: `1px solid ${C.border}` }}>
          <span className="mono" style={{ fontSize: 11, letterSpacing: "0.12em", color: C.muted }}>GENERATED · PINE v5 · FROM THE VALIDATED SPEC</span>
          <button onClick={copy} className="mono row center" style={{ gap: 6, fontSize: 11, padding: "6px 12px", borderRadius: 4, color: copied ? C.neon : C.muted, border: `1px solid ${copied ? C.neon + "55" : C.border}` }}>
            {copied ? <Check size={12} /> : <Copy size={12} />}{copied ? "COPIED" : "COPY"}
          </button>
        </div>
        <pre style={{ margin: 0, padding: 18, fontFamily: MONO, fontSize: 12, color: C.text, overflowX: "auto", lineHeight: 1.6 }}>
          <code>{code}</code>
        </pre>
      </div>

      <p style={{ fontFamily: SANS, fontSize: 12, color: C.muted, marginTop: 18, lineHeight: 1.6 }}>
        Anything that couldn’t be represented appears as a comment, not an approximation. Paste into the TradingView Pine Editor and verify it compiles before use. TradingView fills intrabar, so its results may differ slightly from Null’s close-evaluated stops.
      </p>

      <div className="row" style={{ justifyContent: "center", marginTop: 30 }}>
        <button onClick={onRestart} className="btn btn-neon" style={{ padding: "12px 28px" }}>TEST ANOTHER STRATEGY</button>
      </div>
    </div>
  );
}
