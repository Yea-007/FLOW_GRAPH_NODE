import { fromMarkdown } from "mdast-util-from-markdown";
import type { StyleRange } from "./styleRanges";

export interface EditorDocument { content: string; ranges: StyleRange[] }

/** Migrate only parsed links. Fenced/inline code containing the same text stays intact. */
export function migrateLegacyStyles(content: string): EditorDocument {
  const replacements: { start: number; end: number; text: string; style: Partial<StyleRange> }[] = [];
  const visit = (node: ReturnType<typeof fromMarkdown> | ReturnType<typeof fromMarkdown>["children"][number]) => {
    if (node.type === "link" && /^#floral-/.test(node.url)) {
      const start = node.position?.start.offset, end = node.position?.end.offset;
      if (start !== undefined && end !== undefined) {
        const raw = content.slice(start, end);
        const match = raw.match(/^\[([\s\S]*)\]\(#floral-((?:(?:color|background|size)-(?:red|orange|green|blue|purple|yellow|pink|12|16|20|24))(?:-(?:color|background|size)-(?:red|orange|green|blue|purple|yellow|pink|12|16|20|24))*)\)$/);
        if (match) {
          const style: Partial<StyleRange> = {};
          for (const token of match[2].match(/(?:color|background|size)-(?:red|orange|green|blue|purple|yellow|pink|12|16|20|24)/g) ?? []) {
            const [kind, value] = token.split("-");
            if (kind === "size") style.size = Number(value);
            else if (kind === "color") style.color = value;
            else style.background = value;
          }
          replacements.push({ start, end, text: match[1], style });
          return;
        }
      }
    }
    if ("children" in node) for (const child of node.children) visit(child);
  };
  visit(fromMarkdown(content));
  let cursor = 0, result = "";
  const ranges: StyleRange[] = [];
  for (const replacement of replacements.sort((a, b) => a.start - b.start)) {
    result += content.slice(cursor, replacement.start);
    ranges.push({ ...replacement.style, start: result.length, end: result.length + replacement.text.length });
    result += replacement.text;
    cursor = replacement.end;
  }
  return { content: result + content.slice(cursor), ranges };
}
