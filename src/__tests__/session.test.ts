import { describe, it, expect } from "vitest";
import { getSessionTotal, buildFilteredEventEntries, buildTurnStartMap, buildTimeMap } from "../lib/session";

function makeEvent(t, duration, track, agent) {
  return {
    t: t,
    duration: duration || 0,
    track: track || "reasoning",
    agent: agent || "assistant",
    text: "test",
  };
}

describe("getSessionTotal", function () {
  it("returns 0 for null or empty events", function () {
    expect(getSessionTotal(null)).toBe(0);
    expect(getSessionTotal(undefined)).toBe(0);
    expect(getSessionTotal([])).toBe(0);
  });

  it("computes max(t + duration) across all events", function () {
    var events = [
      makeEvent(0, 5),
      makeEvent(3, 10),
      makeEvent(20, 2),
    ];
    expect(getSessionTotal(events)).toBe(22);
  });

  it("handles single event", function () {
    expect(getSessionTotal([makeEvent(10, 3)])).toBe(13);
  });
});

describe("buildFilteredEventEntries", function () {
  var events = [
    makeEvent(0, 1, "reasoning"),
    makeEvent(1, 1, "tool_call"),
    makeEvent(2, 1, "output"),
    makeEvent(3, 1, "reasoning"),
  ];

  it("returns all events when no tracks are hidden", function () {
    var entries = buildFilteredEventEntries(events, {});
    expect(entries).toHaveLength(4);
    expect(entries[0].index).toBe(0);
    expect(entries[0].event).toBe(events[0]);
  });

  it("filters out hidden tracks", function () {
    var entries = buildFilteredEventEntries(events, { reasoning: true });
    expect(entries).toHaveLength(2);
    expect(entries[0].event.track).toBe("tool_call");
    expect(entries[1].event.track).toBe("output");
  });

  it("returns empty for null events", function () {
    expect(buildFilteredEventEntries(null, {})).toEqual([]);
    expect(buildFilteredEventEntries(undefined, {})).toEqual([]);
  });
});

describe("buildTurnStartMap", function () {
  it("maps first event index of each turn to the turn", function () {
    var turns = [
      { index: 0, eventIndices: [0, 1, 2] },
      { index: 1, eventIndices: [3, 4] },
    ];
    var map = buildTurnStartMap(turns);
    expect(map[0]).toBe(turns[0]);
    expect(map[3]).toBe(turns[1]);
    expect(map[1]).toBeUndefined();
  });

  it("skips turns with no events", function () {
    var turns = [
      { index: 0, eventIndices: [] },
      { index: 1, eventIndices: [5] },
    ];
    var map = buildTurnStartMap(turns);
    expect(Object.keys(map)).toHaveLength(1);
    expect(map[5]).toBe(turns[1]);
  });
});

describe("buildTimeMap", function () {
  it("returns identity map for null/empty events", function () {
    var map = buildTimeMap(null);
    expect(map.hasCompression).toBe(false);
    expect(map.displayTotal).toBe(0);
    expect(map.toPosition(0)).toBe(0);
    expect(map.toTime(0)).toBe(0);
  });

  it("returns identity map for evenly spaced events", function () {
    var events = [
      makeEvent(0, 1),
      makeEvent(2, 1),
      makeEvent(4, 1),
      makeEvent(6, 1),
    ];
    var map = buildTimeMap(events);
    expect(map.hasCompression).toBe(false);
  });

  it("compresses large gaps between events", function () {
    var events = [
      makeEvent(0, 1),
      makeEvent(2, 1),
      makeEvent(5000, 1),
      makeEvent(5002, 1),
    ];
    var map = buildTimeMap(events);
    expect(map.hasCompression).toBe(true);
    expect(map.displayTotal).toBeLessThan(5003);
  });

  it("maps position 0 to time 0 and position 1 to session total", function () {
    var events = [
      makeEvent(0, 1),
      makeEvent(2, 1),
      makeEvent(5000, 1),
      makeEvent(5002, 1),
    ];
    var map = buildTimeMap(events);
    expect(map.toTime(0)).toBe(0);
    expect(map.toTime(1)).toBe(getSessionTotal(events));
  });

  it("roundtrips position -> time -> position", function () {
    var events = [
      makeEvent(0, 1),
      makeEvent(2, 1),
      makeEvent(5000, 1),
      makeEvent(5002, 1),
    ];
    var map = buildTimeMap(events);
    for (var p = 0; p <= 1; p += 0.25) {
      var time = map.toTime(p);
      var backToPos = map.toPosition(time);
      expect(Math.abs(backToPos - p)).toBeLessThan(0.001);
    }
  });
});
