import { describe, it, expect } from "vitest";
import {
  buildFilteredEventEntriesV2,
  getUniqueToolNames,
  getUniqueAgents,
} from "../lib/session";

function makeEvent(overrides) {
  return Object.assign(
    { t: 0, agent: "assistant", track: "tool_call", text: "", duration: 1, intensity: 1, isError: false },
    overrides,
  );
}

var sampleEvents = [
  makeEvent({ agent: "assistant", track: "tool_call", toolName: "Read", isError: false }),
  makeEvent({ agent: "assistant", track: "tool_call", toolName: "Write", isError: true }),
  makeEvent({ agent: "user", track: "output", toolName: undefined, isError: false }),
  makeEvent({ agent: "system", track: "reasoning", toolName: undefined, isError: false }),
  makeEvent({ agent: "assistant", track: "tool_call", toolName: "Read", isError: false }),
];

describe("buildFilteredEventEntriesV2", function () {
  it("filters by toolNames on tool_call events", function () {
    var result = buildFilteredEventEntriesV2(sampleEvents, {
      hiddenTracks: {},
      toolNames: ["Read"],
    });
    var toolEntries = result.filter(function (e) { return e.event.track === "tool_call"; });
    expect(toolEntries.length).toBe(2);
    toolEntries.forEach(function (e) {
      expect(e.event.toolName).toBe("Read");
    });
    // Non-tool_call events should still pass through
    var nonToolEntries = result.filter(function (e) { return e.event.track !== "tool_call"; });
    expect(nonToolEntries.length).toBe(2);
  });

  it("filters by agents", function () {
    var result = buildFilteredEventEntriesV2(sampleEvents, {
      hiddenTracks: {},
      agents: ["user"],
    });
    expect(result.length).toBe(1);
    expect(result[0].event.agent).toBe("user");
  });

  it("filters errors only", function () {
    var result = buildFilteredEventEntriesV2(sampleEvents, {
      hiddenTracks: {},
      errorsOnly: true,
    });
    expect(result.length).toBe(1);
    expect(result[0].event.isError).toBe(true);
  });

  it("applies combined filters with AND logic", function () {
    var result = buildFilteredEventEntriesV2(sampleEvents, {
      hiddenTracks: {},
      toolNames: ["Write"],
      agents: ["assistant"],
      errorsOnly: true,
    });
    expect(result.length).toBe(1);
    expect(result[0].event.toolName).toBe("Write");
    expect(result[0].event.isError).toBe(true);
  });

  it("respects hiddenTracks alongside new filters", function () {
    var result = buildFilteredEventEntriesV2(sampleEvents, {
      hiddenTracks: { tool_call: true },
      agents: ["assistant", "user", "system"],
    });
    // All tool_call events hidden, only output + reasoning remain
    expect(result.length).toBe(2);
    result.forEach(function (e) {
      expect(e.event.track).not.toBe("tool_call");
    });
  });

  it("returns all events when no filters are active", function () {
    var result = buildFilteredEventEntriesV2(sampleEvents, { hiddenTracks: {} });
    expect(result.length).toBe(sampleEvents.length);
  });

  it("handles null events", function () {
    expect(buildFilteredEventEntriesV2(null, { hiddenTracks: {} })).toEqual([]);
  });

  it("handles undefined events", function () {
    expect(buildFilteredEventEntriesV2(undefined, { hiddenTracks: {} })).toEqual([]);
  });

  it("handles empty events array", function () {
    expect(buildFilteredEventEntriesV2([], { hiddenTracks: {} })).toEqual([]);
  });

  it("preserves correct original indices", function () {
    var result = buildFilteredEventEntriesV2(sampleEvents, {
      hiddenTracks: {},
      agents: ["user"],
    });
    expect(result[0].index).toBe(2);
  });
});

describe("getUniqueToolNames", function () {
  it("returns sorted unique tool names", function () {
    var result = getUniqueToolNames(sampleEvents);
    expect(result).toEqual(["Read", "Write"]);
  });

  it("handles null events", function () {
    expect(getUniqueToolNames(null)).toEqual([]);
  });

  it("handles empty events", function () {
    expect(getUniqueToolNames([])).toEqual([]);
  });
});

describe("getUniqueAgents", function () {
  it("returns sorted unique agents", function () {
    var result = getUniqueAgents(sampleEvents);
    expect(result).toEqual(["assistant", "system", "user"]);
  });

  it("handles null events", function () {
    expect(getUniqueAgents(null)).toEqual([]);
  });

  it("handles undefined events", function () {
    expect(getUniqueAgents(undefined)).toEqual([]);
  });
});
