import { useState, useEffect } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  ReferenceLine, ReferenceArea, ResponsiveContainer, Tooltip,
} from "recharts";
import { Lock, Copy, Check, ChevronRight, ArrowRight, AlertTriangle } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

// ─── Design tokens ─────────────────────────────────────────────────────────────
const C = {
  canvas:   "#0A0E1A",
  surface:  "#121829",
  raised:   "#161D30",
  border:   "#20293D",
  text:     "#E6EAF2",
  muted:    "#8893A8",
  neon:     "#CDFF4B",
  red:      "#FF5B5B",
  amber:    "#E8B53B",
} as const;

const SERIF  = "'Newsreader', 'Georgia', serif";
const MONO   = "'JetBrains Mono', 'Courier New', monospace";
const SANS   = "'Inter', system-ui, sans-serif";

// ─── Chart data ────────────────────────────────────────────────────────────────
function pr(seed: number) {
  const s = Math.sin(seed * 9301 + 49297) * 233280;
  return s - Math.floor(s);
}

interface ChartPoint {
  day: number;
  is: number | undefined;
  oos: number | undefined;
  bh: number;
}

const SPLIT = 150;

const chartData: ChartPoint[] = (() => {
  let strategy = 100;
  let bh = 100;
  const data: ChartPoint[] = [];
  for (let i = 0; i < 200; i++) {
    const r1 = pr(i * 7 + 1);
    const r2 = pr(i * 13 + 5);
    if (i < SPLIT) {
      strategy *= (1 + r1 * 0.04 - 0.015);
      bh       *= (1 + r2 * 0.025 - 0.0105);
    } else {
      strategy *= (1 + r1 * 0.042 - 0.026);
      bh       *= (1 + r2 * 0.022 - 0.0098);
    }
    data.push({
      day: i,
      is:  i <= SPLIT ? +strategy.toFixed(1) : undefined,
      oos: i >= SPLIT - 1 ? +strategy.toFixed(1) : undefined,
      bh:  +bh.toFixed(1),
    });
  }
  return data;
})();

// ─── Metrics ───────────────────────────────────────────────────────────────────
const IS_METRICS = [
  { label: "Total Return",   value: "+84.7%", good: true  },
  { label: "CAGR",           value: "14.1%",  good: true  },
  { label: "Sharpe Ratio",   value: "1.84",   good: true  },
  { label: "Max Drawdown",   value: "−11.2%", good: false },
  { label: "Win Rate",       value: "61.4%",  good: true  },
  { label: "Profit Factor",  value: "2.31",   good: true  },
];

const OOS_METRICS = [
  { label: "Total Return",   value: "+3.1%",  good: false },
  { label: "CAGR",           value: "1.4%",   good: false },
  { label: "Sharpe Ratio",   value: "0.31",   good: false },
  { label: "Max Drawdown",   value: "−19.7%", good: false },
  { label: "Win Rate",       value: "44.2%",  good: false },
  { label: "Profit Factor",  value: "0.87",   good: false },
];

// ─── Types ─────────────────────────────────────────────────────────────────────
type Screen = "landing" | "input" | "parsing" | "confirm" | "results-locked" | "results-revealed" | "verdict" | "export";

// ─── Shared components ─────────────────────────────────────────────────────────

