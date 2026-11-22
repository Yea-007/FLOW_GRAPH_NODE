import type { EditorDocument } from "../markdown/documentModel";

export type NoteIcon = { type: "emoji" | "image"; value: string };

export type NoteDropPosition = "before" | "after" | "inside";

export type NoteGroupTarget =
  | { type: "existing"; id: string }
  | { type: "named"; title: string }
  | { type: "root" };

export interface NoteMetadata {
  id: string;
  title: string;
  fileName: string;
  createdAt: string;
  updatedAt: string;
  wordCount: number;
  preview: string;
  parentId: string | null;
  sortOrder: number;
  icon?: NoteIcon | null;
}

export interface Note extends Omit<NoteMetadata, "preview"> {
  content: string;
  styleDocument?: EditorDocument | null;
}

export interface SaveNoteRequest {
  title: string;
  content: string;
  parentId?: string | null;
}

export interface NoteTreeNode extends NoteMetadata {
  children: NoteTreeNode[];
}

export interface NoteReorderEntry {
  id: string;
  sortOrder: number;
}
