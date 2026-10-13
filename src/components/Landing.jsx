import React from "react";
import { motion } from "motion/react";
import { ArrowRight, ChevronDown } from "lucide-react";
import { C, SERIF, MONO, SANS } from "../ui/tokens.js";
import LandingSpecimen from "./LandingSpecimen.jsx";

export default function Landing({ onStart, onGuided, firstRun, dataReady, dataError }) {
  return (
    <div>
    <div className="center-screen container" style={{ position: "relative" }}>
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
          <span style={{ display: "block" }}>Assume your strategy has no edge.</span>
          <span style={{ display: "block" }}>Now make it prove otherwise.</span>
        </h1>
        <p
          style={{ fontFamily: SANS, color: C.muted, fontSize: 16, lineHeight: 1.6, maxWidth: 460, margin: "0 auto 40px" }}
        >
          Null tries to prove your strategy has no edge — on real market data it
          was never tuned on, after real trading costs. Survive that, and the
          result means something. Nothing here is hardcoded.
        </p>
        <div className="row center gap4 wrap" style={{ justifyContent: "center" }}>
          <button onClick={onStart} className="btn btn-neon" style={{ padding: "16px 30px" }}>
            TEST A STRATEGY <ArrowRight size={15} />
          </button>
          {onGuided && (
            dataError ? (
              <button
                onClick={() => window.location.reload()}
                className="btn btn-ghost"
                style={{ padding: "16px 24px" }}
                title={String(dataError)}
              >
                COULDN’T LOAD DATA — RELOAD <ArrowRight size={15} />
              </button>
            ) : dataReady ? (
              <button onClick={onGuided} className="btn btn-ghost" style={{ padding: "16px 24px" }}>
                {firstRun ? "New here? Watch it autopsy a classic" : "See a guided example"} <ArrowRight size={15} />
              </button>
            ) : (
              <div
                className="btn btn-ghost"
                role="status"
                aria-live="polite"
                style={{ padding: "16px 24px", cursor: "default" }}
              >
                LOADING REAL DATA… <span className="pulse-dot" aria-hidden="true" />
              </div>
            )
          )}
        </div>
        <p
          className="mono"
          style={{ fontSize: 11, letterSpacing: "0.1em", color: C.muted, margin: "20px 0 0", textAlign: "center" }}
        >
          NO SIGNUP · RUNS IN YOUR BROWSER · 15 REAL DATASETS
        </p>
      </motion.div>
      <div style={{ position: "absolute", bottom: 28, left: 0, right: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: "0 16px" }}>
        <span className="mono" style={{ fontSize: 11, letterSpacing: "0.2em", color: C.muted, textAlign: "center" }}>
          ASSUME NO EDGE — UNTIL THE DATA PROVES ONE
        </span>
        <ChevronDown size={16} color={C.border} aria-hidden="true" />
      </div>
    </div>

    <div className="container" style={{ paddingBottom: 96 }}>
      <LandingSpecimen onStart={onStart} />
    </div>
    </div>
  );
}
