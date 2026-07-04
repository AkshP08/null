// ── Data layer ───────────────────────────────────────────────────────────────
//
// The bundled REAL historical data lives in /public/data/*.json and is served
// as STATIC ASSETS — it is NOT inlined into the JS bundle. This keeps the
// initial bundle small; each price series is fetched lazily only when needed.
//
//   loadManifest()      → small list of instrument summaries (for the picker)
//   loadInstrument(id)  → full price series, integrity-checked on load
//
// Nothing synthetic is ever loaded. A series that fails integrity is returned
// with ok:false and its issues, so the UI can disclose the problem rather than
// crashing through it or silently passing bad data to the engine.

import { checkIntegrity } from "./integrity.js";

const BASE = (import.meta.env && import.meta.env.BASE_URL) || "/";
const url = (p) => `${BASE}data/${p}`.replace(/\/{2,}/g, "/").replace(":/", "://");

let manifestCache = null;
const instrumentCache = new Map();

export async function loadManifest() {
  if (manifestCache) return manifestCache;
  const res = await fetch(url("manifest.json"));
  if (!res.ok) throw new Error(`Could not load data manifest (HTTP ${res.status}).`);
  manifestCache = await res.json();
  return manifestCache;
}

export async function loadInstrument(id) {
  if (instrumentCache.has(id)) return instrumentCache.get(id);
  const res = await fetch(url(`${encodeURIComponent(id)}.json`));
  if (!res.ok) throw new Error(`Could not load ${id} (HTTP ${res.status}).`);
  const data = await res.json();
  const integrity = checkIntegrity(data);
  const loaded = { ...data, integrity };
  instrumentCache.set(id, loaded);
  return loaded;
}

/** Load several instruments; returns { id → loaded | {error} } without throwing. */
export async function loadInstruments(ids) {
  const out = {};
  await Promise.all(
    ids.map(async (id) => {
      try {
        out[id] = await loadInstrument(id);
      } catch (e) {
        out[id] = { id, error: e?.message || "load failed" };
      }
    }),
  );
  return out;
}

export { checkIntegrity };