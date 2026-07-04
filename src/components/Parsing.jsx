import React from "react";
import { motion } from "motion/react";
import { C, MONO } from "../ui/tokens.js";

// Shown while the (real) parser runs. The label reflects whether Claude or the
// local grammar is doing the work.
export default function Parsing({ label = "READING YOUR STRATEGY…" }) {
  return (
    <div className="center-screen" style={{ gap: 24 }}>
      <motion.span
        animate={{ rotate: 360 }}
        transition={{ duration: 5, repeat: Infinity, ease: "linear" }}
        style={{ display: "inline-block", fontFamily: MONO, fontSize: "4rem", color: C.neon, lineHeight: 1 }}
      >
        ∅
      </motion.span>
      <p className="mono" style={{ fontSize: 11, letterSpacing: "0.2em", color: C.muted }}>
        {label}
      </p>
    </div>
  );
}
