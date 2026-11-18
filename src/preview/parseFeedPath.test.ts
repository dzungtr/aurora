import { describe, expect, test } from "bun:test";
import { parseFeedPath, parsePreviewPath } from "./previewApi";

describe("parseFeedPath", () => {
  test.each([
    ["/feed", {}],
    ["/feed/", {}],
    ["/feed/tech", { sid: "tech", aid: undefined }],
    ["/feed/tech/", { sid: "tech", aid: undefined }],
    ["/feed/tech/a1", { sid: "tech", aid: "a1" }],
    ["/feed/tech/a1/", { sid: "tech", aid: "a1" }],
    ["/feed/a%20b/x%2Fy", { sid: "a b", aid: "x/y" }],
  ])("%s", (path, expected) => {
    expect(parseFeedPath(path)).toEqual(expected as object);
  });

  test.each(["/", "/s", "/s/tech", "/feeds", "/feedx/tech", "/feed/a/b/c", "/x/feed", ""])(
    "%p is not a feed path",
    (path) => {
      expect(parseFeedPath(path)).toBeNull();
    }
  );

  test("malformed percent-encoding is tolerated", () => {
    expect(parseFeedPath("/feed/%E0%A4%A")).toEqual({ sid: undefined, aid: undefined });
  });
});

describe("parsePreviewPath vs feed paths", () => {
  test.each(["/feed", "/feed/tech", "/feed/tech/a1"])("%s never matches parsePreviewPath", (path) => {
    expect(parsePreviewPath(path)).toBeNull();
  });
});
