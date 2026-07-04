import React, { useEffect, useMemo, useRef, useState } from "react";
import { createChart, LineStyle, CrosshairMode } from "lightweight-charts";
import { RotateCcw, TrendingDown, Crosshair } from "lucide-react";
import { C, MONO, SANS } from "../ui/tokens.js";
import { buildEquityView } from "../ui/equityView.js";
import { buildPriceModel, enrichTrades } from "../ui/overlays.js";
import { chartAnchors } from "../engine/autopsy.js";
import { signedPct, pct } from "../ui/format.js";

const reducedMotion =
  typeof window !== "undefined" && window.matchMedia &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const pad = (n) => String(n).padStart(2, "0");
function timeToKey(t) {
  if (t == null) return null;
  if (typeof t === "string") return t;
  if (typeof t === "object" && t.year) return `${t.year}-${pad(t.month)}-${pad(t.day)}`;
  return null;
}
function baseTheme(w, h) {
  return {
    width: w, height: h,
    layout: { background: { type: "solid", color: C.surface }, textColor: C.muted, fontFamily: MONO, fontSize: 10, attributionLogo: false },
    grid: { vertLines: { color: C.border, style: LineStyle.Dotted }, horzLines: { color: C.border, style: LineStyle.Dotted } },
    rightPriceScale: { borderColor: C.border, minimumWidth: 58, scaleMargins: { top: 0.12, bottom: 0.12 } },
    timeScale: { borderColor: C.border },
    crosshair: {
      mode: CrosshairMode.Normal,
      vertLine: { color: C.muted, width: 1, style: LineStyle.Solid, labelBackgroundColor: C.raised },
      horzLine: { color: C.muted, width: 1, style: LineStyle.Solid, labelBackgroundColor: C.raised },
    },
    handleScroll: true, handleScale: true,
  };
}

