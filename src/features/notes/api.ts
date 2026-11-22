import { invoke } from "@tauri-apps/api/core";
import type { EditorDocument } from "../markdown/documentModel";
import type { Note, NoteDropPosition, NoteGroupTarget, NoteIcon, NoteMetadata, NoteReorderEntry, SaveNoteRequest } from "./types";

export function listNotes(): Promise<NoteMetadata[]> {
  return invoke("notes_list");
}

export async function getNote(id: string): Promise<Note> {
  const [note, styleDocument] = await Promise.all([invoke<Note>("notes_get", { id }), getNoteStyles(id)]);
  return { ...note, styleDocument };
}

export function createNote(request: SaveNoteRequest): Promise<Note> {
  return invoke("notes_create", { request });
}

export function updateNote(id: string, request: SaveNoteRequest): Promise<Note> {
  return invoke("notes_update", { id, request });
}

export function saveGroupedNote(id: string | null, request: SaveNoteRequest, group: NoteGroupTarget): Promise<Note> {
  return invoke("notes_save_grouped", { id, request, group });
}

export function deleteNote(id: string): Promise<void> {
  return invoke("notes_delete", { id });
}

export function readFileBase64(path: string): Promise<string> {
  return invoke("read_file", { path });
}

export function moveNote(
  id: string,
  targetId: string,
  position: NoteDropPosition,
): Promise<void> {
  return invoke("notes_move", { id, targetId, position });
}

export function setNoteIcon(id: string, icon: NoteIcon | null): Promise<void> {
  return invoke("notes_set_icon", { id, icon });
}

export function reorderNotes(orders: NoteReorderEntry[]): Promise<void> {
  return invoke("notes_reorder", { orders });
}

export function getErrorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return "操作失败";
}

/** The content snapshot lets callers detect a stale sidecar without dropping it. */
export function getNoteStyles(id: string): Promise<EditorDocument | null> {
  return invoke("notes_get_styles", { id });
}

export function saveNoteStyles(id: string, document: EditorDocument): Promise<void> {
  return invoke("notes_save_styles", { id, document });
}
