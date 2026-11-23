import { createContext, memo, useContext, useEffect, useLayoutEffect, useMemo, useState, useRef } from "react";
import type { MouseEvent, RefObject, UIEventHandler } from "react";
import { mappedPreviewPlugin, sourceSelection } from "./previewMapping";
import type { PreviewEdit } from "./previewEditing";
import type { StyleRange } from "./styleRanges";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { Components } from "react-markdown";
import { resolveImagePath } from "./imagePaths";
import { readFileBase64 } from "../notes/api";
import type { NoteBookmark } from "../notes/bookmarks";

interface MarkdownPreviewProps {
  content: string;
  fontSize?: number;
  notesDir?: string;
  ranges?: StyleRange[];
  onUndo?: () => void;
  onRedo?: () => void;
  onStyle?: (start: number, end: number, property: "color" | "background" | "size", value: string | number | undefined) => void;
  onPreviewEdit?: (action: PreviewEdit) => void;
  bookmarks?: NoteBookmark[];
  onMarkBookmark?: (offset: number) => void;
  bookmarkJump?: { offset: number } | null;
  scrollRef?: RefObject<HTMLDivElement | null>;
  onScroll?: UIEventHandler<HTMLDivElement>;
  visible?: boolean;
}

const remarkPlugins = [remarkGfm, remarkMath];
const emptyRanges: StyleRange[] = [];
const PreviewEditContext = createContext<MarkdownPreviewProps["onPreviewEdit"]>(undefined);

const TaskCheckbox: NonNullable<Components["input"]> = ({ checked, node }) => {
  const onPreviewEdit = useContext(PreviewEditContext);
  const itemStart = node?.properties.dataPreviewTaskStart;
  const editable = onPreviewEdit && typeof itemStart === "number";

  return (
    <input
      type="checkbox"
      checked={Boolean(checked)}
      aria-label="任务完成状态"
      aria-disabled={!editable}
      tabIndex={editable ? undefined : -1}
      readOnly={!editable}
      data-preview-line={node?.properties.dataPreviewLine as number | undefined}
      onChange={editable ? (event) => onPreviewEdit({
        type: "set-task-checked", itemStart, checked: event.currentTarget.checked,
      }) : undefined}
      className={`mr-1.5 accent-bamboo w-3.5 h-3.5 align-middle ${editable ? "cursor-pointer" : "cursor-default"}`}
    />
  );
};

function ImgRenderer({ src, alt, notesDir }: { src?: string; alt?: string; notesDir?: string }) {
  const targetPath = resolveImagePath(src ?? "", notesDir);
  const [loaded, setLoaded] = useState<{ path: string; src: string | null; error: boolean } | null>(null);
  const resolvedSrc = loaded?.path === targetPath ? loaded.src : null;
  const error = loaded?.path === targetPath && loaded.error;

  useEffect(() => {
    if (!targetPath) return;
    let cancelled = false;
    if (/^(https?:|data:)/i.test(targetPath)) {
      setLoaded({ path: targetPath, src: targetPath, error: false });
    } else {
      readFileBase64(targetPath)
        .then(dataUrl => { if (!cancelled) setLoaded({ path: targetPath, src: dataUrl, error: false }); })
        .catch(() => { if (!cancelled) setLoaded({ path: targetPath, src: null, error: true }); });
    }
    return () => { cancelled = true; };
  }, [targetPath]);

  if (error || (!resolvedSrc && targetPath)) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 my-1 text-[12px] text-ink-ghost bg-paper-warm rounded border border-paper-deep/30 select-none">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <path d="m21 15-5-5L5 21" />
        </svg>
        <span className="truncate max-w-[200px]">{error ? `图片加载失败：${alt || targetPath}` : "图片加载中…"}</span>
      </span>
    );
  }

  if (!resolvedSrc) return null;

  return (
    <img
      key={targetPath}
      src={resolvedSrc}
      alt={alt}
      className="max-w-full h-auto my-2 rounded cursor-pointer hover:opacity-90 transition-opacity"
      onClick={() => {
        if (targetPath.startsWith("http://") || targetPath.startsWith("https://")) {
          openUrl(targetPath);
        } else {
          openUrl("file:///" + targetPath.replace(/\\/g, "/"));
        }
      }}
      onError={() => setLoaded({ path: targetPath, src: null, error: true })}
    />
  );
}

