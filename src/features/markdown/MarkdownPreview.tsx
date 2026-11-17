import { useEffect, useMemo, useState, useRef } from "react";
import { mappedPreviewPlugin, sourceSelection } from "./previewMapping";
import type { StyleRange } from "./styleRanges";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { Components } from "react-markdown";
import { resolveImagePath } from "./imagePaths";
import { readFileBase64 } from "../notes/api";

interface MarkdownPreviewProps {
  content: string;
  fontSize?: number;
  notesDir?: string;
  ranges?: StyleRange[];
  onUndo?: () => void;
  onRedo?: () => void;
  onStyle?: (start: number, end: number, property: "color" | "background" | "size", value: string | number | undefined) => void;
  onEdit?: (start: number, end: number, text: string) => void;
}

const remarkPlugins = [remarkGfm, remarkBreaks, remarkMath];
const rehypePlugins = [rehypeKatex];

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
    hr: () => (
      <hr className="my-6 border-none h-px bg-gradient-to-r from-transparent via-paper-deep to-transparent" />
    ),
    code: ({ className, children }) => {
      const isBlock = className?.startsWith("language-") || String(children).includes("\n");
      if (isBlock) {
        return (
          <code className="text-[12px] font-mono text-ink-soft leading-[1.8] whitespace-pre">
            {children}
          </code>
        );
      }
      return (
        <code className="px-1.5 py-0.5 text-[12px] font-mono bg-paper-warm rounded text-bamboo">
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
    img: ({ src, alt }) => <ImgRenderer src={src} alt={alt} notesDir={notesDir} />,
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
    input: ({ checked }) => (
      <input
        type="checkbox"
        checked={Boolean(checked)}
        readOnly
        className="mr-1.5 accent-bamboo w-3.5 h-3.5 align-middle cursor-default"
      />
    ),
  };
}

export function MarkdownPreview({ content, fontSize = 14, notesDir, ranges = [], onStyle, onEdit, onUndo, onRedo }: MarkdownPreviewProps) {
  const root = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<{ start: number; end: number } | null>(null);
  const [editing, setEditing] = useState<{ start: number; end: number; text: string } | null>(null);
  useEffect(() => { setSelection(null); setEditing(null); }, [content]);
  const components = useMemo(() => buildComponents(notesDir), [notesDir]);
  const plugins = useMemo(() => [mappedPreviewPlugin(content, ranges), ...rehypePlugins], [content, ranges]);
  return <div className="flex flex-col min-h-0 h-full">
    {onStyle && <div className="flex flex-wrap gap-1 py-2 sticky top-0 bg-cloud z-10 border-b border-paper-deep" role="toolbar" aria-label="预览文字格式">
      {(["color", "background", "size"] as const).map(property => <select key={property} aria-label={property === "color" ? "文字颜色" : property === "background" ? "背景颜色" : "文字大小"} className="format-select" disabled={!selection} value="" onChange={e => { if (selection) onStyle(selection.start, selection.end, property, e.target.value === "default" ? undefined : property === "size" ? Number(e.target.value) : e.target.value); }}>
        <option value="" disabled>{property === "color" ? "文字颜色" : property === "background" ? "背景颜色" : "字号"}</option><option value="default">恢复默认</option>
        {(property === "size" ? [["12","12"],["16","16"],["20","20"],["24","24"]] : property === "color" ? [["red","红色"],["orange","橙色"],["green","绿色"],["blue","蓝色"],["purple","紫色"]] : [["yellow","黄色"],["pink","粉色"],["green","绿色"],["blue","蓝色"],["purple","紫色"]]).map(([v,label]) => <option key={v} value={v}>{label}</option>)}
      </select>)}
      <button type="button" title="撤销 Ctrl+Z" className="format-select" onClick={onUndo}>撤销</button>
      <button type="button" title="重做 Ctrl+Y" className="format-select" onClick={onRedo}>重做</button>
      <span className="text-xs text-ink-faint self-center">选中文字设置格式 · 双击文字编辑</span>
    </div>}
    {editing && <div className="my-2 p-2 border border-bamboo rounded bg-paper-warm">
      <textarea aria-label="修改预览文字" autoFocus className="w-full text-ink min-h-20" value={editing.text} onChange={e => setEditing({ ...editing, text: e.target.value })} />
      <button className="px-3 py-1 text-bamboo" onClick={() => { onEdit?.(editing.start, editing.end, editing.text); setEditing(null); requestAnimationFrame(() => root.current?.focus()); }}>应用修改</button>
      <button className="px-3 py-1 text-ink-soft" onClick={() => setEditing(null)}>取消</button>
    </div>}
    <div ref={root} tabIndex={onEdit ? 0 : undefined} className="max-w-[560px] font-body" style={{ fontSize: `${fontSize}px` }} onMouseUp={() => { if (root.current) setSelection(sourceSelection(root.current)); }} onKeyUp={() => { if (root.current) setSelection(sourceSelection(root.current)); }} onDoubleClick={e => {
      if (!onEdit) return;
      const target = (e.target as HTMLElement).closest<HTMLElement>("[data-source-start]");
      if (target) { const start = Number(target.dataset.sourceStart), end = Number(target.dataset.sourceEnd); setEditing({ start, end, text: content.slice(start,end) }); }
    }}>
      {content.trim() ? <Markdown remarkPlugins={remarkPlugins} rehypePlugins={plugins} components={components}>{content}</Markdown> : <p className="text-ink-ghost leading-[1.9]">在源码区开始写作，预览中的文字可双击修改</p>}
    </div>
  </div>;
}
