import React, { useMemo, useState } from "react";
import { Skull, Heart, Send, ShieldAlert } from "lucide-react";
import { C, SERIF, MONO, SANS } from "../ui/tokens.js";
import { Eyebrow } from "./Bits.jsx";
import { diagnose, summarize } from "../engine/autopsy.js";
import { askAutopsy } from "../ai/autopsyChat.js";

const sevColor = { fatal: C.red, warn: C.amber };

const SUGGESTED = [
  "Why did it die?",
  "Was it the costs or the overfitting?",
  "Would fewer trades help?",
  "How do I make it pass?",
];

export default function Autopsy({ result, crossRuns, fragility }) {
  const diagnosis = useMemo(() => diagnose(result, crossRuns, { fragility }), [result, crossRuns, fragility]);
  const [thread, setThread] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  async function ask(qRaw) {
    const q = (qRaw ?? input).trim();
    if (!q || busy) return;
    setInput("");
    setThread((t) => [...t, { role: "you", text: q }]);
    setBusy(true);
    const { text, source } = await askAutopsy(q, { diagnosis, result });
    setThread((t) => [...t, { role: "null", text, source }]);
    setBusy(false);
  }

  const alive = diagnosis.alive;

  return (
    <div className="card" style={{ padding: "18px 20px", textAlign: "left", marginBottom: 28 }}>
      <div className="row center gap3" style={{ marginBottom: 4 }}>
        {alive ? <Heart size={16} style={{ color: C.neon }} /> : <Skull size={16} style={{ color: C.red }} />}
        <Eyebrow>{alive ? "Post-mortem — no cause of death" : "Autopsy — cause of death"}</Eyebrow>
      </div>

      {/* the forensic findings */}
      {alive ? (
        <p style={{ fontFamily: SANS, fontSize: 13.5, color: C.text, lineHeight: 1.6, margin: "6px 0 0" }}>
          Nothing killed it. Out-of-sample Sharpe {fmt(diagnosis.stats.oosS)} (in-sample {fmt(diagnosis.stats.isS)}), and it
          survives realistic costs (after-cost Sharpe {fmt(diagnosis.stats.fullS)}). That’s the profile of a real edge —
          but this is <em>one</em> instrument and <em>one</em> split. Encouraging, not proof. Interrogate it below.
        </p>
      ) : diagnosis.unusable ? (
        <p style={{ fontFamily: SANS, fontSize: 13.5, color: C.muted, margin: "6px 0 0" }}>{diagnosis.message}</p>
      ) : diagnosis.causes.length === 0 ? (
        <p style={{ fontFamily: SANS, fontSize: 13.5, color: C.text, lineHeight: 1.6, margin: "6px 0 0" }}>{summarize(diagnosis)}</p>
      ) : (
        <div className="col" style={{ gap: 12, marginTop: 8 }}>
          {diagnosis.causes.map((c, i) => (
            <div key={i} style={{ borderLeft: `3px solid ${sevColor[c.severity] || C.muted}`, paddingLeft: 14 }}>
              <div className="row center gap2" style={{ marginBottom: 4 }}>
                <span className="mono" style={{ fontSize: 10, letterSpacing: "0.12em", color: sevColor[c.severity] || C.muted }}>
                  {c.severity === "fatal" ? "FATAL" : "WARNING"}{c === diagnosis.primary ? " · PRIMARY" : ""}
                </span>
              </div>
              <div style={{ fontFamily: SERIF, fontSize: 15.5, color: C.text, marginBottom: 4 }}>{c.title}</div>
              <div style={{ fontFamily: SANS, fontSize: 13, color: C.text, lineHeight: 1.55 }}>{c.text}</div>
              <div className="row wrap gap2" style={{ marginTop: 8 }}>
                {c.evidence.map(([k, v], j) => (
                  <span key={j} className="mono" style={{ fontSize: 11, color: C.muted, border: `1px solid ${C.border}`, borderRadius: 5, padding: "3px 8px" }}>
                    {k}: <span style={{ color: C.text }}>{v}</span>
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* conversational follow-up, grounded in the numbers above */}
      <div style={{ marginTop: 18, borderTop: `1px solid ${C.border}`, paddingTop: 14 }}>
        <Eyebrow>Interrogate the autopsy</Eyebrow>

        {thread.length > 0 && (
          <div className="col" style={{ gap: 10, margin: "8px 0 12px" }}>
            {thread.map((msg, i) => (
              <div key={i} style={{ alignSelf: msg.role === "you" ? "flex-end" : "flex-start", maxWidth: "92%" }}>
                <div style={{
                  fontFamily: msg.role === "you" ? MONO : SANS,
                  fontSize: msg.role === "you" ? 12 : 13.5,
                  color: msg.role === "you" ? C.muted : C.text,
                  background: msg.role === "you" ? "transparent" : C.raised,
                  border: msg.role === "you" ? "none" : `1px solid ${C.border}`,
                  borderRadius: 8, padding: msg.role === "you" ? "2px 4px" : "10px 12px", lineHeight: 1.55,
                }}>
                  {msg.role === "you" ? `› ${msg.text}` : msg.text}
                </div>
              </div>
            ))}
            {busy && <div className="mono" style={{ fontSize: 12, color: C.muted }}>…thinking (grounded in your numbers)</div>}
          </div>
        )}

        <div className="row wrap gap2" style={{ marginBottom: 10 }}>
          {SUGGESTED.map((s) => (
            <button key={s} onClick={() => ask(s)} disabled={busy} className="mono"
              style={{ fontSize: 11, color: C.muted, border: `1px solid ${C.border}`, borderRadius: 100, padding: "6px 11px" }}>
              {s}
            </button>
          ))}
        </div>

        <form className="row gap2" onSubmit={(e) => { e.preventDefault(); ask(); }}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask why it failed — grounded in this run’s numbers"
            aria-label="Ask the autopsy"
            style={{ flex: 1, background: C.raised, color: C.text, border: `1px solid ${C.border}`, borderRadius: 8, padding: "11px 13px", fontSize: 13.5, fontFamily: SANS }}
          />
          <button type="submit" disabled={busy || !input.trim()} className="btn btn-ghost" style={{ padding: "0 16px" }} aria-label="Send">
            <Send size={15} />
          </button>
        </form>

        <p className="row center gap2" style={{ fontFamily: SANS, fontSize: 11, color: C.muted, marginTop: 10 }}>
          <ShieldAlert size={12} style={{ flexShrink: 0 }} />
          The autopsy diagnoses the cause of death only. It will not tell you how to make a strategy “pass” — chasing a
          green verdict by tweaking is the overfitting Null exists to expose. This is a credibility stress-test, not advice.
        </p>
      </div>
    </div>
  );
}

function fmt(x) {
  return Number.isFinite(x) ? x.toFixed(2) : "—";
}
