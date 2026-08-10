import { describe, expect, it } from "vitest";
import { estimateCost, estimateMultiModelCost, formatCost, getSessionCostLabel, hasModelPricing } from "../lib/pricing.js";

describe("estimateCost", function () {
  it("returns 0 for null tokenUsage", function () {
    expect(estimateCost(null, "claude-sonnet-4")).toBe(0);
  });

  it("returns 0 for unknown model", function () {
    expect(estimateCost({ inputTokens: 1000 }, "gemini-pro")).toBe(0);
  });

  it("prices cached input at the discounted rate", function () {
    var cost = estimateCost({ inputTokens: 1000000, outputTokens: 0, cacheRead: 800000 }, "gpt-4.1");
    // Fresh: 200K * $2/M = $0.40; cached: 800K * $2/M * 10% = $0.16
    expect(cost).toBeCloseTo(0.56, 2);
  });

  it("prices the Anthropic cache write bucket separately from fresh input", function () {
    var cost = estimateCost({ inputTokens: 1000000, outputTokens: 0, cacheRead: 400000, cacheWrite: 100000 }, "claude-opus-4");
    // Fresh: 500K * $5/M = $2.50; cached: 400K * $0.50/M = $0.20; write: 100K * $6.25/M = $0.625
    expect(cost).toBeCloseTo(3.325, 3);
  });

  it("bills non-Anthropic cache write tokens at the standard input rate (no surcharge)", function () {
    var cost = estimateCost({ inputTokens: 1000000, outputTokens: 0, cacheRead: 400000, cacheWrite: 100000 }, "gpt-4.1");
    // Fresh: 500K * $2/M = $1.00; cached: 400K * $0.20/M = $0.08; write: 100K * $2/M = $0.20 (input rate)
    expect(cost).toBeCloseTo(1.28, 2);
  });

  it("prices Claude Haiku 4 correctly", function () {
    var cost = estimateCost({ inputTokens: 1000000, outputTokens: 100000 }, "claude-haiku-4.5");
    // 1M * $1.00/M + 100K * $5.00/M = $1.00 + $0.50 = $1.50
    expect(cost).toBeCloseTo(1.50, 2);
  });

  it("prices Claude Sonnet 4 correctly", function () {
    var cost = estimateCost({ inputTokens: 1000000, outputTokens: 100000 }, "claude-sonnet-4");
    // 1M * $3.00/M + 100K * $15.00/M = $3.00 + $1.50 = $4.50
    expect(cost).toBeCloseTo(4.50, 2);
  });

  it("prices spaced Claude model labels", function () {
    var cost = estimateCost({ inputTokens: 1000000, outputTokens: 100000 }, "Claude Opus 4.6");
    // 1M * $5.00/M + 100K * $25.00/M = $5.00 + $2.50 = $7.50
    expect(cost).toBeCloseTo(7.50, 2);
  });

  it("prices GPT 5.x Copilot aliases", function () {
    var cost = estimateCost({ inputTokens: 200000, outputTokens: 100000 }, "gpt-5.4");
    // Default tier (<= 272K input): 200K * $2.50/M + 100K * $15.00/M = $0.50 + $1.50 = $2.00
    expect(cost).toBeCloseTo(2.00, 2);
  });

  it("applies the long-context tier above the input threshold", function () {
    // GPT-5.4 long context (> 272K input) is $5.00 input / $22.50 output.
    var cost = estimateCost({ inputTokens: 300000, outputTokens: 10000 }, "gpt-5.4");
    // 300K * $5/M + 10K * $22.50/M = $1.50 + $0.225 = $1.725
    expect(cost).toBeCloseTo(1.725, 3);
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
    // Haiku: 500K * $1.00/M + 50K * $5.00/M = $0.50 + $0.25 = $0.75
    // Sonnet: 500K * $3.00/M + 50K * $15.00/M = $1.50 + $0.75 = $2.25
    // Total = $3.00
    expect(cost).toBeCloseTo(3.00, 2);
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
      "gemini-pro":       { inputTokens: 500000, outputTokens: 50000 },
    });
    // Only Sonnet is priced; Gemini contributes 0
    expect(cost).toBeCloseTo(4.50, 2);
  });
});

