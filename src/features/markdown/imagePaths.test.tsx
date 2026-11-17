import { renderToStaticMarkup } from "react-dom/server";
import Markdown from "react-markdown";
import { describe, expect, test } from "vitest";
import { resolveImagePath } from "./imagePaths";

describe("Markdown local image paths", () => {
  test("decodes the actual URL produced by Markdown for Chinese note assets", () => {
    let nativePath = "";
    renderToStaticMarkup(<Markdown components={{ img: ({src}) => {
      nativePath = resolveImagePath(src ?? "", "C:\\Notes\\花笺");
      return null;
    } }}>{"![图表](数字电子技术基础_复习笔记/images/p002_01.png)"}</Markdown>);
    expect(nativePath).toBe("C:/Notes/花笺/数字电子技术基础_复习笔记/images/p002_01.png");
  });
  test("decodes local spaces and file URLs, preserving literal percent characters", () => {
    expect(resolveImagePath("images/chart%201.png", "D:\\Notes")).toBe("D:/Notes/images/chart 1.png");
    expect(resolveImagePath("file:///D:/Notes/%E5%9B%BE.png")).toBe("D:/Notes/图.png");
    expect(resolveImagePath("images/100%25.png", "D:/Notes")).toBe("D:/Notes/images/100%.png");
    expect(resolveImagePath("images/100%.png", "D:/Notes")).toBe("D:/Notes/images/100%.png");
  });
  test("does not decode network URLs or data payloads", () => {
    const url = "https://example.com/chart%20a.png?signature=abc%2Fdef";
    expect(resolveImagePath(url, "D:/Notes")).toBe(url);
    expect(resolveImagePath("data:image/png;base64,abcd")).toBe("data:image/png;base64,abcd");
  });
});
