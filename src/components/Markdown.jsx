import React from "react";
import { C, SANS, MONO } from "../ui/tokens.js";
import { parseMarkdown } from "../ui/markdown.js";

// Renders the autopsy answer's lightweight markdown in the Null palette.
// Text is parsed to a plain token tree (see ui/markdown.js) and emitted as React
// text nodes + styled spans only — no dangerouslySetInnerHTML, so nothing in the
// model output can inject live HTML.

function Inline({ nodes }) {
  return nodes.map((n, i) => {
    if (n.bold) return <strong key={i} style={{ fontWeight: 650, color: C.text }}>{n.text}</strong>;
    if (n.italic) return <em key={i} style={{ fontStyle: "italic" }}>{n.text}</em>;
    if (n.code) return (
      <code key={i} style={{ fontFamily: MONO, fontSize: "0.9em", color: C.neon, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 4, padding: "1px 5px" }}>{n.text}</code>
    );
    return <React.Fragment key={i}>{n.text}</React.Fragment>;
  });
}

function List({ block, first }) {
  const ordered = block.type === "ol";
  return (
    <ul style={{ listStyle: "none", margin: first ? 0 : "8px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 5 }}>
      {block.items.map((item, i) => (
        <li key={i} style={{ display: "flex", gap: 9, alignItems: "baseline" }}>
          <span aria-hidden="true" style={{ flexShrink: 0, fontFamily: MONO, fontSize: 11, color: C.neon, minWidth: ordered ? 16 : "auto", textAlign: ordered ? "right" : "left" }}>
            {ordered ? `${i + 1}.` : "▸"}
          </span>
          <span style={{ flex: 1 }}><Inline nodes={item} /></span>
        </li>
      ))}
    </ul>
  );
}

export default function Markdown({ text }) {
  const blocks = parseMarkdown(text);
  return (
    <div style={{ fontFamily: SANS, whiteSpace: "normal" }}>
      {blocks.map((block, i) => {
        const first = i === 0;
        if (block.type === "ul" || block.type === "ol") return <List key={i} block={block} first={first} />;
        return (
          <p key={i} style={{ margin: first ? 0 : "8px 0 0" }}>
            {block.lines.map((line, j) => (
              <React.Fragment key={j}>
                {j > 0 && <br />}
                <Inline nodes={line} />
              </React.Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}
