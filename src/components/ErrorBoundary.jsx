import React from "react";
import { C, SERIF, MONO, SANS } from "../ui/tokens.js";
import { reportError } from "../monitoring.js";

// Catches render/runtime errors anywhere below it so a crash surfaces as a
// visible, honest message instead of a blank white screen — and routes the
// error through reportError so it is logged/monitored rather than dying
// silently. In Null's voice: it does not pretend nothing happened.
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    reportError(error, "react-render");
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{ minHeight: "100vh", background: C.canvas, color: C.text, fontFamily: SANS, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <div className="card" style={{ maxWidth: 460, width: "100%", padding: "24px 22px", borderColor: `${C.red}55` }}>
          <p className="mono" style={{ fontSize: 11, letterSpacing: "0.14em", color: C.red, margin: 0 }}>SOMETHING BROKE</p>
          <h1 className="serif" style={{ color: C.text, fontSize: "1.5rem", margin: "10px 0 8px" }}>Null hit an error — and it's not going to hide it.</h1>
          <p style={{ fontSize: 13.5, color: C.muted, lineHeight: 1.6, margin: "0 0 18px" }}>
            This is a bug in the app, not a verdict on your strategy. Nothing you did was wrong, and no result you saw was faked to cover it. The failure has been logged. Reload to start over.
          </p>
          <p className="mono" style={{ fontSize: 11, color: C.muted, background: C.raised, border: `1px solid ${C.border}`, borderRadius: 6, padding: "8px 10px", margin: "0 0 18px", overflowX: "auto", whiteSpace: "nowrap" }}>
            {String(this.state.error?.message || this.state.error).slice(0, 160)}
          </p>
          <button onClick={() => { if (typeof location !== "undefined") location.reload(); }} className="btn btn-neon" style={{ padding: "12px 20px" }}>
            RELOAD
          </button>
        </div>
      </div>
    );
  }
}
