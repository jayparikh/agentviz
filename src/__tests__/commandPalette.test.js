import { describe, expect, it } from "vitest";
import { buildCommandPaletteIndex, searchCommandPalette } from "../lib/commandPalette.js";

describe("command palette flow-aware items", function () {
  it("keeps same-tool same-time events and turn start identities distinct", function () {
    var events = [0, 1].map(function (index) {
      return { t: 0, text: "tool call " + index, toolName: "read", agent: "assistant", track: "tool_call" };
    });
    var index = buildCommandPaletteIndex(events, [{ index: 0, startTime: 0, eventIndices: [1], userMessage: "turn" }]);
    expect(index.items.filter(function (item) { return item.type === "event"; }).map(function (item) { return item.eventIndex; })).toEqual([0, 1]);
    expect(index.items.find(function (item) { return item.type === "turn"; }).eventIndex).toBe(1);
  });
  it("searches extra zone commands", function () {
    var index = buildCommandPaletteIndex([], [], {
      includeLegacyViews: false,
      includeDefaultActions: false,
      extraItems: [
        {
          id: "failed",
          type: "zone",
          label: "Go to failed tool calls",
          zoneId: "investigate",
          searchText: "failed tool calls errors investigate debug",
          priority: 48,
        },
      ],
    });

    var results = searchCommandPalette(index, "failed tool");

    expect(results.map(function (item) { return item.id; })).toEqual(["failed"]);
  });
});
