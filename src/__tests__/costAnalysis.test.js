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
  it("prices requests separately even when their sum crosses the context threshold", function () {
    var calls = [0, 1].map(i => event(i, { inputTokens: 200000, outputTokens: 10000, cacheRead: 60000, cacheWrite: 20000 }, "gpt-5.6-sol", 200000));
    var analysis = buildCostAnalysis(calls, { primaryModel: "gpt-5.6-sol", tokenUsage: { inputTokens: 400000, outputTokens: 20000, cacheRead: 120000, cacheWrite: 40000 } });
    expect(analysis.totals.cost).toBeCloseTo(1.608, 8);
    expect(analysis.totals.peakContext).toBe(200000);
    expect(buildCostAnalysis([event(0, analysis.totals, "gpt-5.6-sol", 400000)], {}).totals.cost).toBeCloseTo(3.016, 8);
  });

  it("does not price metadata-only aggregates as a long request or show a fake peak context", function () {
    var analysis = buildCostAnalysis([], { primaryModel: "gpt-5.6-sol", tokenUsage: { inputTokens: 400000, outputTokens: 20000, cacheWrite: 0 } });
    expect(analysis.totals.cost).toBeNull();
    expect(analysis.totals.estimatedUsdCost).toBeNull();
    expect(analysis.totals.peakContext).toBeNull();
    expect(analysis.pricingNotes.join(" ")).toContain("Per-request usage required");
  });

  it("does not publish partial estimates as mixed-model totals", function () {
    var analysis = buildCostAnalysis([
      event(0, { inputTokens: 100000 }, "gpt-5.6-sol", 100000),
      event(1, { inputTokens: 100000 }, "gpt-6-unknown", 100000),
    ], {});
    expect(analysis.calls[0].cost).toBeCloseTo(0.4, 8);
    expect(analysis.calls[1].cost).toBeNull();
    expect(analysis.calls[1].cumulativeCost).toBeNull();
    expect(analysis.totals.cost).toBeNull();
  });

  it("keeps reported session charges authoritative even with complete request usage", function () {
    var calls = [event(0, { inputTokens: 100000, cacheRead: 60000, cacheWrite: 20000, outputTokens: 10000 }, "gpt-5.6-sol", 100000)];
    for (var unit of ["usd", "ai_credits"]) {
      var analysis = buildCostAnalysis(calls, { totalCost: 3, totalCostUnit: unit });
      expect(analysis.totals.cost).toBe(3);
      expect(analysis.totals.costUnit).toBe(unit);
      expect(analysis.totals.estimatedUsdCost).toBeCloseTo(0.404, 8);
      expect(analysis.calls[0].cost).toBeCloseTo(0.404, 8);
      expect(analysis.calls[0].costUnit).toBe("usd");
      expect(analysis.calls[0].isReportedCost).toBe(false);
    }
  });

  it("preserves per-model reported credits instead of prorating a session bill by estimated prices", function () {
    var analysis = buildCostAnalysis([], {
      primaryModel: "gpt-5.6-sol", totalCost: 20, totalCostUnit: "ai_credits",
      tokenUsage: { inputTokens: 200000, outputTokens: 20000 },
      modelTokenUsage: {
        "gpt-5.6-sol": { inputTokens: 100000, outputTokens: 10000, aiCredits: 2 },
        "gpt-6-astra": { inputTokens: 100000, outputTokens: 10000, aiCredits: 7 },
      },
    });
    expect(analysis.calls.map(call => call.cost)).toEqual([2, 7]);
    expect(analysis.calls[1].cumulativeCost).toBe(9);
    expect(analysis.totals.cost).toBe(20);
    expect(analysis.pricingNotes.join(" ")).toContain("both are preserved");
  });

  it("does not allocate reported costs to unreported model charges", function () {
    var analysis = buildCostAnalysis([], {
      totalCost: 10, totalCostUnit: "usd",
      modelTokenUsage: { "gpt-5.6-sol": { inputTokens: 10000 }, "gpt-6-astra": { inputTokens: 10000 } },
    });

    expect(analysis.calls.map(call => call.cost)).toEqual([null, null]);
    expect(analysis.totals.cost).toBe(10);
  });

  it("does not report floating-point addition as a model-charge discrepancy", function () {
    var analysis = buildCostAnalysis([], {
      totalCost: 0.3, totalCostUnit: "ai_credits",
      modelTokenUsage: {
        "gpt-5.6-sol": { aiCredits: 0.1 },
        "gpt-6-astra": { aiCredits: 0.2 },
      },
    });
    expect(analysis.totals.cost).toBe(0.3);
    expect(analysis.pricingNotes.join(" ")).not.toContain("do not sum");
  });

  it("uses Copilot's Luna threshold only for sourced Copilot sessions", function () {
    var call = event(0, { inputTokens: 220000, outputTokens: 10000, cacheWrite: 0 }, "gpt-5.6-luna", 220000);
    expect(buildCostAnalysis([call], { format: "copilot-cli" }).totals.cost).toBeCloseTo(0.106, 8);
    expect(buildCostAnalysis([call], { format: "codex" }).totals.cost).toBeNull();
    expect(buildCostAnalysis([{ ...call, pricingContext: { provider: "openai" } }], {}).totals.cost).toBeCloseTo(0.056, 8);
  });

  it("retains reported credits without token telemetry", function () {
    var analysis = buildCostAnalysis([], { totalCost: 3, totalCostUnit: "ai_credits", modelTokenUsage: { "gpt-6-astra": { aiCredits: 3 } } });
    expect(analysis.hasCostData).toBe(true);
    expect(analysis.totals.cost).toBe(3);
    expect(analysis.totals.estimatedUsdCost).toBeNull();
    expect(analysis.calls[0].cost).toBe(3);
  });

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
    expect(analysis.totals.peakContext).toBe(1500);
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
