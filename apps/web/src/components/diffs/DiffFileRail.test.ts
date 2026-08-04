import { describe, expect, it } from "vite-plus/test";

import { reviewFileDecoration } from "./DiffFileRail";

describe("review file rail", () => {
  it("labels files that changed after review", () => {
    expect(reviewFileDecoration("changed")).toEqual({
      text: "Changed",
      title: "Changed since you last viewed this file",
    });
    expect(reviewFileDecoration("viewed")).toEqual({ text: "Viewed", title: "Viewed" });
    expect(reviewFileDecoration("unviewed")).toBeNull();
  });
});
