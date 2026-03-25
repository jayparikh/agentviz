import { describe, expect, it } from "vitest";
import { buildAutonomyMetrics, formatAutonomyEfficiency, getNeedsReviewScore } from "../lib/autonomyMetrics.js";

describe("autonomy metrics", function () {
  it("derives babysitting, idle time, interventions, and efficiency from session gaps", function () {
    var events = [
      { t: 0, duration: 1, agent: "user", track: "output", text: "start" },
      { t: 2, duration: 4, agent: "assistant", track: "output", text: "working" },
      { t: 14, duration: 1, agent: "user", track: "output", text: "check in" },
      { t: 50, duration: 3, agent: "assistant", track: "tool_call", text: "bash()", toolName: "bash" },
      { t: 95, duration: 2, agent: "assistant", track: "output", text: "done" },
    ];
    var turns = [
      { index: 0, userMessage: "start" },
      { index: 1, userMessage: "check in" },
    ];
    var metadata = {
      duration: 100,
      totalTurns: 2,
      totalToolCalls: 1,
      errorCount: 0,
      format: "claude-code",
      primaryModel: "claude-sonnet-4",
      tokenUsage: null,
    };

    var metrics = buildAutonomyMetrics(events, turns, metadata);

    expect(metrics.interventionCount).toBe(1);
    expect(metrics.babysittingTime).toBe(8);
    expect(metrics.idleTime).toBe(77);
    expect(metrics.eventRuntime).toBe(11);
    expect(metrics.productiveRuntime).toBe(11);
    expect(metrics.topTools[0].name).toBe("bash");
    expect(formatAutonomyEfficiency(metrics.autonomyEfficiency)).toBe("11%");
    expect(getNeedsReviewScore({ autonomyMetrics: metrics, errorCount: 0 })).toBeGreaterThan(0);
  });

  it("caps babysitting time per follow-up gap and ignores continuation placeholders", function () {
    var events = [
      { t: 0, duration: 1, agent: "user", track: "output", text: "start" },
      { t: 2, duration: 3, agent: "assistant", track: "output", text: "working" },
      { t: 5000, duration: 1, agent: "user", track: "output", text: "(continuation)" },
    ];
    var turns = [
      { index: 0, userMessage: "start" },
      { index: 1, userMessage: "(continuation)" },
    ];
    var metadata = {
      duration: 5002,
      totalTurns: 2,
      totalToolCalls: 0,
      errorCount: 0,
      format: "copilot-cli",
    };

    var metrics = buildAutonomyMetrics(events, turns, metadata);

    expect(metrics.interventionCount).toBe(0);
    expect(metrics.babysittingTime).toBe(45);
    expect(metrics.userFollowUps).toEqual([]);
  });
});
