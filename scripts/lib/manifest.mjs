// Builds the small manifest (instrument summaries) loaded at app startup for
// the instrument picker. Pure — no I/O — so it is unit-testable.
export function buildManifest(datasets) {
  return datasets
    .filter((d) => d && Array.isArray(d.rows) && d.rows.length > 0)
    .map((d) => ({
      id: d.id,
      symbol: d.symbol,
      name: d.name,
      klass: d.klass,
      bars: d.rows.length,
      start: d.rows[0].date,
      end: d.rows.at(-1).date,
      adjusted: !!d.adjusted,
      fillConvention: d.fillConvention || "nextOpen",
      source: d.source || "unknown",
    }))
    // longest history first — the most useful instruments lead the list.
    .sort((a, b) => b.bars - a.bars);
}