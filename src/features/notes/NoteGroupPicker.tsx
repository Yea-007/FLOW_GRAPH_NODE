import { useMemo, useState } from "react";
import { getDisplayTitle } from "./noteUtils";
import type { NoteGroupTarget, NoteMetadata } from "./types";

interface NoteGroupPickerProps {
  notes: NoteMetadata[];
  noteId: string | null;
  disabled: boolean;
  error: string | null;
  onSelect: (group: NoteGroupTarget) => void;
  onCancel: () => void;
}

export function NoteGroupPicker({ notes, noteId, disabled, error, onSelect, onCancel }: NoteGroupPickerProps) {
  const [query, setQuery] = useState("");
  const options = useMemo(() => {
    const byId = new Map(notes.map((note) => [note.id, note]));
    return notes.flatMap((note) => {
      if (!note.title.trim()) return [];
      const labels: string[] = [];
      const visited = new Set<string>();
      let ancestor: NoteMetadata | undefined = note;
      while (ancestor) {
        if (ancestor.id === noteId || visited.has(ancestor.id)) return [];
        visited.add(ancestor.id);
        labels.push(getDisplayTitle(ancestor));
        ancestor = ancestor.parentId ? byId.get(ancestor.parentId) : undefined;
      }
      return [{ id: note.id, title: note.title.trim(), path: labels.reverse().join(" / ") }];
    });
  }, [noteId, notes]);

  const title = query.trim();
  const normalized = title.toLowerCase();
  const exact = options.filter((option) => option.title.toLowerCase() === normalized);
  const canCreate = Boolean(normalized) && !notes.some((note) => note.title.trim().toLowerCase() === normalized);
  const matches = [
    ...exact,
    ...options.filter((option) => option.title.toLowerCase() !== normalized && option.path.toLowerCase().includes(normalized)),
  ];
  const rowClass = "w-full text-left rounded-md px-2 py-1.5 text-[12px] text-ink-soft hover:bg-paper-warm hover:text-bamboo cursor-pointer disabled:opacity-50";

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1 px-3 py-2" onKeyDown={(event) => {
      if (event.key === "Escape" && !event.nativeEvent.isComposing) {
        event.stopPropagation();
        onCancel();
      }
    }}>
      <form onSubmit={(event) => {
        event.preventDefault();
        if (disabled) return;
        if (exact.length === 1) onSelect({ type: "existing", id: exact[0].id });
        else if (canCreate) onSelect({ type: "named", title });
      }}>
        <input
          autoFocus
          type="text"
          aria-label="分组名称"
          value={query}
          disabled={disabled}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索或输入新分组"
          className="w-full rounded-md bg-paper-warm px-2 py-1.5 text-[12px] text-ink focus:ring-1 focus:ring-bamboo"
        />
      </form>
      {error && <p role="status" className="px-2 text-[11px] text-red-500">{error}</p>}
      {exact.length > 1 && <p className="px-2 text-[11px] text-ink-faint">请选择同名分组的路径</p>}
      <div className="min-h-0 flex-1 overflow-y-auto" aria-label="保存到分组">
        {canCreate && (
          <button type="button" disabled={disabled} className={`${rowClass} truncate font-medium`} title={title} onClick={() => onSelect({ type: "named", title })}>
            新建分组「{title}」
          </button>
        )}
        {!normalized && (
          <button type="button" disabled={disabled} className={rowClass} onClick={() => onSelect({ type: "root" })}>不分组</button>
        )}
        {matches.map((option) => (
          <button key={option.id} type="button" disabled={disabled} className={`${rowClass} truncate`} title={option.path} onClick={() => onSelect({ type: "existing", id: option.id })}>
            {option.path}
          </button>
        ))}
      </div>
    </div>
  );
}
