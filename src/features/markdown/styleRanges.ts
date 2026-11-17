/** Offsets are UTF-16 code units into the Markdown source, end exclusive. */
export interface StyleRange {
  start: number;
  end: number;
  color?: string;
  background?: string;
  size?: number;
}

export interface TextEdit { start: number; end: number; text: string }

/** A single contiguous change. The unchanged prefix and suffix remain anchored. */
export function findTextEdit(before: string, after: string): TextEdit {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  // Do not split a surrogate pair when two emoji share a high surrogate.
  if (start > 0 && start < before.length && /[\uD800-\uDBFF]/.test(before[start - 1]) && /[\uDC00-\uDFFF]/.test(before[start])) start--;
  let oldEnd = before.length;
  let newEnd = after.length;
  while (oldEnd > start && newEnd > start && before[oldEnd - 1] === after[newEnd - 1]) { oldEnd--; newEnd--; }
  if (oldEnd < before.length && oldEnd > start && /[\uDC00-\uDFFF]/.test(before[oldEnd]) && /[\uD800-\uDBFF]/.test(before[oldEnd - 1])) { oldEnd++; newEnd++; }
  return { start, end: oldEnd, text: after.slice(start, newEnd) };
}

/** Preserve styles on surviving text; inserted text inherits a range only strictly inside it. */
export function rebaseStyles(ranges: StyleRange[], edit: TextEdit): StyleRange[] {
  const { start, end, text } = edit;
  const delta = text.length - (end - start);
  const result: StyleRange[] = [];
  for (const range of ranges) {
    if (range.end <= start) { result.push({ ...range }); continue; }
    if (range.start >= end && (start !== end || range.start >= start)) {
      result.push({ ...range, start: range.start + delta, end: range.end + delta }); continue;
    }
    const left = range.start < start;
    const right = range.end > end;
    if (range.start <= start && range.end >= end) result.push({ ...range, end: range.end + delta });
    else if (left) result.push({ ...range, end: start });
    else if (right) result.push({ ...range, start: start + text.length, end: range.end + delta });
  }
  return result.filter((range) => range.end > range.start);
}

/** Apply or clear one property without disturbing other properties or adjacent text. */
export function setRangeStyle(ranges: StyleRange[], start: number, end: number, property: "color" | "background" | "size", value: string | number | undefined): StyleRange[] {
  if (end <= start) return ranges;
  const boundaries = new Set([start, end]);
  for (const r of ranges) { boundaries.add(r.start); boundaries.add(r.end); }
  const points = [...boundaries].sort((a, b) => a - b);
  const result: StyleRange[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i], b = points[i + 1];
    const previous = ranges.filter((r) => r.start <= a && r.end >= b);
    const combined: StyleRange = { start: a, end: b };
    for (const r of previous) {
      if (r.color !== undefined) combined.color = r.color;
      if (r.background !== undefined) combined.background = r.background;
      if (r.size !== undefined) combined.size = r.size;
    }
    if (a >= start && b <= end) {
      if (property === "size") combined.size = typeof value === "number" ? value : undefined;
      else combined[property] = typeof value === "string" ? value : undefined;
    }
    if (combined.color === undefined && combined.background === undefined && combined.size === undefined) continue;
    const last = result[result.length - 1];
    if (last && last.end === a && last.color === combined.color && last.background === combined.background && last.size === combined.size) last.end = b;
    else result.push(combined);
  }
  return result;
}
