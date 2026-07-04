// ── Privacy-respecting usage analytics ──────────────────────────────────────
//
// Goal: learn which STRATEGIES and INSTRUMENTS get tested, and where users drop
// off — so future development follows real usage. Non-goals: anything personal.
//
// Guarantees:
//   • No-op unless VITE_PLAUSIBLE_DOMAIN is configured at build time — a fresh
//     clone or a preview build sends nothing.
//   • No cookies, no fingerprinting, no cross-site tracking (Plausible is
//     cookieless and GDPR/CCPA-friendly by design).
//   • The user's strategy TEXT is never sent. Only structural facts (direction,
//     entry-condition types) and public instrument tickers leave the page, and
//     only through a strict allow-list + length cap (see sanitizeProps).
//   • The Plausible script loads from an external origin; the service worker
//     never caches cross-origin requests, so analytics never enters the cache.

const ENV = (typeof import.meta !== "undefined" && import.meta.env) || {};
const DOMAIN = ENV.VITE_PLAUSIBLE_DOMAIN || "";
const HOST = ENV.VITE_PLAUSIBLE_HOST || "https://plausible.io";

let injected = false;

export function analyticsEnabled() {
  return !!DOMAIN;
}

/** Inject the Plausible script once, only when configured. Safe to call repeatedly. */
export function initAnalytics() {
  if (!DOMAIN || injected || typeof document === "undefined") return;
  injected = true;
  const s = document.createElement("script");
  s.defer = true;
  s.setAttribute("data-domain", DOMAIN);
  s.src = `${HOST.replace(/\/$/, "")}/js/script.tagged-events.js`;
  document.head.appendChild(s);
  // queue stub so events fired before the script loads are not lost
  if (typeof window !== "undefined" && !window.plausible) {
    window.plausible = function () { (window.plausible.q = window.plausible.q || []).push(arguments); };
  }
}

// Only these keys may ever leave the page, and only as short strings/numbers.
// Nothing here is identifying: sources, public tickers, structural facts.
const ALLOWED_PROPS = new Set([
  "source", "screen", "bucket", "direction", "entry", "instruments", "count", "comparator", "window",
]);

/** Keep only allow-listed keys; coerce to a short string or finite number. */
export function sanitizeProps(props) {
  const out = {};
  if (!props || typeof props !== "object") return out;
  for (const [k, v] of Object.entries(props)) {
    if (!ALLOWED_PROPS.has(k)) continue;
    if (v == null) continue;
    if (typeof v === "number") { if (Number.isFinite(v)) out[k] = v; continue; }
    out[k] = String(v).slice(0, 80);
  }
  return out;
}

/**
 * A NON-PII descriptor of a strategy. Deliberately ignores spec.name and any
 * free text — it reports only the structural shape of the rules.
 */
export function strategyDescriptor(spec) {
  const condType = (c) => (Array.isArray(c?.all) ? "all" : Array.isArray(c?.any) ? "any" : c?.type || "cond");
  const entry = (spec?.entry || []).map(condType).join("+");
  return { direction: spec?.direction || "unknown", entry: entry || "none" };
}

/** Fire a custom event (no-op unless configured). Never throws. */
export function track(event, props) {
  if (!DOMAIN || typeof window === "undefined" || typeof event !== "string") return;
  try {
    const clean = sanitizeProps(props);
    if (typeof window.plausible === "function") {
      window.plausible(event, Object.keys(clean).length ? { props: clean } : undefined);
    }
  } catch {
    /* analytics must never break the app */
  }
}
