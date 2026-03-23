import { describe, expect, it } from "vitest";
import { buildSearchData, normalizeSearchQuery } from "../hooks/useSearch.js";

describe("useSearch helpers", function () {
  it("trims input before it becomes the active query", function () {
    expect(normalizeSearchQuery("  waterfall  ")).toBe("waterfall");
  });

  it("creates a stable result list and lookup set for active matches", function () {
    var searchData = buildSearchData([
      { index: 1, event: { text: "bash" } },
      { index: 4, event: { text: "grep" } },
    ], "tools");

    expect(searchData.results).toEqual([1, 4]);
    expect(searchData.matchSet.has(1)).toBe(true);
    expect(searchData.matchSet.has(4)).toBe(true);
  });

  it("returns empty search metadata when no query is active", function () {
    expect(buildSearchData([], "")).toEqual({ results: null, matchSet: null });
  });
});
