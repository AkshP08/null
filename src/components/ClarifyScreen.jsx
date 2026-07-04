import React, { useState } from "react";
import { HelpCircle } from "lucide-react";
import { C, SERIF, MONO, SANS } from "../ui/tokens.js";
import { Eyebrow } from "./Bits.jsx";

// One targeted clarifying question, asked only when a MATERIAL dimension of the
// strategy is genuinely ambiguous (entry, exit, direction, timeframe). The user
// answers (or skips, taking the model's best guess), and the description is
// re-parsed. This never bypasses the mandatory "What I understood" confirm gate —
// it feeds it. Capped so it can ask at most twice.
const DIMENSION_LABEL = {
  entry: "ENTRY TRIGGER",
  exit: "EXIT RULE",
  direction: "DIRECTION",
  timeframe: "TIMEFRAME",
  other: "DETAIL",
};

export default function ClarifyScreen({ clarify, onAnswer, onSkip, onEdit, busy }) {
  const [answer, setAnswer] = useState("");
  const asked = (clarify.clarifications?.length || 0) + 1;
  const canSubmit = answer.trim().length > 0 && !busy;

  const submit = () => { if (canSubmit) onAnswer(answer.trim()); };

  return (
    <div className="screen container w-2xl">
      <div style={{ paddingTop: 16, marginBottom: 18 }}>
        <Eyebrow>One quick question · {asked} of 2</Eyebrow>
        <h1 className="serif" style={{ color: C.text, fontSize: "1.9rem" }}>Before I test it, one thing to pin down</h1>
        <p style={{ fontFamily: SANS, fontSize: 13.5, color: C.muted, lineHeight: 1.6, marginTop: 8 }}>
          Your description is ambiguous on a point that would change the backtest. I'd rather ask than guess — you'll still see and can edit everything before it runs.
        </p>
      </div>

      <div className="card" style={{ padding: "18px 20px", marginBottom: 16 }}>
        <div className="row center" style={{ gap: 8, marginBottom: 10 }}>
          <HelpCircle size={15} style={{ color: C.neon }} />
          <span className="mono" style={{ fontSize: 10.5, letterSpacing: "0.12em", color: C.muted }}>
            {DIMENSION_LABEL[clarify.dimension] || "DETAIL"}
          </span>
        </div>
        <p style={{ fontFamily: SERIF, fontSize: "1.15rem", color: C.text, lineHeight: 1.4, margin: "0 0 14px" }}>
          {clarify.question}
        </p>
        <textarea
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit(); }}
          placeholder="Type your answer…"
          rows={3}
          autoFocus
          style={{
            width: "100%", background: C.raised, color: C.text, border: `1px solid ${C.border}`,
            borderRadius: 8, fontFamily: SANS, fontSize: 14, padding: "10px 12px", outline: "none", resize: "vertical",
          }}
        />
      </div>

      <div className="row gap3 wrap">
        <button onClick={submit} disabled={!canSubmit} className="btn btn-neon" style={{ flex: 1, minWidth: 200 }}>
          {busy ? "RE-READING…" : "ANSWER & CONTINUE"}
        </button>
        <button onClick={onSkip} disabled={busy} className="btn btn-ghost" style={{ padding: "14px 22px" }}>
          SKIP — USE YOUR BEST GUESS
        </button>
        <button onClick={onEdit} disabled={busy} className="btn btn-ghost" style={{ padding: "14px 22px" }}>← RE-TYPE</button>
      </div>

      <p style={{ fontFamily: MONO, fontSize: 10, color: C.muted, marginTop: 16, letterSpacing: "0.04em", lineHeight: 1.6 }}>
        SKIP LETS CLAUDE ASSUME A SENSIBLE DEFAULT AND DISCLOSE IT · YOU STILL CONFIRM EVERYTHING NEXT
      </p>
    </div>
  );
}
