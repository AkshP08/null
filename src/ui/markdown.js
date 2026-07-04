// Minimal, safe markdown → token tree for the autopsy chat bubbles.
//
// Deliberately tiny: the model emits **bold**, `-`/`*` bullets, `1.` numbered
// lists and newlines — nothing else. We parse ONLY those into a plain data tree
// (no HTML strings, no raw-HTML passthrough), which the <Markdown> component
// renders as React text nodes + styled spans. Because every leaf is a text node
// that React escapes, there is no HTML-injection surface: markup in the model's
// output can never become live DOM.

/** Parse inline runs: **bold**, *italic* / _italic_, `code`. Returns segments. */
export function parseInline(text) {
  const src = String(text ?? "");
  const nodes = [];
  // Order matters: match the two-char delimiters (**, __) before the one-char.
  const re = /\*\*([^*]+?)\*\*|__([^_]+?)__|(?<![A-Za-z0-9])\*([^*\s][^*]*?)\*(?![A-Za-z0-9])|(?<![A-Za-z0-9])_([^_\s][^_]*?)_(?![A-Za-z0-9])|`([^`]+?)`/g;
  let last = 0, m;
  while ((m = re.exec(src)) !== null) {
    if (m.index > last) nodes.push({ text: src.slice(last, m.index) });
    if (m[1] != null) nodes.push({ text: m[1], bold: true });
    else if (m[2] != null) nodes.push({ text: m[2], bold: true });
    else if (m[3] != null) nodes.push({ text: m[3], italic: true });
    else if (m[4] != null) nodes.push({ text: m[4], italic: true });
    else if (m[5] != null) nodes.push({ text: m[5], code: true });
    last = re.lastIndex;
  }
  if (last < src.length) nodes.push({ text: src.slice(last) });
  return nodes.length ? nodes : [{ text: "" }];
}

const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBER = /^\s*\d+[.)]\s+(.*)$/;

/**
 * Parse a block of text into an ordered list of blocks:
 *   { type: 'p',  lines: inline[][] }   — paragraph (soft line breaks kept)
 *   { type: 'ul', items: inline[][] }   — bulleted list
 *   { type: 'ol', items: inline[][] }   — numbered list
 * Blank lines separate blocks. Unknown syntax degrades to plain paragraph text.
 */
export function parseMarkdown(text) {
  const lines = String(text ?? "").replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  let para = null, list = null;
  const flushPara = () => { if (para) { blocks.push(para); para = null; } };
  const flushList = () => { if (list) { blocks.push(list); list = null; } };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    const bullet = BULLET.exec(line);
    const number = NUMBER.exec(line);

    if (bullet) {
      flushPara();
      if (!list || list.type !== "ul") { flushList(); list = { type: "ul", items: [] }; }
      list.items.push(parseInline(bullet[1]));
    } else if (number) {
      flushPara();
      if (!list || list.type !== "ol") { flushList(); list = { type: "ol", items: [] }; }
      list.items.push(parseInline(number[1]));
    } else if (line.trim() === "") {
      flushPara();
      flushList();
    } else {
      flushList();
      if (!para) para = { type: "p", lines: [] };
      para.lines.push(parseInline(line));
    }
  }
  flushPara();
  flushList();
  return blocks;
}
