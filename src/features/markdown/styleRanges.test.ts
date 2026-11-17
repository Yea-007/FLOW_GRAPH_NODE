import { describe, expect, test } from "vitest";
import { findTextEdit, rebaseStyles, setRangeStyle } from "./styleRanges";

describe("independent formatting ranges", () => {
  test("finds changes in UTF-16 offsets", () => {
    expect(findTextEdit("甲😀乙", "甲😀新乙")).toEqual({ start: 3, end: 3, text: "新" });
    expect(findTextEdit("甲😀乙", "甲😁乙")).toEqual({ start: 1, end: 3, text: "😁" });
  });
  test("shifts styles and expands an insertion within a range", () => {
    const ranges = [{ start: 2, end: 5, color: "red" }];
    expect(rebaseStyles(ranges, { start: 0, end: 0, text: "好" })).toEqual([{ start: 3, end: 6, color: "red" }]);
    expect(rebaseStyles(ranges, { start: 3, end: 3, text: "好" })).toEqual([{ start: 2, end: 6, color: "red" }]);
    expect(rebaseStyles(ranges, { start: 2, end: 5, text: "" })).toEqual([]);
  });
  test("combines and clears a property only on the selected portion", () => {
    let ranges = setRangeStyle([], 2, 6, "color", "red");
    ranges = setRangeStyle(ranges, 4, 8, "size", 20);
    expect(ranges).toEqual([{ start: 2, end: 4, color: "red" }, { start: 4, end: 6, color: "red", size: 20 }, { start: 6, end: 8, size: 20 }]);
    ranges = setRangeStyle(ranges, 3, 5, "color", undefined);
    expect(ranges).toEqual([{ start: 2, end: 3, color: "red" }, { start: 4, end: 5, size: 20 }, { start: 5, end: 6, color: "red", size: 20 }, { start: 6, end: 8, size: 20 }]);
  });
});
