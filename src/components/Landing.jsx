import React from "react";
import { motion } from "motion/react";
import { ArrowRight } from "lucide-react";
import { C, SERIF, MONO, SANS } from "../ui/tokens.js";

export default function Landing({ onStart, onGuided, firstRun, dataReady }) {
  return (
    <div className="center-screen container">
      <div
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          background: `radial-gradient(ellipse 60% 50% at 50% 40%, ${C.neon}0A 0%, transparent 70%)`,
        }}
      />
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        style={{ position: "relative", maxWidth: 720 }}
      >
        <div
          style={{ fontFamily: MONO, color: C.neon, opacity: 0.12, fontSize: "8rem", lineHeight: 1, marginBottom: 24 }}
        >
          ∅
        </div>
        <h1
          className="serif"
          style={{ color: C.text, fontSize: "clamp(2rem, 6vw, 3.4rem)", lineHeight: 1.15, marginBottom: 22 }}
        >
          Assume your strategy has no edge.
          <br />
          Now make it prove otherwise.
        </h1>
        <p
          style={{ fontFamily: SANS, color: C.muted, fontSize: 16, lineHeight: 1.6, maxWidth: 460, margin: "0 auto 40px" }}
        >
          Null tests trading strategies the way a skeptic would — on real data
          they’ve never seen, after real costs. Every number is computed from a
          look-ahead-free backtest. Nothing here is hardcoded.
        </p>
        <div className="row center gap4 wrap" style={{ justifyContent: "center" }}>
          <button onClick={onStart} className="btn btn-neon" style={{ padding: "16px 30px" }}>
            TEST A STRATEGY <ArrowRight size={15} />
          </button>
          {onGuided && (
            <button onClick={onGuided} disabled={!dataReady} className="btn btn-ghost" style={{ padding: "16px 24px" }}
              title={dataReady ? "" : "loading real data…"}>
              {firstRun ? "New here? Watch it autopsy a classic →" : "See a guided example →"}
            </button>
          )}
        </div>
      </motion.div>
      <div style={{ position: "absolute", bottom: 28, left: 0, right: 0, display: "flex", justifyContent: "center" }}>
        <span className="mono" style={{ fontSize: 11, letterSpacing: "0.2em", color: C.border }}>
          ASSUME NO EDGE — UNTIL THE DATA PROVES ONE
        </span>
      </div>
    </div>
  );
}
