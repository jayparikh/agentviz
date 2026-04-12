import { describe, expect, it } from "vitest";
import { buildAutonomyMetrics, buildAutonomySummary, formatAutonomyEfficiency, getNeedsReviewScore, getSessionCost, getTopTools } from "../lib/autonomyMetrics.js";

describe("autonomy metrics", function () {
  it("treats missing Copilot or VS Code cost data as unknown", function () {
    expect(getSessionCost({ format: "copilot-cli" })).toBeNull();
    expect(getSessionCost({ format: "vscode-chat" })).toBeNull();
  });

  it("returns null for Claude Code with unknown model", function () {
    expect(getSessionCost({ format: "claude-code", primaryModel: null })).toBeNull();
    expect(getSessionCost({ format: "claude-code" })).toBeNull();
  });

  it("returns null for non-Claude model (e.g. GPT)", function () {
    expect(getSessionCost({
      format: "claude-code",
      primaryModel: "gpt-4o",
      tokenUsage: { inputTokens: 1000, outputTokens: 1000 },
    })).toBeNull();
  });

  it("estimates cost for Claude Code with recognized model", function () {
    var cost = getSessionCost({
      format: "claude-code",
      primaryModel: "claude-sonnet-4-20250514",
      tokenUsage: { inputTokens: 1000000, outputTokens: 100000 },
    });
    expect(cost).toBeGreaterThan(0);
  });

  it("uses fallback pricing for unrecognized Claude variant", function () {
    var cost = getSessionCost({
      format: "claude-code",
      primaryModel: "claude-99-mega-20260101",
      tokenUsage: { inputTokens: 1000000, outputTokens: 100000 },
    });
    expect(cost).toBeGreaterThan(0);
  });

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

describe("getTopTools", function () {
  it("counts tool calls and returns sorted by frequency", function () {
    var events = [
      { track: "tool_call", toolName: "bash" },
      { track: "tool_call", toolName: "edit" },
      { track: "tool_call", toolName: "bash" },
      { track: "tool_call", toolName: "bash" },
      { track: "tool_call", toolName: "edit" },
      { track: "reasoning", toolName: null },
    ];
    var top = getTopTools(events, 5);
    expect(top[0]).toEqual({ name: "bash", count: 3 });
    expect(top[1]).toEqual({ name: "edit", count: 2 });
  });

  it("respects limit parameter", function () {
    var events = [
      { track: "tool_call", toolName: "bash" },
      { track: "tool_call", toolName: "edit" },
      { track: "tool_call", toolName: "view" },
    ];
    expect(getTopTools(events, 2)).toHaveLength(2);
  });

  it("handles null/empty events", function () {
    expect(getTopTools(null, 5)).toEqual([]);
    expect(getTopTools([], 5)).toEqual([]);
  });
});

describe("buildAutonomySummary", function () {
  it("returns empty array for null metrics", function () {
    expect(buildAutonomySummary(null)).toEqual([]);
  });

  it("returns 5 summary items with labels and values", function () {
    var metrics = {
      productiveRuntime: 120,
      babysittingTime: 30,
      idleTime: 45,
      interventionCount: 2,
      autonomyEfficiency: 0.65,
    };
    var summary = buildAutonomySummary(metrics);
    expect(summary).toHaveLength(5);
    summary.forEach(function (item) {
      expect(item.label).toBeTruthy();
      expect(item.value).toBeTruthy();
      expect(item.tooltip).toBeTruthy();
    });
    expect(summary[0].label).toBe("Productive runtime");
    expect(summary[3].value).toBe("2");
  });
});
