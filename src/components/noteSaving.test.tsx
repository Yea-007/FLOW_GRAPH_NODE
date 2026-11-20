// @vitest-environment happy-dom

import { act } from "react";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createNote, getNote, listNotes, updateNote } from "../features/notes/api";
import { metadataFromNote } from "../features/notes/noteUtils";
import type { Note } from "../features/notes/types";
import { getConfig } from "../features/settings/api";
import type { AppConfig } from "../features/settings/types";
import { recycleCurrentNotepad } from "../features/windows/controls";
import { MainWindow } from "./MainWindow";
import { NotePad } from "./NotePad";

const events = vi.hoisted(() => ({
  listeners: new Map<string, Set<(event: { payload: unknown }) => void>>(),
  close: undefined as ((event: { preventDefault: () => void }) => void) | undefined,
}));

vi.mock("@tauri-apps/api/event", () => ({
  emit: vi.fn(async () => undefined),
  listen: vi.fn(async (name: string, callback: (event: { payload: unknown }) => void) => {
    const listeners = events.listeners.get(name) ?? new Set();
    listeners.add(callback);
    events.listeners.set(name, listeners);
    return () => { listeners.delete(callback); };
  }),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    label: "notepad-test",
    onCloseRequested: async (callback: typeof events.close) => {
      events.close = callback;
      return () => { if (events.close === callback) events.close = undefined; };
    },
  }),
}));

vi.mock("../features/notes/api", async (importOriginal) => ({
  ...await importOriginal<typeof import("../features/notes/api")>(),
  createNote: vi.fn(),
  getNote: vi.fn(),
  listNotes: vi.fn(),
  updateNote: vi.fn(),
}));

vi.mock("../features/settings/api", async (importOriginal) => ({
  ...await importOriginal<typeof import("../features/settings/api")>(),
  getConfig: vi.fn(),
}));

vi.mock("../features/windows/controls", () => ({
  recycleCurrentNotepad: vi.fn(async () => undefined),
  showCurrentWindow: vi.fn(async () => undefined),
  setCurrentWindowAlwaysOnTop: vi.fn(async () => undefined),
  getCurrentWindowBounds: vi.fn(async () => ({ x: 0, y: 0, width: 260, height: 260 })),
  animateCurrentWindowBounds: vi.fn(async () => undefined),
  startCurrentWindowDrag: vi.fn(async () => undefined),
  startCurrentWindowResize: vi.fn(async () => undefined),
  closeCurrentWindow: vi.fn(async () => undefined),
  minimizeCurrentWindow: vi.fn(async () => undefined),
  toggleMaximizeCurrentWindow: vi.fn(async () => undefined),
  isCurrentWindowMaximized: vi.fn(async () => false),
}));

const config: AppConfig = {
  notesDir: "D:\\notes",
  globalShortcut: "Ctrl+Space",
  closeToTray: true,
  autostart: false,
  defaultViewMode: "edit",
  noteAutoSave: false,
  noteSurfaceAutoSave: true,
  tileColor: "#f6f3ec",
  tileColorMode: "custom",
  theme: "light",
  fontSize: 14,
  surfaceFontSize: 14,
};

