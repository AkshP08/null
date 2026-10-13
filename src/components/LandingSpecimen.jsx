import React, { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import { C, SANS } from "../ui/tokens.js";
import { MetricRow } from "./Bits.jsx";
import { num } from "../ui/format.js";
import { loadManifest, loadInstruments } from "../data/index.js";
import { runEngine, isSuperseded } from "../engine/engineClient.js";
import { computeVerdict } from "../engine/verdict.js";
import { DEFAULT_CONFIG } from "../engine/backtest.js";
import { CLASSICS } from "../classics.js";

// The landing "specimen on the slab": a real, look-ahead-free backtest of the
// Golden Cross (50/200 SMA) on real SPY data, computed LIVE in the browser via
// the exact same engine worker the product uses — then held behind the Locked
// Reveal until the visitor unlocks it. Nothing here is hardcoded or canned: if
// the real computation can't produce a verdict, the specimen renders nothing
// rather than show a fake. A fake verdict on a tool built to catch fakery would
// be self-refuting.

// Display mapping — the engine's buckets spoken as the user-facing word + its
// severity color (identical to VerdictScreen). Amber/red/neon are semantic, not
// decoration; the primary neon CTA stays up in the hero.
const MAP = {
  PLAUSIBLE: { word: "SURVIVED", color: C.neon },
  SUSPECT: { word: "SHAKY", color: C.amber },
  REJECTED: { word: "DEAD", color: C.red },
};

export default function LandingSpecimen({ onStart }) {
  const [state, setState] = useState({ phase: "computing" });
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const manifest = await loadManifest();
        const spy = (Array.isArray(manifest) ? manifest : []).find((s) => s.id === "SPY");
        if (!spy) return alive && setState({ phase: "error" });

        const loaded = await loadInstruments(["SPY"]);
        const data = loaded.SPY;
        const ok = data && !data.error;
        const inst = {
          id: "SPY", symbol: spy.symbol, name: spy.name, adjusted: spy.adjusted,
          fillConvention: spy.fillConvention, source: spy.source,
          integrity: data?.integrity,
          error: ok ? null : data?.error || "Could not load SPY.",
          data: ok ? data : null,
        };
        if (!ok) return alive && setState({ phase: "error" });

        const spec = CLASSICS.find((c) => c.key === "golden-cross").spec;
        const cfg = {
          commissionBps: DEFAULT_CONFIG.commissionBps,
          slippageBps: DEFAULT_CONFIG.slippageBps,
          isFraction: DEFAULT_CONFIG.isFraction,
        };
        const { runs, robustness, fragility } = await runEngine({ spec, cfg, from: "", to: "", instruments: [inst] });
        const primary = runs.find((r) => r.result?.ok) || runs[0] || null;
        if (!primary?.result?.ok) return alive && setState({ phase: "error" });

        const verdict = computeVerdict(primary.result, { robustness, fragility });
        const rows = data.rows || [];
        const span = rows.length ? [rows[0].date.slice(0, 4), rows[rows.length - 1].date.slice(0, 4)] : null;
        if (alive) setState({ phase: "ready", metrics: primary.result.metrics, verdict, span });
      } catch (e) {
        if (isSuperseded(e)) return; // visitor started their own run; this one's abandoned
        if (alive) setState({ phase: "error" });
      }
    })();
    return () => { alive = false; };
  }, []);

  // Never render a placeholder verdict: a failed computation shows no specimen.
  if (state.phase === "error") return null;

  const spanLabel = state.span ? `${state.span[0]}–${state.span[1]}` : "REAL DATA";

  return (
    <div className="card" style={{ maxWidth: 520, margin: "0 auto", padding: "22px 22px 20px", textAlign: "left" }}>
      <p className="mono" style={{ fontSize: 10.5, letterSpacing: "0.12em", color: C.muted, margin: 0 }}>
        LIVE SPECIMEN · GOLDEN CROSS 50/200 · SPY · {spanLabel}
      </p>

      {state.phase === "computing" && (
        <div className="row center gap2" role="status" aria-live="polite" style={{ marginTop: 20, color: C.muted }}>
          <span className="mono" style={{ fontSize: 12, letterSpacing: "0.07em" }}>RUNNING LOOK-AHEAD-FREE BACKTEST…</span>
          <span className="pulse-dot" aria-hidden="true" />
        </div>
      )}

      {state.phase === "ready" && (
        <Ready metrics={state.metrics} verdict={state.verdict} revealed={revealed} onReveal={() => setRevealed(true)} onStart={onStart} />
      )}
    </div>
  );
}

function Ready({ metrics: m, verdict, revealed, onReveal, onStart }) {
  const v = MAP[verdict.bucket] || MAP.REJECTED;
  const oos = m.outSample?.sharpe ?? 0;
  const vsDiff = ((m.full?.cagr ?? 0) - (m.benchmark?.cagr ?? 0)) * 100; // annualized, %/yr vs buy & hold
  const vsBH = `${vsDiff >= 0 ? "+" : "-"}${Math.abs(vsDiff).toFixed(1)}%/yr`;
  const maxDD = `${((m.full?.maxDrawdown ?? 0) * 100).toFixed(1)}%`;

  return (
    <>
      <div
        style={{
          margin: "14px 0 6px",
          filter: revealed ? "none" : "blur(10px)",
          userSelect: revealed ? "auto" : "none",
          transition: "filter 0.4s",
        }}
      >
        <span className="serif" style={{ fontSize: "clamp(1.8rem, 7vw, 2.8rem)", color: v.color, lineHeight: 1 }}>
          {v.word}
        </span>
      </div>

      <div style={{ marginTop: 4 }}>
        <MetricRow label="Out-of-sample Sharpe" value={num(oos)} good={oos >= 0.5} blur={!revealed} />
        <MetricRow label="vs buy & hold" value={vsBH} good={vsDiff > 0} blur={!revealed} />
        <MetricRow label="Max drawdown" value={maxDD} good={false} blur={!revealed} />
      </div>

      {!revealed ? (
        <button onClick={onReveal} className="btn btn-ghost" style={{ marginTop: 18, width: "100%", padding: "13px 20px" }}>
          REVEAL THE VERDICT <ArrowRight size={14} />
        </button>
      ) : (
        <div style={{ marginTop: 16 }}>
          <p className="serif" style={{ fontStyle: "italic", color: C.text, fontSize: "1.05rem", lineHeight: 1.4, margin: "0 0 12px" }}>
            {verdict.headline}
          </p>
          <p style={{ fontFamily: SANS, fontSize: 12.5, color: C.muted, lineHeight: 1.6, margin: "0 0 16px" }}>
            A textbook classic, computed live on real SPY history in your browser — benchmarked, cost-charged, split out of sample. Null gave it no mercy. Yours gets the same.
          </p>
          <button onClick={onStart} className="btn btn-ghost" style={{ width: "100%", padding: "13px 20px" }}>
            TEST YOUR OWN STRATEGY <ArrowRight size={14} />
          </button>
        </div>
      )}
    </>
  );
}
