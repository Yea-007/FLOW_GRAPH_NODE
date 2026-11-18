import { useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent, PointerEvent as ReactPointerEvent } from "react";
import type { NoteDropPosition, NoteMetadata, NoteTreeNode } from "./types";
import { getDisplayTitle } from "./noteUtils";

const DRAG_THRESHOLD = 3;
const LEVEL_INDENT = 16;

interface DropTarget {
  id: string;
  position: NoteDropPosition;
}

interface Drag {
  id: string;
  pointerId: number;
  startX: number;
  startY: number;
  active: boolean;
}

function findDropTarget(container: HTMLElement, x: number, y: number): DropTarget | null {
  const bounds = container.getBoundingClientRect();
  if (x < bounds.left || x >= bounds.right || y < bounds.top || y >= bounds.bottom) {
    return null;
  }

  // The full row is hittable. Sample either side of the narrow gap between rows.
  let row: HTMLElement | null = null;
  for (const offset of [0, 2, -2]) {
    row = document.elementFromPoint(x, y + offset)?.closest<HTMLElement>("[data-note-id]") ?? null;
    if (row && container.contains(row)) break;
    row = null;
  }

  if (!row) {
    const rows = container.querySelectorAll<HTMLElement>("[data-note-id]");
    const last = rows[rows.length - 1];
    if (last && y >= last.getBoundingClientRect().bottom) row = last;
  }
  if (!row) return null;

  const rect = row.getBoundingClientRect();
  const edge = Math.max(8, rect.height * 0.23);
  const level = Number(row.dataset.noteLevel);
  const inIndent = level > 0 && x < rect.left + level * LEVEL_INDENT + 12;
  const offset = y - rect.top;
  let position: NoteDropPosition = "inside";
  if (inIndent) position = offset < rect.height / 2 ? "before" : "after";
  else if (offset <= edge) position = "before";
  else if (offset >= rect.height - edge) position = "after";

  // At the end of a branch, the gutter also exposes the enclosing levels.
  let branch = row.parentElement;
  while (position === "after" && branch && !branch.nextElementSibling) {
    const ancestor = branch.parentElement?.parentElement?.firstElementChild;
    if (!(ancestor instanceof HTMLElement) || !ancestor.dataset.noteId) break;
    const indent = Number(row.dataset.noteLevel) * LEVEL_INDENT + 12;
    if (x >= rect.left + indent) break;
    row = ancestor;
    branch = row.parentElement;
  }

  return { id: row.dataset.noteId!, position };
}

interface NoteTreeProps {
  notes: NoteTreeNode[];
  allNotes: NoteMetadata[];
  selectedId: string | null;
  hoveredId: string | null;
  onSelectNote: (id: string) => void;
  onHoverNote: (id: string | null) => void;
  onContextMenu: (event: MouseEvent<HTMLDivElement>, noteId: string) => void;
  onChangeIcon: (noteId: string, anchor: HTMLElement) => void;
  onCreateChild: (parentId: string) => void;
  onMoveNote: (noteId: string, targetId: string, position: NoteDropPosition) => void;
}

