import type { Root, Element, Text, RootContent } from "hast";
import { sourceLineIndex, sourceLines } from "../notes/bookmarks";
import { findTaskMarker } from "./previewEditing";
import type { StyleRange } from "./styleRanges";

function element(tagName: string, properties: Element["properties"], children: Element["children"]): Element {
  return { type: "element", tagName, properties, children };
}

function isMath(node: Element) {
  const classes = node.properties.className;
  return Array.isArray(classes) && classes.includes("language-math");
}

/** Map visible rows before KaTeX replaces nodes. Render soft breaks here to retain source positions. */
export function mappedPreviewPlugin(content: string, ranges: StyleRange[]) {
  const lines = sourceLines(content);
  return () => (tree: Root) => {
    function styledText(value: string, lineOffset: number, start: number | undefined) {
      const previewLine = { dataPreviewLine: lineOffset };
      if (start === undefined) return [element("span", previewLine, [{ type: "text", value }])];

      const end = start + value.length;
      const points = new Set([start, end]);
      for (const range of ranges) {
        if (range.start > start && range.start < end) points.add(range.start);
        if (range.end > start && range.end < end) points.add(range.end);
      }
      const boundaries = [...points].sort((a, b) => a - b);
      return boundaries.slice(0, -1).map((from, index) => {
        const to = boundaries[index + 1];
        const properties: Element["properties"] = { ...previewLine, dataSourceStart: from, dataSourceEnd: to };
        for (const range of ranges.filter((range) => range.start <= from && range.end >= to)) {
          if (range.color) properties.dataTextColor = range.color;
          if (range.background) properties.dataTextBackground = range.background;
          if (range.size) properties.dataTextSize = range.size;
        }
        return element("span", properties, [{ type: "text", value: content.slice(from, to) }]);
      });
    }

    function mapText(node: Text): RootContent[] {
      const position = node.position;
      const start = position?.start.offset;
      const end = position?.end.offset;
      if (!position || start === undefined || end === undefined) return [node];

      const first = position.start.line - 1;
      if (position.start.line === position.end.line) {
        return styledText(node.value, lines[first].offset, content.slice(start, end) === node.value ? start : undefined);
      }

      return node.value.split(/\r\n|\r|\n/).flatMap((value, index) => {
        const line = lines[first + index];
        if (!line) return [];
        const from = Math.max(line.offset, start);
        const to = Math.min(line.offset + line.text.length, end);
        const source = content.slice(from, to);
        // Subsequent lines can have quote markers or list indentation omitted by Markdown.
        const prefixLength = source.length - value.length;
        const matches = source.endsWith(value) && /^(?:[\t ]*>[\t ]?)*[\t ]*$/.test(source.slice(0, prefixLength));
        const parts = value ? styledText(value, line.offset, matches ? from + prefixLength : undefined) : [];
        return index === 0 ? parts : [element("br", {}, []), ...parts];
      });
    }

    function mapCode(node: Element, lineIndex: number, offset: number): Element {
      const code = node.children[0];
      if (code?.type !== "element" || code.tagName !== "code") return node;
      if (isMath(code)) return element("div", { dataPreviewLine: offset }, [node]);

      const text = code.children[0];
      if (text?.type !== "text") return node;
      const fence = content.slice(node.position?.start.offset, lines[lineIndex].offset + lines[lineIndex].text.length);
      const start = lineIndex + (/^[\t ]*(?:`{3,}|~{3,})/.test(fence) ? 1 : 0);
      code.properties.dataPreviewCodeBlock = true;
      code.children = text.value.split(/(\r\n|\r|\n)/).map((value, index) => {
        const line = lines[start + index / 2];
        const part: Text = { type: "text", value };
        return line && value ? element("span", { dataPreviewLine: line.offset }, [part]) : part;
      });
      return node;
    }

    function mapTask(node: Element) {
      const classes = node.properties.className;
      const itemStart = node.position?.start.offset;
      if (itemStart === undefined || !Array.isArray(classes) || !classes.includes("task-list-item")) return;

      // GFM puts the generated input directly in a tight item, or in its first paragraph.
      const first = node.children.find((child) => child.type === "element");
      const checkbox = first?.tagName === "p" ? first.children[0] : first;
      if (checkbox?.type !== "element" || checkbox.tagName !== "input" || checkbox.properties.type !== "checkbox") return;
      const marker = findTaskMarker(content, itemStart);
      if (marker && marker.checked === checkbox.properties.checked) {
        checkbox.properties.dataPreviewTaskStart = itemStart;
        checkbox.properties.dataPreviewLine = lines[sourceLineIndex(lines, marker.start)].offset;
      }
    }

    function mapNode(node: RootContent): RootContent[] {
      if (node.type === "text") return mapText(node);
      if (node.type !== "element") return [node];

      const index = (node.position?.start.line ?? 0) - 1;
      const line = lines[index];
      if (line) {
        if (node.tagName === "pre") return [mapCode(node, index, line.offset)];
        if (isMath(node)) return [element("span", { dataPreviewLine: line.offset }, [node])];
        if (["code", "img", "hr", "tr"].includes(node.tagName)) node.properties.dataPreviewLine = line.offset;
        if (node.tagName === "li") mapTask(node);
      }
      node.children = node.children.flatMap(mapNode) as Element["children"];
      return [node];
    }

    tree.children = tree.children.flatMap(mapNode);
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
