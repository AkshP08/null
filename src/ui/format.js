// Display formatting. Never alters values — only renders them.
export const pct = (x, d = 1) =>
  x == null || !Number.isFinite(x) ? "—" : `${(x * 100).toFixed(d)}%`;

export const signedPct = (x, d = 1) =>
  x == null || !Number.isFinite(x) ? "—" : `${x >= 0 ? "+" : ""}${(x * 100).toFixed(d)}%`;

export const num = (x, d = 2) =>
  x == null || !Number.isFinite(x)
    ? x === Infinity
      ? "∞"
      : "—"
    : x.toFixed(d);

export const int = (x) => (x == null ? "—" : Math.round(x).toLocaleString());

export const cls = (x) => (x == null || !Number.isFinite(x) ? "" : x >= 0 ? "pos" : "neg");

export function bars2years(bars, perYear = 252) {
  return bars / perYear;
}
