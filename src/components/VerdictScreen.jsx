import React from "react";
import { motion } from "motion/react";
import { C, SERIF, MONO, SANS } from "../ui/tokens.js";
import { Eyebrow, Disclaimer } from "./Bits.jsx";
import Autopsy from "./Autopsy.jsx";
import { num } from "../ui/format.js";
import { verdictMeaning } from "../ui/verdictMeaning.js";

const MAP = {
  PLAUSIBLE: { word: "SURVIVED", color: C.neon },
  SUSPECT: { word: "SHAKY", color: C.amber },
  REJECTED: { word: "DEAD", color: C.red },
};

const dotColor = { fatal: C.red, warn: C.amber, good: C.neon, info: C.muted };

export default function VerdictScreen({ verdict, result, instrumentSymbol, crossRuns, fragility, onExport, onRestart, onSave, onCopyLink, savedFlash }) {
  const v = MAP[verdict.bucket] || MAP.REJECTED;
  const m = result.metrics;
  const isS = m.inSample.sharpe;
  const oosS = m.outSample.sharpe;
  // Edge decay = fraction of the in-sample edge lost out-of-sample. Only
  // meaningful when there was a real in-sample edge to begin with; with a
  // near-zero IS Sharpe the ratio explodes into nonsense, so we show "—".
  const decay = isS > 0.3 ? (isS - oosS) / isS : null;

  const nums = [
    { l: "IS Sharpe", val: num(isS), color: isS >= 0.5 ? C.neon : isS < 0 ? C.red : C.text },
    { l: "OOS Sharpe", val: num(oosS), color: oosS >= 0.5 ? C.neon : oosS < 0 ? C.red : C.text },
    {
      l: "Edge decay",
      val: decay == null ? "—" : `${(decay * 100).toFixed(0)}%`,
      color: decay == null ? C.muted : decay > 0 ? C.red : C.neon,
    },
  ];

  return (
    <div className="screen container" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center" }}>
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }} style={{ maxWidth: 720, width: "100%" }}>
        <Eyebrow>Verdict · {result.spec.name} · {instrumentSymbol}</Eyebrow>

        <h1 className="serif" aria-live="polite" style={{ color: v.color, fontSize: "clamp(3rem, 13vw, 6rem)", lineHeight: 1, margin: "18px 0 8px" }}>
          {v.word}
        </h1>
        <p style={{ fontFamily: SERIF, fontStyle: "italic", color: C.text, fontSize: "clamp(1rem,3vw,1.25rem)", marginBottom: 14, lineHeight: 1.4 }}>
          {verdict.headline}
        </p>
        <div style={{ marginBottom: 26 }}><Disclaimer /></div>

        {/* key numbers */}
        <div className="grid3" style={{ marginBottom: 28 }}>
          {nums.map((n, i) => (
            <div key={i} className="card" style={{ padding: 16 }}>
              <p className="mono" style={{ fontSize: 10, letterSpacing: "0.12em", color: C.muted, margin: "0 0 10px" }}>{n.l.toUpperCase()}</p>
              <p className="mono" style={{ fontSize: "1.6rem", fontWeight: 500, color: n.color, margin: 0 }}>{n.val}</p>
            </div>
          ))}
        </div>

        {/* what the verdict MEANS — so a DEAD/SHAKY result reads as the tool
            working (a save), not the tool failing the user. */}
        <VerdictMeaning bucket={verdict.bucket} color={v.color} />

        {/* the forensic autopsy + grounded follow-up (replaces the flat evidence list) */}
        <Autopsy result={result} crossRuns={crossRuns} fragility={fragility} />

        <div className="row gap3 wrap" style={{ justifyContent: "center" }}>
          {onSave && (
            <button onClick={onSave} className="btn btn-ghost" style={{ padding: "12px 20px" }}>
              {savedFlash ? "SAVED ✓" : "SAVE"}
            </button>
          )}
          {onCopyLink && <CopyLinkButton onCopyLink={onCopyLink} />}
          <button onClick={onExport} className="btn btn-ghost" style={{ padding: "12px 20px" }}>EXPORT PINE</button>
          <button onClick={onRestart} className="btn btn-neon" style={{ padding: "12px 20px" }}>TEST ANOTHER</button>
        </div>
      </motion.div>
    </div>
  );
}

// In-voice positioning: most honest verdicts are DEAD or SHAKY, and users who
// misread that as the tool failing them will churn. This says, plainly, that a
// kill is the tool doing its job — while refusing to coach anyone toward a pass.
function VerdictMeaning({ bucket, color }) {
  const meaning = verdictMeaning(bucket);
  if (!meaning) return null;
  return (
    <div className="card" style={{ padding: "16px 18px", marginBottom: 26, textAlign: "left", borderColor: `${color}44`, background: `${color}0d` }}>
      <p className="mono" style={{ fontSize: 10.5, letterSpacing: "0.12em", color, margin: "0 0 8px" }}>{meaning.eyebrow}</p>
      <p className="serif" style={{ fontSize: "1.1rem", color: C.text, margin: "0 0 10px", lineHeight: 1.35 }}>{meaning.title}</p>
      <p style={{ fontFamily: SANS, fontSize: 13.5, color: C.text, lineHeight: 1.6, margin: 0 }}>{meaning.body}</p>
      {meaning.caution && (
        <p style={{ fontFamily: SANS, fontSize: 12.5, color: C.muted, lineHeight: 1.6, margin: "10px 0 0", paddingTop: 10, borderTop: `1px solid ${C.border}` }}>
          {meaning.caution}
        </p>
      )}
    </div>
  );
}

function CopyLinkButton({ onCopyLink }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <button
      onClick={async () => { await onCopyLink(); setCopied(true); setTimeout(() => setCopied(false), 1800); }}
      className="btn btn-ghost" style={{ padding: "12px 20px" }}>
      {copied ? "LINK COPIED ✓" : "COPY LINK"}
    </button>
  );
}
