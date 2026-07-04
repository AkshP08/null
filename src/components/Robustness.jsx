import React, { useState } from "react";
import { C, SERIF, MONO, SANS } from "../ui/tokens.js";
import { Eyebrow } from "./Bits.jsx";
import { signedPct, num, pct } from "../ui/format.js";
import { windowView } from "../ui/walkForwardView.js";
import OverlayChart from "./OverlayChart.jsx";

// Walk-forward consistency + seeded bootstrap confidence — depth beyond one
// lucky split. Deterministic; nothing here is a point estimate dressed up as
// certainty. The walk-forward bars are clickable: selecting a window loads that
// window's OWN equity curve + metrics, reconstructed view-side from the real
// return series (see walkForwardView.js) — so you can inspect the good and bad
// stretches individually. Selecting a window is a VIEW action; it never
// recomputes anything.
export default function Robustness({ robustness, testCount, result }) {
  const [selected, setSelected] = useState(null);
  if (!robustness?.ok) return null;
  const wf = robustness.walkForward;
  const boot = robustness.bootstrap;
  const canInspect = wf.ok && !!result?.ok;
  const detail = canInspect && selected != null ? windowView(result, wf, selected) : null;

  return (
    <div className="w-5xl container" style={{ marginTop: 16, padding: 0 }}>
      <div className="card" style={{ padding: "16px 18px" }}>
        <Eyebrow>Robustness — not one lucky split</Eyebrow>

        <div className="grid2" style={{ marginTop: 10 }}>
          {/* Walk-forward */}
          <div>
            <div className="mono" style={{ fontSize: 11, letterSpacing: "0.1em", color: C.muted, marginBottom: 8 }}>
              WALK-FORWARD{wf.ok ? ` · ${wf.folds} WINDOWS` : ""}
            </div>
            {!wf.ok ? (
              <p style={{ fontFamily: SANS, fontSize: 12.5, color: C.muted }}>{wf.reason}</p>
            ) : (
              <>
                <WalkBars windows={wf.windows} selected={selected} onSelect={canInspect ? setSelected : null} />
                <p style={{ fontFamily: SANS, fontSize: 12.5, color: C.text, lineHeight: 1.55, marginTop: 10 }}>
                  Positive in <b style={{ color: wf.consistent ? C.neon : C.red }}>{wf.positive} of {wf.folds}</b> time windows ·
                  mean window Sharpe <span className="mono">{num(wf.meanSharpe)}</span>, worst <span className="mono">{num(wf.worstSharpe)}</span>.{" "}
                  {wf.consistent ? "The edge shows up across history." : "The edge does not hold across history — it leans on a few windows."}
                </p>
                {canInspect && (
                  <p className="mono" style={{ fontSize: 10, letterSpacing: "0.06em", color: C.muted, marginTop: 2 }}>
                    {detail ? "CLICK ANOTHER WINDOW, OR THE SAME TO CLOSE" : "▸ CLICK A WINDOW TO INSPECT ITS OWN EQUITY CURVE"}
                  </p>
                )}
              </>
            )}
          </div>

          {/* Bootstrap CI */}
          <div>
            <div className="mono" style={{ fontSize: 11, letterSpacing: "0.1em", color: C.muted, marginBottom: 8 }}>
              BOOTSTRAP {boot.ok ? `· ${Math.round(boot.confidence * 100)}% CI · SEED ${boot.seed}` : ""}
            </div>
            {!boot.ok ? (
              <p style={{ fontFamily: SANS, fontSize: 12.5, color: C.muted }}>{boot.reason}</p>
            ) : (
              <>
                <CIBand ci={boot.totalReturn} />
                <p style={{ fontFamily: SANS, fontSize: 12.5, color: C.text, lineHeight: 1.55, marginTop: 10 }}>
                  Resampling the {boot.trades} out-of-sample trades, total return lands between{" "}
                  <b className="mono" style={{ color: boot.totalReturn.lo >= 0 ? C.neon : C.red }}>{signedPct(boot.totalReturn.lo)}</b> and{" "}
                  <b className="mono" style={{ color: boot.totalReturn.hi >= 0 ? C.neon : C.red }}>{signedPct(boot.totalReturn.hi)}</b>{" "}
                  (median {signedPct(boot.totalReturn.median)}).{" "}
                  {boot.straddlesZero ? "The interval includes zero — indistinguishable from luck at this confidence." : "The interval clears zero."}
                </p>
              </>
            )}
          </div>
        </div>

        {detail && <WindowDetail detail={detail} folds={wf.folds} onClose={() => setSelected(null)} />}

        {testCount >= 5 && (
          <p style={{ fontFamily: SANS, fontSize: 12, color: C.amber, marginTop: 14, lineHeight: 1.55, borderTop: `1px solid ${C.border}`, paddingTop: 12 }}>
            ⚠ You’ve tested {testCount} strategies this session. Test enough of them and one will look good by pure chance — that’s p-hacking. A single passing verdict found after many attempts is weak evidence; the more you try, the higher the bar the survivor must clear.
          </p>
        )}
      </div>
    </div>
  );
}

