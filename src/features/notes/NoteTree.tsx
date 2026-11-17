import { useCallback, useEffect, useRef, useState } from "react";
import type { NoteTreeNode } from "./types";
import { getDisplayTitle } from "./noteUtils";

function collectDescendants(
  nodes: NoteTreeNode[],
  targetId: string,
): Set<string> {
  for (const node of nodes) {
    if (node.id === targetId) {
      const ids = new Set<string>();
      const walk = (n: NoteTreeNode) => {
        for (const child of n.children) {
          ids.add(child.id);
          walk(child);
        }
      };
      walk(node);
      return ids;
    }
    const result = collectDescendants(node.children, targetId);
    if (result.size > 0) return result;
  }
  return new Set();
}

interface NoteMeta {
  parentId: string | null;
  sortOrder: number;
  childMaxSort: number;
}

function buildNoteMeta(
  nodes: NoteTreeNode[],
  parentId: string | null,
): Map<string, NoteMeta> {
  const map = new Map<string, NoteMeta>();
  for (const node of nodes) {
    const maxChildSort = node.children.reduce(
      (max, c) => Math.max(max, c.sortOrder),
      -1,
    );
    map.set(node.id, {
      parentId,
      sortOrder: node.sortOrder,
      childMaxSort: maxChildSort,
    });
    const childMap = buildNoteMeta(node.children, node.id);
    childMap.forEach((v, k) => map.set(k, v));
  }
  return map;
}

interface NoteTreeProps {
  notes: NoteTreeNode[];
  selectedId: string | null;
  hoveredId: string | null;
  onSelectNote: (id: string) => void;
  onHoverNote: (id: string | null) => void;
  onContextMenu: (event: React.MouseEvent, noteId: string) => void;
  onCreateChild: (parentId: string) => void;
  onMoveNote: (
    noteId: string,
    newParentId: string | null,
    newSortOrder: number,
  ) => void;
}

interface DragState {
  noteId: string;
  isDragging: boolean;
}

interface DropIndicator {
  targetId: string;
  position: "before" | "after" | "inside";
}

