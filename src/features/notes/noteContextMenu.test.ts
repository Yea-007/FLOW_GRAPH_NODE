import { describe, expect, test } from "vitest";
import { noteContextMenuItems } from "./noteContextMenu";

describe("noteContextMenuItems", () => {
  test("offers icon editing from the note list", () => {
    expect(noteContextMenuItems).toEqual([
      { action: "newChild", label: "新建子笔记" },
      { action: "changeIcon", label: "更换图标" },
      { action: "export", label: "导出 Markdown", separator: true },
      { action: "delete", label: "删除笔记", tone: "danger" },
    ]);
  });
});
