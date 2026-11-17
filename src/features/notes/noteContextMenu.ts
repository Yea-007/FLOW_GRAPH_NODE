export type NoteContextMenuAction = "newChild" | "export" | "delete";

export interface NoteContextMenuItem {
  action: NoteContextMenuAction;
  label: string;
  tone?: "danger";
  separator?: boolean;
}

export const noteContextMenuItems: NoteContextMenuItem[] = [
  { action: "newChild", label: "新建子笔记" },
  { action: "export", label: "导出 Markdown", separator: true },
  { action: "delete", label: "删除笔记", tone: "danger" },
];