function NullLogo({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const sz = { sm: ["text-lg", "text-base"], md: ["text-2xl", "text-xl"], lg: ["text-6xl", "text-5xl"] }[size];
  return (
    <div className="flex items-center gap-2 select-none">
      <span className={sz[0]} style={{ fontFamily: MONO, color: C.neon }}> ∅</span>
      <span className={sz[1]} style={{ fontFamily: SERIF, color: C.text, fontWeight: 400, letterSpacing: "-0.02em" }}>null</span>
    </div>
  );
}

function NavBar({ onNav }: { onNav: (s: Screen) => void }) {
  return (
    <nav
      className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 py-4 border-b"
      style={{ background: C.canvas, borderColor: C.border }}
    >
      <button onClick={() => onNav("landing")} className="focus:outline-none focus-visible:ring-2 focus-visible:ring-[#CDFF4B] rounded">
        <NullLogo size="sm" />
      </button>
      <button
        onClick={() => onNav("input")}
        className="px-4 py-2 text-xs border transition-colors hover:border-[#8893A8] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#CDFF4B] rounded"
        style={{ fontFamily: MONO, color: C.muted, borderColor: C.border, borderRadius: "6px", letterSpacing: "0.1em" }}
      >
        TEST A STRATEGY
      </button>
    </nav>
  );
}

function MetricRow({ label, value, good, blur }: { label: string; value: string; good: boolean; blur?: boolean }) {
  return (
    <div
      className={`flex justify-between items-center py-3 border-b last:border-b-0 transition-all ${blur ? "select-none pointer-events-none" : ""}`}
      style={{ borderColor: C.border, filter: blur ? "blur(6px)" : "none" }}
    >
      <span className="text-xs tracking-widest" style={{ fontFamily: MONO, color: C.muted }}>
        {label.toUpperCase()}
      </span>
      <span className="text-sm font-medium" style={{ fontFamily: MONO, color: good ? C.neon : C.red }}>
        {value}
      </span>
    </div>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs tracking-widest mb-2" style={{ fontFamily: MONO, color: C.muted }}>
      {String(children).toUpperCase()}
    </p>
  );
}

// ─── Landing ───────────────────────────────────────────────────────────────────

function LandingScreen({ onNav }: { onNav: (s: Screen) => void }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center relative">
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: `radial-gradient(ellipse 60% 50% at 50% 40%, ${C.neon}06 0%, transparent 70%)`,
        }}
      />

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        className="relative"
      >
        <div
          className="text-[8rem] leading-none mb-8 select-none"
          style={{ fontFamily: MONO, color: C.neon, opacity: 0.12 }}
        >
          ∅
        </div>

        <h1
          className="max-w-2xl text-4xl md:text-[3.5rem] leading-[1.15] mb-6"
          style={{ fontFamily: SERIF, color: C.text, fontWeight: 400 }}
        >
          Assume your strategy<br />has no edge. Now make<br />it prove otherwise.
        </h1>

        <p
          className="max-w-md mx-auto text-base leading-relaxed mb-12"
          style={{ fontFamily: SANS, color: C.muted }}
        >
          Null tests trading strategies the way a skeptic would — on data they've never seen, after real costs.
        </p>

        <button
          onClick={() => onNav("input")}
          className="inline-flex items-center gap-3 px-8 py-4 text-sm transition-all hover:opacity-85 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#CDFF4B] focus-visible:ring-offset-[#0A0E1A]"
          style={{
            fontFamily: MONO,
            background: C.neon,
            color: C.canvas,
            borderRadius: "8px",
            letterSpacing: "0.1em",
          }}
        >
          TEST A STRATEGY <ArrowRight size={15} />
        </button>
      </motion.div>

      <div className="absolute bottom-8 left-0 right-0 flex justify-center">
        <span className="text-xs tracking-widest" style={{ fontFamily: MONO, color: C.border }}>
          ASSUME NO EDGE — UNTIL THE DATA PROVES ONE
        </span>
      </div>
    </div>
  );
}

// ─── Input ─────────────────────────────────────────────────────────────────────

const EXAMPLES = [
  "50/200 SMA crossover",
  "RSI(14) mean reversion",
  "Momentum 12-1 month",
  "Gap-and-go breakout",
  "Dual momentum",
];

const INSTRUMENTS = ["SPY", "QQQ", "IWM", "GLD", "TLT", "BTC-USD", "AAPL", "EFA"];

