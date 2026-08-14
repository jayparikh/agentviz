import { describe, expect, it } from "vitest";
import { buildReplayLayout, getReplayWindow, clearEstimateCache, buildVisibilityIndex, countVisibleAtTime } from "../lib/replayLayout.js";
import { parseClaudeCodeJSONL } from "../lib/parser.ts";
import { buildFilteredEventEntries } from "../lib/session.ts";

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

describe("buildVisibilityIndex + countVisibleAtTime", function () {
  function entryAt(index, t) {
    return { index: index, event: { t: t } };
  }

  // Mirrors ReplayView's visible-entry derivation exactly.
  function visibleEntriesAt(entries, currentTime) {
    var sortedTimes = buildVisibilityIndex(entries);
    var count = countVisibleAtTime(sortedTimes, currentTime);
    if (count === 0) return [];
    if (count === entries.length) return entries.slice();
    var threshold = sortedTimes[count - 1];
    return entries.filter(function (entry) { return entry.event.t <= threshold; });
  }

  function naiveVisible(entries, currentTime) {
    return entries.filter(function (entry) { return entry.event.t <= currentTime; });
  }

  it("buildVisibilityIndex returns [] for empty or missing input", function () {
    expect(buildVisibilityIndex([])).toEqual([]);
    expect(buildVisibilityIndex(null)).toEqual([]);
    expect(buildVisibilityIndex(undefined)).toEqual([]);
  });

  it("buildVisibilityIndex sorts times ascending without reordering entries", function () {
    var entries = [entryAt(0, 0), entryAt(1, 0.2), entryAt(2, 0.1)];
    expect(buildVisibilityIndex(entries)).toEqual([0, 0.1, 0.2]);
    // The source array must be left untouched.
    expect(entries.map(function (e) { return e.event.t; })).toEqual([0, 0.2, 0.1]);
  });

  it("countVisibleAtTime returns 0 for empty or missing input", function () {
    expect(countVisibleAtTime([], 5)).toBe(0);
    expect(countVisibleAtTime(null, 5)).toBe(0);
    expect(countVisibleAtTime(undefined, 5)).toBe(0);
  });

  it("counts times <= currentTime with inclusive boundary", function () {
    var sorted = buildVisibilityIndex([entryAt(0, 0), entryAt(1, 1), entryAt(2, 2), entryAt(3, 3)]);
    expect(countVisibleAtTime(sorted, -1)).toBe(0);
    expect(countVisibleAtTime(sorted, 0)).toBe(1);
    expect(countVisibleAtTime(sorted, 1.5)).toBe(2);
    expect(countVisibleAtTime(sorted, 3)).toBe(4);
    expect(countVisibleAtTime(sorted, 99)).toBe(4);
  });

  it("includes all times sharing the exact boundary (ties)", function () {
    var sorted = buildVisibilityIndex([entryAt(0, 1), entryAt(1, 2), entryAt(2, 2), entryAt(3, 2), entryAt(4, 3)]);
    expect(countVisibleAtTime(sorted, 2)).toBe(4);
  });

  it("matches the naive filter for out-of-order entry times", function () {
    // Deliberately unsorted by event.t: the sorted index yields the right count
    // and the threshold filter returns the right entries in original order.
    var entries = [entryAt(0, 0), entryAt(1, 0.2), entryAt(2, 0.1), entryAt(3, 0.05), entryAt(4, 0.5)];

    for (var time = -0.1; time <= 0.6; time += 0.01) {
      expect(visibleEntriesAt(entries, time)).toEqual(naiveVisible(entries, time));
    }
  });

  it("matches the naive filter across a large unsorted set", function () {
    var entries = [];
    for (var i = 0; i < 300; i++) entries.push(entryAt(i, Math.round(Math.random() * 1000) / 10));

    for (var time = -1; time <= 101; time += 0.5) {
      expect(visibleEntriesAt(entries, time)).toEqual(naiveVisible(entries, time));
    }
  });
});

describe("replay visibility with out-of-order parser output (regression)", function () {
  // The Claude parser bumps a record's text/tool events by fractional offsets, so
  // a later record with an earlier real timestamp yields out-of-order event.t.
  // ReplayView must still show every event whose t <= playhead; a prefix slice
  // (which assumes sorted times) would drop the earlier-but-later event.
  function buildJSONL() {
    var assistant = {
      type: "assistant",
      timestamp: "2026-01-01T00:00:00.000Z",
      message: {
        role: "assistant",
        model: "claude-3-5-sonnet-20241022",
        content: [
          { type: "text", text: "Let me read the file." },
          { type: "tool_use", name: "read_file", input: { path: "a.txt" } },
        ],
      },
    };
    var user = {
      type: "user",
      timestamp: "2026-01-01T00:00:00.100Z",
      message: { role: "user", content: "thanks" },
    };
    return JSON.stringify(assistant) + "\n" + JSON.stringify(user);
  }

  function visibleEntriesAt(entries, currentTime) {
    var sortedTimes = buildVisibilityIndex(entries);
    var count = countVisibleAtTime(sortedTimes, currentTime);
    if (count === 0) return [];
    if (count === entries.length) return entries.slice();
    var threshold = sortedTimes[count - 1];
    return entries.filter(function (entry) { return entry.event.t <= threshold; });
  }

  it("emits non-monotonic event times (documents the invariant)", function () {
    var parsed = parseClaudeCodeJSONL(buildJSONL());
    expect(parsed).not.toBeNull();

    var entries = buildFilteredEventEntries(parsed.events, {});
    // text @ 0, tool_use @ ~0.2, user @ ~0.1 -> entry[1].t > entry[2].t.
    expect(entries.length).toBe(3);
    expect(entries[1].event.t).toBeGreaterThan(entries[2].event.t);
  });

  it("shows the earlier-timestamped user event at an intermediate playhead", function () {
    var parsed = parseClaudeCodeJSONL(buildJSONL());
    var entries = buildFilteredEventEntries(parsed.events, {});

    // At t=0.15 the user event (t~0.1) must be visible even though it follows the
    // tool_use event (t~0.2) in array order. A prefix slice would hide it.
    var visible = visibleEntriesAt(entries, 0.15);
    var naive = entries.filter(function (entry) { return entry.event.t <= 0.15; });
    expect(visible).toEqual(naive);

    var userVisible = visible.some(function (entry) { return entry.event.agent === "user"; });
    expect(userVisible).toBe(true);
  });

  it("matches the naive filter across the whole playback range", function () {
    var parsed = parseClaudeCodeJSONL(buildJSONL());
    var entries = buildFilteredEventEntries(parsed.events, {});

    for (var time = 0; time <= 0.5; time += 0.01) {
      var visible = visibleEntriesAt(entries, time);
      var naive = entries.filter(function (entry) { return entry.event.t <= time; });
      expect(visible).toEqual(naive);
    }
  });
});
