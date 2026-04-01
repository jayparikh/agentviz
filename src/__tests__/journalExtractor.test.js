import { describe, it, expect } from "vitest";
import {
  extractJournal,
  computeJournalStats,
  JOURNAL_TYPES,
} from "../lib/journalExtractor.js";

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makeTurn(overrides) {
  return Object.assign({
    index: 0,
    startTime: 0,
    endTime: 10,
    eventIndices: [],
    userMessage: "",
    toolCount: 0,
    hasError: false,
  }, overrides);
}

function makeEvent(overrides) {
  return Object.assign({
    t: 0,
    agent: "assistant",
    track: "reasoning",
    text: "",
    duration: 1,
    intensity: 0.5,
    isError: false,
    turnIndex: 0,
  }, overrides);
}

// ── JOURNAL_TYPES ────────────────────────────────────────────────────────────

describe("JOURNAL_TYPES", function () {
  it("defines all 6 entry types", function () {
    expect(Object.keys(JOURNAL_TYPES)).toHaveLength(6);
    expect(JOURNAL_TYPES).toHaveProperty("steering");
    expect(JOURNAL_TYPES).toHaveProperty("levelup");
    expect(JOURNAL_TYPES).toHaveProperty("pivot");
    expect(JOURNAL_TYPES).toHaveProperty("mistake");
    expect(JOURNAL_TYPES).toHaveProperty("milestone");
    expect(JOURNAL_TYPES).toHaveProperty("insight");
  });

  it("each type has id, label, emoji, and color", function () {
    Object.values(JOURNAL_TYPES).forEach(function (t) {
      expect(t).toHaveProperty("id");
      expect(t).toHaveProperty("label");
      expect(t).toHaveProperty("emoji");
      expect(t).toHaveProperty("color");
      expect(t.color).toMatch(/^#[0-9a-f]{6}$/i);
    });
  });
});

// ── extractJournal — empty/edge inputs ───────────────────────────────────────

describe("extractJournal", function () {
  describe("empty and edge inputs", function () {
    it("returns empty array for null events", function () {
      expect(extractJournal(null, null)).toEqual([]);
    });

    it("returns empty array for empty arrays", function () {
      expect(extractJournal([], [])).toEqual([]);
    });

    it("returns empty array for events with no turns", function () {
      var events = [makeEvent({ t: 1 })];
      expect(extractJournal(events, [])).toEqual([]);
    });
  });

  // ── Steering detection ───────────────────────────────────────────────────

  describe("steering detection", function () {
    it("detects 'instead' as steering", function () {
      var turns = [
        makeTurn({ index: 0, startTime: 0, userMessage: "Build a parser" }),
        makeTurn({ index: 1, startTime: 10, userMessage: "Use regex instead of manual parsing" }),
      ];
      var events = [makeEvent({ t: 0 }), makeEvent({ t: 10 })];
      var entries = extractJournal(events, turns);
      var steering = entries.filter(function (e) { return e.type === "steering"; });
      expect(steering.length).toBeGreaterThanOrEqual(1);
      expect(steering[0].turnIndex).toBe(1);
    });

    it("detects 'try again' as steering", function () {
      var turns = [
        makeTurn({ index: 0, startTime: 0, userMessage: "Create the API" }),
        makeTurn({ index: 1, startTime: 10, userMessage: "That's wrong, try again with Express" }),
      ];
      var entries = extractJournal([], turns);
      var steering = entries.filter(function (e) { return e.type === "steering"; });
      expect(steering.length).toBeGreaterThanOrEqual(1);
    });

    it("detects 'don't' as steering", function () {
      var turns = [
        makeTurn({ index: 0, startTime: 0, userMessage: "Start" }),
        makeTurn({ index: 1, startTime: 5, userMessage: "Don't use that library" }),
      ];
      var entries = extractJournal([], turns);
      var steering = entries.filter(function (e) { return e.type === "steering"; });
      expect(steering.length).toBeGreaterThanOrEqual(1);
    });

    it("does not flag the first turn as steering", function () {
      var turns = [
        makeTurn({ index: 0, startTime: 0, userMessage: "Actually let's try something instead" }),
      ];
      var entries = extractJournal([], turns);
      var steering = entries.filter(function (e) { return e.type === "steering"; });
      expect(steering.length).toBe(0);
    });

    it("ignores short user messages", function () {
      var turns = [
        makeTurn({ index: 0, startTime: 0, userMessage: "go" }),
        makeTurn({ index: 1, startTime: 5, userMessage: "ok" }),
      ];
      var entries = extractJournal([], turns);
      var steering = entries.filter(function (e) { return e.type === "steering"; });
      expect(steering.length).toBe(0);
    });
  });

  // ── Error recovery (mistake + levelup) ─────────────────────────────────

  describe("error recovery arcs", function () {
    it("detects error turns as mistakes", function () {
      var events = [
        makeEvent({ t: 0, isError: true, turnIndex: 0 }),
      ];
      var turns = [
        makeTurn({ index: 0, startTime: 0, hasError: true, eventIndices: [0] }),
      ];
      var entries = extractJournal(events, turns);
      var mistakes = entries.filter(function (e) { return e.type === "mistake"; });
      expect(mistakes.length).toBeGreaterThanOrEqual(1);
    });

    it("detects recovery after error as level-up", function () {
      var events = [
        makeEvent({ t: 0, isError: true, turnIndex: 0 }),
        makeEvent({ t: 10, isError: false, turnIndex: 1 }),
      ];
      var turns = [
        makeTurn({ index: 0, startTime: 0, hasError: true, eventIndices: [0] }),
        makeTurn({ index: 1, startTime: 10, hasError: false, toolCount: 3, eventIndices: [1] }),
      ];
      var entries = extractJournal(events, turns);
      var levelups = entries.filter(function (e) { return e.type === "levelup"; });
      expect(levelups.length).toBeGreaterThanOrEqual(1);
      expect(levelups[0].title).toContain("Recovered");
    });
  });

  // ── Milestones ─────────────────────────────────────────────────────────

  describe("milestones", function () {
    it("always creates session start milestone", function () {
      var turns = [
        makeTurn({ index: 0, startTime: 0, userMessage: "Build the feature" }),
      ];
      var entries = extractJournal([], turns);
      var milestones = entries.filter(function (e) { return e.type === "milestone"; });
      expect(milestones.length).toBeGreaterThanOrEqual(1);
      var start = milestones.find(function (m) { return m.title === "Session started"; });
      expect(start).toBeDefined();
    });

    it("creates session end milestone for multi-turn sessions", function () {
      var turns = [
        makeTurn({ index: 0, startTime: 0 }),
        makeTurn({ index: 1, startTime: 10 }),
      ];
      var entries = extractJournal([], turns);
      var end = entries.find(function (e) { return e.title === "Session ended"; });
      expect(end).toBeDefined();
      expect(end.type).toBe("milestone");
    });

    it("detects heavy tool-count turns with test tools as milestones", function () {
      var events = [];
      var indices = [];
      for (var i = 0; i < 20; i++) {
        events.push(makeEvent({ t: i, toolName: i < 15 ? "edit" : "test", turnIndex: 0 }));
        indices.push(i);
      }
      var turns = [
        makeTurn({ index: 0, startTime: 0, toolCount: 20, eventIndices: indices }),
      ];
      var entries = extractJournal(events, turns);
      var milestones = entries.filter(function (e) {
        return e.type === "milestone" && e.title !== "Session started";
      });
      expect(milestones.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── Insights ───────────────────────────────────────────────────────────

  describe("insight detection", function () {
    it("detects discovery language in reasoning events", function () {
      var events = [
        makeEvent({
          t: 5,
          track: "reasoning",
          text: "I found the root cause of the issue. The problem is that the connection pool is exhausted because connections are never returned after use.",
          turnIndex: 0,
        }),
      ];
      var turns = [makeTurn({ index: 0, startTime: 0 })];
      var entries = extractJournal(events, turns);
      var insights = entries.filter(function (e) { return e.type === "insight"; });
      expect(insights.length).toBeGreaterThanOrEqual(1);
    });

    it("ignores short reasoning text", function () {
      var events = [
        makeEvent({ t: 5, track: "reasoning", text: "found it", turnIndex: 0 }),
      ];
      var turns = [makeTurn({ index: 0, startTime: 0 })];
      var entries = extractJournal(events, turns);
      var insights = entries.filter(function (e) { return e.type === "insight"; });
      expect(insights.length).toBe(0);
    });

    it("limits insight count to avoid noise", function () {
      var events = [];
      var i;
      for (i = 0; i < 30; i++) {
        events.push(makeEvent({
          t: i,
          track: "reasoning",
          text: "I discovered that the configuration file at this path contains the settings we need to modify for this particular integration test scenario and it requires careful changes to work correctly",
          turnIndex: 0,
        }));
      }
      var turns = [makeTurn({ index: 0, startTime: 0 })];
      var entries = extractJournal(events, turns);
      var insights = entries.filter(function (e) { return e.type === "insight"; });
      expect(insights.length).toBeLessThanOrEqual(10);
    });
  });

  // ── Pivot detection ────────────────────────────────────────────────────

  describe("pivot detection", function () {
    it("detects rapid consecutive steerings as pivot", function () {
      var turns = [
        makeTurn({ index: 0, startTime: 0, userMessage: "Build the API" }),
        makeTurn({ index: 1, startTime: 5, userMessage: "Actually switch to GraphQL instead" }),
        makeTurn({ index: 2, startTime: 10, userMessage: "No wait, let's try REST instead" }),
      ];
      var entries = extractJournal([], turns);
      var pivots = entries.filter(function (e) { return e.type === "pivot"; });
      expect(pivots.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── Deduplication ──────────────────────────────────────────────────────

  describe("deduplication", function () {
    it("does not produce duplicate entries for same turn and type", function () {
      var turns = [
        makeTurn({ index: 0, startTime: 0, userMessage: "Build it" }),
        makeTurn({ index: 1, startTime: 5, userMessage: "Switch to a different approach instead" }),
      ];
      var entries = extractJournal([], turns);
      var keys = entries.map(function (e) { return e.type + ":" + e.turnIndex; });
      var unique = keys.filter(function (k, i) { return keys.indexOf(k) === i; });
      expect(unique.length).toBe(keys.length);
    });
  });

  // ── Sorting ────────────────────────────────────────────────────────────

  describe("chronological sorting", function () {
    it("returns entries sorted by time ascending", function () {
      var turns = [
        makeTurn({ index: 0, startTime: 0, userMessage: "Start" }),
        makeTurn({ index: 1, startTime: 10, userMessage: "Actually try something else instead" }),
        makeTurn({ index: 2, startTime: 20, hasError: true }),
        makeTurn({ index: 3, startTime: 30 }),
      ];
      var events = [
        makeEvent({ t: 20, isError: true, turnIndex: 2 }),
      ];
      var entries = extractJournal(events, turns);
      for (var i = 1; i < entries.length; i++) {
        expect(entries[i].time).toBeGreaterThanOrEqual(entries[i - 1].time);
      }
    });
  });
});

// ── computeJournalStats ──────────────────────────────────────────────────────

describe("computeJournalStats", function () {
  it("counts entries by type", function () {
    var entries = [
      { type: "steering" },
      { type: "steering" },
      { type: "mistake" },
      { type: "levelup" },
      { type: "milestone" },
      { type: "milestone" },
      { type: "milestone" },
    ];
    var stats = computeJournalStats(entries);
    expect(stats.total).toBe(7);
    expect(stats.steering).toBe(2);
    expect(stats.mistake).toBe(1);
    expect(stats.levelup).toBe(1);
    expect(stats.milestone).toBe(3);
    expect(stats.pivot).toBe(0);
    expect(stats.insight).toBe(0);
  });

  it("handles empty array", function () {
    var stats = computeJournalStats([]);
    expect(stats.total).toBe(0);
  });
});
