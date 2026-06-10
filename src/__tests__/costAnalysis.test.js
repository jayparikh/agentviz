import { describe, expect, it } from "vitest";
import { buildCostAnalysis, formatTokens } from "../lib/costAnalysis.js";

function event(index, usage, model, contextTotal, tools) {
  return {
    t: index,
    agent: "assistant",
    track: "output",
    text: "Call " + (index + 1),
    duration: 1,
    intensity: 0.5,
    isError: false,
    model: model || "gpt-4.1",
    tokenUsage: usage,
    raw: {
      costPrompt: {
        toolNames: tools || ["read_file"],
        contextBreakdown: {
          system: 100,
          tools: 200,
          history: Math.max(contextTotal - 350, 0),
          toolResults: 25,
          user: 25,
          total: contextTotal,
        },
      },
    },
  };
}

describe("buildCostAnalysis", function () {
  it("builds cumulative costs and token totals", function () {
    var analysis = buildCostAnalysis([
      event(0, { inputTokens: 1000, outputTokens: 100, cacheRead: 200, cacheWrite: 50 }, "gpt-4.1", 1000),
      event(1, { inputTokens: 1500, outputTokens: 120, cacheRead: 600, cacheWrite: 0 }, "gpt-4.1", 1300),
    ], { primaryModel: "gpt-4.1" });

    expect(analysis.hasCostData).toBe(true);
    expect(analysis.calls).toHaveLength(2);
    expect(analysis.totals.inputTokens).toBe(2500);
    expect(analysis.totals.cacheRead).toBe(800);
    expect(analysis.totals.freshInputTokens).toBe(1650);
    expect(analysis.calls[1].cumulativeCost).toBeGreaterThan(analysis.calls[0].cost);
    expect(analysis.totals.peakContext).toBe(1300);
  });

  it("flags same-model cache misses with tool diffs", function () {
    var analysis = buildCostAnalysis([
      event(0, { inputTokens: 4000, outputTokens: 100, cacheRead: 3000, cacheWrite: 0 }, "gpt-4.1", 4000, ["read_file"]),
      event(1, { inputTokens: 9000, outputTokens: 120, cacheRead: 200, cacheWrite: 0 }, "gpt-4.1", 9000, ["read_file", "grep"]),
    ], {});

    expect(analysis.cacheMisses).toHaveLength(1);
    expect(analysis.cacheMisses[0].callIndex).toBe(1);
    expect(analysis.cacheMisses[0].toolDiff.added).toEqual(["grep"]);
  });

  it("ignores events without token usage", function () {
    var analysis = buildCostAnalysis([{ text: "no usage" }], {});
    expect(analysis.hasCostData).toBe(false);
    expect(analysis.calls).toHaveLength(0);
  });

  it("uses metadata token totals when event-level usage is incomplete", function () {
    var analysis = buildCostAnalysis([
      event(0, { outputTokens: 100 }, "gpt-4.1", 0),
    ], {
      primaryModel: "gpt-4.1",
      totalCost: 1.23,
      tokenUsage: { inputTokens: 5000, outputTokens: 300, cacheRead: 1200, cacheWrite: 800 },
      modelTokenUsage: {
        "gpt-4.1": { inputTokens: 5000, outputTokens: 300, cacheRead: 1200, cacheWrite: 800 },
      },
    });

    expect(analysis.hasCostData).toBe(true);
    expect(analysis.calls).toHaveLength(1);
    expect(analysis.calls[0].isMetadataSummary).toBe(true);
    expect(analysis.totals.inputTokens).toBe(5000);
    expect(analysis.totals.outputTokens).toBe(300);
    expect(analysis.totals.cacheRead).toBe(1200);
    expect(analysis.totals.cacheWrite).toBe(800);
    expect(analysis.totals.cost).toBe(1.23);
    expect(analysis.totals.costUnit).toBe("usd");
  });

  it("labels Copilot CLI reported cost as AI credits and keeps token USD estimate separate", function () {
    var analysis = buildCostAnalysis([
      event(0, { outputTokens: 100 }, "claude-opus-4.6", 0),
    ], {
      format: "copilot-cli",
      primaryModel: "claude-opus-4.6",
      totalCost: 17.12,
      totalCostUnit: "ai_credits",
      aiCredits: 17.12,
      tokenUsage: { inputTokens: 48382, outputTokens: 287, cacheRead: 24064, cacheWrite: 24314 },
      modelTokenUsage: {
        "claude-opus-4.6": { inputTokens: 48382, outputTokens: 287, cacheRead: 24064, cacheWrite: 24314 },
      },
    });

    expect(analysis.calls).toHaveLength(1);
    expect(analysis.calls[0].isMetadataSummary).toBe(true);
    expect(analysis.calls[0].cost).toBe(17.12);
    expect(analysis.calls[0].costUnit).toBe("ai_credits");
    expect(analysis.calls[0].estimatedUsdCost).toBeGreaterThan(0);
    expect(analysis.totals.cost).toBe(17.12);
    expect(analysis.totals.costUnit).toBe("ai_credits");
    expect(analysis.totals.estimatedUsdCost).toBeGreaterThan(0);
    expect(analysis.totals.aiCredits).toBe(17.12);
  });

  it("uses metadata-only token totals when no token events exist", function () {
    var analysis = buildCostAnalysis([{ text: "no usage" }], {
      primaryModel: "gpt-5.4",
      tokenUsage: { inputTokens: 12000, outputTokens: 3400, cacheRead: 9000, cacheWrite: 0 },
    });

    expect(analysis.hasCostData).toBe(true);
    expect(analysis.calls[0].title).toBe("Session token totals");
    expect(analysis.totals.inputTokens).toBe(12000);
    expect(analysis.totals.outputTokens).toBe(3400);
    expect(analysis.totals.cacheRead).toBe(9000);
    expect(analysis.totals.cacheWrite).toBe(0);
  });

  it("falls back to session totals when modelTokenUsage is incomplete", function () {
    var analysis = buildCostAnalysis([], {
      primaryModel: "gpt-5.4",
      tokenUsage: { inputTokens: 12000, outputTokens: 3400, cacheRead: 9000, cacheWrite: 0 },
      modelTokenUsage: {
        "gpt-5.4": { inputTokens: 1000, outputTokens: 400, cacheRead: 0, cacheWrite: 0 },
      },
    });

    expect(analysis.calls).toHaveLength(1);
    expect(analysis.totals.inputTokens).toBe(12000);
    expect(analysis.totals.outputTokens).toBe(3400);
    expect(analysis.totals.cacheRead).toBe(9000);
  });
});

describe("formatTokens", function () {
  it("formats compact token counts", function () {
    expect(formatTokens(412000)).toBe("412k");
    expect(formatTokens(1250)).toBe("1.3k");
    expect(formatTokens(12)).toBe("12");
  });
});
