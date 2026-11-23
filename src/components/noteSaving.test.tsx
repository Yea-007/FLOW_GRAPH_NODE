// @vitest-environment happy-dom

import { act } from "react";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createNote, getNote, listNotes, saveGroupedNote, saveNoteStyles, updateNote } from "../features/notes/api";
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
  saveGroupedNote: vi.fn(),
  saveNoteStyles: vi.fn(),
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
  vi.mocked(saveGroupedNote).mockReset();
  vi.mocked(saveNoteStyles).mockReset().mockResolvedValue(undefined);
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

  test("keeps an empty pad editable when the pin button is clicked", async () => {
    await mount(<NotePad />);
    await type("textarea", "  ");
    await click("转为磁贴");
    await advance(1000);
    expect(container.querySelector('[data-surface-mode="pad"] textarea')).toBeTruthy();
    expect(container.textContent).toContain("填写标题或正文后再转为磁贴");
    expect(createNote).not.toHaveBeenCalled();
  });

  test("pins a title-only draft without saving when auto-save is off", async () => {
    vi.mocked(getConfig).mockResolvedValue({ ...config, noteSurfaceAutoSave: false });
    await mount(<NotePad />);
    await type('input[placeholder="标题（可选）"]', "桌面待办");
    await click("转为磁贴");
    const tile = container.querySelector('[data-surface-mode="tile"]');
    expect(tile?.textContent).toBe("桌面待办");
    expect(createNote).not.toHaveBeenCalled();
  });

  test("uses an existing group when its exact name is submitted and preserves the draft", async () => {
    const group = note("circuits", "", "数字电路复习");
    vi.mocked(listNotes).mockResolvedValue([metadataFromNote(group)]);
    vi.mocked(saveGroupedNote).mockResolvedValue({ ...note("saved-note", "章末小结"), parentId: group.id });
    await mount(<NotePad />);
    await type("textarea", "章末小结");
    await click("分组");
    await type('input[aria-label="分组名称"]', group.title);
    await act(async () => { container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(container.querySelector("textarea")?.value).toBe("章末小结");
    expect(container.textContent).toContain("分组 · 数字电路复习");
    await click("关闭");
    expect(saveGroupedNote).toHaveBeenCalledExactlyOnceWith(null, { title: "", content: "章末小结" }, { type: "existing", id: group.id });
    expect(createNote).not.toHaveBeenCalled();
    expect(recycleCurrentNotepad).toHaveBeenCalledOnce();
  });

  test("groups an already auto-saved draft under a new name using its existing note ID", async () => {
    await mount(<NotePad />);
    await type("textarea", "第一条记录");
    await advance(900);
    expect(createNote).toHaveBeenCalledOnce();
    vi.mocked(saveGroupedNote).mockResolvedValue({ ...note("new-note", "第一条记录"), parentId: "group" });
    await click("分组");
    await type('input[aria-label="分组名称"]', "  随手记录  ");
    await click("新建分组「随手记录」");
    await click("保存");
    expect(saveGroupedNote).toHaveBeenCalledExactlyOnceWith("new-note", { title: "", content: "第一条记录" }, { type: "named", title: "随手记录" });
    await type("textarea", "继续写同一篇");
    await advance(900);
    expect(saveGroupedNote).toHaveBeenCalledOnce();
    expect(updateNote).toHaveBeenCalledExactlyOnceWith("new-note", { title: "", content: "继续写同一篇" });
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

describe("main-window view switching", () => {
  test("keeps both panes mounted and restores the last scrolled preview line", async () => {
    const origin = note("long-note", "开头\n\n中间\n\n结尾");
    vi.mocked(listNotes).mockResolvedValue([metadataFromNote(origin)]);
    vi.mocked(getNote).mockResolvedValue(origin);
    vi.mocked(getConfig).mockResolvedValue({ ...config, defaultViewMode: "split" });
    await mount(<MainWindow />);

    const editor = container.querySelector("textarea")!;
    const preview = container.querySelector<HTMLDivElement>('[aria-label="笔记预览"]')!;
    const [first, middle] = preview.querySelectorAll<HTMLElement>("[data-preview-line]");
    const rect = (top: number, height: number) => ({ top, bottom: top + height, height }) as DOMRect;
    vi.spyOn(preview, "getBoundingClientRect").mockReturnValue(rect(100, 150));
    vi.spyOn(first, "getBoundingClientRect").mockReturnValue(rect(10, 20));
    vi.spyOn(middle, "getBoundingClientRect").mockImplementation(() =>
      rect((editor.closest("[hidden]") ? 160 : 195) - preview.scrollTop, 20),
    );
    editor.setSelectionRange(3, 5);
    preview.scrollTop = 100;
    await act(async () => { preview.dispatchEvent(new Event("scroll")); });

    await click("预览");
    expect(editor.closest("[hidden]")).not.toBeNull();
    expect(preview.closest("[hidden]")).toBeNull();
    expect(preview.scrollTop).toBe(65);
    expect(container.querySelector("[data-preview-line]")).toBe(first);

    await click("分栏");
    expect(editor.closest("[hidden]")).toBeNull();
    expect(preview.scrollTop).toBe(100);
    expect(container.querySelector("textarea")).toBe(editor);
    expect([editor.selectionStart, editor.selectionEnd]).toEqual([3, 5]);
    expect(getNote).toHaveBeenCalledOnce();
  });
});

describe("main-window bookmarks", () => {
  test("marks the chosen preview line, saves its manual name, and jumps without reloading the note", async () => {
    const content = "第一行😀\r\n第二行 **粗体**\r\n第三行";
    const first = note("first", content, "第一篇");
    const second = note("second", content, "第二篇");
    vi.mocked(listNotes).mockResolvedValue([metadataFromNote(first), metadataFromNote(second)]);
    vi.mocked(getNote).mockImplementation(async (id) => id === first.id ? first : second);
    vi.mocked(saveNoteStyles).mockImplementation(async (id, document) => {
      if (id === first.id) first.styleDocument = document;
    });
    await mount(<MainWindow />);

    expect(container.querySelector('[title="删除笔记"]')?.nextElementSibling?.getAttribute("aria-label")).toBe("标记书签");
    await click("标记书签");
    const selectedLine = container.querySelector<HTMLElement>('[data-preview-line="7"]')!;
    expect(selectedLine.textContent).toContain("第二行");
    await act(async () => { selectedLine.click(); });
    expect(selectedLine.hasAttribute("data-bookmarked")).toBe(true);
    expect(container.querySelector('[data-preview-line="0"]')?.hasAttribute("data-bookmarked")).toBe(false);
    expect(container.querySelector('[aria-label="当前笔记书签"]')).toBeNull();
    await click("书签");
    expect(container.querySelector('[aria-label="当前笔记书签"]')?.textContent).toContain("未命名");
    await click("重命名书签");
    await type('input[aria-label="书签名称"]', "复习重点");
    await click("确定");
    await click("保存");
    expect(first.styleDocument?.bookmarks).toEqual([{ id: expect.any(String), name: "复习重点", offset: 7 }]);

    const scroller = selectedLine.closest<HTMLElement>(".overflow-y-auto")!;
    const scrollTo = vi.spyOn(scroller, "scrollTo");
    vi.spyOn(selectedLine, "getBoundingClientRect").mockReturnValue({ top: 420, height: 20 } as DOMRect);
    await click("复习重点第 2 行");
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ top: 430 }));
    expect(getNote).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-preview-line="7"]')).toBe(selectedLine);

    await act(async () => { container.querySelector<HTMLElement>('[data-note-id="second"]')!.click(); });
    await click("书签");
    expect(container.textContent).toContain("这篇笔记还没有书签");
    expect(container.querySelector("[data-bookmarked]")).toBeNull();
    await act(async () => { container.querySelector<HTMLElement>('[data-note-id="first"]')!.click(); });
    await click("书签");
    expect(container.querySelector('[aria-label="当前笔记书签"]')?.textContent).toContain("复习重点");
    expect(container.querySelector('[data-preview-line="7"]')?.hasAttribute("data-bookmarked")).toBe(true);
  });
});

