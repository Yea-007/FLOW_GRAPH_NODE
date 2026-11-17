/** Per-note content history. Consecutive typing is grouped until a pause or an explicit edit. */
export class ContentHistory {
  private past: string[] = [];
  private future: string[] = [];
  private current: string;
  private lastTypingAt = 0;

  constructor(initial: string) { this.current = initial; }

  record(next: string, typing = false, now = Date.now()): void {
    if (next === this.current) return;
    if (!typing || !this.lastTypingAt || now - this.lastTypingAt > 750) {
      this.past.push(this.current);
      if (this.past.length > 200) this.past.shift();
    }
    this.current = next;
    this.future = [];
    this.lastTypingAt = typing ? now : 0;
  }

  undo(): string | undefined {
    const previous = this.past.pop();
    if (previous === undefined) return;
    this.future.push(this.current);
    this.current = previous;
    this.lastTypingAt = 0;
    return previous;
  }

  redo(): string | undefined {
    const next = this.future.pop();
    if (next === undefined) return;
    this.past.push(this.current);
    this.current = next;
    this.lastTypingAt = 0;
    return next;
  }
}
