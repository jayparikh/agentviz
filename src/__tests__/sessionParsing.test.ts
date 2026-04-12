import { describe, it, expect } from "vitest";
import { parseSessionText, buildAppliedSession, SUPPORTED_FORMATS_ERROR } from "../lib/sessionParsing";

function makeParsedSession(eventCount) {
  var events = [];
  for (var i = 0; i < eventCount; i++) {
    events.push({ t: i * 2, duration: 1, track: "reasoning", agent: "assistant", text: "event " + i });
  }
  return {
    events: events,
    turns: [{ index: 0, startTime: 0, endTime: eventCount * 2, eventIndices: events.map(function (_, idx) { return idx; }), userMessage: "start", toolCount: 0, hasError: false }],
    metadata: { totalEvents: eventCount, totalTurns: 1, totalToolCalls: 0, errorCount: 0, duration: eventCount * 2 },
  };
}

describe("parseSessionText", function () {
  it("returns error for text that produces no events", function () {
    var result = parseSessionText("not a valid session", function () { return null; });
    expect(result.result).toBeNull();
    expect(result.error).toBe(SUPPORTED_FORMATS_ERROR);
  });

  it("returns error for parser returning empty events", function () {
    var result = parseSessionText("text", function () {
      return { events: [], turns: [], metadata: {} };
    });
    expect(result.result).toBeNull();
    expect(result.error).toBe(SUPPORTED_FORMATS_ERROR);
  });

  it("returns parsed result on success", function () {
    var session = makeParsedSession(3);
    var result = parseSessionText("text", function () { return session; });
    expect(result.result).toBe(session);
    expect(result.error).toBeNull();
  });

  it("catches parser exceptions and returns error", function () {
    var result = parseSessionText("text", function () {
      throw new Error("parse boom");
    });
    expect(result.result).toBeNull();
    expect(result.error).toContain("parse boom");
  });

  it("handles non-Error thrown values", function () {
    var result = parseSessionText("text", function () {
      throw "string error";
    });
    expect(result.result).toBeNull();
    expect(result.error).toContain("unknown error");
  });
});

describe("buildAppliedSession", function () {
  it("builds applied session with total and file name", function () {
    var session = makeParsedSession(3);
    var applied = buildAppliedSession(session, "test.jsonl");

    expect(applied.events).toBe(session.events);
    expect(applied.turns).toBe(session.turns);
    expect(applied.metadata).toBe(session.metadata);
    expect(applied.file).toBe("test.jsonl");
    expect(applied.total).toBeGreaterThan(0);
    expect(applied.error).toBeNull();
    expect(applied.showHero).toBe(true);
  });
});