function InputScreen({ onNav }: { onNav: (s: Screen) => void }) {
  const [mode, setMode] = useState<"english" | "pine">("english");
  const [text, setText] = useState("");
  const [insts, setInsts] = useState<string[]>(["SPY"]);
  const [dateFrom, setDateFrom] = useState("2015-01-01");
  const [dateTo, setDateTo] = useState("2024-12-31");

  const toggleInst = (i: string) =>
    setInsts((p) => (p.includes(i) ? p.filter((x) => x !== i) : [...p, i]));

  const inputStyle = {
    background: C.raised,
    color: C.text,
    border: `1px solid ${C.border}`,
    borderRadius: "8px",
    fontFamily: SANS,
  };

  return (
    <div className="min-h-screen pt-20 px-6 pb-16 max-w-2xl mx-auto">
      <div className="pt-8 mb-8">
        <Eyebrow>Strategy</Eyebrow>
        <h1 className="text-3xl" style={{ fontFamily: SERIF, color: C.text, fontWeight: 400 }}>
          Describe your edge
        </h1>
      </div>

      {/* Mode toggle */}
      <div
        className="flex mb-5 p-1"
        style={{ background: C.raised, border: `1px solid ${C.border}`, borderRadius: "8px" }}
      >
        {(["english", "pine"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className="flex-1 py-2 text-xs transition-all focus:outline-none"
            style={{
              fontFamily: MONO,
              borderRadius: "6px",
              letterSpacing: "0.1em",
              background: mode === m ? C.text : "transparent",
              color: mode === m ? C.canvas : C.muted,
            }}
          >
            {m === "english" ? "ENGLISH" : "PINE SCRIPT"}
          </button>
        ))}
      </div>

      {/* Textarea */}
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={6}
        placeholder={
          mode === "english"
            ? "e.g. go long when the 50-day average crosses above the 200-day; exit on a 5% stop"
            : "// paste your Pine Script strategy here\nstrategy(\"My Strategy\", overlay=true)"
        }
        className="w-full p-4 text-sm resize-none outline-none placeholder:text-[#8893A8] focus:border-[#8893A8] transition-colors"
        style={{ ...inputStyle, fontFamily: mode === "pine" ? MONO : SANS, lineHeight: 1.7 }}
      />

      {/* Example chips */}
      <div className="flex flex-wrap gap-2 mt-3 mb-8">
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            onClick={() => setText(ex)}
            className="px-3 py-1.5 text-xs border transition-colors hover:border-[#8893A8] focus:outline-none focus-visible:ring-1 focus-visible:ring-[#CDFF4B]"
            style={{ fontFamily: MONO, color: C.muted, borderColor: C.border, borderRadius: "6px" }}
          >
            {ex}
          </button>
        ))}
      </div>

      {/* Instruments */}
      <div className="mb-6">
        <Eyebrow>Instruments</Eyebrow>
        <div className="flex flex-wrap gap-2">
          {INSTRUMENTS.map((inst) => {
            const active = insts.includes(inst);
            return (
              <button
                key={inst}
                onClick={() => toggleInst(inst)}
                className="px-3 py-1.5 text-xs border transition-all focus:outline-none focus-visible:ring-1 focus-visible:ring-[#CDFF4B]"
                style={{
                  fontFamily: MONO,
                  borderRadius: "6px",
                  background: active ? `${C.neon}18` : "transparent",
                  color: active ? C.neon : C.muted,
                  borderColor: active ? `${C.neon}55` : C.border,
                }}
              >
                {inst}
              </button>
            );
          })}
        </div>
      </div>

      {/* Date range */}
      <div className="grid grid-cols-2 gap-4 mb-10">
        {[
          { label: "From", value: dateFrom, set: setDateFrom },
          { label: "To", value: dateTo, set: setDateTo },
        ].map(({ label, value, set }) => (
          <div key={label}>
            <Eyebrow>{label}</Eyebrow>
            <input
              type="date"
              value={value}
              onChange={(e) => set(e.target.value)}
              className="w-full px-3 py-2 text-sm outline-none focus:border-[#8893A8] transition-colors"
              style={{ ...inputStyle, fontFamily: MONO }}
            />
          </div>
        ))}
      </div>

      <button
        onClick={() => onNav("parsing")}
        className="w-full py-4 text-sm transition-all hover:opacity-85 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#CDFF4B]"
        style={{
          fontFamily: MONO,
          background: C.neon,
          color: C.canvas,
          borderRadius: "8px",
          letterSpacing: "0.1em",
        }}
      >
        RUN THE TEST
      </button>
    </div>
  );
}

