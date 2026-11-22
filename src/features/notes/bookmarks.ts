import { findTextEdit } from "../markdown/styleRanges";
import type { TextEdit } from "../markdown/styleRanges";

export interface NoteBookmark {
  id: string;
  name: string;
  offset: number;
}

export function sourceLines(content: string) {
  let start = 0;
  return content.split(/(\r\n|\r|\n)/).flatMap((part, index) => {
    const offset = start;
    start += part.length;
    return index % 2 === 0 ? [{ offset, text: part }] : [];
  });
}

export function sourceLineIndex(lines: ReturnType<typeof sourceLines>, offset: number) {
  let low = 0;
  let high = lines.length;
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    if (lines[middle].offset <= offset) low = middle;
    else high = middle;
  }
  return low;
}

export function rebaseBookmarks(
  bookmarks: NoteBookmark[] | undefined,
  before: string,
  after: string,
  edit?: TextEdit,
) {
  if (!bookmarks?.length || before === after) return bookmarks;
  const { start, end, text } = edit ?? findTextEdit(before, after);
  const shift = text.length - (end - start);
  const oldLines = sourceLines(before);
  const newLines = sourceLines(after);
  return bookmarks.flatMap((bookmark) => {
    const line = oldLines[sourceLineIndex(oldLines, bookmark.offset)];
    const lineEnd = line.offset + line.text.length;
    let offset = line.offset;
    if (end <= line.offset) {
      offset += shift;
    } else if (start <= line.offset && end >= lineEnd) {
      // A replacement on the same line keeps its bookmark. A larger edit
      // keeps it only if the original line still appears in the replacement.
      if (start === line.offset && end === lineEnd && !/[\r\n]/.test(text)) {
        if (!text.trim()) return [];
      } else {
        const first = sourceLineIndex(newLines, start);
        const last = sourceLineIndex(newLines, start + text.length);
        const match = newLines.slice(first, last + 1).find((candidate) => candidate.text === line.text);
        if (!match) return [];
        offset = match.offset;
      }
    }
    const target = newLines[sourceLineIndex(newLines, offset)];
    return target.text.trim() ? [{ ...bookmark, offset: target.offset }] : [];
  });
}
