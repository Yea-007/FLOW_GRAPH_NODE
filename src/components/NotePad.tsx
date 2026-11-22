import { useCallback, useEffect, useRef, useState } from "react";
import type { MouseEvent } from "react";
import {
  createNote,
  getErrorMessage,
  getNote,
  listNotes,
  saveGroupedNote,
  updateNote,
} from "../features/notes/api";
import type { Note, NoteGroupTarget, NoteMetadata } from "../features/notes/types";
import { NoteGroupPicker } from "../features/notes/NoteGroupPicker";
import {
  countNoteChars,
  formatShortDate,
  getDisplayTitle,
  metadataFromNote,
} from "../features/notes/noteUtils";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  animateCurrentWindowBounds,
  getCurrentWindowBounds,
  recycleCurrentNotepad,
  setCurrentWindowAlwaysOnTop,
  showCurrentWindow,
  startCurrentWindowDrag,
  startCurrentWindowResize,
} from "../features/windows/controls";
import type { ResizeDirection } from "../features/windows/controls";
import { getConfig } from "../features/settings/api";
import {
  DEFAULT_TILE_COLOR,
  normalizeTileColor,
  resolveTileColor,
} from "../features/settings/tileColor";
import type { TileColorMode } from "../features/settings/types";
import { shouldSaveBeforeSwitchingToTile } from "../features/windows/noteSurfaceSavePolicy";
import {
  NOTE_SURFACE_ACTION_EVENT,
  surfaceActionFromEvent,
} from "../features/windows/surfaceActions";
import {
  NOTE_SURFACE_MODE_EVENT,
  getSurfaceTargetBounds,
  surfaceModeFromEvent,
} from "../features/windows/surfaceMode";
import type { NoteSurfaceMode } from "../features/windows/surfaceMode";
import { Tile } from "./Tile";

type OpenMode = "new" | "open" | "group";
const noGroup: NoteGroupTarget = { type: "root" };

interface NotePadProps {
  initialNoteId?: string;
  initialSurfaceMode?: NoteSurfaceMode;
  initialAutoSave?: boolean;
  initialTileColor?: string;
}

interface NoteDraft {
  noteId: string | null;
  title: string;
  content: string;
  revision: number;
  savedRevision: number;
  savedNote: Note | null;
  group?: NoteGroupTarget;
  savedGroup?: NoteGroupTarget;
}

function emptyDraft(): NoteDraft {
  return {
    noteId: null,
    title: "",
    content: "",
    revision: 0,
    savedRevision: 0,
    savedNote: null,
  };
}

function hasNoteText(draft: NoteDraft) {
  return Boolean(draft.title.trim() || draft.content.trim());
}

const surfaceResizeHandles: Array<{
  direction: ResizeDirection;
  className: string;
  size: string;
}> = [
  {
    direction: "NorthWest",
    size: "w-8 h-8",
    className: "top-0 left-0 cursor-nwse-resize",
  },
  {
    direction: "NorthEast",
    size: "w-5 h-5",
    className: "top-0 right-0 cursor-nesw-resize",
  },
  {
    direction: "SouthWest",
    size: "w-8 h-8",
    className: "bottom-0 left-0 cursor-nesw-resize",
  },
  {
    direction: "SouthEast",
    size: "w-5 h-5",
    className: "bottom-0 right-0 cursor-nwse-resize",
  },
];

function SurfaceResizeHandles() {
  return (
    <>
      {surfaceResizeHandles.map((handle) => (
        <div
          key={handle.direction}
          aria-hidden="true"
          data-surface-resize-handle="true"
          data-resize-direction={handle.direction}
          onMouseDown={(event) => {
            event.stopPropagation();
            void startCurrentWindowResize(handle.direction).catch(
              () => undefined,
            );
          }}
          className={`absolute ${handle.size} opacity-0 ${handle.className}`}
        />
      ))}
    </>
  );
}