function buildComponents(notesDir?: string): Components {
  return {
    h1: ({ children }) => (
      <h1 className="text-[22px] font-display font-bold text-ink mt-6 mb-4 tracking-wide">
        {children}
      </h1>
    ),
    h2: ({ children }) => (
      <h2 className="text-[17px] font-display font-bold text-ink mt-7 mb-3 tracking-wide">
        {children}
      </h2>
    ),
    h3: ({ children }) => (
      <h3 className="text-[15px] font-display font-bold text-ink mt-5 mb-2 tracking-wide">
        {children}
      </h3>
    ),
    h4: ({ children }) => (
      <h4 className="text-[14px] font-display font-semibold text-ink mt-4 mb-2 tracking-wide">
        {children}
      </h4>
    ),
    p: ({ children }) => (
      <p className="text-ink-soft leading-[1.9]">{children}</p>
    ),
    strong: ({ children }) => (
      <strong className="font-semibold text-ink">{children}</strong>
    ),
    em: ({ children }) => (
      <em className="italic text-bamboo-light">{children}</em>
    ),
    blockquote: ({ children }) => (
      <blockquote className="border-l-2 border-bamboo/40 pl-4 my-3 text-ink-soft/80 italic leading-[1.9]">
        {children}
      </blockquote>
    ),
    ul: ({ children }) => (
      <ul className="ml-4 text-ink-soft leading-[1.9] list-disc list-outside marker:text-bamboo/40">
        {children}
      </ul>
    ),
    ol: ({ children }) => (
      <ol className="ml-4 text-ink-soft leading-[1.9] list-decimal list-outside marker:text-bamboo/50 marker:font-mono marker:text-[12px]">
        {children}
      </ol>
    ),
    li: ({ children }) => (
      <li className="text-ink-soft leading-[1.9]">{children}</li>
    ),
    hr: ({ node }) => (
      <hr data-preview-line={node?.properties.dataPreviewLine as number | undefined} className="my-6 border-none h-px bg-gradient-to-r from-transparent via-paper-deep to-transparent" />
    ),
    code: ({ node, children }) => {
      const isBlock = node?.properties.dataPreviewCodeBlock === true;
      if (isBlock) {
        return (
          <code className="text-[12px] font-mono text-ink-soft leading-[1.8] whitespace-pre">
            {children}
          </code>
        );
      }
      return (
        <code data-preview-line={node?.properties.dataPreviewLine as number | undefined} className="px-1.5 py-0.5 text-[12px] font-mono bg-paper-warm rounded text-bamboo">
          {children}
        </code>
      );
    },
    pre: ({ children }) => (
      <pre className="my-3 px-4 py-3 rounded bg-paper-warm/80 overflow-x-auto">
        {children}
      </pre>
    ),
    a: ({ href, children }) => {
      const match = href?.match(/^#floral-((?:(?:color|background|size)-(?:red|orange|green|blue|purple|yellow|pink|12|16|20|24))(?:-(?:color|background|size)-(?:red|orange|green|blue|purple|yellow|pink|12|16|20|24))*)$/);
      if (match) {
        const colors: Record<string, string> = { red: "var(--format-red)", orange: "var(--format-orange)", green: "var(--format-green)", blue: "var(--format-blue)", purple: "var(--format-purple)" };
        const backgrounds: Record<string, string> = { yellow: "#fff29d", pink: "#ffd3d8", green: "#c5efca", blue: "#cedeff", purple: "#e2d0ff" };
        const style: React.CSSProperties = {};
        for (const token of match[1].match(/(?:color|background|size)-(?:red|orange|green|blue|purple|yellow|pink|12|16|20|24)/g) ?? []) {
          const [kind, value] = token.split("-");
          if (kind === "color" && colors[value]) style.color = colors[value];
          if (kind === "background" && backgrounds[value]) { style.backgroundColor = backgrounds[value]; style.color = "#252525"; }
          if (kind === "size" && /^\d+$/.test(value)) style.fontSize = `${value}px`;
        }
        return <span style={style}>{children}</span>;
      }
      return <a
        href={href}
        onClick={(e) => {
          e.preventDefault();
          if (href) openUrl(href);
        }}
        className="text-bamboo hover:text-bamboo-light underline underline-offset-2 cursor-pointer"
      >
        {children}
      </a>;
    },
    img: ({ src, alt, node }) => (
      <span data-preview-line={node?.properties.dataPreviewLine as number | undefined} className="block w-fit max-w-full">
        <ImgRenderer src={src} alt={alt} notesDir={notesDir} />
      </span>
    ),
    table: ({ children }) => (
      <div className="my-3 overflow-x-auto">
        <table className="w-full text-[13px] border-collapse">{children}</table>
      </div>
    ),
    th: ({ children }) => (
      <th className="text-left px-3 py-1.5 border-b border-paper-deep/30 font-semibold text-ink text-[12px]">
        {children}
      </th>
    ),
    td: ({ children }) => (
      <td className="px-3 py-1.5 border-b border-paper-deep/15 text-ink-soft">
        {children}
      </td>
    ),
    input: TaskCheckbox,
  };
}

export const MarkdownPreview = memo(function MarkdownPreview({
  content, fontSize = 14, notesDir, ranges = emptyRanges, onStyle, onPreviewEdit, onUndo, onRedo,
  bookmarks, onMarkBookmark, bookmarkJump, scrollRef, onScroll, visible = true,
}: MarkdownPreviewProps) {
  const root = useRef<HTMLDivElement>(null);
  const localScrollRef = useRef<HTMLDivElement>(null);
  const scrollerRef = scrollRef ?? localScrollRef;
  const [selection, setSelection] = useState<{ start: number; end: number } | null>(null);
  useEffect(() => { setSelection(null); }, [content]);
  const components = useMemo(() => buildComponents(notesDir), [notesDir]);
  const preview = useMemo(() => (
    !visible ? null : content.trim() ? (
      <Markdown remarkPlugins={remarkPlugins} rehypePlugins={[mappedPreviewPlugin(content, ranges), rehypeKatex]} components={components}>{content}</Markdown>
    ) : <p className="text-ink-ghost leading-[1.9]">在编辑区开始写作，即可看到预览</p>
  ), [components, content, ranges, visible]);

  useLayoutEffect(() => {
    const marked = bookmarks?.flatMap(({ offset }) => Array.from(
      root.current?.querySelectorAll(`[data-preview-line="${offset}"]`) ?? [],
    )) ?? [];
    for (const element of marked) element.setAttribute("data-bookmarked", "");
    return () => { for (const element of marked) element.removeAttribute("data-bookmarked"); };
  }, [bookmarks, preview]);

  useLayoutEffect(() => {
    if (!bookmarkJump) return;
    const target = root.current?.querySelector(`[data-preview-line="${bookmarkJump.offset}"]`);
    const scroller = scrollerRef.current;
    if (!target || !scroller) return;
    const { top, height } = target.getBoundingClientRect();
    scroller.scrollTo({
      top: scroller.scrollTop + top - scroller.getBoundingClientRect().top - (scroller.clientHeight - height) / 2,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
  }, [bookmarkJump, scrollerRef]);

  function pickBookmark(event: MouseEvent<HTMLDivElement>) {
    if (!onMarkBookmark) return;
    event.preventDefault();
    event.stopPropagation();
    const target = event.target as HTMLElement;
    let line = target.closest<HTMLElement>("[data-preview-line]");
    if (!line) {
      line = Array.from(target.querySelectorAll<HTMLElement>("[data-preview-line]")).find((candidate) =>
        Array.from(candidate.getClientRects()).some((rect) => event.clientY >= rect.top && event.clientY < rect.bottom),
      ) ?? null;
    }
    if (line?.dataset.previewLine !== undefined) onMarkBookmark(Number(line.dataset.previewLine));
  }

  return <div className="flex min-h-0 flex-1 flex-col">
    {onStyle && <div className="mx-6 flex shrink-0 flex-wrap gap-1 border-b border-paper-deep py-2" role="toolbar" aria-label="预览文字格式">
      {(["color", "background", "size"] as const).map(property => <select key={property} aria-label={property === "color" ? "文字颜色" : property === "background" ? "背景颜色" : "文字大小"} className="format-select" disabled={!selection} value="" onChange={e => { if (selection) onStyle(selection.start, selection.end, property, e.target.value === "default" ? undefined : property === "size" ? Number(e.target.value) : e.target.value); }}>
        <option value="" disabled>{property === "color" ? "文字颜色" : property === "background" ? "背景颜色" : "字号"}</option><option value="default">恢复默认</option>
        {(property === "size" ? [["12","12"],["16","16"],["20","20"],["24","24"]] : property === "color" ? [["red","红色"],["orange","橙色"],["green","绿色"],["blue","蓝色"],["purple","紫色"]] : [["yellow","黄色"],["pink","粉色"],["green","绿色"],["blue","蓝色"],["purple","紫色"]]).map(([v,label]) => <option key={v} value={v}>{label}</option>)}
      </select>)}
      <button type="button" title="撤销 Ctrl+Z" className="format-select" onClick={onUndo}>撤销</button>
      <button type="button" title="重做 Ctrl+Y" className="format-select" onClick={onRedo}>重做</button>
      {onMarkBookmark ? (
        <span role="status" className="text-xs text-bamboo self-center">点击预览中的一行添加书签，按 Esc 取消</span>
      ) : <span className="text-xs text-ink-faint self-center">选中文字设置格式 · 点击任务框更新状态</span>}
    </div>}
    <div ref={scrollerRef} onScroll={onScroll} role="region" aria-label="笔记预览" className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-2">
      <div
        ref={root}
        tabIndex={onStyle ? 0 : undefined}
        data-bookmark-picking={onMarkBookmark ? "true" : undefined}
        className="max-w-[560px] font-body"
        style={{ fontSize: `${fontSize}px` }}
        onClickCapture={pickBookmark}
        onMouseUp={() => { if (root.current && !onMarkBookmark) setSelection(sourceSelection(root.current)); }}
        onKeyUp={() => { if (root.current) setSelection(sourceSelection(root.current)); }}
      >
        <PreviewEditContext.Provider value={onMarkBookmark ? undefined : onPreviewEdit}>
          {preview}
        </PreviewEditContext.Provider>
      </div>
    </div>
  </div>;
// Keep the last rendered preview while hidden, and apply any pending edits when it becomes visible.
}, (_previous, next) => next.visible === false);
