import { describe, expect, test } from "vitest";
import { noteContextMenuItems } from "./noteContextMenu";

describe("noteContextMenuItems", () => {
  test("keeps note list actions focused on export and delete", () => {
    expect(noteContextMenuItems).toEqual([
      { action: "newChild", label: "新建子笔记" },
      { action: "export", label: "导出 Markdown", separator: true },
      { action: "delete", label: "删除笔记", tone: "danger" },
    ]);
  });
});
