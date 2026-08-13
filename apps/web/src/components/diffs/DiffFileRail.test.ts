import { describe, expect, it } from "vite-plus/test";

import {
  DIFF_FILE_RAIL_DEFAULT_WIDTH,
  DIFF_FILE_RAIL_MAX_WIDTH,
  DIFF_FILE_RAIL_MIN_WIDTH,
  reviewFileDecoration,
} from "./DiffFileRail";

describe("review file rail", () => {
  it("labels files that changed after review", () => {
    expect(reviewFileDecoration("changed")).toEqual({
      text: "Changed",
      title: "Changed since you last viewed this file",
    });
    expect(reviewFileDecoration("viewed")).toEqual({ text: "Viewed", title: "Viewed" });
    expect(reviewFileDecoration("unviewed")).toBeNull();
  });

  it("starts wider while retaining useful resize bounds", () => {
    expect(DIFF_FILE_RAIL_DEFAULT_WIDTH).toBe(288);
    expect(DIFF_FILE_RAIL_MIN_WIDTH).toBeLessThan(DIFF_FILE_RAIL_DEFAULT_WIDTH);
    expect(DIFF_FILE_RAIL_MAX_WIDTH).toBeGreaterThan(DIFF_FILE_RAIL_DEFAULT_WIDTH);
  });
});
