// ── Error monitoring ────────────────────────────────────────────────────────
//
// So real-world failures SURFACE instead of dying silently. Three layers:
//   1. normalizeError() — reduce any thrown value to a small, non-PII record.
//   2. reportError() — log it, send a coarse analytics signal, and (only if a
//      sink is configured) beacon the detail to VITE_ERROR_ENDPOINT.
//   3. initMonitoring() — catch uncaught errors + unhandled promise rejections.
// The React <ErrorBoundary> (components/ErrorBoundary.jsx) also routes through
// reportError so a render crash shows a visible fallback, not a white screen.
//
// No third-party SDK is bundled: monitoring works with zero config (console +
// visible fallback), and can forward to any endpoint you set — no secret ships
// in the client.

import { track } from "./analytics.js";

const ENV = (typeof import.meta !== "undefined" && import.meta.env) || {};
const ENDPOINT = ENV.VITE_ERROR_ENDPOINT || "";

/** Reduce any thrown value to a bounded, structured record. Pure. */
export function normalizeError(err, context) {
  const name = (err && err.name) || (err instanceof Error ? "Error" : typeof err === "string" ? "Error" : "UnknownError");
  const message = String((err && err.message) || err || "unknown error").slice(0, 300);
  const stack = err && err.stack ? String(err.stack).split("\n").slice(0, 5).join("\n").slice(0, 1000) : null;
  return {
    name: String(name).slice(0, 80),
    message,
    stack,
    context: context ? String(context).slice(0, 80) : null,
  };
}

/** Report an error everywhere available. Never throws. */
export function reportError(err, context) {
  const info = normalizeError(err, context);
  try { console.error("[null:error]", info.context || "", info.message, info.stack || ""); } catch {}
  // Coarse, non-PII signal for the funnel (message text is NOT sent to analytics).
  try { track("error", { screen: info.context || "app" }); } catch {}
  // Optional external sink — only if the deployer configured one.
  try {
    if (ENDPOINT && typeof navigator !== "undefined" && navigator.sendBeacon) {
      navigator.sendBeacon(ENDPOINT, JSON.stringify({ ...info, url: typeof location !== "undefined" ? location.pathname : "", ts: Date.now() }));
    }
  } catch {}
  return info;
}

/** Wire global handlers so nothing fails silently. Call once at startup. */
export function initMonitoring() {
  if (typeof window === "undefined") return;
  window.addEventListener("error", (e) => reportError(e.error || e.message, "window.onerror"));
  window.addEventListener("unhandledrejection", (e) => reportError(e.reason, "unhandledrejection"));
}
