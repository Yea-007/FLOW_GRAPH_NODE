import { describe, expect, test } from "vitest";
import { ContentHistory } from "./contentHistory";

describe("content history", () => {
  test("groups consecutive typing and keeps toolbar edits separate", () => {
    const history = new ContentHistory("");
    history.record("你", true, 1000);
    history.record("你好", true, 1100);
    history.record("**你好**", false, 1200);
    expect(history.undo()).toBe("你好");
    expect(history.undo()).toBe("");
    expect(history.redo()).toBe("你好");
    expect(history.redo()).toBe("**你好**");
  });
  test("a new edit clears redo and typing after a pause starts a new step", () => {
    const history = new ContentHistory("a");
    history.record("ab", true, 1000);
    history.record("abc", true, 2000);
    expect(history.undo()).toBe("ab");
    history.record("abd", true, 2100);
    expect(history.redo()).toBeUndefined();
    expect(history.undo()).toBe("ab");
  });
});
