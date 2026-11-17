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
}

export interface Note extends Omit<NoteMetadata, "preview"> {
  content: string;
  styleDocument?: { content: string; ranges: import("../markdown/styleRanges").StyleRange[] } | null;
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
