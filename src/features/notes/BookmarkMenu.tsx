import { useEffect, useId, useRef, useState } from "react";
import { sourceLineIndex } from "./bookmarks";
import type { NoteBookmark, sourceLines } from "./bookmarks";

export function BookmarkIcon({ size = 14 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16l-6-4-6 4z" />
    </svg>
  );
}

interface BookmarkMenuProps {
  bookmarks: NoteBookmark[];
  lines: ReturnType<typeof sourceLines>;
  onJump: (offset: number) => void;
  onRename: (id: string, name: string) => void;
  onRemove: (id: string) => void;
}

export function BookmarkMenu({ bookmarks, lines, onJump, onRename, onRemove }: BookmarkMenuProps) {
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [name, setName] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  function close() {
    setOpen(false);
    setRenaming(null);
  }

  useEffect(() => {
    if (!open) return;
    function dismissOutside(event: PointerEvent) {
      if (event.target instanceof Node && !root.current?.contains(event.target)) close();
    }
    function dismissOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (renaming) {
        setRenaming(null);
      } else {
        close();
      }
      toggle.current?.focus();
    }
    document.addEventListener("pointerdown", dismissOutside);
    document.addEventListener("keydown", dismissOnEscape);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside);
      document.removeEventListener("keydown", dismissOnEscape);
    };
  }, [open, renaming]);

  return (
    <div ref={root} className="relative">
      <button
        ref={toggle}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => { if (open) close(); else setOpen(true); }}
        className="flex h-6 items-center gap-1 rounded px-1.5 text-[11px] text-ink-faint hover:bg-paper-warm hover:text-bamboo cursor-pointer"
      >
        <BookmarkIcon size={11} />
        书签
        <svg aria-hidden="true" width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className={open ? "rotate-180" : ""}>
          <path d="m4 6 4 4 4-4" />
        </svg>
      </button>
      <div id={panelId} hidden={!open} className="absolute top-full left-0 z-30 mt-1 w-60 max-w-[calc(100vw-3rem)] max-h-64 overflow-auto rounded-lg border border-paper-deep bg-cloud p-1 text-xs shadow-md">
        {open && (bookmarks.length ? (
          <ul aria-label="当前笔记书签">
            {bookmarks.map((bookmark) => {
              const line = sourceLineIndex(lines, bookmark.offset);
              const label = bookmark.name || "未命名";
              return (
                <li key={bookmark.id} className="flex min-h-8 items-center gap-1 rounded px-1 hover:bg-paper/60">
                  {renaming === bookmark.id ? (
                    <form className="flex w-full items-center gap-1.5" onSubmit={(event) => {
                      event.preventDefault();
                      onRename(bookmark.id, name.trim());
                      setRenaming(null);
                      toggle.current?.focus();
                    }}>
                      <input autoFocus type="text" aria-label="书签名称" placeholder="输入书签名称" value={name} onChange={(event) => setName(event.target.value)} className="min-w-0 flex-1 rounded bg-paper-warm px-1.5 py-1 text-ink focus:ring-1 focus:ring-bamboo" />
                      <button type="submit" className="shrink-0 rounded px-1.5 py-1 text-bamboo hover:bg-bamboo-mist cursor-pointer">确定</button>
                    </form>
                  ) : (
                    <>
                      <button
                        type="button"
                        title={lines[line].text.trim()}
                        onClick={() => { onJump(bookmark.offset); close(); toggle.current?.focus(); }}
                        className="flex flex-1 min-w-0 items-center gap-1.5 rounded px-1 py-1.5 text-left text-ink hover:text-bamboo cursor-pointer"
                      >
                        <span className="min-w-0 truncate">{label}</span>
                        <span className="shrink-0 text-[10px] text-ink-ghost">第 {line + 1} 行</span>
                      </button>
                      <button type="button" aria-label={`重命名书签 ${label}`} title="重命名书签" onClick={() => { setName(bookmark.name); setRenaming(bookmark.id); }} className="shrink-0 rounded px-1 py-1 text-ink-faint hover:text-bamboo cursor-pointer">改名</button>
                      <button type="button" aria-label={`移除书签 ${label}`} title="移除书签" onClick={() => onRemove(bookmark.id)} className="shrink-0 rounded px-1 py-1 text-ink-faint hover:text-red-400 cursor-pointer">移除</button>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        ) : <p className="px-2 py-2 text-ink-ghost">这篇笔记还没有书签</p>)}
      </div>
    </div>
  );
}
