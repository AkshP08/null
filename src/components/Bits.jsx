import React from "react";
import { C, SERIF, MONO, SANS } from "../ui/tokens.js";

export function NullLogo({ size = "md" }) {
  const glyph = { sm: 20, md: 26, lg: 92 }[size];
  const word = { sm: 18, md: 22, lg: 60 }[size];
  return (
    <span className="row center" style={{ gap: 8, userSelect: "none" }}>
      <span style={{ fontFamily: MONO, color: C.neon, fontSize: glyph, lineHeight: 1 }}>∅</span>
      <span
        className="serif"
        style={{ color: C.text, fontSize: word, letterSpacing: "-0.02em" }}
      >
        null
      </span>
    </span>
  );
}

export function NavBar({ onHome, onTest, showTest = true }) {
  return (
    <nav
      className="row between center"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 50,
        padding: "14px clamp(16px,4vw,24px)",
        background: C.canvas,
        borderBottom: `1px solid ${C.border}`,
      }}
    >
      <button onClick={onHome} aria-label="Home">
        <NullLogo size="sm" />
      </button>
      {showTest && (
        <button
          onClick={onTest}
          className="mono"
          style={{
            fontSize: 11,
            letterSpacing: "0.1em",
            color: C.muted,
            border: `1px solid ${C.border}`,
            borderRadius: 6,
            padding: "8px 14px",
          }}
        >
          TEST A STRATEGY
        </button>
      )}
    </nav>
  );
}

export function Eyebrow({ children }) {
  return <p className="eyebrow">{children}</p>;
}

// A persistent honest-framing chip shown wherever numbers appear.
export function Disclaimer({ style }) {
  return (
    <span
      className="mono"
      style={{ fontSize: 10, letterSpacing: "0.08em", color: C.muted, border: `1px solid ${C.border}`, borderRadius: 100, padding: "3px 10px", display: "inline-block", ...style }}
    >
      CREDIBILITY STRESS-TEST · NOT ADVICE · NOT A SIGNAL
    </span>
  );
}

export function MetricRow({ label, value, good, blur }) {
  return (
    <div
      className="row between center"
      style={{
        padding: "11px 0",
        borderBottom: `1px solid ${C.border}`,
        filter: blur ? "blur(6px)" : "none",
        userSelect: blur ? "none" : "auto",
        pointerEvents: blur ? "none" : "auto",
        transition: "filter 0.4s",
      }}
    >
      <span
        className="mono"
        style={{ fontSize: 11, letterSpacing: "0.12em", color: C.muted }}
      >
        {label.toUpperCase()}
      </span>
      <span
        className="mono"
        style={{ fontSize: 14, fontWeight: 500, color: good ? C.neon : C.red }}
      >
        {value}
      </span>
    </div>
  );
}