export function NoteTree({
  notes,
  allNotes,
  selectedId,
  hoveredId,
  onSelectNote,
  onHoverNote,
  onContextMenu,
  onChangeIcon,
  onCreateChild,
  onMoveNote,
}: NoteTreeProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const suppressClickRef = useRef(false);

  const { parents, folderIds } = useMemo(() => {
    const parents = new Map(allNotes.map((note) => [note.id, note.parentId]));
    const folderIds = new Set(allNotes.flatMap((note) => note.parentId ? [note.parentId] : []));
    return { parents, folderIds };
  }, [allNotes]);

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>, id: string) {
    if (event.button !== 0 || !event.isPrimary) return;
    if ((event.target as Element).closest("[data-note-action]")) return;
    if (event.pointerType === "touch" && !(event.target as Element).closest("[data-note-handle]")) return;
    dragRef.current = {
      id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
    };
  }

  useEffect(() => {
    function getTarget(event: PointerEvent, id: string) {
      const container = containerRef.current;
      if (!container) return null;
      const target = findDropTarget(container, event.clientX, event.clientY);
      const visited = new Set<string>();
      for (let ancestor = target?.id; ancestor; ancestor = parents.get(ancestor) ?? undefined) {
        if (ancestor === id || visited.has(ancestor)) return null;
        visited.add(ancestor);
      }
      return target;
    }

    function cancelDrag() {
      if (dragRef.current?.active) suppressClickRef.current = true;
      dragRef.current = null;
      setDraggedId(null);
      setDropTarget(null);
    }

    function handlePointerMove(event: PointerEvent) {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      if (event.buttons === 0) {
        cancelDrag();
        return;
      }
      if (!drag.active) {
        if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < DRAG_THRESHOLD) return;
        drag.active = true;
        setDraggedId(drag.id);
      }
      event.preventDefault();
      const next = getTarget(event, drag.id);
      setDropTarget((current) => (
        current?.id === next?.id && current?.position === next?.position ? current : next
      ));
    }

    function handlePointerUp(event: PointerEvent) {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const target = drag.active ? getTarget(event, drag.id) : null;
      cancelDrag();
      if (!target) return;
      if (target.position === "inside") {
        setExpandedIds((current) => new Set(current).add(target.id));
      }
      onMoveNote(drag.id, target.id, target.position);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") cancelDrag();
    }

    function handlePointerCancel(event: PointerEvent) {
      if (event.pointerId === dragRef.current?.pointerId) cancelDrag();
    }

    document.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointerup", handlePointerUp);
    document.addEventListener("pointercancel", handlePointerCancel);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("blur", cancelDrag);
    return () => {
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", handlePointerUp);
      document.removeEventListener("pointercancel", handlePointerCancel);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("blur", cancelDrag);
    };
  }, [onMoveNote, parents]);

  function toggleExpand(id: string) {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function renderNodes(nodes: NoteTreeNode[], level: number) {
    return nodes.map((note) => {
      const isSelected = note.id === selectedId;
      const hasChildren = note.children.length > 0;
      const isExpanded = expandedIds.has(note.id);
      const position = dropTarget?.id === note.id ? dropTarget.position : null;
      const title = getDisplayTitle(note);
      const indent = level * LEVEL_INDENT;
      const icon = note.icon;

      return (
        <div key={note.id} className="relative">
          <div
            data-note-id={note.id}
            data-note-level={level}
            onPointerDown={(event) => handlePointerDown(event, note.id)}
            onClick={() => onSelectNote(note.id)}
            onContextMenu={(event) => onContextMenu(event, note.id)}
            onMouseEnter={() => onHoverNote(note.id)}
            onMouseLeave={() => onHoverNote(null)}
            className={`group relative cursor-pointer select-none rounded-md py-[7px] pr-2 transition-colors ${
              position === "inside"
                ? "bg-bamboo-mist ring-2 ring-inset ring-bamboo/45"
                : isSelected
                  ? "bg-bamboo-mist/70"
                  : note.id === hoveredId ? "bg-paper-warm/70" : "bg-transparent"
            } ${draggedId === note.id ? "opacity-40" : ""}`}
            style={{ paddingLeft: indent + 12 }}
          >
            <div
              className={`absolute top-1/2 w-[3px] -translate-y-1/2 rounded-r-full bg-bamboo/60 transition-all duration-[600ms] ${
                isSelected ? "h-5 opacity-100" : "h-0 opacity-0"
              }`}
              style={{ left: indent + 2 }}
            />
            <div className="flex items-center gap-1">
              <span
                data-note-handle
                aria-hidden="true"
                title="拖动排序或调整层级"
                className={`flex h-4 w-4 shrink-0 touch-none cursor-grab items-center justify-center transition-colors active:cursor-grabbing ${
                  draggedId === note.id ? "text-bamboo" : "text-ink-ghost/0 group-hover:text-ink-ghost/40"
                }`}
              >
                <svg width="8" height="12" viewBox="0 0 8 12" fill="currentColor">
                  <circle cx="2" cy="2" r="1.2" />
                  <circle cx="6" cy="2" r="1.2" />
                  <circle cx="2" cy="6" r="1.2" />
                  <circle cx="6" cy="6" r="1.2" />
                  <circle cx="2" cy="10" r="1.2" />
                  <circle cx="6" cy="10" r="1.2" />
                </svg>
              </span>

              {hasChildren ? (
                <button
                  type="button"
                  data-note-action
                  aria-expanded={isExpanded}
                  onClick={(event) => {
                    event.stopPropagation();
                    toggleExpand(note.id);
                  }}
                  className="flex h-4 w-4 shrink-0 cursor-pointer items-center justify-center text-ink-ghost transition-colors hover:text-ink-faint"
                  title={isExpanded ? "收起" : "展开"}
                >
                  <svg
                    width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                    className={`transition-transform ${isExpanded ? "rotate-90" : ""}`}
                  >
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>
              ) : <span className="w-4 shrink-0" />}

              <button
                type="button"
                data-note-action
                aria-label={`更换图标 · ${title}`}
                aria-haspopup="dialog"
                title="更换图标"
                onClick={(event) => {
                  event.stopPropagation();
                  onChangeIcon(note.id, event.currentTarget);
                }}
                className="flex h-5 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-[15px] leading-none hover:bg-bamboo/10"
              >
                {icon?.type === "image"
                  ? <img src={`data:image/png;base64,${icon.value}`} alt="" draggable={false} className="size-[17px] rounded-sm" />
                  : <span aria-hidden="true">{icon?.value ?? (folderIds.has(note.id) ? "📁" : "📄")}</span>}
              </button>

              <button
                type="button"
                title={title}
                className={`min-w-0 flex-1 cursor-pointer truncate text-left font-body text-[13px] ${
                  isSelected ? "font-semibold text-bamboo" : "text-ink"
                }`}
              >
                {title.replace(/^#{1,6}\s*/, "")}
              </button>

              <button
                type="button"
                data-note-action
                onClick={(event) => {
                  event.stopPropagation();
                  onCreateChild(note.id);
                }}
                className="flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded text-ink-ghost opacity-0 transition-all group-hover:opacity-100 hover:bg-bamboo-mist/50 hover:text-bamboo focus-visible:opacity-100"
                title="新建子笔记"
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </button>
            </div>
          </div>

          {hasChildren && isExpanded && <div>{renderNodes(note.children, level + 1)}</div>}
          {(position === "before" || position === "after") && (
            <div
              className={`pointer-events-none absolute right-0 z-10 h-0.5 rounded-full bg-bamboo ${
                position === "before" ? "-top-px" : "-bottom-px"
              }`}
              style={{ left: indent + 12 }}
            />
          )}
        </div>
      );
    });
  }

  return (
    <div
      ref={containerRef}
      onPointerDownCapture={() => { suppressClickRef.current = false; }}
      onClickCapture={(event) => {
        if (event.detail === 0 || !suppressClickRef.current) return;
        suppressClickRef.current = false;
        event.stopPropagation();
        event.preventDefault();
      }}
      className={`flex-1 overflow-y-auto px-2 pb-2 ${draggedId ? "[&_*]:!cursor-grabbing" : ""}`}
    >
      {notes.length > 0 && (
        <div className="flex items-center gap-1 px-2 pb-1">
          <button
            onClick={() => setExpandedIds(new Set(folderIds))}
            className="cursor-pointer px-1 py-0.5 text-[10px] text-ink-ghost transition-colors hover:text-ink-faint"
            title="全部展开"
          >
            展开
          </button>
          <button
            onClick={() => setExpandedIds(new Set())}
            className="cursor-pointer px-1 py-0.5 text-[10px] text-ink-ghost transition-colors hover:text-ink-faint"
            title="全部收起"
          >
            收起
          </button>
        </div>
      )}
      <div className="space-y-0.5">{renderNodes(notes, 0)}</div>
    </div>
  );
}
