import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { UIEvent } from "react";
import type { sourceLines } from "../notes/bookmarks";
import type { ViewMode } from "../settings/types";

type Pane = "edit" | "preview";
type Lines = ReturnType<typeof sourceLines>;
type Anchor = { offset: number; inset: number };

// Use the textarea's actual wrap width and font to locate source lines after soft wrapping.
function measureEditor<T>(editor: HTMLTextAreaElement, lines: Lines, measure: (top: (line: number) => number) => T) {
  const style = getComputedStyle(editor);
  const mirror = document.createElement("div");
  Object.assign(mirror.style, {
    position: "fixed", top: "0", left: "0", visibility: "hidden", pointerEvents: "none",
    boxSizing: "border-box", width: `${editor.clientWidth}px`, padding: style.padding,
    font: style.font, lineHeight: style.lineHeight, letterSpacing: style.letterSpacing,
    wordSpacing: style.wordSpacing, tabSize: style.tabSize, direction: style.direction,
    whiteSpace: "pre-wrap", overflowWrap: "break-word",
  });
  const text = document.createTextNode(lines.map((line) => line.text).join("\n") + "\u200b");
  mirror.append(text);
  document.body.append(mirror);
  try {
    const range = document.createRange();
    // Textareas normalize newlines to LF. Keep document offsets for preview lookup.
    let offset = 0;
    const starts = lines.map((line) => {
      const start = offset;
      offset += line.text.length + 1;
      return start;
    });
    range.setStart(text, 0);
    range.collapse(true);
    const origin = range.getBoundingClientRect().top - Number.parseFloat(style.paddingTop || "0");
    return measure((line) => {
      range.setStart(text, starts[line]);
      range.collapse(true);
      return range.getBoundingClientRect().top - origin;
    });
  } finally {
    mirror.remove();
  }
}

function editorAnchor(editor: HTMLTextAreaElement, lines: Lines): Anchor {
  return measureEditor(editor, lines, (top) => {
    let first = 0;
    let end = lines.length;
    while (first + 1 < end) {
      const middle = Math.floor((first + end) / 2);
      if (top(middle) <= editor.scrollTop) first = middle;
      else end = middle;
    }
    return { offset: lines[first].offset, inset: editor.scrollTop - top(first) };
  });
}

function previewAnchor(preview: HTMLDivElement): Anchor | null {
  const viewportTop = preview.getBoundingClientRect().top;
  let last: HTMLElement | undefined;
  for (const line of preview.querySelectorAll<HTMLElement>("[data-preview-line]")) {
    last = line;
    if (line.getBoundingClientRect().bottom > viewportTop) break;
  }
  if (!last) return null;
  const offset = Number(last.dataset.previewLine);
  const first = preview.querySelector(`[data-preview-line="${offset}"]`)!;
  return { offset, inset: viewportTop - first.getBoundingClientRect().top };
}

function restoreEditor(editor: HTMLTextAreaElement, lines: Lines, anchor: Anchor, inset: number) {
  const line = lines.findIndex(({ offset }) => offset === anchor.offset);
  if (line < 0) return;
  editor.scrollTop = measureEditor(editor, lines, (top) => {
    const start = top(line);
    const end = line + 1 < lines.length ? top(line + 1) : editor.scrollHeight;
    return start + Math.min(inset, Math.max(0, end - start - 1));
  });
}

function restorePreview(preview: HTMLDivElement, anchor: Anchor, inset: number) {
  const exact = preview.querySelector<HTMLElement>(`[data-preview-line="${anchor.offset}"]`);
  const lines = exact ? [] : Array.from(preview.querySelectorAll<HTMLElement>("[data-preview-line]"));
  const line = exact ?? lines.find((line) => Number(line.dataset.previewLine) > anchor.offset) ?? lines[lines.length - 1];
  if (!line) return;
  const rect = line.getBoundingClientRect();
  const offset = Number(line.dataset.previewLine);
  let bottom = rect.bottom;
  if (inset > 0 && offset === anchor.offset) {
    for (const part of preview.querySelectorAll(`[data-preview-line="${offset}"]`)) {
      bottom = Math.max(bottom, part.getBoundingClientRect().bottom);
    }
  }
  preview.scrollTop += rect.top - preview.getBoundingClientRect().top
    + (offset === anchor.offset ? Math.min(inset, Math.max(0, bottom - rect.top - 1)) : 0);
}

export function useNoteView(initialMode: ViewMode, noteId: string | null, lines: Lines) {
  const [viewMode, updateViewMode] = useState(initialMode);
  const viewRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLTextAreaElement>(null);
  const previewScrollRef = useRef<HTMLDivElement>(null);
  const layout = useRef({ viewMode, noteId, lines });
  const lastScrolled = useRef<Pane>("edit");
  const scrollPositions = useRef({ edit: 0, preview: 0 });
  const pending = useRef<{ noteId: string; source: Pane; anchor: Anchor | null } | null>(null);

  const setViewMode = useCallback((mode: ViewMode, preservePosition = true) => {
    const current = layout.current;
    if (mode === current.viewMode) {
      pending.current = null;
      updateViewMode(mode);
      return;
    }
    if (current.noteId && preservePosition) {
      const source = current.viewMode === "split" ? lastScrolled.current : current.viewMode;
      const editor = contentRef.current;
      const preview = previewScrollRef.current;
      const anchor = source === "edit"
        ? editor?.scrollTop ? editorAnchor(editor, current.lines) : null
        : preview?.scrollTop ? previewAnchor(preview) : null;
      pending.current = { noteId: current.noteId, source, anchor };
    } else {
      pending.current = null;
    }
    updateViewMode(mode);
  }, []);

  function trackScroll(pane: Pane, event: UIEvent<HTMLElement>) {
    const mode = layout.current.viewMode;
    const top = event.currentTarget.scrollTop;
    if ((mode === pane || mode === "split") && scrollPositions.current[pane] !== top) {
      scrollPositions.current[pane] = top;
      lastScrolled.current = pane;
    }
  }

  useLayoutEffect(() => {
    const previous = layout.current;
    layout.current = { viewMode, noteId, lines };
    const editor = contentRef.current;
    const preview = previewScrollRef.current;
    const noteChanged = previous.noteId !== noteId;
    if (noteChanged) lastScrolled.current = "edit";
    if (previous.viewMode === viewMode && !noteChanged) return;

    const position = pending.current;
    pending.current = null;
    if (position && position.noteId === noteId) {
      const { anchor, source } = position;
      lastScrolled.current = source;
      if (editor && viewMode !== "preview") {
        if (anchor) restoreEditor(editor, lines, anchor, source === "edit" ? anchor.inset : 0);
        else editor.scrollTop = 0;
      }
      if (preview && viewMode !== "edit") {
        if (anchor) restorePreview(preview, anchor, source === "preview" ? anchor.inset : 0);
        else preview.scrollTop = 0;
      }
    }
    scrollPositions.current = { edit: editor?.scrollTop ?? 0, preview: preview?.scrollTop ?? 0 };

    if (previous.viewMode === viewMode || noteChanged || !noteId) return;
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      viewRef.current?.animate?.(
        [{ opacity: 0.76, transform: "translateX(4px)" }, { opacity: 1, transform: "translateX(0)" }],
        { duration: 180, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
      );
    }
  }, [viewMode, noteId, lines]);

  return { viewMode, setViewMode, viewRef, contentRef, previewScrollRef, trackScroll };
}
