// ── Saved-strategy library (localStorage) ───────────────────────────────────
//
// Persists the strategy SPEC + settings only — never results. When a saved
// strategy is reopened the backtest is recomputed live from real data, so a
// stored run can never show a stale or fabricated number. All access is wrapped
// so a disabled/private-mode localStorage degrades gracefully.

const KEY = "null_saved_strategies";

function readAll() {
  try {
    const raw = localStorage.getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}
function writeAll(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

export function listSaved() {
  return readAll().sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1));
}

/** Save (or update) a strategy. `savedAt` is passed in so this stays pure of Date. */
export function saveStrategy(entry, savedAt) {
  const list = readAll();
  const id = entry.id || `s_${savedAt}_${Math.abs(hash(JSON.stringify(entry.spec)))}`;
  const record = {
    id,
    name: entry.name || entry.spec?.name || "Untitled strategy",
    savedAt,
    mode: entry.mode || "english",
    text: entry.text || "",
    spec: entry.spec,
    config: entry.config || {},
    selected: entry.selected || [],
  };
  const idx = list.findIndex((s) => s.id === id);
  if (idx >= 0) list[idx] = record;
  else list.push(record);
  writeAll(list);
  return record;
}

export function deleteSaved(id) {
  writeAll(readAll().filter((s) => s.id !== id));
}

export function storageAvailable() {
  try {
    const k = "__null_probe__";
    localStorage.setItem(k, "1");
    localStorage.removeItem(k);
    return true;
  } catch {
    return false;
  }
}

function hash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  return h;
}
