import { describe, it, expect } from "vitest";
import {
  eventMatchesQuery,
  filterEventEntries,
  clampTime,
} from "../lib/playbackUtils.js";

// ── Helpers ──

function makeEntry(index, overrides) {
  return {
    index: index,
    event: Object.assign({ text: "", agent: "assistant", track: "output" }, overrides),
  };
}

// ── clampTime ──

describe("clampTime", function () {
  it("returns time when within bounds", function () {
    expect(clampTime(5, 10)).toBe(5);
  });

  it("clamps to 0 when time is negative", function () {
    expect(clampTime(-3, 10)).toBe(0);
  });

  it("clamps to total when time exceeds total", function () {
    expect(clampTime(15, 10)).toBe(10);
  });

  it("returns 0 when total is 0", function () {
    expect(clampTime(5, 0)).toBe(0);
  });

  it("returns exact boundary values", function () {
    expect(clampTime(0, 10)).toBe(0);
    expect(clampTime(10, 10)).toBe(10);
  });
});

// ── eventMatchesQuery ──

describe("eventMatchesQuery", function () {
  it("matches on event text (case-insensitive)", function () {
    var entry = makeEntry(0, { text: "Hello World" });
    expect(eventMatchesQuery(entry, "hello")).toBe(true);
    expect(eventMatchesQuery(entry, "WORLD")).toBe(false); // lowerQuery must be lowercased by caller
    expect(eventMatchesQuery(entry, "world")).toBe(true);
  });

  it("matches on toolName", function () {
    var entry = makeEntry(0, { text: "", toolName: "Bash" });
    expect(eventMatchesQuery(entry, "bash")).toBe(true);
    expect(eventMatchesQuery(entry, "read")).toBe(false);
  });

  it("matches on agent", function () {
    var entry = makeEntry(0, { agent: "user", text: "" });
    expect(eventMatchesQuery(entry, "user")).toBe(true);
    expect(eventMatchesQuery(entry, "assistant")).toBe(false);
  });

  it("returns false when no fields match", function () {
    var entry = makeEntry(0, { text: "foo", toolName: "bar", agent: "assistant" });
    expect(eventMatchesQuery(entry, "xyz")).toBe(false);
  });

  it("handles missing optional fields gracefully", function () {
    var entry = makeEntry(0, { text: "some text" });
    // toolName is undefined
    expect(eventMatchesQuery(entry, "some")).toBe(true);
    expect(eventMatchesQuery(entry, "bash")).toBe(false);
  });

  it("handles empty text fields", function () {
    var entry = makeEntry(0, { text: "", agent: "assistant" });
    expect(eventMatchesQuery(entry, "assistant")).toBe(true);
    expect(eventMatchesQuery(entry, "")).toBe(true); // empty string always included
  });
});

// ── filterEventEntries ──

describe("filterEventEntries", function () {
  var entries = [
    makeEntry(0, { text: "Thinking about the problem", agent: "assistant" }),
    makeEntry(1, { text: "Running tests", toolName: "Bash", agent: "assistant" }),
    makeEntry(2, { text: "Hello from user", agent: "user" }),
    makeEntry(3, { text: "Reading file", toolName: "Read", agent: "assistant" }),
  ];

  it("returns empty array when query is empty", function () {
    expect(filterEventEntries(entries, "")).toEqual([]);
  });

  it("returns empty array when query is null/undefined", function () {
    expect(filterEventEntries(entries, null)).toEqual([]);
    expect(filterEventEntries(entries, undefined)).toEqual([]);
  });

  it("returns empty array when entries is null", function () {
    expect(filterEventEntries(null, "bash")).toEqual([]);
  });

  it("returns matching entries by text", function () {
    var results = filterEventEntries(entries, "thinking");
    expect(results).toHaveLength(1);
    expect(results[0].index).toBe(0);
  });

  it("returns matching entries by toolName", function () {
    var results = filterEventEntries(entries, "bash");
    expect(results).toHaveLength(1);
    expect(results[0].index).toBe(1);
  });

  it("returns matching entries by agent", function () {
    var results = filterEventEntries(entries, "user");
    expect(results).toHaveLength(1);
    expect(results[0].index).toBe(2);
  });

  it("returns multiple matches", function () {
    var results = filterEventEntries(entries, "assistant");
    expect(results).toHaveLength(3);
  });

  it("is case-insensitive", function () {
    var results = filterEventEntries(entries, "READ");
    expect(results).toHaveLength(1); // entry 3: "Reading file" text + "Read" toolName (same entry)
    expect(results[0].index).toBe(3);
  });

  it("returns empty array when nothing matches", function () {
    var results = filterEventEntries(entries, "zzznomatch");
    expect(results).toEqual([]);
  });

  it("preserves original entry references", function () {
    var results = filterEventEntries(entries, "bash");
    expect(results[0]).toBe(entries[1]);
  });
});