describe("formatCost", function () {
  it("formats zero", function () {
    expect(formatCost(0)).toBe("$0.00");
  });

  describe("getSessionCostLabel", function () {
    it("uses sentence case for estimated cost", function () {
      expect(getSessionCostLabel({}, true)).toBe("Est. cost");
      expect(getSessionCostLabel({ totalCost: 1, totalCostUnit: "usd" }, false)).toBe("Cost");
    });
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

describe("AI Credits", function () {
  it("converts nano-AIU to credits and USD", async function () {
    var pricing = await import("../lib/pricing.js");
    expect(pricing.nanoAiuToCredits(17118950000)).toBeCloseTo(17.11895, 5);
    expect(pricing.nanoAiuToCredits(null)).toBeNull();
    expect(pricing.creditsToUsd(17.11895)).toBeCloseTo(0.171, 3);
  });

  it("formats credits with their USD equivalent", async function () {
    var pricing = await import("../lib/pricing.js");
    expect(pricing.formatCredits(1)).toBe("1 credit");
    expect(pricing.formatCredits(17.119)).toBe("17.12 credits");
    expect(pricing.formatCreditsWithUsd(17.119)).toBe("17.12 credits (~$0.171)");
    expect(pricing.isAiCreditsUnit("ai_credits")).toBe(true);
    expect(pricing.isAiCreditsUnit("usd")).toBe(false);
  });

  it("guards against non-finite credit values so the UI never shows NaN", async function () {
    var pricing = await import("../lib/pricing.js");
    expect(pricing.nanoAiuToCredits(NaN)).toBeNull();
    expect(pricing.nanoAiuToCredits(Infinity)).toBeNull();
    expect(pricing.creditsToUsd(NaN)).toBe(0);
    expect(pricing.formatCredits(NaN)).toBe("--");
    expect(pricing.formatCreditsWithUsd(NaN)).toBe("--");
  });
});

describe("formatCostValue", function () {
  it("formats AI credits with a USD equivalent and USD values plainly", async function () {
    var pricing = await import("../lib/pricing.js");
    expect(pricing.formatCostValue(17.119, "ai_credits")).toBe("17.12 credits (~$0.171)");
    expect(pricing.formatCostValue(0.5, "usd")).toBe("$0.500");
  });
});

describe("hasModelPricing", function () {
  it("returns true for known Claude models", function () {
    expect(hasModelPricing("claude-sonnet-4-20250514")).toBe(true);
    expect(hasModelPricing("Claude Opus 4.6")).toBe(true);
    expect(hasModelPricing("claude-3-5-haiku-20241022")).toBe(true);
    expect(hasModelPricing("claude-opus-4")).toBe(true);
  });

  it("returns true for unknown Claude variants (fallback pricing)", function () {
    expect(hasModelPricing("claude-next-gen-99")).toBe(true);
  });

  it("returns true for known OpenAI/Copilot models", function () {
    expect(hasModelPricing("gpt-5.5")).toBe(true);
    expect(hasModelPricing("gpt-5.4")).toBe(true);
    expect(hasModelPricing("gpt-5.3-codex")).toBe(true);
    expect(hasModelPricing("gpt-5-mini")).toBe(true);
    expect(hasModelPricing("gpt-4o")).toBe(true);
    expect(hasModelPricing("gpt-4.1")).toBe(true);
    expect(hasModelPricing("o4-mini")).toBe(true);
  });

  it("returns false for unknown non-Claude models", function () {
    expect(hasModelPricing("gemini-pro")).toBe(false);
  });

  it("returns false for null/undefined", function () {
    expect(hasModelPricing(null)).toBe(false);
    expect(hasModelPricing(undefined)).toBe(false);
  });
});
