import type { Note, NoteMetadata, NoteTreeNode } from "./types";

export function getDisplayTitle(note: Pick<NoteMetadata, "title" | "preview">): string {
  const title = note.title.trim();
  if (title) return title;

  const preview = note.preview.trim();
  if (preview) return preview.slice(0, 20);

  return "无标题笔记";
}

export function buildPreview(content: string): string {
  return content.split(/\s+/).filter(Boolean).join(" ").slice(0, 80);
}

export function countNoteChars(content: string): number {
  let count = 0;
  for (const ch of content) {
    if (!/\s/.test(ch)) count++;
  }
  return count;
}

export function metadataFromNote(note: Note): NoteMetadata {
  return {
    id: note.id,
    title: note.title,
    fileName: note.fileName,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
    wordCount: note.wordCount,
    preview: buildPreview(note.content),
    parentId: note.parentId,
    sortOrder: note.sortOrder,
    icon: note.icon,
  };
}

export function buildNoteTree(notes: NoteMetadata[]): NoteTreeNode[] {
  const map = new Map<string, NoteTreeNode>();
  const roots: NoteTreeNode[] = [];

  for (const note of notes) {
    map.set(note.id, { ...note, children: [] });
  }

  for (const note of notes) {
    const node = map.get(note.id)!;
    if (note.parentId && map.has(note.parentId)) {
      map.get(note.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const sortChildren = (nodes: NoteTreeNode[]) => {
    nodes.sort(
      (a, b) => a.sortOrder - b.sortOrder || b.updatedAt.localeCompare(a.updatedAt),
    );
    for (const node of nodes) sortChildren(node.children);
  };
  sortChildren(roots);

  return roots;
}

export function filterNotes(notes: NoteMetadata[], query: string): NoteMetadata[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return notes;

  return notes.filter((note) => {
    const haystack = [
      note.title,
      note.preview,
      note.fileName,
      getDisplayTitle(note),
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(normalized);
  });
}

export function formatShortDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return `${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--:--";
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}