// ─── Parsing ───────────────────────────────────────────────────────────────────

function ParsingScreen({ onNav }: { onNav: (s: Screen) => void }) {
  useEffect(() => {
    const t = setTimeout(() => onNav("confirm"), 2600);
    return () => clearTimeout(t);
  }, [onNav]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-6">
      <motion.span
        animate={{ rotate: 360 }}
        transition={{ duration: 5, repeat: Infinity, ease: "linear" }}
        style={{
          display: "inline-block",
          fontFamily: MONO,
          fontSize: "4rem",
          color: C.neon,
          lineHeight: 1,
        }}
      >
        ∅
      </motion.span>
      <p className="text-xs tracking-widest" style={{ fontFamily: MONO, color: C.muted }}>
        READING YOUR STRATEGY…
      </p>
    </div>
  );
}

// ─── Confirm ───────────────────────────────────────────────────────────────────

const PARSED_RULES = [
  { type: "ENTRY",    desc: "50-day SMA crosses above 200-day SMA",                  ok: true  },
  { type: "EXIT",     desc: "5% trailing stop-loss from peak",                        ok: true  },
  { type: "POSITION", desc: "100% equity — no leverage",                              ok: true  },
  { type: "COSTS",    desc: "0.1% slippage per side · $0.005/share commission",       ok: true  },
  { type: "UNCLEAR",  desc: "\"momentum filter\" — could not be represented. Ignored.", ok: false },
];

function ConfirmScreen({ onNav }: { onNav: (s: Screen) => void }) {
  return (
    <div className="min-h-screen pt-20 px-6 pb-16 max-w-2xl mx-auto">
      <div className="pt-8 mb-8">
        <Eyebrow>Parsing result</Eyebrow>
        <h1 className="text-3xl" style={{ fontFamily: SERIF, color: C.text, fontWeight: 400 }}>
          What I understood
        </h1>
      </div>

      <div className="rounded-lg border overflow-hidden mb-6" style={{ background: C.surface, borderColor: C.border }}>
        {PARSED_RULES.map((rule, i) => (
          <div
            key={i}
            className="px-5 py-4 border-b last:border-b-0 flex items-start gap-4"
            style={{ borderColor: C.border }}
          >
            <span
              className="text-xs tracking-widest flex-shrink-0 pt-0.5 w-[4.5rem]"
              style={{ fontFamily: MONO, color: rule.ok ? C.muted : C.red }}
            >
              {rule.type}
            </span>
            <span className="text-sm leading-relaxed flex items-start gap-2" style={{ fontFamily: SANS, color: rule.ok ? C.text : C.red }}>
              {rule.desc}
              {!rule.ok && <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" style={{ color: C.red }} />}
            </span>
          </div>
        ))}
      </div>

      <p className="text-xs leading-relaxed mb-8" style={{ fontFamily: SANS, color: C.muted }}>
        One clause couldn't be parsed and has been excluded. The test will proceed without it.
        Review the rules above before continuing.
      </p>

      <div className="flex gap-3">
        <button
          onClick={() => onNav("results-locked")}
          className="flex-1 py-4 text-sm transition-all hover:opacity-85 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#CDFF4B]"
          style={{ fontFamily: MONO, background: C.neon, color: C.canvas, borderRadius: "8px", letterSpacing: "0.08em" }}
        >
          LOOKS RIGHT — TEST IT
        </button>
        <button
          onClick={() => onNav("input")}
          className="px-8 py-4 text-sm border transition-colors hover:border-[#8893A8] focus:outline-none"
          style={{ fontFamily: MONO, color: C.muted, borderColor: C.border, borderRadius: "8px", letterSpacing: "0.08em" }}
        >
          EDIT
        </button>
      </div>
    </div>
  );
}

// ─── Results ───────────────────────────────────────────────────────────────────

const CustomTooltip = ({ active, payload }: { active?: boolean; payload?: { name: string; value: number; color: string }[] }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="px-3 py-2 border text-xs" style={{ background: C.surface, borderColor: C.border, borderRadius: "6px", fontFamily: MONO }}>
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.color }}>
          {p.name}: {p.value?.toFixed(1)}
        </div>
      ))}
    </div>
  );
};

