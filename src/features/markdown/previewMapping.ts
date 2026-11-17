import type { Root, Element, Text, RootContent } from "hast";
import type { StyleRange } from "./styleRanges";

/** Wrap source-backed text after Markdown parsing, before KaTeX generates display-only nodes. */
export function mappedPreviewPlugin(content: string, ranges: StyleRange[]) {
  return () => (tree: Root) => {
    function walk(parent: Root | Element) {
      const children: RootContent[] = [];
      for (const node of parent.children) {
        if (node.type === "element") {
          if (!["code", "pre"].includes(node.tagName) && !String(node.properties.className ?? "").includes("math")) walk(node);
          children.push(node);
        } else if (node.type === "text") {
          const start = node.position?.start.offset, end = node.position?.end.offset;
          if (start === undefined || end === undefined || content.slice(start, end) !== node.value) { children.push(node); continue; }
          const points = new Set([start, end]);
          for (const r of ranges) { if (r.start > start && r.start < end) points.add(r.start); if (r.end > start && r.end < end) points.add(r.end); }
          const boundaries = [...points].sort((a,b) => a-b);
          for (let i = 0; i < boundaries.length - 1; i++) {
            const a = boundaries[i], b = boundaries[i+1];
            const properties: Element["properties"] = { dataSourceStart: a, dataSourceEnd: b };
            for (const range of ranges.filter(r => r.start <= a && r.end >= b)) {
              if (range.color) properties.dataTextColor = range.color;
              if (range.background) properties.dataTextBackground = range.background;
              if (range.size) properties.dataTextSize = range.size;
            }
            children.push({ type: "element", tagName: "span", properties, children: [{ type: "text", value: content.slice(a,b) } as Text] });
          }
        } else children.push(node);
      }
      parent.children = children as Element["children"];
    }
    walk(tree);
  };
}

export function sourceSelection(root: HTMLElement): { start: number; end: number } | null {
  const selection = window.getSelection();
  if (!selection?.rangeCount || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  function offset(node: Node, offset: number): number | null {
    const element = node.nodeType === Node.ELEMENT_NODE ? node as HTMLElement : node.parentElement;
    const span = element?.closest<HTMLElement>("[data-source-start]");
    if (!span || !root.contains(span)) return null;
    const prefix = document.createRange(); prefix.selectNodeContents(span); prefix.setEnd(node, offset);
    return Number(span.dataset.sourceStart) + prefix.toString().length;
  }
  const start = offset(range.startContainer, range.startOffset), end = offset(range.endContainer, range.endOffset);
  return start === null || end === null ? null : { start, end };
}
