// ── What the verdict MEANS for the user (positioning, not metrics) ──────────
//
// Most honest verdicts are DEAD (REJECTED) or SHAKY (SUSPECT), because most
// strategies that look good in a backtest are curve fits. Without a plain,
// in-voice explanation, users misread a DEAD verdict as the TOOL failing them
// rather than the tool doing its one job — catching a bad trade before it costs
// real money. This module supplies that framing.
//
// It is pure explanatory copy — it fabricates NO metric and reads NONE. It also
// deliberately does NOT coach the user toward a passing verdict: the DEAD/SHAKY
// framing tells them a kill is a good outcome and warns against tuning until the
// tool caves. Null is on the market's side, not the user's.

export function verdictMeaning(bucket) {
  switch (bucket) {
    case "REJECTED":
      return {
        tone: "dead",
        eyebrow: "WHY THIS IS GOOD NEWS",
        title: "A DEAD verdict is the tool working — not failing you.",
        body:
          "Most strategies that look great on a backtest are curve fits: they memorized the past and fall apart on money you haven't lost yet. Null just caught one on paper, for free, before it cost you anything real. That's the whole point of running it — a kill here is a save out there.",
        // A guardrail, not a nudge: do NOT tune until the tool caves.
        caution:
          "Don't take this as a to-do list. Tweaking the rules until the verdict flips isn't finding an edge — it's overfitting to Null's split, and it's exactly what this tool exists to stop. The honest move is usually to walk away.",
      };
    case "SUSPECT":
      return {
        tone: "shaky",
        eyebrow: "HOW TO READ A SHAKY VERDICT",
        title: "SHAKY means the evidence is too thin to trust — not that it's good.",
        body:
          "The strategy didn't fail outright, but it didn't clear the bar either: the out-of-sample signal is weak, inconsistent, or indistinguishable from luck. “Not proven guilty” is not “proven innocent.” Treat SHAKY as unproven, and unproven money is money you don't bet.",
        caution:
          "More testing here means more instruments, more history, more walk-forward — not shopping for the one parameter set that squeaks a pass. If it were a real edge, it wouldn't need you to hunt for it.",
      };
    case "PLAUSIBLE":
      return {
        tone: "survived",
        eyebrow: "WHAT SURVIVED ACTUALLY MEANS",
        title: "SURVIVED is encouraging — it is not proof.",
        body:
          "The strategy cleared one out-of-sample window after real costs. That's rare and worth noting. It is still one instrument and one split: a passing grade on a single unseen stretch, not evidence you should risk capital. Push it harder across markets and time before you trust it.",
        caution: null,
      };
    default:
      return null;
  }
}
