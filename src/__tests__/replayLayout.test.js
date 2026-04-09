import { describe, expect, it } from "vitest";
import { buildReplayLayout, getReplayWindow, clearEstimateCache } from "../lib/replayLayout.js";

function makeEntry(index, text) {
  return {
    index: index,
    event: {
      t: index,
      agent: "assistant",
      track: "reasoning",
      text: text,
    },
  };
}

describe("buildReplayLayout", function () {
  it("keeps growing for long wrapped replay entries", function () {
    var longText = Array(21).join("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef01234567");
    var layout = buildReplayLayout([makeEntry(0, longText), makeEntry(1, "short")], {});

    expect(layout.items[0].height).toBeGreaterThan(250);
    expect(layout.items[1].top).toBeGreaterThan(250);
  });

  it("uses measured heights when available", function () {
    var layout = buildReplayLayout([makeEntry(0, "short")], {}, { 0: 320 });
    expect(layout.items[0].height).toBe(320);
  });

  it("adds turn header space for later user turns", function () {
    var turnStartMap = {
      1: {
        index: 1,
        toolCount: 0,
        hasError: false,
      },
    };
    var layout = buildReplayLayout([makeEntry(0, "short"), makeEntry(1, "short")], turnStartMap);

    expect(layout.items[1].height).toBeGreaterThan(layout.items[0].height);
  });

  it("cache produces identical results on repeated calls", function () {
    clearEstimateCache();
    var entries = [makeEntry(0, "hello world"), makeEntry(1, "hello world"), makeEntry(2, "different text")];
    var layout1 = buildReplayLayout(entries, {});
    var layout2 = buildReplayLayout(entries, {});
    expect(layout1.items[0].height).toBe(layout2.items[0].height);
    expect(layout1.items[1].height).toBe(layout2.items[1].height);
    expect(layout1.totalHeight).toBe(layout2.totalHeight);
  });

  it("clearEstimateCache resets the cache", function () {
    clearEstimateCache();
    var entries = [makeEntry(0, "cached text")];
    buildReplayLayout(entries, {});
    clearEstimateCache();
    // After clearing, should still produce same results (just recomputed)
    var layout = buildReplayLayout(entries, {});
    expect(layout.items[0].height).toBeGreaterThan(0);
  });
});

describe("getReplayWindow", function () {
  it("returns only the visible slice with overscan", function () {
    var items = buildReplayLayout([
      makeEntry(0, "one"),
      makeEntry(1, "two"),
      makeEntry(2, "three"),
    ], {}).items;

    var windowed = getReplayWindow(items, 0, items[0].height + 4, 0);
    expect(windowed.map(function (item) { return item.entry.index; })).toEqual([0, 1]);
  });
});
