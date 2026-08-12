import { describe, expect, it } from "vitest";
import { buildReplayLayout, getReplayWindow, clearEstimateCache, countVisibleEntries } from "../lib/replayLayout.js";

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
        eventIndices: [1],
        toolCount: 0,
        hasError: false,
      },
    };
    var layout = buildReplayLayout([makeEntry(0, "short"), makeEntry(1, "short")], turnStartMap);

    expect(layout.items[1].height).toBeGreaterThan(layout.items[0].height);
  });

  it("adds turn header to the first visible event when the turn start is hidden", function () {
    var turnStartMap = {
      1: {
        index: 1,
        eventIndices: [1, 2],
        toolCount: 0,
        hasError: false,
      },
    };
    var layout = buildReplayLayout([makeEntry(2, "visible")], turnStartMap);
    var withoutTurn = buildReplayLayout([makeEntry(2, "visible")], {});

    expect(layout.items[0].turn.index).toBe(1);
    expect(layout.items[0].height).toBeGreaterThan(withoutTurn.items[0].height);
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

describe("countVisibleEntries", function () {
  function entryAt(index, t) {
    return { index: index, event: { t: t } };
  }

  it("returns 0 for empty or missing input", function () {
    expect(countVisibleEntries([], 5)).toBe(0);
    expect(countVisibleEntries(null, 5)).toBe(0);
    expect(countVisibleEntries(undefined, 5)).toBe(0);
  });

  it("counts entries whose t is <= currentTime (inclusive boundary)", function () {
    var entries = [entryAt(0, 0), entryAt(1, 1), entryAt(2, 2), entryAt(3, 3)];
    expect(countVisibleEntries(entries, -1)).toBe(0);
    expect(countVisibleEntries(entries, 0)).toBe(1);
    expect(countVisibleEntries(entries, 1.5)).toBe(2);
    expect(countVisibleEntries(entries, 3)).toBe(4);
    expect(countVisibleEntries(entries, 99)).toBe(4);
  });

  it("includes all entries sharing the exact boundary time (ties)", function () {
    var entries = [entryAt(0, 1), entryAt(1, 2), entryAt(2, 2), entryAt(3, 2), entryAt(4, 3)];
    expect(countVisibleEntries(entries, 2)).toBe(4);
  });

  it("matches the equivalent filter on chronological entries", function () {
    var entries = [];
    for (var i = 0; i < 200; i++) entries.push(entryAt(i, i * 0.5));

    for (var time = -1; time <= 101; time += 0.25) {
      var expected = entries.filter(function (entry) { return entry.event.t <= time; }).length;
      expect(countVisibleEntries(entries, time)).toBe(expected);
    }
  });
});
