import { describe, it, expect } from "vitest";
import {
  extractSteering,
  computeSteeringStats,
  STEERING_TYPES,
} from "../lib/steeringExtractor.js";

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

// ── STEERING_TYPES ────────────────────────────────────────────────────────────

describe("STEERING_TYPES", function () {
  it("defines all 6 entry types", function () {
    expect(Object.keys(STEERING_TYPES)).toHaveLength(6);
    expect(STEERING_TYPES).toHaveProperty("steering");
    expect(STEERING_TYPES).toHaveProperty("levelup");
    expect(STEERING_TYPES).toHaveProperty("pivot");
    expect(STEERING_TYPES).toHaveProperty("mistake");
    expect(STEERING_TYPES).toHaveProperty("milestone");
    expect(STEERING_TYPES).toHaveProperty("insight");
  });

  it("each type has id, label, emoji, and color", function () {
    Object.values(STEERING_TYPES).forEach(function (t) {
      expect(t).toHaveProperty("id");
      expect(t).toHaveProperty("label");
      expect(t).toHaveProperty("emoji");
      expect(t).toHaveProperty("color");
      expect(t.color).toMatch(/^#[0-9a-f]{6}$/i);
    });
  });
});

// ── extractSteering — empty/edge inputs ───────────────────────────────────────

describe("extractSteering", function () {
  describe("empty and edge inputs", function () {
    it("returns empty array for null events", function () {
      expect(extractSteering(null, null)).toEqual([]);
    });

    it("returns empty array for empty arrays", function () {
      expect(extractSteering([], [])).toEqual([]);
    });

    it("returns empty array for events with no turns", function () {
      var events = [makeEvent({ t: 1 })];
      expect(extractSteering(events, [])).toEqual([]);
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
      var entries = extractSteering(events, turns);
      var steering = entries.filter(function (e) { return e.type === "steering"; });
      expect(steering.length).toBeGreaterThanOrEqual(1);
      expect(steering[0].turnIndex).toBe(1);
    });

    it("detects 'try again' as steering", function () {
      var turns = [
        makeTurn({ index: 0, startTime: 0, userMessage: "Create the API" }),
        makeTurn({ index: 1, startTime: 10, userMessage: "That's wrong, try again with Express" }),
      ];
      var entries = extractSteering([], turns);
      var steering = entries.filter(function (e) { return e.type === "steering"; });
      expect(steering.length).toBeGreaterThanOrEqual(1);
    });

    it("detects 'don't' as steering", function () {
      var turns = [
        makeTurn({ index: 0, startTime: 0, userMessage: "Start" }),
        makeTurn({ index: 1, startTime: 5, userMessage: "Don't use that library" }),
      ];
      var entries = extractSteering([], turns);
      var steering = entries.filter(function (e) { return e.type === "steering"; });
      expect(steering.length).toBeGreaterThanOrEqual(1);
    });

    it("does not flag the first turn as steering", function () {
      var turns = [
        makeTurn({ index: 0, startTime: 0, userMessage: "Actually let's try something instead" }),
      ];
      var entries = extractSteering([], turns);
      var steering = entries.filter(function (e) { return e.type === "steering"; });
      expect(steering.length).toBe(0);
    });

    it("ignores short user messages", function () {
      var turns = [
        makeTurn({ index: 0, startTime: 0, userMessage: "go" }),
        makeTurn({ index: 1, startTime: 5, userMessage: "ok" }),
      ];
      var entries = extractSteering([], turns);
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
      var entries = extractSteering(events, turns);
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
      var entries = extractSteering(events, turns);
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
      var entries = extractSteering([], turns);
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
      var entries = extractSteering([], turns);
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
      var entries = extractSteering(events, turns);
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
      var entries = extractSteering(events, turns);
      var insights = entries.filter(function (e) { return e.type === "insight"; });
      expect(insights.length).toBeGreaterThanOrEqual(1);
    });

    it("ignores short reasoning text", function () {
      var events = [
        makeEvent({ t: 5, track: "reasoning", text: "found it", turnIndex: 0 }),
      ];
      var turns = [makeTurn({ index: 0, startTime: 0 })];
      var entries = extractSteering(events, turns);
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
      var entries = extractSteering(events, turns);
      var insights = entries.filter(function (e) { return e.type === "insight"; });
      expect(insights.length).toBeLessThanOrEqual(10);
    });
  });

  // ── Pivot detection ────────────────────────────────────────────────────

  describe("pivot detection (removed)", function () {
    it("no longer generates synthetic pivot entries from consecutive steerings", function () {
      var turns = [
        makeTurn({ index: 0, startTime: 0, userMessage: "Build the API" }),
        makeTurn({ index: 1, startTime: 5, userMessage: "Actually switch to GraphQL instead" }),
        makeTurn({ index: 2, startTime: 10, userMessage: "No wait, let's try REST instead" }),
      ];
      var entries = extractSteering([], turns);
      var pivots = entries.filter(function (e) { return e.type === "pivot"; });
      expect(pivots.length).toBe(0);
    });
  });

  // ── Deduplication ──────────────────────────────────────────────────────

  describe("deduplication", function () {
    it("does not produce duplicate entries for same turn and type", function () {
      var turns = [
        makeTurn({ index: 0, startTime: 0, userMessage: "Build it" }),
        makeTurn({ index: 1, startTime: 5, userMessage: "Switch to a different approach instead" }),
      ];
      var entries = extractSteering([], turns);
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
      var entries = extractSteering(events, turns);
      for (var i = 1; i < entries.length; i++) {
        expect(entries[i].time).toBeGreaterThanOrEqual(entries[i - 1].time);
      }
    });
  });

  // ── Live update simulation ─────────────────────────────────────────────

  describe("live update behavior", function () {
    it("produces new steering entries when new turns are appended", function () {
      var baseTurns = [
        makeTurn({ index: 0, startTime: 0, userMessage: "Build the initial feature" }),
        makeTurn({ index: 1, startTime: 10, userMessage: "Switch to a different approach instead of this one" }),
      ];
      var baseEntries = extractSteering([], baseTurns);
      var baseSteering = baseEntries.filter(function (e) { return e.type === "steering"; });

      // Simulate live update: new turn arrives
      var updatedTurns = baseTurns.concat([
        makeTurn({ index: 2, startTime: 20, userMessage: "Actually try using the repo history instead of session data" }),
      ]);
      var updatedEntries = extractSteering([], updatedTurns);
      var updatedSteering = updatedEntries.filter(function (e) { return e.type === "steering"; });

      expect(updatedSteering.length).toBeGreaterThan(baseSteering.length);
    });

    it("captures assistant response from new turn events", function () {
      var events = [
        makeEvent({ t: 0, track: "assistant", text: "Initial response", turnIndex: 0 }),
        makeEvent({ t: 10, track: "assistant", text: "This is the detailed squad reasoning about the new direction we should take for this feature", turnIndex: 1 }),
      ];
      var turns = [
        makeTurn({ index: 0, startTime: 0, userMessage: "Build the feature", eventIndices: [0] }),
        makeTurn({ index: 1, startTime: 10, userMessage: "No wait, try a completely different approach instead", eventIndices: [1] }),
      ];
      var entries = extractSteering(events, turns);
      var steering = entries.filter(function (e) { return e.type === "steering"; });
      expect(steering.length).toBeGreaterThanOrEqual(1);
      expect(steering[0].assistantResponse).toContain("squad reasoning");
    });

    it("filters out short messages as non-steering", function () {
      var turns = [
        makeTurn({ index: 0, startTime: 0, userMessage: "Build it" }),
        makeTurn({ index: 1, startTime: 5, userMessage: "iterate" }),
        makeTurn({ index: 2, startTime: 10, userMessage: "good" }),
        makeTurn({ index: 3, startTime: 15, userMessage: "ok do it" }),
      ];
      var entries = extractSteering([], turns);
      var steering = entries.filter(function (e) { return e.type === "steering"; });
      expect(steering.length).toBe(0);
    });

    it("computes impactTurns between consecutive steerings", function () {
      var turns = [
        makeTurn({ index: 0, startTime: 0, userMessage: "Start the project with a basic setup" }),
        makeTurn({ index: 1, startTime: 5 }),
        makeTurn({ index: 2, startTime: 10 }),
        makeTurn({ index: 3, startTime: 15, userMessage: "Switch to a completely different architecture instead" }),
        makeTurn({ index: 4, startTime: 20 }),
      ];
      var entries = extractSteering([], turns);
      var steering = entries.filter(function (e) { return e.type === "steering"; });
      expect(steering.length).toBeGreaterThanOrEqual(1);
      var first = steering[0];
      expect(first.impactTurns).toBeGreaterThan(0);
    });
  });
});

// ── computeSteeringStats ──────────────────────────────────────────────────────

describe("computeSteeringStats", function () {
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
    var stats = computeSteeringStats(entries);
    expect(stats.total).toBe(7);
    expect(stats.steering).toBe(2);
    expect(stats.mistake).toBe(1);
    expect(stats.levelup).toBe(1);
    expect(stats.milestone).toBe(3);
    expect(stats.pivot).toBe(0);
    expect(stats.insight).toBe(0);
  });

  it("handles empty array", function () {
    var stats = computeSteeringStats([]);
    expect(stats.total).toBe(0);
  });
});
