import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { migrateLegacyStyles } from "./documentModel";
import { MarkdownPreview } from "./MarkdownPreview";
import { ContentHistory } from "./contentHistory";

describe("two layer document", () => {
  test("migrates only real legacy links, keeping code and Markdown emphasis", () => {
    const old = "前 [**重要**](#floral-color-red-size-20) 后\n\n`[代码](#floral-color-blue)`";
    const next = migrateLegacyStyles(old);
    expect(next.content).toBe("前 **重要** 后\n\n`[代码](#floral-color-blue)`");
    expect(next.ranges).toEqual([{ start: 2, end: 8, color: "red", size: 20 }]);
  });
  test("renders Markdown before independent styling, without injecting source markers", () => {
    const content = "**重要** 和 `代码`";
    const markup = renderToStaticMarkup(<MarkdownPreview content={content} ranges={[{start: 2, end: 4, color: "red", size: 20}]} />);
    expect(markup).toContain("<strong");
    expect(markup).toContain('data-text-color="red"');
    expect(markup).toContain('data-source-start="2"');
    expect(markup).toContain('data-text-size="20"');
    expect(markup).not.toContain('data-source-start="10"');
    expect(content).toBe("**重要** 和 `代码`");
  });
  test("restores content and formatting together", () => {
    const before = {content: "你好", ranges: []};
    const after = {content: "你好", ranges: [{start: 0, end: 2, color: "red"}]};
    const history = new ContentHistory(JSON.stringify(before));
    history.record(JSON.stringify(after));
    expect(JSON.parse(history.undo()!)).toEqual(before);
    expect(JSON.parse(history.redo()!)).toEqual(after);
  });
});
