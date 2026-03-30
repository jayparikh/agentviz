import { describe, it, expect } from "vitest";
import { buildReplayLayout, getReplayWindow } from "../lib/replayLayout.js";
import { buildCommandPaletteIndex, searchCommandPalette } from "../lib/commandPalette.js";
import { buildTimelineBins } from "../components/Timeline.jsx";

describe("replay layout helpers", function () {
  it("adds extra height for turn headers", function () {
    var entries = [
      { index: 0, event: { agent: "user", text: "first", track: "output" } },
      { index: 1, event: { agent: "assistant", text: "reply", track: "output" } },
      { index: 2, event: { agent: "user", text: "second turn message", track: "output" } },
    ];
    var turnStartMap = {
      0: { index: 0, toolCount: 0, hasError: false },
      2: { index: 1, toolCount: 0, hasError: false },
    };

    var layout = buildReplayLayout(entries, turnStartMap);

    expect(layout.items[2].height).toBeGreaterThan(layout.items[0].height);
  });

  it("returns a windowed slice near the viewport", function () {
    var entries = [];
    for (var i = 0; i < 40; i++) {
      entries.push({
        index: i,
        event: { agent: i % 2 === 0 ? "user" : "assistant", text: "event " + i, track: "output" },
      });
    }

    var layout = buildReplayLayout(entries, {});
    var windowed = getReplayWindow(layout.items, 500, 220, 80);

    expect(windowed.length).toBeGreaterThan(0);
    expect(windowed.length).toBeLessThan(entries.length);
    expect(windowed[0].entry.index).toBeGreaterThan(0);
  });
});

describe("command palette helpers", function () {
  it("builds defaults with views and turns", function () {
    var index = buildCommandPaletteIndex([], [
      { index: 0, startTime: 0, userMessage: "Open the replay", hasError: false },
      { index: 1, startTime: 5, userMessage: "Inspect tool calls", hasError: true },
    ]);

    expect(index.defaults[0].type).toBe("action");
    expect(index.defaults.some(function (item) { return item.type === "view"; })).toBe(true);
    expect(index.defaults.some(function (item) { return item.type === "turn"; })).toBe(true);
  });

  it("ranks an exact view match highly", function () {
    var index = buildCommandPaletteIndex([], []);
    var results = searchCommandPalette(index, "replay");

    expect(results[0].type).toBe("view");
    expect(results[0].label).toBe("Replay View");
  });

  it("caps event-heavy results", function () {
    var events = [];
    for (var i = 0; i < 40; i++) {
      events.push({
        t: i,
        track: "tool_call",
        agent: "assistant",
        toolName: "bash",
        text: "bash command " + i,
        isError: false,
      });
    }

    var index = buildCommandPaletteIndex(events, []);
    var results = searchCommandPalette(index, "bash");
    var eventResults = results.filter(function (item) { return item.type === "event"; });

    expect(eventResults.length).toBeLessThanOrEqual(12);
  });
});

describe("timeline binning", function () {
  it("marks every covered bin for long-duration events", function () {
    var entries = [
      {
        index: 0,
        event: {
          t: 10,
          duration: 60,
          intensity: 0.8,
          isError: false,
          track: "tool_call",
        },
      },
    ];

    var bins = buildTimelineBins(entries, 100, null, null);
    var filled = bins.reduce(function (acc, bin) {
      return acc + (bin.count > 0 ? 1 : 0);
    }, 0);

    expect(filled).toBeGreaterThan(1);
  });
});