export function NoteTree({
  notes,
  selectedId,
  hoveredId,
  onSelectNote,
  onHoverNote,
  onContextMenu,
  onCreateChild,
  onMoveNote,
}: NoteTreeProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [dropIndicator, setDropIndicator] = useState<DropIndicator | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const dragStateRef = useRef<DragState | null>(null);
  const noteMetaRef = useRef<Map<string, NoteMeta>>(new Map());
  const descendantIdsRef = useRef<Set<string>>(new Set());
  const dropIndicatorRef = useRef<DropIndicator | null>(null);

  noteMetaRef.current = buildNoteMeta(notes, null);

  const setDrag = useCallback((s: DragState | null) => {
    dragStateRef.current = s;
    setDragState(s);
  }, []);

  const setIndicator = useCallback((ind: DropIndicator | null) => {
    dropIndicatorRef.current = ind;
    setDropIndicator(ind);
  }, []);

  const toggleExpand = useCallback((id: string, event: React.MouseEvent) => {
    event.stopPropagation();
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // -- custom mouse-based drag ------------------------------------------------

  const DRAG_THRESHOLD = 5;

  const handleDragMouseDown = useCallback(
    (event: React.MouseEvent, noteId: string) => {
      if (event.button !== 0) return;
      event.stopPropagation();
      descendantIdsRef.current = collectDescendants(notes, noteId);
      setDrag({ noteId, isDragging: false });
    },
    [notes, setDrag],
  );

  useEffect(() => {
    if (!dragState) return;

    let startX = 0;
    let startY = 0;
    let movedPastThreshold = false;

    const handleMove = (e: MouseEvent) => {
      if (!dragStateRef.current) return;

      if (!movedPastThreshold) {
        if (startX === 0 && startY === 0) {
          startX = e.clientX;
          startY = e.clientY;
          return;
        }
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) {
          return;
        }
        movedPastThreshold = true;
        dragStateRef.current = { ...dragStateRef.current, isDragging: true };
        setDragState({ ...dragStateRef.current });
      }

      // Prevent text selection while dragging
      e.preventDefault();

      const container = containerRef.current;
      if (!container) return;

      const noteElements =
        container.querySelectorAll<HTMLElement>("[data-note-id]");

      // Collect horizontally-aligned candidates
      const candidates: Array<{ el: HTMLElement; rect: DOMRect }> = [];
      for (const el of noteElements) {
        const rect = el.getBoundingClientRect();
        if (e.clientX >= rect.left && e.clientX <= rect.right) {
          candidates.push({ el, rect });
        }
      }

      if (candidates.length === 0) {
        setIndicator(null);
        return;
      }

      // 1. Try direct hit (cursor over the element)
      let targetEl: HTMLElement | null = null;
      let targetRect: DOMRect | null = null;
      let isDirectHit = false;

      for (const c of candidates) {
        if (e.clientY >= c.rect.top - 2 && e.clientY <= c.rect.bottom + 2) {
          if (!targetEl || c.rect.height < targetRect!.height) {
            targetEl = c.el;
            targetRect = c.rect;
            isDirectHit = true;
          }
        }
      }

      // 2. No direct hit — find closest candidate by vertical distance
      if (!targetEl) {
        let closestEl = candidates[0].el;
        let closestRect = candidates[0].rect;
        let minDist = Infinity;

        for (const c of candidates) {
          const distBelow = e.clientY - c.rect.bottom;
          const distAbove = c.rect.top - e.clientY;
          const dist =
            distBelow >= 0
              ? distBelow
              : distAbove >= 0
                ? distAbove
                : Infinity;
          if (dist < minDist) {
            minDist = dist;
            closestEl = c.el;
            closestRect = c.rect;
          }
        }

        if (minDist < 60) {
          targetEl = closestEl;
          targetRect = closestRect;
          isDirectHit = false;
        }
      }

      if (
        !targetEl ||
        !targetRect ||
        targetEl.dataset.noteId === dragStateRef.current.noteId
      ) {
        setIndicator(null);
        return;
      }

      let targetId = targetEl.dataset.noteId!;
      if (descendantIdsRef.current.has(targetId)) {
        setIndicator(null);
        return;
      }

      let position: DropIndicator["position"];

      if (isDirectHit) {
        const y = e.clientY - targetRect.top;
        const h = targetRect.height;
        if (y > h * 0.25 && y < h * 0.75) {
          position = "inside";
        } else if (y < h * 0.5) {
          position = "before";
        } else {
          position = "after";
        }
      } else {
        position =
          e.clientY < targetRect.top ? "before" : "after";
      }

      // 3. Edge case: cursor is below the last child of a parent -
      //    redirect to parent so the note can escape the subtree
      if (!isDirectHit && position === "after") {
        const meta = noteMetaRef.current.get(targetId);
        if (meta?.parentId) {
          const parentMeta = noteMetaRef.current.get(meta.parentId);
          if (parentMeta && meta.sortOrder >= parentMeta.childMaxSort) {
            targetId = meta.parentId;
          }
        }
      }

      setIndicator({ targetId, position });
    };

    const handleUp = (_e: MouseEvent) => {
      const ds = dragStateRef.current;
      const indicator = dropIndicatorRef.current;

      if (ds?.isDragging && indicator) {
        const meta = noteMetaRef.current.get(indicator.targetId);
        if (meta) {
          let newParentId: string | null;
          let newSortOrder: number;

          if (indicator.position === "inside") {
            newParentId = indicator.targetId;
            newSortOrder = meta.childMaxSort + 1;
          } else if (indicator.position === "before") {
            newParentId = meta.parentId;
            newSortOrder = meta.sortOrder;
          } else {
            newParentId = meta.parentId;
            newSortOrder = meta.sortOrder + 1;
          }

          onMoveNote(ds.noteId, newParentId, newSortOrder);
        }
      }

      setDrag(null);
      setIndicator(null);
      movedPastThreshold = false;
      startX = 0;
      startY = 0;
    };

    document.addEventListener("mousemove", handleMove);
    document.addEventListener("mouseup", handleUp);
    return () => {
      document.removeEventListener("mousemove", handleMove);
      document.removeEventListener("mouseup", handleUp);
    };
  }, [dragState, setDrag, setIndicator, onMoveNote]);

  // -- expand / collapse all --------------------------------------------------

  const handleExpandAll = useCallback(() => {
    const collectIds = (nodes: NoteTreeNode[]): string[] => {
      const ids: string[] = [];
      for (const node of nodes) {
        if (node.children.length > 0) {
          ids.push(node.id);
          ids.push(...collectIds(node.children));
        }
      }
      return ids;
    };
    setExpandedIds(new Set(collectIds(notes)));
  }, [notes]);

  const handleCollapseAll = useCallback(() => {
    setExpandedIds(new Set());
  }, []);

  // -- render -----------------------------------------------------------------

  const renderNodes = (nodes: NoteTreeNode[], level: number) => {
    return nodes.map((note) => {
      const isSelected = note.id === selectedId;
      const isHovered = note.id === hoveredId;
      const hasChildren = note.children.length > 0;
      const isExpanded = expandedIds.has(note.id);
      const isDropTarget = dropIndicator?.targetId === note.id;
      const isInsideDrop = isDropTarget && dropIndicator?.position === "inside";
      const isBeforeDrop = isDropTarget && dropIndicator?.position === "before";
      const isAfterDrop = isDropTarget && dropIndicator?.position === "after";
      const isBeingDragged =
        dragState?.noteId === note.id && dragState?.isDragging;
      const canShowAfterOnItem = !hasChildren || !isExpanded;

      return (
        <div key={note.id}>
          <div
            data-note-id={note.id}
            className={`relative group${
              isBeforeDrop ? " border-t-2 border-bamboo/60" : ""
            }${
              isAfterDrop && canShowAfterOnItem
                ? " border-b-2 border-bamboo/60"
                : ""
            }${isBeingDragged ? " opacity-40" : ""}`}
          >
            <div
              onClick={() => onSelectNote(note.id)}
              onContextMenu={(event) => onContextMenu(event, note.id)}
              onMouseEnter={() => onHoverNote(note.id)}
              onMouseLeave={() => onHoverNote(null)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelectNote(note.id);
                }
              }}
              role="button"
              tabIndex={0}
              className={`w-full text-left rounded-md transition-colors relative ${
                isSelected
                  ? "bg-bamboo-mist/70"
                  : isHovered
                    ? "bg-paper-warm/70"
                    : isInsideDrop
                      ? "bg-bamboo-mist/60 ring-2 ring-bamboo/30"
                      : "bg-transparent"
              }`}
              style={{
                paddingLeft: `${level * 16 + 12}px`,
                paddingRight: "8px",
                paddingTop: "7px",
                paddingBottom: "7px",
              }}
            >
              <div
                className={`absolute left-0 top-1/2 -translate-y-1/2 w-[3px] rounded-r-full bg-bamboo/60 transition-all duration-[600ms] ${
                  isSelected ? "h-5 opacity-100" : "h-0 opacity-0"
                }`}
                style={{ left: `${level * 16 + 2}px` }}
              />

              <div className="flex items-center gap-1">
                {/* drag handle */}
                <div
                  className={`shrink-0 w-4 h-4 flex items-center justify-center transition-colors cursor-grab active:cursor-grabbing select-none ${
                    isBeingDragged
                      ? "text-bamboo"
                      : "text-ink-ghost/0 group-hover:text-ink-ghost/40"
                  }`}
                  onMouseDown={(e) => handleDragMouseDown(e, note.id)}
                  title="拖动排序"
                >
                  <svg
                    width="8"
                    height="12"
                    viewBox="0 0 8 12"
                    fill="currentColor"
                  >
                    <circle cx="2" cy="2" r="1.2" />
                    <circle cx="6" cy="2" r="1.2" />
                    <circle cx="2" cy="6" r="1.2" />
                    <circle cx="6" cy="6" r="1.2" />
                    <circle cx="2" cy="10" r="1.2" />
                    <circle cx="6" cy="10" r="1.2" />
                  </svg>
                </div>

                {hasChildren && (
                  <button
                    onClick={(event) => toggleExpand(note.id, event)}
                    onMouseDown={(e) => e.stopPropagation()}
                    className="shrink-0 w-4 h-4 flex items-center justify-center text-ink-ghost hover:text-ink-faint transition-colors cursor-pointer"
                    title={isExpanded ? "收起" : "展开"}
                  >
                    <svg
                      width="10"
                      height="10"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      style={{
                        transform: isExpanded
                          ? "rotate(90deg)"
                          : "rotate(0deg)",
                        transition: "transform 0.2s ease",
                      }}
                    >
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </button>
                )}
                {!hasChildren && <div className="w-4 shrink-0" />}

                <span aria-hidden="true" className="shrink-0 text-[14px]">{hasChildren ? "📁" : "📄"}</span>
                <div className="flex-1 min-w-0">
                  <span className={`block text-[13px] font-body truncate ${isSelected ? "text-bamboo font-semibold" : "text-ink"}`} title={getDisplayTitle(note)}>
                    {getDisplayTitle(note).replace(/^#{1,6}\s*/, "")}
                  </span>
                </div>

                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    onCreateChild(note.id);
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                  className="shrink-0 w-5 h-5 flex items-center justify-center rounded text-ink-ghost/0 group-hover:text-ink-ghost hover:text-bamboo hover:bg-bamboo-mist/50 transition-all cursor-pointer opacity-0 group-hover:opacity-100"
                  title="新建子笔记"
                >
                  <svg
                    width="11"
                    height="11"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                  >
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </button>
              </div>
            </div>
          </div>

          {hasChildren && isExpanded && (
            <div
              className={
                isAfterDrop && !canShowAfterOnItem
                  ? "border-b-2 border-bamboo/60"
                  : ""
              }
            >
              {renderNodes(note.children, level + 1)}
            </div>
          )}
        </div>
      );
    });
  };

  return (
    <div
      ref={containerRef}
      className={`flex-1 overflow-y-auto px-2 pb-2 ${
        dragState?.isDragging ? "cursor-grabbing select-none" : ""
      }`}
    >
      {notes.length > 0 && (
        <div className="flex items-center gap-1 px-2 pb-1">
          <button
            onClick={handleExpandAll}
            className="text-[10px] text-ink-ghost hover:text-ink-faint transition-colors cursor-pointer px-1 py-0.5"
            title="全部展开"
          >
            展开
          </button>
          <button
            onClick={handleCollapseAll}
            className="text-[10px] text-ink-ghost hover:text-ink-faint transition-colors cursor-pointer px-1 py-0.5"
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