function note(id: string, content: string, title = ""): Note {
  return {
    id, title, content,
    fileName: `${id}.md`,
    createdAt: "2026-11-20T00:00:00Z",
    updatedAt: "2026-11-20T00:00:00Z",
    wordCount: content.length,
    parentId: null,
    sortOrder: 0,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

let container: HTMLDivElement;
let root: Root;

async function mount(component: ReactNode) {
  await act(async () => { root.render(component); });
}

async function type(selector: string, value: string) {
  const input = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!;
  const prototype = input instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function click(label: string) {
  const button = [...container.querySelectorAll("button")].find(
    (item) => item.title === label || item.textContent === label,
  );
  expect(button, `button ${label}`).toBeDefined();
  await act(async () => { button!.click(); });
}

async function advance(milliseconds: number) {
  await act(async () => { await vi.advanceTimersByTimeAsync(milliseconds); });
}

async function emit(name: string, payload: unknown) {
  await act(async () => {
    events.listeners.get(name)?.forEach((callback) => callback({ payload }));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createNote).mockReset().mockImplementation(async (request) => note("new-note", request.content, request.title));
  vi.mocked(updateNote).mockReset().mockImplementation(async (id, request) => note(id, request.content, request.title));
  vi.mocked(getNote).mockReset();
  vi.mocked(listNotes).mockReset().mockResolvedValue([]);
  vi.mocked(getConfig).mockReset().mockResolvedValue(config);
  events.listeners.clear();
  events.close = undefined;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("small-window saving", () => {
  test("saves the latest text after typing pauses", async () => {
    await mount(<NotePad />);
    await type("textarea", "第一段");
    await advance(600);
    await type("textarea", "第一段，继续写");
    await advance(600);
    expect(createNote).not.toHaveBeenCalled();
    await advance(300);
    expect(createNote).toHaveBeenCalledExactlyOnceWith({ title: "", content: "第一段，继续写" });
    expect(container.textContent).toContain("已保存");
  });

  test("saves immediately before closing, without waiting for the timer", async () => {
    const pending = deferred<Note>();
    vi.mocked(createNote).mockReturnValueOnce(pending.promise);
    await mount(<NotePad />);
    await type("textarea", "输入后立即关闭");
    await click("关闭");
    expect(createNote).toHaveBeenCalledExactlyOnceWith({ title: "", content: "输入后立即关闭" });
    expect(recycleCurrentNotepad).not.toHaveBeenCalled();
    expect(container.querySelector("textarea")!.disabled).toBe(true);
    await act(async () => { pending.resolve(note("new-note", "输入后立即关闭")); });
    expect(recycleCurrentNotepad).toHaveBeenCalledOnce();
    await advance(2000);
    expect(createNote).toHaveBeenCalledOnce();
  });

  test("keeps the draft open when saving fails and allows retry", async () => {
    vi.mocked(createNote).mockRejectedValueOnce(new Error("磁盘写入失败"));
    await mount(<NotePad />);
    await type("textarea", "不能丢掉的内容");
    await click("关闭");
    expect(recycleCurrentNotepad).not.toHaveBeenCalled();
    expect(container.textContent).toContain("磁盘写入失败");
    expect(container.querySelector("textarea")!.value).toBe("不能丢掉的内容");
    expect(container.querySelector("textarea")!.disabled).toBe(false);
    await click("关闭");
    expect(recycleCurrentNotepad).toHaveBeenCalledOnce();
  });

  test("serializes an in-flight auto-save and closing with newer text", async () => {
    const pending = deferred<Note>();
    vi.mocked(createNote).mockReturnValueOnce(pending.promise);
    await mount(<NotePad />);
    await type("textarea", "旧内容");
    await advance(900);
    await type("textarea", "最新内容");
    await click("关闭");
    expect(createNote).toHaveBeenCalledOnce();
    expect(recycleCurrentNotepad).not.toHaveBeenCalled();
    await act(async () => { pending.resolve(note("created-id", "旧内容")); });
    expect(updateNote).toHaveBeenCalledExactlyOnceWith("created-id", { title: "", content: "最新内容" });
    expect(recycleCurrentNotepad).toHaveBeenCalledOnce();
  });

  test("does not mark newer edits as saved when an older save completes", async () => {
    const pending = deferred<Note>();
    vi.mocked(createNote).mockReturnValueOnce(pending.promise);
    await mount(<NotePad />);
    await type("textarea", "旧内容");
    await advance(900);
    await type("textarea", "最新内容");
    await act(async () => { pending.resolve(note("created-id", "旧内容")); });
    expect(container.textContent).toContain("未保存");
    await advance(900);
    expect(updateNote).toHaveBeenCalledExactlyOnceWith("created-id", { title: "", content: "最新内容" });
    expect(container.textContent).toContain("已保存");
  });

  test("does not attach a completed save to a newly cleared draft", async () => {
    const pending = deferred<Note>();
    vi.mocked(createNote).mockReturnValueOnce(pending.promise);
    await mount(<NotePad />);
    await type("textarea", "第一篇");
    await click("保存");
    await click("清空");
    await type("textarea", "第二篇");
    await act(async () => { pending.resolve(note("first-id", "第一篇")); });
    await advance(900);
    expect(createNote).toHaveBeenCalledTimes(2);
    expect(createNote).toHaveBeenLastCalledWith({ title: "", content: "第二篇" });
    expect(updateNote).not.toHaveBeenCalled();
  });

  test("honors auto-save changes in an already-open window", async () => {
    vi.mocked(getConfig).mockResolvedValue({ ...config, noteSurfaceAutoSave: false });
    await mount(<NotePad />);
    await type("textarea", "待保存");
    await advance(1000);
    expect(createNote).not.toHaveBeenCalled();
    await emit("config-changed", { noteSurfaceAutoSave: true });
    await advance(900);
    expect(createNote).toHaveBeenCalledOnce();
    await emit("config-changed", { noteSurfaceAutoSave: false });
    await type("textarea", "手动保存内容");
    await click("关闭");
    expect(updateNote).not.toHaveBeenCalled();
  });

  test("also flushes text on a native window close request", async () => {
    await mount(<NotePad />);
    await type("textarea", "Alt+F4 前的内容");
    const preventDefault = vi.fn();
    await act(async () => { events.close!({ preventDefault }); });
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(createNote).toHaveBeenCalledExactlyOnceWith({ title: "", content: "Alt+F4 前的内容" });
    expect(recycleCurrentNotepad).toHaveBeenCalledOnce();
  });

  test("closing an empty window does not create a blank note", async () => {
    await mount(<NotePad />);
    await click("关闭");
    expect(createNote).not.toHaveBeenCalled();
    expect(recycleCurrentNotepad).toHaveBeenCalledOnce();
  });

  test("starts a separate note when a closed pooled window is activated again", async () => {
    await mount(<NotePad />);
    await type("textarea", "第一次打开的内容");
    await click("关闭");
    await emit("notepad:activate", "notepad-test");
    expect(container.querySelector("textarea")!.value).toBe("");
    await type("textarea", "再次打开的内容");
    await advance(900);
    expect(createNote).toHaveBeenCalledTimes(2);
    expect(createNote).toHaveBeenLastCalledWith({ title: "", content: "再次打开的内容" });
    expect(updateNote).not.toHaveBeenCalled();
  });
});

describe("main-window synchronization", () => {
  test("adds a note saved in another window to the note list", async () => {
    await mount(<MainWindow />);
    const saved = note("quick-note", "快捷便签正文", "来自悬浮贴");
    vi.mocked(listNotes).mockResolvedValue([metadataFromNote(saved)]);
    vi.mocked(getNote).mockResolvedValue(saved);
    await emit("notes-changed", saved.id);
    expect(container.textContent).toContain("来自悬浮贴");
    await act(async () => {
      container.querySelector<HTMLElement>('[data-note-id="quick-note"]')!.click();
    });
    expect(container.querySelector("textarea")!.value).toBe("快捷便签正文");
  });

  test("refreshes a clean selected note after another window saves it", async () => {
    const original = note("shared", "原正文", "共享笔记");
    vi.mocked(listNotes).mockResolvedValue([metadataFromNote(original)]);
    vi.mocked(getNote).mockResolvedValue(original);
    await mount(<MainWindow />);
    vi.mocked(getNote).mockResolvedValue(note("shared", "悬浮贴修改的正文", "共享笔记"));
    await emit("notes-changed", "shared");
    expect(container.querySelector("textarea")!.value).toBe("悬浮贴修改的正文");
  });

  test("preserves unsaved main-window edits when another window saves", async () => {
    const original = note("shared", "原正文", "共享笔记");
    vi.mocked(listNotes).mockResolvedValue([metadataFromNote(original)]);
    vi.mocked(getNote).mockResolvedValue(original);
    await mount(<MainWindow />);
    await type("textarea", "主窗口还没保存的正文");
    await emit("notes-changed", "shared");
    expect(getNote).toHaveBeenCalledOnce();
    expect(container.querySelector("textarea")!.value).toBe("主窗口还没保存的正文");
  });

  test("preserves edits made while a refresh is in flight", async () => {
    const original = note("shared", "原正文", "共享笔记");
    vi.mocked(listNotes).mockResolvedValue([metadataFromNote(original)]);
    vi.mocked(getNote).mockResolvedValue(original);
    await mount(<MainWindow />);
    const pending = deferred<Note>();
    vi.mocked(getNote).mockReturnValueOnce(pending.promise);
    await emit("notes-changed", "shared");
    await type("textarea", "刷新期间输入的正文");
    await act(async () => { pending.resolve(note("shared", "小窗保存的正文")); });
    expect(container.querySelector("textarea")!.value).toBe("刷新期间输入的正文");
  });

  test("preserves title edits made while a refresh is in flight", async () => {
    const original = note("shared", "原正文", "原标题");
    vi.mocked(listNotes).mockResolvedValue([metadataFromNote(original)]);
    vi.mocked(getNote).mockResolvedValue(original);
    await mount(<MainWindow />);
    const pending = deferred<Note>();
    vi.mocked(getNote).mockReturnValueOnce(pending.promise);
    await emit("notes-changed", "shared");
    await type('input[placeholder="无标题笔记"]', "主窗口修改的标题");
    await act(async () => { pending.resolve(note("shared", "小窗正文", "小窗标题")); });
    expect(container.querySelector<HTMLInputElement>('input[placeholder="无标题笔记"]')!.value).toBe("主窗口修改的标题");
  });
});
