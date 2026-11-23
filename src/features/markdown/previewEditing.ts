import type { TextEdit } from "./styleRanges";

export type PreviewEdit = {
  type: "set-task-checked";
  itemStart: number;
  checked: boolean;
};

/** Locate the marker inside a list item already recognized as a GFM task. */
export function findTaskMarker(content: string, itemStart: number) {
  if (!Number.isInteger(itemStart) || itemStart < 0 || itemStart >= content.length) return null;
  // The Markdown parser omits a leading BOM from its positions.
  const sourceStart = itemStart + (content.startsWith("\uFEFF") ? 1 : 0);
  // List items may start on the following line, including inside a blockquote.
  const marker = /^((?:[-+*]|\d{1,9}[.)])[ \t]*(?:(?:\r\n|\r|\n)[ \t>]*)?\[)([ \txX]|(?:\r\n|\r|\n)[ \t>]*)\](?=[ \t\r\n])/.exec(content.slice(sourceStart));
  if (!marker) return null;
  const start = sourceStart + marker[1].length;
  return { start, end: start + marker[2].length, checked: /^[xX]$/.test(marker[2]) };
}

export function resolvePreviewEdit(content: string, action: PreviewEdit): TextEdit | null {
  switch (action.type) {
    case "set-task-checked": {
      const marker = findTaskMarker(content, action.itemStart);
      if (!marker || marker.checked === action.checked) return null;
      return { start: marker.start, end: marker.end, text: action.checked ? "X" : " " };
    }
    default:
      return null;
  }
}
