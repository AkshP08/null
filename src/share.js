// ── Shareable permalinks ────────────────────────────────────────────────────
//
// Encodes ONLY the reproducible inputs — the strategy spec and the test settings
// — into the URL. It NEVER serializes results: a shared link recomputes the
// backtest live on the other end, so no stale or fake number can ever travel in
// a URL. The spec is re-validated on decode before it can be used.

import { validateSpec } from "./engine/schema.js";

const VERSION = 1;

// URL-safe base64 of a UTF-8 string
function b64encode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64decode(s) {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** Encode a run's inputs into a compact URL-safe token. */
export function encodeShare({ spec, config, selected, mode, text, name }) {
  const payload = {
    v: VERSION,
    spec,
    cfg: {
      from: config?.from || "",
      to: config?.to || "",
      c: config?.commissionBps,
      s: config?.slippageBps,
      is: config?.isFraction,
    },
    sel: selected || [],
    mode: mode || "english",
    text: text || "",
    name: name || spec?.name || "",
  };
  return b64encode(JSON.stringify(payload));
}

/** Decode + validate a share token. Returns { ok, state } or { ok:false, error }. */
export function decodeShare(token) {
  let payload;
  try {
    payload = JSON.parse(b64decode(token));
  } catch {
    return { ok: false, error: "This share link is malformed." };
  }
  if (!payload || payload.v !== VERSION || !payload.spec) {
    return { ok: false, error: "This share link is from an unsupported version." };
  }
  const v = validateSpec(payload.spec);
  if (!v.ok) return { ok: false, error: `The shared strategy didn't validate: ${(v.errors || []).join("; ")}` };
  return {
    ok: true,
    state: {
      spec: v.spec,
      config: {
        from: payload.cfg?.from || "",
        to: payload.cfg?.to || "",
        commissionBps: payload.cfg?.c,
        slippageBps: payload.cfg?.s,
        isFraction: payload.cfg?.is,
      },
      selected: Array.isArray(payload.sel) ? payload.sel : [],
      mode: payload.mode === "pine" ? "pine" : "english",
      text: typeof payload.text === "string" ? payload.text : "",
      name: payload.name || v.spec.name,
    },
  };
}

/** Build a full shareable URL for the current origin. */
export function shareUrl(state) {
  const token = encodeShare(state);
  const base = typeof window !== "undefined" ? `${window.location.origin}${window.location.pathname}` : "";
  return `${base}#s=${token}`;
}

/** Read a share token from the current URL hash, if any. */
export function readShareFromLocation() {
  if (typeof window === "undefined") return null;
  const m = window.location.hash.match(/[#&]s=([^&]+)/);
  return m ? m[1] : null;
}