describe("main-window task editing from preview", () => {
  test("updates only the chosen task and uses the normal history and auto-save", async () => {
    const prefix = "\uFEFF> 1. [ ] 重复任务😀\r\n>    - [x] 嵌套任务\r\n\r\n";
    const suffix = "\r\n\r\n```md\r\n- [ ] 重复任务\r\n```";
    const content = prefix + "- [ ] 重复任务" + suffix;
    const changed = prefix + "- [X] 重复任务" + suffix;
    const origin = note("tasks", content, "任务清单");
    const bookmarks = [{ id: "task", name: "末尾任务", offset: prefix.length }];
    const ranges = [{ start: prefix.length + 6, end: prefix.length + 10, color: "red" }];
    origin.styleDocument = { content, ranges, bookmarks };
    vi.mocked(listNotes).mockResolvedValue([metadataFromNote(origin)]);
    vi.mocked(getNote).mockResolvedValue(origin);
    vi.mocked(getConfig).mockResolvedValue({ ...config, defaultViewMode: "split", noteAutoSave: true });
    await mount(<MainWindow />);

    const checks = () => [...container.querySelectorAll<HTMLInputElement>('[aria-label="任务完成状态"]')];
    const source = container.querySelector("textarea")!;
    const normalized = (value: string) => value.replace(/\r\n/g, "\n");
    const preview = container.querySelector('[aria-label="笔记预览"]')!;
    const toolbar = container.querySelector('[aria-label="预览文字格式"]')!;
    expect(toolbar.nextElementSibling).toBe(preview);
    expect(checks().map((check) => check.checked)).toEqual([false, true, false]);
    await act(async () => { checks()[2].click(); });
    expect(normalized(source.value)).toBe(normalized(changed));
    expect(checks().map((check) => check.checked)).toEqual([false, true, true]);
    await act(async () => { checks()[1].click(); });
    expect(source.value).toContain("- [ ] 嵌套任务");
    await click("撤销 Ctrl+Z");
    expect(normalized(source.value)).toBe(normalized(changed));
    await click("撤销 Ctrl+Z");
    expect(normalized(source.value)).toBe(normalized(content));
    await click("重做 Ctrl+Y");
    expect(normalized(source.value)).toBe(normalized(changed));

    await advance(900);
    expect(updateNote).toHaveBeenCalledExactlyOnceWith(origin.id, { title: origin.title, content: changed });
    expect(saveNoteStyles).toHaveBeenCalledExactlyOnceWith(origin.id, { content: changed, ranges, bookmarks });
  });

  test("lets preview mode change tasks, while plain text stays read-only", async () => {
    const origin = note("preview-only", "一段普通文字\n\n- [ ] 待办", "任务");
    vi.mocked(listNotes).mockResolvedValue([metadataFromNote(origin)]);
    vi.mocked(getNote).mockResolvedValue(origin);
    vi.mocked(getConfig).mockResolvedValue({ ...config, defaultViewMode: "preview" });
    await mount(<MainWindow />);

    const plain = container.querySelector<HTMLElement>('[data-preview-line="0"]')!;
    await act(async () => { plain.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); });
    expect(container.querySelector("textarea")?.closest("[hidden]")).not.toBeNull();

    const task = container.querySelector<HTMLInputElement>('[aria-label="任务完成状态"]')!;
    await click("标记书签");
    await act(async () => { task.click(); });
    expect(task.checked).toBe(false);
    expect(task.hasAttribute("data-bookmarked")).toBe(true);
    await act(async () => { task.click(); });
    expect(task.checked).toBe(true);
    await click("保存");
    expect(updateNote).toHaveBeenCalledExactlyOnceWith(origin.id, { title: origin.title, content: "一段普通文字\n\n- [X] 待办" });
  });
});