function WalkBars({ windows, selected, onSelect }) {
  const maxAbs = Math.max(0.001, ...windows.map((w) => Math.abs(w.sharpe)));
  const clickable = !!onSelect;
  return (
    <div className="row" style={{ alignItems: "stretch", gap: 6, height: 74 }}>
      {windows.map((w, i) => {
        const h = Math.min(100, (Math.abs(w.sharpe) / maxAbs) * 46);
        const pos = w.sharpe >= 0;
        const isSel = selected === i;
        const bar = pos ? C.neon : C.red;
        return (
          <button key={i} type="button"
            onClick={clickable ? () => onSelect(isSel ? null : i) : undefined}
            title={`${w.start}→${w.end} · Sharpe ${num(w.sharpe)} · ${signedPct(w.totalReturn)}`}
            className="col" style={{
              flex: 1, alignItems: "center", justifyContent: "center", gap: 2,
              background: isSel ? C.raised : "transparent",
              border: isSel ? `1px solid ${bar}` : "1px solid transparent",
              borderRadius: 5, padding: "3px 0", cursor: clickable ? "pointer" : "default",
            }}>
            <div className="col" style={{ justifyContent: "flex-end", height: 46 }}>
              {pos && <div style={{ width: 16, height: h, background: bar, borderRadius: "3px 3px 0 0", opacity: isSel || selected == null ? 1 : 0.5 }} />}
            </div>
            <div style={{ width: 22, height: 1, background: C.border }} />
            <div className="col" style={{ justifyContent: "flex-start", height: 46 }}>
              {!pos && <div style={{ width: 16, height: h, background: bar, borderRadius: "0 0 3px 3px", opacity: isSel || selected == null ? 1 : 0.5 }} />}
            </div>
            <span className="mono" style={{ fontSize: 8, color: isSel ? C.text : C.muted }}>{i + 1}</span>
          </button>
        );
      })}
    </div>
  );
}

// The clicked window's own equity curve + metrics — real values reconstructed
// from the engine's return series (walkForwardView), never a recompute.
function WindowDetail({ detail, folds, onClose }) {
  const m = detail.metrics;
  const pos = m.totalReturn >= 0;
  const color = pos ? C.neon : C.red;
  const stats = [
    ["Total return", signedPct(m.totalReturn), color],
    ["Sharpe", num(m.sharpe), m.sharpe >= 0 ? C.neon : C.red],
    ["Max drawdown", pct(m.maxDrawdown), C.muted],
    ["CAGR", signedPct(m.cagr), m.cagr >= 0 ? C.text : C.red],
    ["Bars", String(detail.bars), C.text],
  ];
  return (
    <div className="card" style={{ marginTop: 14, padding: "12px 14px", background: C.raised, borderColor: `${color}55` }}>
      <div className="row between center wrap gap2" style={{ marginBottom: 6 }}>
        <span className="mono" style={{ fontSize: 10, letterSpacing: "0.1em", color }}>
          WINDOW {detail.index + 1} / {folds} · {detail.start} → {detail.end}
        </span>
        <button onClick={onClose} className="mono" style={{ fontSize: 10, color: C.muted, background: "transparent", border: `1px solid ${C.border}`, borderRadius: 4, padding: "3px 8px" }}>CLOSE</button>
      </div>
      <OverlayChart
        height={150}
        series={[{ points: detail.points, color, label: `WINDOW ${detail.index + 1}` }]}
        caption="THIS WINDOW ONLY · EQUITY INDEXED TO 100 AT ITS START"
      />
      <div className="row wrap" style={{ gap: "2px 18px", marginTop: 8 }}>
        {stats.map(([k, v, c]) => (
          <div key={k} className="row between" style={{ flex: "1 1 120px", fontFamily: MONO, fontSize: 12, padding: "3px 0", borderBottom: `1px solid ${C.border}` }}>
            <span style={{ color: C.muted }}>{k}</span><span style={{ color: c }}>{v}</span>
          </div>
        ))}
      </div>
      <p style={{ fontFamily: SANS, fontSize: 11, color: C.muted, margin: "8px 0 0", lineHeight: 1.5 }}>
        This stretch in isolation — a real slice of the strategy's own return series, re-indexed to 100. One window is not the verdict; it shows where the edge lived and where it didn't.
      </p>
    </div>
  );
}

function CIBand({ ci }) {
  const lo = Math.min(ci.lo, 0);
  const hi = Math.max(ci.hi, 0);
  const span = hi - lo || 1;
  const pctPos = (v) => `${((v - lo) / span) * 100}%`;
  return (
    <div style={{ position: "relative", height: 34, marginTop: 4 }}>
      {/* track */}
      <div style={{ position: "absolute", top: 15, left: 0, right: 0, height: 3, background: C.border, borderRadius: 2 }} />
      {/* CI segment */}
      <div style={{
        position: "absolute", top: 13, height: 7, borderRadius: 4,
        left: pctPos(ci.lo), width: `calc(${pctPos(ci.hi)} - ${pctPos(ci.lo)})`,
        background: ci.lo >= 0 ? C.neon : ci.hi <= 0 ? C.red : C.amber,
      }} />
      {/* median */}
      <div style={{ position: "absolute", top: 9, left: pctPos(ci.median), width: 2, height: 15, background: C.text }} />
      {/* zero marker */}
      <div style={{ position: "absolute", top: 4, left: pctPos(0), width: 1, height: 25, background: C.muted }} />
      <div className="mono" style={{ position: "absolute", top: 26, left: pctPos(0), transform: "translateX(-50%)", fontSize: 9, color: C.muted }}>0</div>
    </div>
  );
}