export function NotePad({
  initialNoteId,
  initialSurfaceMode = "pad",
  initialAutoSave = true,
  initialTileColor = DEFAULT_TILE_COLOR,
}: NotePadProps) {
  const [surfaceMode, setSurfaceMode] =
    useState<NoteSurfaceMode>(initialSurfaceMode);
  const [mode, setMode] = useState<OpenMode>("new");
  const [notes, setNotes] = useState<NoteMetadata[]>([]);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [group, setGroup] = useState<NoteGroupTarget>(noGroup);
  const [hoveredNote, setHoveredNote] = useState<string | null>(null);
  const [status, setStatus] = useState("空");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [noteSurfaceAutoSave, setNoteSurfaceAutoSave] =
    useState(initialAutoSave);
  const [tileColorRaw, setTileColorRaw] = useState(
    normalizeTileColor(initialTileColor),
  );
  const [tileColorMode, setTileColorMode] = useState<TileColorMode>("system");
  const [surfaceFontSize, setSurfaceFontSize] = useState(14);
  const [tileColor, setTileColor] = useState(() =>
    resolveTileColor("system", normalizeTileColor(initialTileColor)),
  );
  const [isExiting, setIsExiting] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const closingRef = useRef(false);
  const draftRef = useRef<NoteDraft>(emptyDraft());
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const contentRef = useRef<HTMLTextAreaElement>(null);
  const isStandby = useRef(
    typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("standby") === "1",
  );
  const hasEnteredOnce = useRef(false);

  const refreshNotes = useCallback(async () => {
    const loadedNotes = await listNotes();
    setNotes(loadedNotes);
    return loadedNotes;
  }, []);

  const applyNote = useCallback((note: Note) => {
    draftRef.current = {
      noteId: note.id,
      title: note.title,
      content: note.content,
      revision: 0,
      savedRevision: 0,
      savedNote: note,
    };
    setEditingNoteId(note.id);
    setTitle(note.title);
    setContent(note.content);
    setGroup(note.parentId ? { type: "existing", id: note.parentId } : noGroup);
    setMode("new");
    setStatus("已打开");
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      try {
        const [loadedConfig] = await Promise.all([getConfig(), refreshNotes()]);
        if (!cancelled) {
          setNoteSurfaceAutoSave(loadedConfig.noteSurfaceAutoSave);
          setSurfaceFontSize(loadedConfig.surfaceFontSize ?? 14);
          setTileColorRaw(normalizeTileColor(loadedConfig.tileColor));
          setTileColorMode(loadedConfig.tileColorMode ?? "system");
          setTileColor(
            resolveTileColor(
              loadedConfig.tileColorMode ?? "system",
              loadedConfig.tileColor,
            ),
          );
        }
        if (initialNoteId) {
          const note = await getNote(initialNoteId);
          if (!cancelled) applyNote(note);
        }
      } catch (error) {
        if (!cancelled) setErrorMessage(getErrorMessage(error));
      }
    }

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [applyNote, initialNoteId, refreshNotes]);

  useEffect(() => {
    if (isStandby.current) return;
    let cancelled = false;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!cancelled) {
          hasEnteredOnce.current = true;
          void showCurrentWindow()
            .then(() => contentRef.current?.focus())
            .catch(() => undefined);
        }
      });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const unlisten = listen<{
      tileColor?: string;
      tileColorMode?: TileColorMode;
      surfaceFontSize?: number;
      noteSurfaceAutoSave?: boolean;
    }>("config-changed", (event) => {
      const mode = event.payload.tileColorMode ?? tileColorMode;
      const raw = event.payload.tileColor ?? tileColorRaw;
      setTileColorMode(mode);
      setTileColorRaw(normalizeTileColor(raw));
      setTileColor(resolveTileColor(mode, raw));
      if (event.payload.surfaceFontSize != null) setSurfaceFontSize(event.payload.surfaceFontSize);
      if (event.payload.noteSurfaceAutoSave != null) {
        setNoteSurfaceAutoSave(event.payload.noteSurfaceAutoSave);
      }
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [tileColorMode, tileColorRaw]);

  useEffect(() => {
    if (tileColorMode !== "system") return;
    const observer = new MutationObserver(() => {
      setTileColor(resolveTileColor("system", tileColorRaw));
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, [tileColorMode, tileColorRaw]);

  useEffect(() => {
    let myLabel = "";
    try {
      myLabel = getCurrentWindow().label;
    } catch {
      // not in Tauri environment (tests)
    }

    const unlisten = listen<string>("notepad:activate", (event) => {
      if (event.payload !== myLabel) return;

      isStandby.current = false;
      hasEnteredOnce.current = true;
      draftRef.current = emptyDraft();
      closingRef.current = false;
      setIsClosing(false);
      setEditingNoteId(null);
      setTitle("");
      setContent("");
      setGroup(noGroup);
      setMode("new");
      setStatus("空");
      setErrorMessage(null);
      setIsExiting(false);
      setSurfaceMode("pad");
      void refreshNotes().catch(() => undefined);
      void showCurrentWindow()
        .then(() => contentRef.current?.focus())
        .catch(() => undefined);
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [refreshNotes]);

  const saveNote = useCallback(async () => {
    const draft = draftRef.current;
    const revision = draft.revision;
    const request = { title: draft.title, content: draft.content };
    const destination = draft.group;
    const pending = saveQueueRef.current.then(async () => {
      if (draft.savedNote && draft.savedRevision >= revision) {
        return draft.savedNote;
      }

      const note = destination && destination !== draft.savedGroup
        ? await saveGroupedNote(draft.noteId, request, destination)
        : draft.noteId
          ? await updateNote(draft.noteId, request)
          : await createNote(request);
      draft.noteId = note.id;
      draft.savedRevision = revision;
      draft.savedNote = note;
      draft.savedGroup = destination;

      setNotes((current) => {
        const metadata = metadataFromNote(note);
        const exists = current.some((item) => item.id === note.id);
        const next = exists
          ? current.map((item) => (item.id === note.id ? metadata : item))
          : [metadata, ...current];
        return [...next].sort((left, right) =>
          right.updatedAt.localeCompare(left.updatedAt),
        );
      });
      if (draftRef.current === draft) {
        setEditingNoteId(note.id);
        setStatus(draft.revision === revision ? "已保存" : "未保存");
      }
      return note;
    });
    // A second save must reuse the ID returned by an in-flight create.
    saveQueueRef.current = pending.then(
      () => undefined,
      () => undefined,
    );
    return pending;
  }, []);

  const hasDraftContent = useCallback(() => {
    const draft = draftRef.current;
    return Boolean(draft.noteId || hasNoteText(draft));
  }, []);

  const switchSurfaceMode = useCallback(async (nextMode: NoteSurfaceMode) => {
    setSurfaceMode(nextMode);

    try {
      if (nextMode === "tile") {
        await setCurrentWindowAlwaysOnTop(true);
      }

      const currentBounds = await getCurrentWindowBounds();
      await animateCurrentWindowBounds(
        getSurfaceTargetBounds(nextMode, currentBounds),
      );
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    }
  }, []);

  useEffect(() => {
    function handleSurfaceModeRequest(event: Event) {
      const nextMode = surfaceModeFromEvent(event);
      if (!nextMode) return;
      if (nextMode === "tile" && !hasNoteText(draftRef.current)) return;
      void switchSurfaceMode(nextMode);
    }

    window.addEventListener(NOTE_SURFACE_MODE_EVENT, handleSurfaceModeRequest);
    return () => {
      window.removeEventListener(
        NOTE_SURFACE_MODE_EVENT,
        handleSurfaceModeRequest,
      );
    };
  }, [switchSurfaceMode]);

  useEffect(() => {
    if (surfaceMode !== "tile") return;
    void setCurrentWindowAlwaysOnTop(true).catch(() => undefined);
  }, [surfaceMode]);

  const handleSave = useCallback(async () => {
    const draft = draftRef.current;
    setErrorMessage(null);
    try {
      await saveNote();
    } catch (error) {
      if (draftRef.current === draft) {
        setStatus("保存失败");
        setErrorMessage(getErrorMessage(error));
      }
    }
  }, [saveNote]);

  const handleOpenNote = async (noteId: string) => {
    setErrorMessage(null);
    try {
      if (noteSurfaceAutoSave && hasDraftContent()) await saveNote();
      const note = await getNote(noteId);
      applyNote(note);
      await switchSurfaceMode("pad");
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    }
  };

  const handlePin = async () => {
    const draft = draftRef.current;
    if (!hasNoteText(draft)) {
      setMode("new");
      setErrorMessage("填写标题或正文后再转为磁贴");
      contentRef.current?.focus();
      return;
    }
    setErrorMessage(null);
    try {
      if (shouldSaveBeforeSwitchingToTile(noteSurfaceAutoSave)) {
        await saveNote();
      }
      if (draftRef.current !== draft || closingRef.current || !hasNoteText(draft)) return;
      await switchSurfaceMode("tile");
    } catch (error) {
      if (draftRef.current === draft) {
        setMode("new");
        setErrorMessage(getErrorMessage(error));
      }
    }
  };

  const handleClose = useCallback(async () => {
    if (closingRef.current) return;
    closingRef.current = true;
    setIsClosing(true);
    setErrorMessage(null);
    try {
      if (noteSurfaceAutoSave && hasDraftContent()) await saveNote();
      setIsExiting(true);
      isStandby.current = true;
      await recycleCurrentNotepad();
    } catch (error) {
      isStandby.current = false;
      setIsExiting(false);
      setStatus("保存失败");
      setErrorMessage(getErrorMessage(error));
    } finally {
      closingRef.current = false;
      setIsClosing(false);
    }
  }, [hasDraftContent, noteSurfaceAutoSave, saveNote]);

  useEffect(() => {
    const unlisten = getCurrentWindow().onCloseRequested((event) => {
      event.preventDefault();
      void handleClose();
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [handleClose]);

  const copyTileContent = useCallback(async () => {
    setErrorMessage(null);
    try {
      const clipboard = navigator.clipboard;
      if (!clipboard?.writeText) {
        throw new Error("当前环境不支持复制");
      }
      await clipboard.writeText(content);
      setStatus("已复制");
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    }
  }, [content]);

  useEffect(() => {
    function handleSurfaceActionRequest(event: Event) {
      const action = surfaceActionFromEvent(event);
      if (!action) return;

      if (action === "copy") {
        void copyTileContent();
        return;
      }

      if (action === "save") {
        void handleSave();
        return;
      }

      if (action === "close") {
        void handleClose();
        return;
      }

      void switchSurfaceMode("pad");
    }

    window.addEventListener(
      NOTE_SURFACE_ACTION_EVENT,
      handleSurfaceActionRequest,
    );
    return () => {
      window.removeEventListener(
        NOTE_SURFACE_ACTION_EVENT,
        handleSurfaceActionRequest,
      );
    };
  }, [copyTileContent, handleClose, handleSave, switchSurfaceMode]);

  useEffect(() => {
    if (
      isStandby.current ||
      isClosing ||
      !noteSurfaceAutoSave ||
      mode !== "new" ||
      status !== "未保存"
    ) {
      return undefined;
    }
    if (!hasDraftContent()) return undefined;

    const timer = window.setTimeout(() => {
      void handleSave();
    }, 900);

    return () => window.clearTimeout(timer);
  }, [
    content,
    title,
    group,
    handleSave,
    hasDraftContent,
    isClosing,
    mode,
    noteSurfaceAutoSave,
    status,
  ]);

  const handleDrag = (event: MouseEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest("button,input,textarea")) return;
    void startCurrentWindowDrag().catch(() => undefined);
  };

  const resetDraft = () => {
    draftRef.current = emptyDraft();
    setEditingNoteId(null);
    setTitle("");
    setContent("");
    setGroup(noGroup);
    setMode("new");
    setStatus("空");
    setErrorMessage(null);
  };

  const openGroupPicker = () => {
    setErrorMessage(null);
    setMode("group");
    void refreshNotes().catch((error) => setErrorMessage(getErrorMessage(error)));
  };

  const selectGroup = (destination: NoteGroupTarget) => {
    const draft = draftRef.current;
    draft.group = destination;
    draft.revision++;
    setGroup(destination);
    setStatus("未保存");
    setErrorMessage(null);
    setMode("new");
  };

  const parent = group.type === "existing" ? notes.find((note) => note.id === group.id) : undefined;
  const groupTitle = group.type === "named" ? group.title : parent ? getDisplayTitle(parent) : null;

  const isTile = surfaceMode === "tile";
  const tileNoteId = editingNoteId ?? initialNoteId ?? "";
  const tileTitle = title.trim();
  const enterClass = hasEnteredOnce.current ? "" : "animate-window-enter";
  const surfaceWrapperClassName = `w-full h-screen flex flex-col bg-transparent p-0 ${isExiting ? "animate-window-exit" : enterClass}`;
  const padSurfaceClassName =
    "relative noise-bg w-full h-full min-h-0 bg-cloud overflow-hidden flex flex-col flex-1 border border-paper-deep/40 rounded-xl shadow-[0_1px_10px_rgba(26,26,24,0.06)] transition-all duration-200 ease-out";

  return (
    <div className={surfaceWrapperClassName}>
      {isTile ? (
        <Tile
          title={tileTitle || undefined}
          content={errorMessage || content}
          color={tileColor}
          fontSize={surfaceFontSize}
          width="100%"
          className="h-full cursor-grab active:cursor-grabbing"
          data-surface-mode={surfaceMode}
          data-context-menu="tile"
          data-note-id={tileNoteId}
          onMouseDown={handleDrag}
        >
          <SurfaceResizeHandles />
        </Tile>
      ) : (
        <div className={padSurfaceClassName} data-surface-mode={surfaceMode}>
          <>
            <div
              className="flex items-center justify-between px-3 pt-3 pb-0 cursor-grab active:cursor-grabbing"
              onMouseDown={handleDrag}
            >
              <div className="flex items-center gap-0.5">
                <button
                  onClick={() => { if (mode === "new") resetDraft(); else setMode("new"); }}
                  disabled={isClosing}
                  className={`relative px-2.5 py-1.5 text-[13px] rounded-t-lg transition-all duration-200 cursor-pointer ${
                    mode === "new"
                      ? "text-bamboo font-medium"
                      : "text-ink-ghost hover:text-ink-faint"
                  }`}
                >
                  {editingNoteId ? "编辑" : "新建"}
                  {mode === "new" && (
                    <div className="absolute bottom-0 left-3 right-3 h-[2px] bg-bamboo rounded-full" />
                  )}
                </button>
                <button
                  onClick={() => setMode("open")}
                  disabled={isClosing}
                  className={`relative px-2.5 py-1.5 text-[13px] rounded-t-lg transition-all duration-200 cursor-pointer ${
                    mode === "open"
                      ? "text-bamboo font-medium"
                      : "text-ink-ghost hover:text-ink-faint"
                  }`}
                >
                  打开
                  {mode === "open" && (
                    <div className="absolute bottom-0 left-3 right-3 h-[2px] bg-bamboo rounded-full" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => mode === "group" ? setMode("new") : openGroupPicker()}
                  disabled={isClosing}
                  aria-expanded={mode === "group"}
                  title={groupTitle ? `当前分组：${groupTitle}` : "选择或新建分组"}
                  className={`relative px-2.5 py-1.5 text-[13px] rounded-t-lg transition-all duration-200 cursor-pointer ${mode === "group" ? "text-bamboo font-medium" : "text-ink-ghost hover:text-ink-faint"}`}
                >
                  分组
                  {mode === "group" && <span className="absolute bottom-0 left-3 right-3 h-[2px] bg-bamboo rounded-full" />}
                </button>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => void handlePin()}
                  disabled={isClosing}
                  className="group w-7 h-7 flex items-center justify-center rounded-lg transition-all duration-200 cursor-pointer text-ink-ghost hover:text-ink-faint hover:bg-paper-warm"
                  title="转为磁贴"
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M12 17v5" />
                    <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 1 1 0 0 0 1-1V4a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v1a1 1 0 0 0 1 1 1 1 0 0 1 1 1z" />
                  </svg>
                </button>

                <button
                  onClick={() => void handleClose()}
                  disabled={isClosing}
                  className="group w-7 h-7 flex items-center justify-center rounded-lg text-ink-ghost hover:bg-danger-bg hover:text-red-400 transition-all duration-200 cursor-pointer"
                  title="关闭"
                >
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                  >
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="mx-4 mt-1 h-px bg-paper-deep/50" />

            {mode === "new" ? (
              <div
                data-pad-editor-body="true"
                className="px-4 pt-3 pb-2 flex flex-col flex-1 min-h-0"
              >
                <input
                  type="text"
                  value={title}
                  disabled={isClosing}
                  onChange={(event) => {
                    draftRef.current.title = event.target.value;
                    draftRef.current.revision++;
                    setTitle(event.target.value);
                    setStatus("未保存");
                    setErrorMessage(null);
                  }}
                  placeholder="标题（可选）"
                  className="w-full font-display font-medium text-ink placeholder:text-ink-ghost/60 mb-2 tracking-wide shrink-0"
                  style={{ fontSize: `${surfaceFontSize}px` }}
                />

                {groupTitle && (
                  <button type="button" title={groupTitle} disabled={isClosing} onClick={openGroupPicker} className="mb-1 max-w-full shrink-0 self-start truncate text-left text-[11px] text-bamboo hover:underline cursor-pointer">
                    分组 · {groupTitle}
                  </button>
                )}

                <textarea
                  ref={contentRef}
                  value={content}
                  disabled={isClosing}
                  onChange={(event) => {
                    draftRef.current.content = event.target.value;
                    draftRef.current.revision++;
                    setContent(event.target.value);
                    setStatus("未保存");
                    setErrorMessage(null);
                  }}
                  placeholder="写点什么……"
                  className="w-full flex-1 min-h-0 pb-2 leading-relaxed text-ink-soft font-body placeholder:text-ink-ghost/50"
                  style={{ fontSize: `${surfaceFontSize}px` }}
                />

                <div className="flex items-center justify-between mt-auto pt-2 border-t border-paper-deep/30 shrink-0">
                  <span role={errorMessage ? "status" : undefined} title={errorMessage ?? undefined} className={`min-w-0 text-[11px] font-mono tabular-nums ${errorMessage ? "pr-1 text-red-500" : "truncate text-ink-ghost"}`}>
                    {errorMessage ?? `${countNoteChars(content)} 字 · ${status}`}
                  </span>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      onClick={resetDraft}
                      disabled={isClosing}
                      className="px-2.5 py-1.5 text-[12px] text-ink-faint hover:text-ink-soft rounded-lg hover:bg-paper-warm transition-all duration-200 cursor-pointer"
                    >
                      清空
                    </button>
                    <button
                      onClick={() => void handleSave()}
                      disabled={isClosing}
                      className="px-3.5 py-1.5 text-[12px] text-cloud bg-bamboo hover:bg-bamboo-light rounded-lg transition-all duration-200 font-medium cursor-pointer"
                    >
                      保存
                    </button>
                  </div>
                </div>
              </div>
            ) : mode === "group" ? (
              <NoteGroupPicker notes={notes} noteId={editingNoteId} disabled={isClosing} error={errorMessage} onSelect={selectGroup} onCancel={() => setMode("new")} />
            ) : (
              <div className="p-2 flex-1 min-h-0 overflow-y-auto">
                <div className="space-y-0.5">
                  {notes.map((note) => (
                    <button
                      key={note.id}
                      onClick={() => void handleOpenNote(note.id)}
                      onMouseEnter={() => setHoveredNote(note.id)}
                      onMouseLeave={() => setHoveredNote(null)}
                      className="w-full text-left px-3.5 py-3 rounded-xl transition-all duration-200 cursor-pointer group hover:bg-paper-warm/70"
                    >
                      <div className="flex items-baseline justify-between mb-0.5">
                        <span className="text-[13px] font-display font-medium text-ink-soft group-hover:text-ink transition-colors truncate pr-3">
                          {getDisplayTitle(note)}
                        </span>
                        <span className="text-[11px] text-ink-ghost font-mono tabular-nums">
                          {formatShortDate(note.updatedAt)}
                        </span>
                      </div>
                      <p className="text-[12px] text-ink-ghost leading-relaxed line-clamp-1 group-hover:text-ink-faint transition-colors">
                        {note.preview || "空白笔记"}
                      </p>
                      {hoveredNote === note.id && (
                        <div className="mt-1.5 h-px bg-bamboo/10 transition-all duration-300" />
                      )}
                    </button>
                  ))}
                  {notes.length === 0 && (
                    <div className="px-4 py-8 text-center text-[12px] text-ink-ghost">
                      还没有可打开的笔记
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
          <SurfaceResizeHandles />
        </div>
      )}
    </div>
  );
}
