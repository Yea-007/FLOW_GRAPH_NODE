import { describe, expect, it } from "vitest";
import { getInitialRoute, routeFromSearch } from "./windowRoutes";

describe("window routes", () => {
  it("parses supported routes and note ids", () => {
    expect(routeFromSearch("?view=notepad&noteId=abc-123")).toEqual({
      view: "notepad",
      noteId: "abc-123",
    });
    expect(routeFromSearch("?view=tile&noteId=note-1")).toEqual({
      view: "tile",
      noteId: "note-1",
    });
    expect(routeFromSearch("?view=unknown")).toEqual({ view: "main" });
  });

  it("reads the browser location by default", () => {
    expect(getInitialRoute(new URL("https://floral-notepaper.test/?view=main"))).toEqual({
      view: "main",
    });
  });
});