// The chart workspace: price + the strategy's own indicators, the equity reveal,
// any oscillator it uses, and an underwater drawdown pane — all time-synced.
// Interactions are investigation only: hover reads REAL values, click drills
// into a trade, and the autopsy can jump the view to the spot that proves it.
// No interaction ever recomputes anything (the engine already ran off-thread).
export default function ChartWorkspace({ result, spec, revealed, showCosts, focus }) {
  const wrapRef = useRef(null);
  const els = useRef({ price: null, equity: null, dd: null, osc: [] });
  const charts = useRef([]);
  const store = useRef({}); // { priceSeries, is, oos, bh, dd, splitTime, rowByTime, trades, allMarkers, isMarkers }
  const rafRef = useRef(0);
  const revealedRef = useRef(revealed);
  const selectedRef = useRef(null);

  // Split the model so a COST TOGGLE never rebuilds the chart. Price + indicators
  // are cost-independent (rebuild only on a new backtest/spec); the equity view is
  // cost-dependent and gets swapped IN PLACE. eqViewRef lets the build/reveal
  // effects read the current cost mode without depending on it (no teardown).
  const priceModel = useMemo(() => ({
    price: buildPriceModel(result, spec) || { priceLine: [], overlays: [], oscillators: [] },
    trades: enrichTrades(result),
    anchors: chartAnchors(result),
  }), [result, spec]);
  const eqView = useMemo(() => buildEquityView(result, showCosts), [result, showCosts]);
  const eqViewRef = useRef(eqView);
  eqViewRef.current = eqView;

  const [vis, setVis] = useState({ is: true, oos: true, bh: true });
  const [selected, setSelected] = useState(null);
  const [tip, setTip] = useState(null); // { pane, x, y, row }
  const [splitX, setSplitX] = useState({ price: null, equity: null });

  const oscCount = priceModel.price.oscillators.length;

  // ── Build every pane once per data change ────────────────────────────────
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || !els.current.price) return;
    const W = () => wrap.clientWidth || 640;
    const eq = eqViewRef.current;            // current cost mode (read, not a dep)
    const { price, trades } = priceModel;    // cost-independent
    const splitTime = eq.splitTime;

    // combined per-time lookup for the shared tooltip (all real values)
    const rowByTime = new Map();
    for (const p of eq.points) rowByTime.set(p.time, { date: p.date, equity: p.equity, bh: p.bh, drawdown: p.drawdown, inMarket: p.inMarket, phase: p.phase, price: null, ov: {}, osc: {} });
    for (const pt of price.priceLine) { const r = rowByTime.get(pt.time); if (r) r.price = pt.value; }
    for (const o of price.overlays) for (const pt of o.data) { const r = rowByTime.get(pt.time); if (r) r.ov[o.label] = pt.value; }
    for (const o of price.oscillators) for (const pt of o.data) { const r = rowByTime.get(pt.time); if (r) r.osc[o.label] = pt.value; }

    const made = [];
    const mkChart = (el, h) => { const c = createChart(el, baseTheme(W(), h)); made.push(c); return c; };

    // — price + indicator overlays + trade markers —
    const priceChart = mkChart(els.current.price, 208);
    const priceSeries = priceChart.addLineSeries({ color: "#C6CEDE", lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
    priceSeries.setData(price.priceLine);
    for (const o of price.overlays) {
      const s = priceChart.addLineSeries({ color: o.color, lineWidth: 1, lineStyle: o.dash ? LineStyle.Dashed : LineStyle.Solid, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
      s.setData(o.data);
    }

    // — equity reveal —
    const eqChart = mkChart(els.current.equity, 210);
    const bh = eqChart.addLineSeries({ color: C.muted, lineWidth: 1, lineStyle: LineStyle.Dashed, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    const is = eqChart.addLineSeries({ color: C.neon, lineWidth: 2, priceLineVisible: false, lastValueVisible: false });
    const oos = eqChart.addLineSeries({ color: C.red, lineWidth: 2, priceLineVisible: false, lastValueVisible: false });
    bh.setData(eq.bhLine); is.setData(eq.is); oos.setData(revealed ? eq.oos : []);
    bh.applyOptions({ visible: vis.bh }); is.applyOptions({ visible: vis.is }); oos.applyOptions({ visible: vis.oos });

    // — oscillator subpanes (with the spec's own threshold lines) —
    const oscSeries = [];
    price.oscillators.forEach((o, i) => {
      const el = els.current.osc[i];
      if (!el) return;
      const oc = mkChart(el, 104);
      const s = oc.addLineSeries({ color: o.color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
      s.setData(o.data);
      for (const t of o.thresholds) s.createPriceLine({ price: t.value, color: C.muted, lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: true, title: String(t.value) });
      oscSeries.push(s);
    });

    // — drawdown (underwater), gated by reveal like the equity —
    const ddChart = mkChart(els.current.dd, 92);
    const dd = ddChart.addAreaSeries({ lineColor: C.red, topColor: "rgba(255,91,91,0.05)", bottomColor: "rgba(255,91,91,0.28)", lineWidth: 1, invertFilledArea: true, priceLineVisible: false, lastValueVisible: false });
    const ddData = eq.points.map((p) => ({ time: p.time, value: +(p.drawdown * 100).toFixed(3) }));
    const ddUpTo = ddData.filter((_, i) => i <= eq.splitIdx);
    dd.setData(revealed ? ddData : ddUpTo);

    charts.current = made;
    store.current = { priceChart, eqChart, ddChart, priceSeries, is, oos, bh, dd, ddData, ddUpTo, splitTime, rowByTime, trades, oscSeries };

    // markers
    const mk = (t) => ([
      { time: t.entryDate, position: "belowBar", color: t.side === "short" ? C.amber : C.neon, shape: "arrowUp", size: 1, _i: t.index, _k: "e" },
      { time: t.exitDate, position: "aboveBar", color: t.win ? C.neon : C.red, shape: "arrowDown", size: 1, _i: t.index, _k: "x" },
    ]);
    store.current.allMarkers = trades.flatMap(mk).sort((a, b) => (a.time < b.time ? -1 : 1));
    applyMarkers();

    // time-sync all panes by TIME (robust to per-series warmup differences)
    let syncing = false;
    const syncFrom = (src) => (tr) => {
      if (syncing || !tr) return;
      syncing = true;
      for (const c of made) if (c !== src) { try { c.timeScale().setVisibleRange(tr); } catch {} }
      syncing = false;
    };
    made.forEach((c) => c.timeScale().subscribeVisibleTimeRangeChange(syncFrom(c)));

    // shared crosshair tooltip — reads the combined real values at the time
    const paneKeyFor = (c) => (c === priceChart ? "price" : c === eqChart ? "equity" : c === ddChart ? "dd" : "osc");
    const onCross = (c) => (param) => {
      if (!param.point || param.time == null) { setTip(null); return; }
      const row = rowByTime.get(timeToKey(param.time));
      if (!row) { setTip(null); return; }
      setTip({ pane: paneKeyFor(c), x: param.point.x, y: param.point.y, row });
    };
    made.forEach((c) => c.subscribeCrosshairMove(onCross(c)));

    // click → nearest trade
    const onClick = (param) => {
      if (param.time == null) return;
      const key = timeToKey(param.time);
      const t = nearestTrade(trades, key);
      if (t != null) selectTrade(t);
    };
    priceChart.subscribeClick(onClick);
    eqChart.subscribeClick(onClick);

    const updateSplit = () => {
      const px = priceChart.timeScale().timeToCoordinate(splitTime);
      const ex = eqChart.timeScale().timeToCoordinate(splitTime);
      setSplitX({ price: px == null ? null : px, equity: ex == null ? null : ex });
    };
    updateSplit();
    priceChart.timeScale().subscribeVisibleTimeRangeChange(updateSplit);
    eqChart.timeScale().subscribeVisibleTimeRangeChange(updateSplit);

    made.forEach((c) => c.timeScale().fitContent());

    const ro = new ResizeObserver(() => { const w = W(); made.forEach((c) => c.applyOptions({ width: w })); updateSplit(); });
    ro.observe(wrap);
    revealedRef.current = revealed;

    return () => {
      ro.disconnect();
      cancelAnimationFrame(rafRef.current);
      made.forEach((c) => c.remove());
      charts.current = [];
      store.current = {};
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [priceModel, oscCount]);

  // rebuild markers honoring reveal-gating + current selection
  function applyMarkers() {
    const s = store.current;
    if (!s.priceSeries || !s.allMarkers) return;
    const showAll = revealedRef.current;
    const sel = selectedRef.current;
    const shown = s.allMarkers
      .filter((m) => showAll || m.time <= s.splitTime)
      .map((m) => (m._i === sel ? { ...m, size: 2, color: "#FFFFFF" } : m));
    s.priceSeries.setMarkers(shown);
  }

  // ── The reveal: draw the red OOS equity in, un-gate drawdown + OOS markers ─
  useEffect(() => {
    const wasRevealed = revealedRef.current;
    revealedRef.current = revealed;
    const s = store.current;
    if (!s.oos) return;
    if (revealed && !wasRevealed) {
      // drawdown + markers un-gate immediately; the red equity line animates
      s.dd?.setData(s.ddData);
      applyMarkers();
      const data = eqViewRef.current.oos;
      if (!data?.length) return;
      if (reducedMotion) { s.oos.setData(data); return; }
      const DUR = 1150, start = performance.now();
      s.oos.setData([data[0]]);
      let last = 0;
      const step = (now) => {
        const t = Math.min(1, (now - start) / DUR);
        const target = Math.max(0, Math.floor(t * (data.length - 1)));
        for (let i = last + 1; i <= target; i++) s.oos.update(data[i]);
        last = target;
        if (t < 1) rafRef.current = requestAnimationFrame(step);
      };
      rafRef.current = requestAnimationFrame(step);
    } else {
      s.oos.setData(revealed ? eqViewRef.current.oos : []);
      s.dd?.setData(revealed ? s.ddData : s.ddUpTo);
      applyMarkers();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealed]);

  // ── Cost toggle: a pure VIEW swap. Update the equity/drawdown series (and the
  //    shared tooltip's cost-dependent values) IN PLACE — never tear down the
  //    chart (that was the flicker) and never re-fire the reveal animation. The
  //    current reveal state is preserved via revealedRef. ─────────────────────
  useEffect(() => {
    const s = store.current;
    if (!s.is) return; // built with the current mode already; nothing to swap yet
    const eq = eqViewRef.current;
    const rev = revealedRef.current;
    s.is.setData(eq.is);
    s.oos.setData(rev ? eq.oos : []);
    s.bh.setData(eq.bhLine);
    const ddData = eq.points.map((p) => ({ time: p.time, value: +(p.drawdown * 100).toFixed(3) }));
    const ddUpTo = ddData.filter((_, i) => i <= eq.splitIdx);
    s.ddData = ddData; s.ddUpTo = ddUpTo;
    s.dd?.setData(rev ? ddData : ddUpTo);
    for (const p of eq.points) {
      const r = s.rowByTime?.get(p.time);
      if (r) { r.equity = p.equity; r.bh = p.bh; r.drawdown = p.drawdown; }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showCosts]);

  // series visibility toggles
  useEffect(() => {
    const s = store.current;
    s.is?.applyOptions({ visible: vis.is }); s.oos?.applyOptions({ visible: vis.oos }); s.bh?.applyOptions({ visible: vis.bh });
  }, [vis]);

  function selectTrade(i) {
    selectedRef.current = i;
    setSelected(i);
    applyMarkers();
    const t = priceModel.trades[i];
    if (t) jumpTo(t.entryDate, t.exitDate, 12);
  }

  // jump/zoom the synced view to a date window (with a little padding, in bars)
  function jumpTo(from, to, padBars = 8) {
    const s = store.current;
    if (!s.priceChart) return;
    const dates = eqViewRef.current.points.map((p) => p.time);
    let lo = dates.indexOf(from), hi = dates.indexOf(to);
    if (lo < 0) lo = 0; if (hi < 0) hi = dates.length - 1;
    const a = Math.max(0, lo - padBars), b = Math.min(dates.length - 1, hi + padBars);
    try { s.priceChart.timeScale().setVisibleRange({ from: dates[a], to: dates[b] }); } catch {}
  }

  // autopsy → chart: react to an external focus request
  useEffect(() => {
    if (!focus) return;
    if (focus.type === "trade" && focus.index != null) selectTrade(focus.index);
    else if (focus.type === "range" && focus.from && focus.to) { setSelected(null); selectedRef.current = null; applyMarkers(); jumpTo(focus.from, focus.to, 4); }
    else if (focus.type === "drawdown" && priceModel.anchors?.drawdown) jumpTo(priceModel.anchors.drawdown.from, priceModel.anchors.drawdown.to, 4);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);

  const resetView = () => { charts.current.forEach((c) => c.timeScale().fitContent()); setSelected(null); selectedRef.current = null; applyMarkers(); };
  const toggle = (k) => setVis((v) => ({ ...v, [k]: !v[k] }));
  const a = priceModel.anchors;
  const overlays = priceModel.price.overlays;

  return (
    <div className="card" style={{ padding: "12px 14px" }}>
      {/* controls + legend */}
      <div className="row between wrap center" style={{ gap: 10, marginBottom: 8 }}>
        <div className="row wrap center" style={{ gap: 12, fontFamily: MONO, fontSize: 10 }}>
          <Chip on={vis.is} onClick={() => toggle("is")} color={C.neon}>IN-SAMPLE</Chip>
          {revealed && <Chip on={vis.oos} onClick={() => toggle("oos")} color={C.red}>OUT-OF-SAMPLE</Chip>}
          <Chip on={vis.bh} onClick={() => toggle("bh")} color={C.muted} dashed>BUY &amp; HOLD</Chip>
          {overlays.map((o) => (
            <span key={o.key} className="row center" style={{ gap: 6, color: C.muted }}>
              <span style={{ width: 14, height: 2, background: o.color, display: "inline-block", opacity: o.dash ? 0.6 : 1 }} />{o.label}
            </span>
          ))}
        </div>
        <div className="row center" style={{ gap: 6 }}>
          {a?.drawdown && <JumpBtn onClick={() => jumpTo(a.drawdown.from, a.drawdown.to, 4)} icon={<TrendingDown size={11} />}>WORST DD</JumpBtn>}
          {a?.worstTrade && <JumpBtn onClick={() => selectTrade(a.worstTrade.index)} icon={<Crosshair size={11} />}>WORST TRADE</JumpBtn>}
          <JumpBtn onClick={resetView} icon={<RotateCcw size={11} />}>RESET</JumpBtn>
        </div>
      </div>

      <div ref={wrapRef} style={{ position: "relative", width: "100%" }}>
        <PaneBox label="PRICE + SIGNALS" refCb={(el) => (els.current.price = el)} h={208} tip={tip?.pane === "price" ? tip : null} splitX={splitX.price} revealed={revealed} />
        <PaneBox label="EQUITY (INDEXED TO 100)" refCb={(el) => (els.current.equity = el)} h={210} tip={tip?.pane === "equity" ? tip : null} splitX={splitX.equity} revealed={revealed} />
        {priceModel.price.oscillators.map((o, i) => (
          <PaneBox key={o.key} label={o.label.toUpperCase()} refCb={(el) => (els.current.osc[i] = el)} h={104} tip={null} />
        ))}
        <PaneBox label="DRAWDOWN (UNDERWATER)" refCb={(el) => (els.current.dd = el)} h={92} tip={tip?.pane === "dd" ? tip : null} />
      </div>

      {/* trades: click any row to drill in + jump the chart */}
      <TradeStrip trades={priceModel.trades} selected={selected} onSelect={selectTrade} splitDate={a?.splitDate} revealed={revealed} />
      {selected != null && priceModel.trades[selected] && <Breakdown t={priceModel.trades[selected]} splitDate={a?.splitDate} onClose={() => { setSelected(null); selectedRef.current = null; applyMarkers(); }} />}
    </div>
  );
}

// The pane title lives in its OWN row above the chart (normal flow), so the
// lightweight-charts canvas can never paint over it — the plotted area starts
// below the label. Only the split marker + hover tooltip are positioned INSIDE
// the chart box (they belong to the plot). This layout makes overlap impossible
// regardless of the library's internal canvas stacking, across every pane.
function PaneBox({ label, refCb, h, tip, splitX, revealed }) {
  return (
    <div style={{ width: "100%", marginTop: 6 }}>
      <div className="mono" style={{ fontSize: 8.5, letterSpacing: "0.1em", color: C.muted, lineHeight: 1.2, padding: "0 0 3px 2px" }}>{label}</div>
      <div style={{ position: "relative", width: "100%", height: h }}>
        <div ref={refCb} style={{ position: "absolute", inset: 0, touchAction: "none" }} />
        {splitX != null && (
          <>
            <div style={{ position: "absolute", top: 0, bottom: 0, left: splitX, width: 0, borderLeft: `1px dashed ${C.muted}`, opacity: 0.5, pointerEvents: "none" }} />
            <span style={{ position: "absolute", top: 2, left: splitX + 5, fontFamily: MONO, fontSize: 8.5, color: C.muted, pointerEvents: "none" }}>{revealed ? "SPLIT" : "UNSEEN →"}</span>
          </>
        )}
        {tip && <HoverTip tip={tip} />}
      </div>
    </div>
  );
}

function HoverTip({ tip }) {
  const { x, y, row } = tip;
  const W = 190;
  const left = Math.min(Math.max(6, x + 14), 9999);
  const top = Math.min(Math.max(4, y - 8), 999);
  const rows = [];
  if (row.price != null) rows.push(["Price", row.price.toFixed(2), C.text]);
  rows.push(["Equity", row.equity.toFixed(1), row.phase === "oos" ? C.red : C.neon]);
  rows.push(["Buy & hold", row.bh.toFixed(1), C.muted]);
  rows.push(["Drawdown", `${(row.drawdown * 100).toFixed(1)}%`, row.drawdown < -0.001 ? C.red : C.muted]);
  rows.push(["Position", row.inMarket ? "IN MARKET" : "FLAT", row.inMarket ? C.neon : C.muted]);
  for (const [k, v] of Object.entries(row.ov)) rows.push([k, v.toFixed(2), C.muted]);
  for (const [k, v] of Object.entries(row.osc)) rows.push([k, v.toFixed(1), C.muted]);
  return (
    <div style={{ position: "absolute", left, top, width: W, transform: left > 9000 ? "translateX(calc(-100% - 28px))" : "none", pointerEvents: "none", zIndex: 6, background: `${C.canvas}f2`, border: `1px solid ${C.border}`, borderRadius: 6, padding: "7px 9px", fontFamily: MONO, fontSize: 10.5, backdropFilter: "blur(4px)" }}>
      <div style={{ color: C.text, marginBottom: 5 }}>{row.date} <span style={{ color: row.phase === "oos" ? C.red : C.neon }}>· {row.phase === "oos" ? "OOS" : "IS"}</span></div>
      {rows.map(([k, v, c]) => (
        <div key={k} className="row between" style={{ gap: 12 }}><span style={{ color: C.muted }}>{k}</span><span style={{ color: c }}>{v}</span></div>
      ))}
    </div>
  );
}

function TradeStrip({ trades, selected, onSelect, splitDate, revealed }) {
  if (!trades.length) return null;
  return (
    <div style={{ marginTop: 12, borderTop: `1px solid ${C.border}`, paddingTop: 10 }}>
      <div className="mono" style={{ fontSize: 9.5, letterSpacing: "0.1em", color: C.muted, marginBottom: 8 }}>
        {trades.length} TRADE{trades.length === 1 ? "" : "S"} · CLICK ANY TO DRILL IN
      </div>
      <div className="row" style={{ gap: 6, overflowX: "auto", paddingBottom: 4 }}>
        {trades.map((t) => {
          const oos = splitDate && t.exitDate > splitDate;
          const locked = oos && !revealed;
          const c = locked ? C.muted : t.win ? C.neon : C.red;
          return (
            <button key={t.index} onClick={() => onSelect(t.index)} title={locked ? "out-of-sample — reveal to inspect" : ""}
              className="mono" style={{
                flex: "0 0 auto", minWidth: 76, textAlign: "left", padding: "6px 9px", borderRadius: 5, cursor: "pointer",
                background: selected === t.index ? C.raised : "transparent",
                border: `1px solid ${selected === t.index ? c : C.border}`, color: C.muted, fontSize: 10.5,
                filter: locked ? "blur(3px)" : "none",
              }}>
              <div style={{ color: c }}>{t.entryDate.slice(2, 7)}{t.open ? " ▹" : ""}</div>
              <div style={{ color: c, fontSize: 12 }}>{signedPct(t.ret, 1)}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Breakdown({ t, splitDate, onClose }) {
  const oos = splitDate && t.exitDate > splitDate;
  const rows = [
    ["Side", t.side.toUpperCase()],
    ["Entry", `${t.entryDate} @ ${fmtPx(t.entryPrice)}`],
    ["Exit", `${t.exitDate} @ ${fmtPx(t.exitPrice)}${t.open ? " (still open)" : ""}`],
    ["Held", `${t.bars} bars${t.days != null ? ` · ${t.days} days` : ""}`],
    ["Return", signedPct(t.ret, 2)],
    ["Result", t.win ? "WIN" : "LOSS"],
    ["Cost paid", pct(t.cost, 2)],
    ["Window", oos ? "OUT-OF-SAMPLE" : "IN-SAMPLE"],
  ];
  return (
    <div className="card" style={{ marginTop: 10, padding: "12px 14px", borderColor: t.win ? `${C.neon}66` : `${C.red}66` }}>
      <div className="row between center" style={{ marginBottom: 8 }}>
        <span className="mono" style={{ fontSize: 10, letterSpacing: "0.1em", color: t.win ? C.neon : C.red }}>TRADE #{t.index + 1} · {t.win ? "WIN" : "LOSS"}</span>
        <button onClick={onClose} className="mono" style={{ fontSize: 10, color: C.muted, background: "transparent", border: `1px solid ${C.border}`, borderRadius: 4, padding: "3px 8px" }}>CLOSE</button>
      </div>
      <div className="grid2" style={{ gap: "2px 20px" }}>
        {rows.map(([k, v]) => (
          <div key={k} className="row between" style={{ fontFamily: MONO, fontSize: 12, padding: "3px 0", borderBottom: `1px solid ${C.border}` }}>
            <span style={{ color: C.muted }}>{k}</span><span style={{ color: C.text }}>{v}</span>
          </div>
        ))}
      </div>
      <p style={{ fontFamily: SANS, fontSize: 11, color: C.muted, margin: "8px 0 0", lineHeight: 1.5 }}>
        Every figure is the engine's own record for this fill — entry/exit at the adjusted open, real commission + slippage charged.
      </p>
    </div>
  );
}

const fmtPx = (v) => (v == null ? "—" : v >= 100 ? v.toFixed(1) : v.toFixed(3));

function Chip({ on, onClick, color, dashed, children }) {
  return (
    <button onClick={onClick} className="row center" style={{ gap: 6, background: "transparent", border: "none", cursor: "pointer", opacity: on ? 1 : 0.36, fontFamily: MONO, fontSize: 10, color: C.muted }}>
      {dashed ? <svg width="16" height="2"><line x1="0" y1="1" x2="16" y2="1" stroke={color} strokeWidth="1" strokeDasharray="3 2" /></svg>
        : <span style={{ width: 16, height: 2, background: color, display: "inline-block" }} />}
      <span style={{ textDecoration: on ? "none" : "line-through" }}>{children}</span>
    </button>
  );
}
function JumpBtn({ onClick, icon, children }) {
  return (
    <button onClick={onClick} className="mono row center" style={{ gap: 5, padding: "5px 9px", fontSize: 9.5, letterSpacing: "0.06em", color: C.muted, background: "transparent", border: `1px solid ${C.border}`, borderRadius: 5 }}>
      {icon} {children}
    </button>
  );
}

function nearestTrade(trades, key) {
  if (!trades.length || !key) return null;
  // prefer a trade whose holding window contains the click
  const inside = trades.find((t) => key >= t.entryDate && key <= t.exitDate);
  if (inside) return inside.index;
  // else nearest entry by date-string distance
  let best = null, bestD = Infinity;
  for (const t of trades) { const d = Math.abs(Date.parse(t.entryDate) - Date.parse(key)); if (d < bestD) { bestD = d; best = t.index; } }
  return best;
}
