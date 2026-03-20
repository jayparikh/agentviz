import { describe, it, expect } from "vitest";
import {
  buildWaterfallItems,
  getWaterfallStats,
  buildWaterfallLayout,
  getWaterfallWindow,
  getToolColor,
  WATERFALL_ROW_HEIGHT,
  WATERFALL_ROW_GAP,
} from "../lib/waterfall.js";

// Helpers to create test events
function makeEvent(overrides) {
  return Object.assign({
    t: 0,
    agent: "assistant",
    track: "tool_call",
    text: "test tool",
    duration: 1,
    intensity: 0.6,
    raw: {},
    turnIndex: 0,
    isError: false,
    toolName: "bash",
    toolInput: {},
  }, overrides);
}

function makeNonToolEvent(overrides) {
  return Object.assign({
    t: 0,
    agent: "assistant",
    track: "reasoning",
    text: "thinking...",
    duration: 0.5,
    intensity: 0.5,
    raw: {},
    turnIndex: 0,
    isError: false,
  }, overrides);
}

// ── buildWaterfallItems ──

describe("buildWaterfallItems", function () {
  it("returns empty array for empty events", function () {
    expect(buildWaterfallItems([])).toEqual([]);
    expect(buildWaterfallItems(null)).toEqual([]);
    expect(buildWaterfallItems(undefined)).toEqual([]);
  });

  it("filters only tool_call events", function () {
    var events = [
      makeNonToolEvent({ t: 0 }),
      makeEvent({ t: 1, toolName: "bash" }),
      makeNonToolEvent({ t: 2, track: "output" }),
      makeEvent({ t: 3, toolName: "grep" }),
      makeNonToolEvent({ t: 4, track: "context" }),
    ];

    var items = buildWaterfallItems(events);
    expect(items.length).toBe(2);
    expect(items[0].event.toolName).toBe("bash");
    expect(items[1].event.toolName).toBe("grep");
  });

  it("preserves original index from events array", function () {
    var events = [
      makeNonToolEvent({ t: 0 }),
      makeNonToolEvent({ t: 0.5 }),
      makeEvent({ t: 1, toolName: "bash" }),
      makeNonToolEvent({ t: 1.5 }),
      makeEvent({ t: 2, toolName: "grep" }),
    ];

    var items = buildWaterfallItems(events);
    expect(items[0].originalIndex).toBe(2);
    expect(items[1].originalIndex).toBe(4);
  });

  it("computes depth=0 for flat tool calls (no parentToolCallId)", function () {
    var events = [
      makeEvent({ t: 0, toolName: "bash" }),
      makeEvent({ t: 1, toolName: "grep" }),
      makeEvent({ t: 2, toolName: "view" }),
    ];

    var items = buildWaterfallItems(events);
    expect(items.every(function (item) { return item.depth === 0; })).toBe(true);
  });

  it("computes correct nesting depth from parentToolCallId chains", function () {
    var events = [
      makeEvent({
        t: 0,
        toolName: "task",
        raw: { data: { toolCallId: "tc-1" } },
      }),
      makeEvent({
        t: 0.5,
        toolName: "bash",
        parentToolCallId: "tc-1",
        raw: { data: { toolCallId: "tc-2", parentToolCallId: "tc-1" } },
      }),
      makeEvent({
        t: 1,
        toolName: "grep",
        parentToolCallId: "tc-2",
        raw: { data: { toolCallId: "tc-3", parentToolCallId: "tc-2" } },
      }),
    ];

    var items = buildWaterfallItems(events);
    expect(items[0].depth).toBe(0);
    expect(items[1].depth).toBe(1);
    expect(items[2].depth).toBe(2);
  });

  it("returns items sorted by start time", function () {
    var events = [
      makeEvent({ t: 3, toolName: "c" }),
      makeEvent({ t: 1, toolName: "a" }),
      makeEvent({ t: 2, toolName: "b" }),
    ];

    var items = buildWaterfallItems(events);
    expect(items[0].event.toolName).toBe("a");
    expect(items[1].event.toolName).toBe("b");
    expect(items[2].event.toolName).toBe("c");
  });

  it("handles events with no raw data gracefully", function () {
    var events = [
      makeEvent({ t: 0, toolName: "bash", raw: null }),
      makeEvent({ t: 1, toolName: "grep", raw: {} }),
    ];

    var items = buildWaterfallItems(events);
    expect(items.length).toBe(2);
    expect(items[0].depth).toBe(0);
    expect(items[1].depth).toBe(0);
  });
});

// ── getWaterfallStats ──

describe("getWaterfallStats", function () {
  it("returns zeros for empty items", function () {
    var stats = getWaterfallStats([]);
    expect(stats.totalCalls).toBe(0);
    expect(stats.maxConcurrency).toBe(0);
    expect(stats.maxDepth).toBe(0);
    expect(stats.longestTool).toBe(null);
  });

  it("computes correct totals", function () {
    var items = [
      { event: makeEvent({ t: 0, duration: 2, toolName: "bash" }), depth: 0 },
      { event: makeEvent({ t: 1, duration: 3, toolName: "grep" }), depth: 0 },
      { event: makeEvent({ t: 5, duration: 1, toolName: "bash" }), depth: 0 },
    ];

    var stats = getWaterfallStats(items);
    expect(stats.totalCalls).toBe(3);
    expect(stats.longestTool).toBe("grep");
    expect(stats.toolFrequency.bash).toBe(2);
    expect(stats.toolFrequency.grep).toBe(1);
  });

  it("computes max concurrency correctly", function () {
    // Three overlapping calls: [0-2], [0.5-1.5], [1-3]
    var items = [
      { event: makeEvent({ t: 0, duration: 2 }), depth: 0 },
      { event: makeEvent({ t: 0.5, duration: 1 }), depth: 0 },
      { event: makeEvent({ t: 1, duration: 2 }), depth: 0 },
    ];

    var stats = getWaterfallStats(items);
    expect(stats.maxConcurrency).toBe(3);
  });

  it("computes max concurrency of 1 for sequential calls", function () {
    var items = [
      { event: makeEvent({ t: 0, duration: 1 }), depth: 0 },
      { event: makeEvent({ t: 2, duration: 1 }), depth: 0 },
      { event: makeEvent({ t: 4, duration: 1 }), depth: 0 },
    ];

    var stats = getWaterfallStats(items);
    expect(stats.maxConcurrency).toBe(1);
  });

  it("reports max depth", function () {
    var items = [
      { event: makeEvent({ t: 0 }), depth: 0 },
      { event: makeEvent({ t: 1 }), depth: 1 },
      { event: makeEvent({ t: 2 }), depth: 3 },
    ];

    var stats = getWaterfallStats(items);
    expect(stats.maxDepth).toBe(3);
  });
});

