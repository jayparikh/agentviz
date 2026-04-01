import { describe, expect, it } from "vitest";
import { estimateCost, estimateMultiModelCost, formatCost } from "../lib/pricing.js";

describe("estimateCost", function () {
  it("returns 0 for null tokenUsage", function () {
    expect(estimateCost(null, "claude-sonnet-4")).toBe(0);
  });

  it("returns 0 for unknown model", function () {
    expect(estimateCost({ inputTokens: 1000 }, "gpt-4o")).toBe(0);
  });

  it("prices Claude Haiku 4 correctly", function () {
    var cost = estimateCost({ inputTokens: 1000000, outputTokens: 100000 }, "claude-haiku-4.5");
    // 1M * $0.80/M + 100K * $4.00/M = $0.80 + $0.40 = $1.20
    expect(cost).toBeCloseTo(1.20, 2);
  });

  it("prices Claude Sonnet 4 correctly", function () {
    var cost = estimateCost({ inputTokens: 1000000, outputTokens: 100000 }, "claude-sonnet-4");
    // 1M * $3.00/M + 100K * $15.00/M = $3.00 + $1.50 = $4.50
    expect(cost).toBeCloseTo(4.50, 2);
  });
});

describe("estimateMultiModelCost", function () {
  it("returns 0 for null input", function () {
    expect(estimateMultiModelCost(null)).toBe(0);
  });

  it("returns 0 for empty map", function () {
    expect(estimateMultiModelCost({})).toBe(0);
  });

  it("prices each model at its own rate", function () {
    var cost = estimateMultiModelCost({
      "claude-haiku-4.5": { inputTokens: 500000, outputTokens: 50000 },
      "claude-sonnet-4":  { inputTokens: 500000, outputTokens: 50000 },
    });
    // Haiku: 500K * $0.80/M + 50K * $4.00/M = $0.40 + $0.20 = $0.60
    // Sonnet: 500K * $3.00/M + 50K * $15.00/M = $1.50 + $0.75 = $2.25
    // Total = $2.85
    expect(cost).toBeCloseTo(2.85, 2);
  });

  it("is more accurate than single-model estimate for mixed sessions", function () {
    var tokens = {
      "claude-haiku-4.5": { inputTokens: 800000, outputTokens: 5000 },
      "claude-opus-4":    { inputTokens: 200000, outputTokens: 5000 },
    };
    var multiModel = estimateMultiModelCost(tokens);
    // Single-model estimate would use haiku for all 1M input tokens
    var singleModel = estimateCost(
      { inputTokens: 1000000, outputTokens: 10000 },
      "claude-haiku-4.5"
    );
    // Multi-model should be higher because opus tokens are priced at $15/M not $0.80/M
    expect(multiModel).toBeGreaterThan(singleModel);
  });

  it("skips unknown models without erroring", function () {
    var cost = estimateMultiModelCost({
      "claude-sonnet-4": { inputTokens: 1000000, outputTokens: 100000 },
      "gpt-4o":          { inputTokens: 500000, outputTokens: 50000 },
    });
    // Only Sonnet is priced; GPT contributes 0
    expect(cost).toBeCloseTo(4.50, 2);
  });
});

describe("formatCost", function () {
  it("formats zero", function () {
    expect(formatCost(0)).toBe("$0.00");
  });

  it("formats sub-penny", function () {
    expect(formatCost(0.005)).toBe("<$0.01");
  });

  it("formats sub-dollar with 3 decimals", function () {
    expect(formatCost(0.786)).toBe("$0.786");
  });

  it("formats dollar amounts with 2 decimals", function () {
    expect(formatCost(6.12)).toBe("$6.12");
  });
});
