import { describe, it, expect } from "vitest";
import { parseMarkdown, parseInline } from "../ui/markdown.js";

// The autopsy chat renders the model's lightweight markdown (bold, bullets,
// numbered lists, soft line breaks). These lock the parser so a raw ** or a
// leading - can never leak back into the bubble, and so plain prose stays plain.

const text = (nodes) => nodes.map((n) => n.text).join("");

describe("parseInline", () => {
  it("extracts **bold** and leaves no asterisks in the text", () => {
    const nodes = parseInline("costs cut the **full-sample Sharpe** by 0.4");
    expect(nodes.some((n) => n.bold && n.text === "full-sample Sharpe")).toBe(true);
    expect(text(nodes)).not.toContain("*");
    expect(text(nodes)).toBe("costs cut the full-sample Sharpe by 0.4");
  });

  it("treats __x__ as bold and `x` as code", () => {
    expect(parseInline("__dead__").some((n) => n.bold && n.text === "dead")).toBe(true);
    expect(parseInline("run `npm test`").some((n) => n.code && n.text === "npm test")).toBe(true);
  });

  it("parses *italic* / _italic_ without eating mid-word underscores or math", () => {
    expect(parseInline("*only* one split").some((n) => n.italic && n.text === "only")).toBe(true);
    // mid-identifier underscores must NOT become italics
    expect(parseInline("oos_sharpe and is_sharpe")).toEqual([{ text: "oos_sharpe and is_sharpe" }]);
  });

  it("never returns an empty array", () => {
    expect(parseInline("").length).toBeGreaterThan(0);
    expect(parseInline(null).length).toBeGreaterThan(0);
  });
});

describe("parseMarkdown blocks", () => {
  it("groups dash / star / plus bullets into a single ul", () => {
    const blocks = parseMarkdown("Two problems:\n- costs\n* overfitting\n+ turnover");
    expect(blocks[0]).toMatchObject({ type: "p" });
    const ul = blocks[1];
    expect(ul.type).toBe("ul");
    expect(ul.items.map((it) => text(it))).toEqual(["costs", "overfitting", "turnover"]);
  });

  it("parses numbered lists into an ol and strips the markers", () => {
    const blocks = parseMarkdown("1. first\n2) second");
    expect(blocks[0].type).toBe("ol");
    expect(blocks[0].items.map((it) => text(it))).toEqual(["first", "second"]);
  });

  it("keeps bold inside list items", () => {
    const blocks = parseMarkdown("- the **costs** ate it");
    expect(blocks[0].type).toBe("ul");
    expect(blocks[0].items[0].some((n) => n.bold && n.text === "costs")).toBe(true);
  });

  it("keeps consecutive prose lines as soft breaks inside one paragraph", () => {
    const blocks = parseMarkdown("line one\nline two");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("p");
    expect(blocks[0].lines).toHaveLength(2);
  });

  it("splits paragraphs on blank lines", () => {
    const blocks = parseMarkdown("para one\n\npara two");
    expect(blocks.filter((b) => b.type === "p")).toHaveLength(2);
  });

  it("leaves plain prose (em-dashes, mid-word hyphens) as one clean paragraph with no stray markers", () => {
    const prose = "Costs weren't the killer — full-sample Sharpe is 1.20 before costs and 1.18 after, barely moved.";
    const blocks = parseMarkdown(prose);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("p");
    const rendered = blocks[0].lines.map((l) => text(l)).join("");
    expect(rendered).toBe(prose);
    expect(rendered).not.toMatch(/^\s*[-*]\s/);
  });

  it("handles empty / nullish input without throwing", () => {
    expect(parseMarkdown("")).toEqual([]);
    expect(parseMarkdown(null)).toEqual([]);
  });
});