// ── buildWaterfallLayout ──

describe("buildWaterfallLayout", function () {
  it("returns empty layout for empty items", function () {
    var layout = buildWaterfallLayout([]);
    expect(layout.layoutItems).toEqual([]);
    expect(layout.totalHeight).toBe(0);
  });

  it("positions items sequentially with correct heights", function () {
    var items = [
      { event: makeEvent({ t: 0 }), depth: 0, originalIndex: 0 },
      { event: makeEvent({ t: 1 }), depth: 0, originalIndex: 1 },
      { event: makeEvent({ t: 2 }), depth: 0, originalIndex: 2 },
    ];

    var layout = buildWaterfallLayout(items);
    expect(layout.layoutItems.length).toBe(3);
    expect(layout.layoutItems[0].top).toBe(0);
    expect(layout.layoutItems[0].height).toBe(WATERFALL_ROW_HEIGHT);
    expect(layout.layoutItems[1].top).toBe(WATERFALL_ROW_HEIGHT + WATERFALL_ROW_GAP);
    expect(layout.layoutItems[2].top).toBe(2 * (WATERFALL_ROW_HEIGHT + WATERFALL_ROW_GAP));
  });

  it("computes total height correctly", function () {
    var items = [
      { event: makeEvent({ t: 0 }), depth: 0, originalIndex: 0 },
      { event: makeEvent({ t: 1 }), depth: 0, originalIndex: 1 },
    ];

    var layout = buildWaterfallLayout(items);
    var expected = 2 * WATERFALL_ROW_HEIGHT + 2 * WATERFALL_ROW_GAP;
    expect(layout.totalHeight).toBe(expected);
  });
});

// ── getWaterfallWindow ──

describe("getWaterfallWindow", function () {
  function makeLayoutItems(count) {
    var items = [];
    var top = 0;
    for (var i = 0; i < count; i++) {
      items.push({
        item: { event: makeEvent({ t: i }), depth: 0, originalIndex: i },
        top: top,
        height: WATERFALL_ROW_HEIGHT,
      });
      top += WATERFALL_ROW_HEIGHT + WATERFALL_ROW_GAP;
    }
    return items;
  }

  it("returns empty for empty items", function () {
    expect(getWaterfallWindow([], 0, 500)).toEqual([]);
    expect(getWaterfallWindow(null, 0, 500)).toEqual([]);
  });

  it("returns all items when they fit in viewport", function () {
    var items = makeLayoutItems(5);
    var result = getWaterfallWindow(items, 0, 2000, 0);
    expect(result.length).toBe(5);
  });

  it("returns correct windowed slice for scroll position", function () {
    var items = makeLayoutItems(100);
    // Each row is 32+2=34px, so 10 items = 340px
    // Scroll to 340px (past first 10 items), viewport 170px (5 items), no overscan
    var result = getWaterfallWindow(items, 340, 170, 0);
    expect(result.length).toBeGreaterThanOrEqual(5);
    expect(result[0].item.originalIndex).toBe(10);
  });

  it("includes overscan items", function () {
    var items = makeLayoutItems(100);
    var rowSize = WATERFALL_ROW_HEIGHT + WATERFALL_ROW_GAP;
    // Scroll to row 50, viewport 5 rows, overscan 3 rows
    var result = getWaterfallWindow(items, 50 * rowSize, 5 * rowSize, 3 * rowSize);
    // Should include items before and after the visible range
    expect(result[0].item.originalIndex).toBeLessThanOrEqual(47);
    expect(result[result.length - 1].item.originalIndex).toBeGreaterThanOrEqual(55);
  });
});

// ── getToolColor ──

describe("getToolColor", function () {
  it("returns a string color for any tool name", function () {
    expect(typeof getToolColor("bash")).toBe("string");
    expect(getToolColor("bash").startsWith("#")).toBe(true);
  });

  it("returns consistent color for same tool name", function () {
    expect(getToolColor("grep")).toBe(getToolColor("grep"));
  });

  it("returns different colors for different tool names (usually)", function () {
    // Not guaranteed for all pairs, but very likely for these
    var colors = new Set([
      getToolColor("bash"),
      getToolColor("grep"),
      getToolColor("view"),
      getToolColor("edit"),
      getToolColor("create"),
    ]);
    expect(colors.size).toBeGreaterThan(1);
  });

  it("handles null/undefined/empty gracefully", function () {
    expect(typeof getToolColor(null)).toBe("string");
    expect(typeof getToolColor(undefined)).toBe("string");
    expect(typeof getToolColor("")).toBe("string");
  });
});
