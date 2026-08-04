import { describe, expect, it } from "vite-plus/test";

import { appViewChartValues, appViewTable, readAppViewPath } from "./AppViewRenderer.logic";

describe("AppViewRenderer logic", () => {
  it("resolves explicit paths without prototype traversal", () => {
    expect(
      readAppViewPath({ health: { checks: [{ status: "ok" }] } }, "$.health.checks.0.status"),
    ).toBe("ok");
    expect(readAppViewPath({}, "$.__proto__.polluted")).toBeUndefined();
    expect(readAppViewPath({}, "constructor.name")).toBeUndefined();
  });

  it("bounds tabular data", () => {
    const value = Array.from({ length: 250 }, (_, index) => ({ index, status: "ok" }));
    expect(appViewTable(value).columns).toEqual(["index", "status"]);
    expect(appViewTable(value).rows).toHaveLength(200);
  });

  it("normalizes chart widths without animation", () => {
    expect(
      appViewChartValues([
        { label: "ready", value: 2 },
        { label: "busy", value: 4 },
      ]),
    ).toEqual([
      { label: "ready", value: 2, percent: 50 },
      { label: "busy", value: 4, percent: 100 },
    ]);
  });
});
