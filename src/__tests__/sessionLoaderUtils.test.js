import { describe, expect, it } from "vitest";
import {
  SUPPORTED_FORMATS_ERROR,
  appendRawLines,
  buildAppliedSession,
  parseSessionText,
  shouldApplyLiveLines,
} from "../hooks/useSessionLoader.js";

function buildResult() {
  return {
    events: [
      { t: 0, duration: 1, track: "output", agent: "user", text: "hello", intensity: 0.5, isError: false },
      { t: 2, duration: 3, track: "output", agent: "assistant", text: "world", intensity: 0.5, isError: false },
    ],
    turns: [{ index: 0, eventIndices: [0, 1], startTime: 0, endTime: 5 }],
    metadata: { totalEvents: 2, totalTurns: 1 },
  };
}

describe("useSessionLoader helpers", function () {
  it("appends live text with stable newline handling", function () {
    expect(appendRawLines("", "line-1")).toBe("line-1");
    expect(appendRawLines("line-1", "line-2")).toBe("line-1\nline-2");
  });

  it("only accepts live updates from the active live request", function () {
    expect(shouldApplyLiveLines(2, 2)).toBe(true);
    expect(shouldApplyLiveLines(2, 3)).toBe(false);
  });

  it("returns a friendly supported-formats error when parsing yields no events", function () {
    var parsed = parseSessionText("{}", function () {
      return null;
    });

    expect(parsed.result).toBeNull();
    expect(parsed.error).toBe(SUPPORTED_FORMATS_ERROR);
  });

  it("returns an explicit parse failure when the parser throws", function () {
    var parsed = parseSessionText("bad", function () {
      throw new Error("boom");
    });

    expect(parsed.result).toBeNull();
    expect(parsed.error).toContain("Failed to parse file: boom");
  });

  it("builds the applied session payload from parsed data", function () {
    var applied = buildAppliedSession(buildResult(), "demo.jsonl");

    expect(applied.file).toBe("demo.jsonl");
    expect(applied.error).toBeNull();
    expect(applied.showHero).toBe(true);
    expect(applied.total).toBe(5);
    expect(applied.metadata.totalEvents).toBe(2);
  });
});