function ResultsScreen({ onNav, revealed }: { onNav: (s: Screen) => void; revealed: boolean }) {
  const [costs, setCosts] = useState<"after" | "before">("after");

  return (
    <div className="min-h-screen pt-20 px-4 md:px-8 pb-16">
      <div className="max-w-5xl mx-auto pt-8 mb-6">
        <Eyebrow>SPY · 2015–2024 · 50/200 SMA crossover</Eyebrow>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h1 className="text-2xl md:text-3xl" style={{ fontFamily: SERIF, color: C.text, fontWeight: 400 }}>
            {revealed ? "The truth, after costs" : "In-sample performance"}
          </h1>

          {/* Costs toggle */}
          <div
            className="flex p-0.5 text-xs"
            style={{ background: C.raised, border: `1px solid ${C.border}`, borderRadius: "6px" }}
          >
            {(["after", "before"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setCosts(v)}
                className="px-4 py-1.5 transition-all focus:outline-none"
                style={{
                  fontFamily: MONO,
                  borderRadius: "4px",
                  letterSpacing: "0.08em",
                  background: costs === v ? C.raised : "transparent",
                  color: costs === v ? C.text : C.muted,
                  border: costs === v ? `1px solid ${C.border}` : "1px solid transparent",
                }}
              >
                {v.toUpperCase()} COSTS
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Chart */}
      <div className="max-w-5xl mx-auto mb-4">
        <div
          className="rounded-lg border p-4 md:p-5 relative"
          style={{ background: C.surface, borderColor: C.border }}
        >
          {/* Legend */}
          <div className="flex flex-wrap items-center gap-5 mb-4 text-xs" style={{ fontFamily: MONO }}>
            <div className="flex items-center gap-2">
              <div className="w-5 h-0.5" style={{ background: C.neon }} />
              <span style={{ color: C.muted }}>STRATEGY (IN-SAMPLE)</span>
            </div>
            {revealed && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center gap-2">
                <div className="w-5 h-0.5" style={{ background: C.red }} />
                <span style={{ color: C.muted }}>STRATEGY (OUT-OF-SAMPLE)</span>
              </motion.div>
            )}
            <div className="flex items-center gap-2">
              <svg width="20" height="2"><line x1="0" y1="1" x2="20" y2="1" stroke={C.muted} strokeWidth="1" strokeDasharray="4 3" /></svg>
              <span style={{ color: C.muted }}>BUY & HOLD</span>
            </div>
          </div>

          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={chartData} margin={{ top: 4, right: 8, left: -18, bottom: 4 }}>
              <defs>
                <filter id="neon-glow" x="-30%" y="-30%" width="160%" height="160%">
                  <feGaussianBlur stdDeviation="2.5" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
                <filter id="red-glow" x="-30%" y="-30%" width="160%" height="160%">
                  <feGaussianBlur stdDeviation="2" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>

              <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false} />
              <XAxis dataKey="day" hide />
              <YAxis
                tick={{ fontSize: 10, fill: C.muted, fontFamily: MONO }}
                tickFormatter={(v) => `${v}`}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip content={<CustomTooltip />} />

              {/* Reference area: unseen region */}
              <ReferenceArea
                x1={SPLIT}
                x2={199}
                fill={revealed ? C.red : C.neon}
                fillOpacity={0.025}
              />

              {/* Vertical split line */}
              <ReferenceLine
                x={SPLIT}
                stroke={C.muted}
                strokeDasharray="5 4"
                strokeOpacity={0.5}
                label={{
                  value: "UNSEEN →",
                  fill: C.muted,
                  fontSize: 9,
                  fontFamily: MONO,
                  position: "insideTopRight",
                }}
              />

              {/* Buy & hold */}
              <Line
                type="monotone"
                dataKey="bh"
                name="Buy & Hold"
                stroke={C.muted}
                strokeWidth={1}
                strokeDasharray="5 4"
                dot={false}
                isAnimationActive={false}
              />

              {/* In-sample neon line */}
              <Line
                type="monotone"
                dataKey="is"
                name="In-sample"
                stroke={C.neon}
                strokeWidth={2.5}
                dot={false}
                isAnimationActive={false}
                connectNulls={false}
                style={{ filter: "url(#neon-glow)" }}
              />

              {/* Out-of-sample — only rendered after reveal, recharts animates it */}
              {revealed && (
                <Line
                  key="oos-line"
                  type="monotone"
                  dataKey="oos"
                  name="Out-of-sample"
                  stroke={C.red}
                  strokeWidth={2.5}
                  dot={false}
                  isAnimationActive={true}
                  animationDuration={1800}
                  animationEasing="ease-out"
                  connectNulls={false}
                  style={{ filter: "url(#red-glow)" }}
                />
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Metric panels */}
      <div className="max-w-5xl mx-auto grid md:grid-cols-2 gap-4">
        {/* In-sample panel */}
        <div
          className="rounded-lg border overflow-hidden"
          style={{
            background: C.surface,
            borderColor: C.border,
            borderTop: `2px solid ${C.neon}`,
          }}
        >
          <div className="px-5 pt-4 pb-3 border-b" style={{ borderColor: C.border }}>
            <p className="text-xs tracking-widest" style={{ fontFamily: MONO, color: C.neon }}>IN-SAMPLE · 2015–2021</p>
            <p className="text-xs mt-1" style={{ fontFamily: SANS, color: C.muted }}>Data the strategy was built on</p>
          </div>
          <div className="px-5 py-1">
            {IS_METRICS.map((m, i) => <MetricRow key={i} {...m} />)}
          </div>
        </div>

        {/* Out-of-sample panel */}
        <div
          className="rounded-lg border overflow-hidden relative"
          style={{
            background: C.surface,
            borderColor: C.border,
            borderTop: `2px solid ${revealed ? C.red : C.border}`,
            transition: "border-top-color 0.5s ease",
          }}
        >
          <div className="px-5 pt-4 pb-3 border-b" style={{ borderColor: C.border }}>
            <p
              className="text-xs tracking-widest transition-colors"
              style={{ fontFamily: MONO, color: revealed ? C.red : C.muted, transition: "color 0.4s" }}
            >
              OUT-OF-SAMPLE · 2022–2024
            </p>
            <p className="text-xs mt-1" style={{ fontFamily: SANS, color: C.muted }}>Data the strategy has never seen</p>
          </div>
          <div className="px-5 py-1">
            {OOS_METRICS.map((m, i) => (
              <MetricRow key={i} label={m.label} value={m.value} good={m.good} blur={!revealed} />
            ))}
          </div>

          {/* Lock overlay */}
          <AnimatePresence>
            {!revealed && (
              <motion.div
                initial={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.5, ease: "easeOut" }}
                className="absolute inset-0 flex flex-col items-center justify-center gap-4"
                style={{ background: `${C.surface}D0`, backdropFilter: "blur(6px)" }}
              >
                <Lock size={18} style={{ color: C.muted }} />
                <p
                  className="text-xs text-center px-8 leading-relaxed"
                  style={{ fontFamily: SANS, color: C.muted, maxWidth: "18rem" }}
                >
                  You haven't earned this number yet.
                </p>
                <button
                  onClick={() => onNav("results-revealed")}
                  className="px-6 py-3 text-xs border-0 transition-all hover:opacity-85 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#FF5B5B]"
                  style={{
                    fontFamily: MONO,
                    background: C.red,
                    color: "#fff",
                    borderRadius: "6px",
                    letterSpacing: "0.1em",
                  }}
                >
                  REVEAL THE TRUTH
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Post-reveal: proceed to verdict */}
      <AnimatePresence>
        {revealed && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.8, duration: 0.4 }}
            className="max-w-5xl mx-auto mt-6 flex justify-end"
          >
            <button
              onClick={() => onNav("verdict")}
              className="flex items-center gap-2 px-6 py-3 text-xs border transition-colors hover:border-[#8893A8] focus:outline-none"
              style={{ fontFamily: MONO, color: C.muted, borderColor: C.border, borderRadius: "8px", letterSpacing: "0.08em" }}
            >
              SEE VERDICT <ChevronRight size={13} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Verdict ───────────────────────────────────────────────────────────────────

const VERDICTS = {
  reject: {
    word:     "SURVIVED",
    color:    "#CDFF4B",
    evidence: "The edge held up out-of-sample and after costs. Rare.",
  },
  borderline: {
    word:     "SHAKY",
    color:    "#E8B53B",
    evidence: "Most of the shine was overfitting. Weak evidence — don't trust it yet.",
  },
  fail: {
    word:     "DEAD",
    color:    "#FF5B5B",
    evidence: "No edge on unseen data. This is a curve fit.",
  },
} as const;

function VerdictScreen({ onNav }: { onNav: (s: Screen) => void }) {
  const v = VERDICTS.fail;

  return (
    <div className="min-h-screen pt-20 px-6 flex flex-col items-center justify-center text-center">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
        className="max-w-2xl w-full"
      >
        <Eyebrow>Verdict · 50/200 SMA Crossover · SPY</Eyebrow>

        <h1
          className="text-5xl md:text-7xl leading-none mb-4 mt-6"
          style={{ fontFamily: SERIF, color: v.color, fontWeight: 400 }}
        >
          {v.word}
        </h1>

        <p className="text-sm mb-12" style={{ fontFamily: MONO, color: C.muted }}>
          {v.evidence}
        </p>

        {/* Key numbers */}
        <div className="grid grid-cols-3 gap-3 mb-12">
          {[
            { l: "IS Sharpe",   val: "1.84",  color: C.neon },
            { l: "OOS Sharpe",  val: "0.31",  color: C.red  },
            { l: "Edge decay",  val: "−83%",  color: C.red  },
          ].map((m, i) => (
            <div
              key={i}
              className="rounded-lg border p-4"
              style={{ background: C.surface, borderColor: C.border }}
            >
              <p className="text-xs tracking-widest mb-3" style={{ fontFamily: MONO, color: C.muted }}>
                {m.l.toUpperCase()}
              </p>
              <p className="text-2xl font-medium" style={{ fontFamily: MONO, color: m.color }}>
                {m.val}
              </p>
            </div>
          ))}
        </div>

        <div className="flex gap-3 justify-center">
          <button
            onClick={() => onNav("export")}
            className="px-6 py-3 text-xs border transition-colors hover:border-[#8893A8] focus:outline-none"
            style={{ fontFamily: MONO, color: C.muted, borderColor: C.border, borderRadius: "8px", letterSpacing: "0.08em" }}
          >
            EXPORT PINE SCRIPT
          </button>
          <button
            onClick={() => onNav("input")}
            className="px-6 py-3 text-xs transition-all hover:opacity-85 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#CDFF4B]"
            style={{ fontFamily: MONO, background: C.neon, color: C.canvas, borderRadius: "8px", letterSpacing: "0.08em" }}
          >
            TEST ANOTHER
          </button>
        </div>
      </motion.div>
    </div>
  );
}

// ─── Export ────────────────────────────────────────────────────────────────────

const PINE_CODE = `//@version=5
strategy("50/200 SMA Crossover", overlay=true, initial_capital=10000,
         default_qty_type=strategy.percent_of_equity,
         default_qty_value=100,
         commission_type=strategy.commission.percent,
         commission_value=0.1,
         slippage=1)

// ─── Inputs ─────────────────────────────────────────────────────────────
fast_len  = input.int(50,  title="Fast MA Length",  minval=1)
slow_len  = input.int(200, title="Slow MA Length",  minval=1)
stop_pct  = input.float(5.0, title="Stop-Loss %",   minval=0.1) / 100

// ─── Indicators ─────────────────────────────────────────────────────────
fast_ma = ta.sma(close, fast_len)
slow_ma = ta.sma(close, slow_len)

// ─── Entry ──────────────────────────────────────────────────────────────
long_entry = ta.crossover(fast_ma, slow_ma)
strategy.entry("Long", strategy.long, when=long_entry)

// ─── Exit ───────────────────────────────────────────────────────────────
strategy.exit("Stop", from_entry="Long",
              loss=strategy.position_avg_price * stop_pct / syminfo.mintick)

// ─── Plots ──────────────────────────────────────────────────────────────
plot(fast_ma, color=color.new(color.green, 0), linewidth=1, title="50 SMA")
plot(slow_ma, color=color.new(color.red,   0), linewidth=1, title="200 SMA")

// NOTE: "momentum filter" clause could not be unambiguously parsed
// and has been excluded from this export. Review before live use.`;

function ExportScreen({ onNav }: { onNav: (s: Screen) => void }) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard.writeText(PINE_CODE);
    setCopied(true);
    setTimeout(() => setCopied(false), 2200);
  };

  return (
    <div className="min-h-screen pt-20 px-6 pb-16 max-w-3xl mx-auto">
      <div className="pt-8 mb-8">
        <Eyebrow>Export</Eyebrow>
        <h1 className="text-3xl" style={{ fontFamily: SERIF, color: C.text, fontWeight: 400 }}>
          Pine Script
        </h1>
      </div>

      <div
        className="rounded-lg border overflow-hidden"
        style={{ background: C.raised, borderColor: C.border }}
      >
        <div
          className="flex items-center justify-between px-5 py-3 border-b"
          style={{ borderColor: C.border }}
        >
          <span className="text-xs tracking-widest" style={{ fontFamily: MONO, color: C.muted }}>
            GENERATED · PINE v5
          </span>
          <button
            onClick={copy}
            className="flex items-center gap-2 px-3 py-1.5 text-xs border transition-all focus:outline-none"
            style={{
              fontFamily: MONO,
              borderRadius: "4px",
              color: copied ? C.neon : C.muted,
              borderColor: copied ? `${C.neon}55` : C.border,
            }}
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
            {copied ? "COPIED" : "COPY"}
          </button>
        </div>

        <pre
          className="p-5 text-xs overflow-x-auto leading-relaxed"
          style={{ fontFamily: MONO, color: C.text }}
        >
          <code>{PINE_CODE}</code>
        </pre>
      </div>

      <p className="mt-6 text-xs leading-relaxed" style={{ fontFamily: SANS, color: C.muted }}>
        Unsupported constructs appear as comments, not approximations. Paste into the TradingView Pine
        Editor and verify it compiles before use.
      </p>

      <div className="mt-8 flex justify-center">
        <button
          onClick={() => onNav("input")}
          className="px-8 py-3 text-xs transition-all hover:opacity-85 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#CDFF4B]"
          style={{ fontFamily: MONO, background: C.neon, color: C.canvas, borderRadius: "8px", letterSpacing: "0.1em" }}
        >
          TEST ANOTHER STRATEGY
        </button>
      </div>
    </div>
  );
}

// ─── App ───────────────────────────────────────────────────────────────────────

export default function App() {
  const [screen, setScreen] = useState<Screen>("landing");

  const navigate = (s: Screen) => {
    setScreen(s);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // Key for AnimatePresence — group results screens so they share a mount
  const motionKey = screen === "results-locked" || screen === "results-revealed" ? "results" : screen;

  const revealed = screen === "results-revealed";

  return (
    <div
      className="min-h-screen"
      style={{ background: C.canvas, color: C.text, fontFamily: SANS }}
    >
      {screen !== "landing" && <NavBar onNav={navigate} />}

      <AnimatePresence mode="wait">
        <motion.div
          key={motionKey}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
        >
          {screen === "landing"         && <LandingScreen onNav={navigate} />}
          {screen === "input"           && <InputScreen   onNav={navigate} />}
          {screen === "parsing"         && <ParsingScreen onNav={navigate} />}
          {screen === "confirm"         && <ConfirmScreen onNav={navigate} />}
          {(screen === "results-locked" || screen === "results-revealed") && (
            <ResultsScreen onNav={navigate} revealed={revealed} />
          )}
          {screen === "verdict"         && <VerdictScreen onNav={navigate} />}
          {screen === "export"          && <ExportScreen  onNav={navigate} />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
