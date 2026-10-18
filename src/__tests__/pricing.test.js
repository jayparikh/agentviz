import { describe, expect, it } from "vitest";
import { estimateCost, estimateCostDetails, estimateMultiModelCost, formatCost, getSessionCostLabel, hasModelPricing } from "../lib/pricing.js";
import { copilotRateCards } from "./fixtures/copilotRateCards.js";

describe("verified October 2026 Copilot rate cards", function () {
  it.each(copilotRateCards)("prices every bucket in %s independently", function (model, input, cached, write, output) {
    const context = { provider: "copilot" };
    expect(hasModelPricing(model)).toBe(true);
    expect(estimateCost({ inputTokens: 10000 }, model, context)).toBeCloseTo(input / 100, 10);
    expect(estimateCost({ inputTokens: 10000, cacheRead: 10000 }, model, context)).toBeCloseTo(cached / 100, 10);
    expect(estimateCost({ inputTokens: 10000, cacheWrite: 10000 }, model, context)).toBeCloseTo((write ?? input) / 100, 10);
    expect(estimateCost({ inputTokens: 0, outputTokens: 10000 }, model, context)).toBeCloseTo(output / 100, 10);
  });

  it.each([
    ["gpt-6-luna", 272000, 0.1, 0.01, 0.125, 0.5, 2, 1.5],
    ["gpt-6-sol", 272000, 2, 0.2, 2.5, 10, 2, 1.5],
    ["gpt-6.1-sol", 272000, 2, 0.1, 2.5, 10, 2, 1.5],
    ["claude-haiku-5.5", 100000, 0.1, 0.01, 0.125, 0.5, 5, 5],
    ["grok-4.5", 200000, 2, 0.5, 2, 6, 2, 2],
    ["grok-4.6", 200000, 2, 0.5, 2, 6, 2, 2],
    ["grok-4.7", 200000, 2, 0.5, 2, 6, 2, 2],
  ])("prices %s at threshold -1, threshold, and threshold +1", function (model, threshold, input, cached, write, output, inputScale, outputScale) {
    for (const extra of [-1, 0, 1]) {
      const usage = { inputTokens: threshold + extra, cacheRead: 60000, cacheWrite: 20000, outputTokens: 10000 };
      const expected = ((usage.inputTokens - 80000) * input + 60000 * cached + 20000 * write) * (extra > 0 ? inputScale : 1) / 1e6
        + 10000 * output * (extra > 0 ? outputScale : 1) / 1e6;
      expect(estimateCost(usage, model, { provider: "copilot" })).toBeCloseTo(expected, 10);
    }
    expect(estimateCost({ outputTokens: 100 }, model)).toBeNull();
    expect(estimateMultiModelCost({ [model]: { inputTokens: threshold + 1 } }, { provider: "copilot" })).toBeNull();
  });

  it.each(["grok-4.5", "grok-4.6", "grok-4.7"])("preserves %s provider-specific boundaries and cache prices", function (model) {
    for (const count of [199999, 200000, 200001]) {
      const usage = { inputTokens: count, cacheRead: 10000, outputTokens: 10000 };
      const xaiBase = ((count - 10000) * 2 + 10000 * (model === "grok-4.5" ? 0.3 : 0.5) + 10000 * 6) / 1e6;
      const copilotBase = ((count - 10000) * 2 + 10000 * 0.5 + 10000 * 6) / 1e6;
      expect(estimateCost(usage, model, { provider: "xai" })).toBeCloseTo(xaiBase * (count >= 200000 ? 2 : 1), 10);
      expect(estimateCost(usage, model, { provider: "copilot" })).toBeCloseTo(copilotBase * (count > 200000 ? 2 : 1), 10);
      if (count === 200000 || model === "grok-4.5") expect(estimateCost(usage, model)).toBeNull();
      else expect(estimateCost(usage, model)).toBeCloseTo(copilotBase * (count > 200000 ? 2 : 1), 10);
    }
    expect(estimateMultiModelCost({ [model]: { inputTokens: 200000 } }, { provider: "xai" })).toBeNull();
  });

  it.each(["gpt-6-luna", "gpt-6-sol", "gpt-6.1-sol"])("applies %s explicit service tiers and preserves response precedence", function (model) {
    const usage = { inputTokens: 300000, cacheRead: 60000, cacheWrite: 20000, outputTokens: 10000 };
    const standard = estimateCost(usage, model, { serviceTier: "standard" });
    for (const [serviceTier, scale] of [["fast", 2], ["priority", 2], ["batch", 0.5], ["flex", 0.5]]) {
      expect(estimateCost(usage, model, { serviceTier })).toBeCloseTo(standard * scale, 10);
    }
    expect(estimateCost(usage, model + "-fast", { serviceTier: "standard" })).toBeCloseTo(standard, 10);
  });

  it("supports Ultrafast only on the two published OpenAI cards", function () {
    for (const model of ["gpt-6-astra", "gpt-6.1-sol"]) {
      for (const inputTokens of [100000, 300000]) {
        const usage = { inputTokens, cacheRead: 60000, cacheWrite: 20000, outputTokens: 10000 };
        expect(estimateCost(usage, model, { serviceTier: "ultrafast" })).toBeCloseTo(estimateCost(usage, model) * 6, 10);
      }
    }
    expect(estimateCost({ inputTokens: 10000 }, "gpt-6-sol", { serviceTier: "ultrafast" })).toBeNull();
  });

  it.each([
    ["anthropic/claude-opus-5-5", "claude-opus-5.5"],
    ["anthropic.claude-opus-5-5", "claude-opus-5.5"],
    ["anthropic.claude-sonnet-5-5", "claude-sonnet-5.5"],
    ["anthropic.claude-haiku-5-5", "claude-haiku-5.5"],
    ["anthropic.claude-fable-5-1", "claude-fable-5.1"],
    ["claude-haiku-5-5-20261007", "claude-haiku-5.5"],
    ["claude-sonnet-5-5", "claude-sonnet-5.5"],
    ["claude-fable-5-1", "claude-fable-5.1"],
    ["google/gemini-4-argon", "gemini-4-argon"],
    ["xai/grok-4.7-latest", "grok-4.7"],
    ["openai/gpt-6.1-sol-2026-09-29", "gpt-6.1-sol"],
  ])("resolves the sourced alias %s", function (alias, model) {
    expect(estimateCost({ inputTokens: 10000 }, alias)).toBe(estimateCost({ inputTokens: 10000 }, model));
    expect(hasModelPricing(alias)).toBe(true);
  });

  it.each(["claude-opus-5.6", "claude-fable-5.2", "claude-sonnet-4.99", "anthropic.claude-sonnet-5-6", "anthropic.claude-sonnet-5-5-unknown", "anthropicXclaude-sonnet-5-5", "gemini-3.8-flash-tts", "gemini-4-argon-unknown", "grok-4.70", "gpt-6.2-sol", "mai-code-1.1-flash-unknown"])("does not borrow another model's rate for %s", function (model) {
    expect(hasModelPricing(model)).toBe(false);
    expect(estimateCost({ inputTokens: 10000 }, model)).toBeNull();
  });

  it("discloses Gemini promotion deadlines in the cost evidence", function () {
    expect(estimateCostDetails({ inputTokens: 10000 }, "gemini-4-argon").notes.join(" ")).toContain("November 30, 2026");
    expect(estimateCostDetails({ inputTokens: 10000 }, "gemini-3.8-flash").notes.join(" ")).toContain("December 31, 2026");
  });

  it.each(["gemini-3.7-flash", "gemini-3.8-flash", "gemini-4-argon"])("uses %s published service tiers, not OpenAI's multiplier", function (model) {
    const usage = { inputTokens: 100000, cacheRead: 60000, outputTokens: 10000 };
    const standard = estimateCost(usage, model);
    expect(estimateCost(usage, model, { serviceTier: "priority" })).toBeCloseTo(standard * 1.8, 10);
    expect(estimateCost(usage, model, { serviceTier: "batch" })).toBeCloseTo(standard * 0.5, 10);
    expect(estimateCost(usage, model, { serviceTier: "flex" })).toBeCloseTo(standard * 0.5, 10);
    expect(estimateCost(usage, model, { serviceTier: "fast" })).toBeNull();
  });

  it.each(["claude-opus-4.8", "claude-opus-5", "claude-opus-5.5"])("uses %s explicit Fast rates without inferring them from effort", function (model) {
    const usage = { inputTokens: 100000, cacheRead: 60000, cacheWrite: 20000, outputTokens: 10000 };
    const standard = estimateCost(usage, model);
    expect(estimateCost(usage, model + "-fast")).toBeCloseTo(standard * 2, 10);
    expect(estimateCost(usage, model, { serviceTier: "fast" })).toBeCloseTo(standard * 2, 10);
    expect(estimateCost(usage, model + "-fast", { serviceTier: "standard" })).toBe(standard);
    expect(estimateCost(usage, model, { reasoningEffort: "max" })).toBe(standard);
  });

  it("does not guess unsupported Grok service tiers or price old Opus as Opus 4.8", function () {
    expect(estimateCost({ inputTokens: 10000 }, "grok-4.7", { serviceTier: "batch" })).toBeNull();
    expect(estimateCost({ inputTokens: 100000 }, "claude-opus-4")).toBe(1.5);
    expect(estimateCost({ inputTokens: 100000 }, "claude-opus-4.1")).toBe(1.5);
    expect(estimateCost({ inputTokens: 100000 }, "claude-opus-4.8")).toBe(0.5);
  });
});

describe("estimateCost", function () {
  it("returns unknown for null tokenUsage", function () {
    expect(estimateCost(null, "claude-sonnet-4")).toBeNull();
  });

  it("returns unknown for unknown model", function () {
    expect(estimateCost({ inputTokens: 1000 }, "gemini-pro")).toBeNull();
  });

  it("prices cached input at the discounted rate", function () {
    var cost = estimateCost({ inputTokens: 1000000, outputTokens: 0, cacheRead: 800000 }, "gpt-4.1");
    // Fresh: 200K * $2/M = $0.40; cached: 800K * $2/M * 10% = $0.16
    expect(cost).toBeCloseTo(0.56, 2);
  });

  it("prices the Anthropic cache write bucket separately from fresh input", function () {
    var cost = estimateCost({ inputTokens: 1000000, outputTokens: 0, cacheRead: 400000, cacheWrite: 100000 }, "claude-opus-4.8");
    // Fresh: 500K * $5/M = $2.50; cached: 400K * $0.50/M = $0.20; write: 100K * $6.25/M = $0.625
    expect(cost).toBeCloseTo(3.325, 3);
  });

  it("keeps older OpenAI cache write tokens at the standard input rate", function () {
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
  it("returns unknown for null input", function () {
    expect(estimateMultiModelCost(null)).toBeNull();
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

  it("does not silently omit unknown models from totals", function () {
    var cost = estimateMultiModelCost({
      "claude-sonnet-4": { inputTokens: 1000000, outputTokens: 100000 },
      "gemini-pro":       { inputTokens: 500000, outputTokens: 50000 },
    });
    expect(cost).toBeNull();
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

  it("does not invent pricing for unknown Claude variants", function () {
    expect(hasModelPricing("claude-next-gen-99")).toBe(false);
  });

  describe("GPT-5.6 and GPT-6 Astra request pricing", function () {
    var example = { inputTokens: 100000, cacheRead: 60000, cacheWrite: 20000, outputTokens: 10000 };
    var models = [
      ["gpt-5.6-sol", 4, 20, 0.404],
      ["gpt-5.6-terra", 2, 12, 0.222],
      ["gpt-5.6-luna", 0.2, 1.2, 0.0222],
      ["gpt-6-astra", 10, 50, 1.01],
    ];

    it.each(models)("prices %s fresh, cached, written, and output tokens once", function (model, input, output, expected) {
      expect(estimateCost(example, model)).toBeCloseTo(expected, 8);
      expect(estimateCost(example, model.toUpperCase().replaceAll("-", " "))).toBeCloseTo(expected, 8);
      expect(estimateCost(example, "openai/" + model + "-2026-09-01")).toBeCloseTo(expected, 8);
    });

    it.each(models)("applies %s tiers at threshold +1, not at threshold", function (model, input, output) {
      for (var provider of ["openai", "copilot"]) {
        var threshold = model === "gpt-5.6-luna" && provider === "copilot" ? 200000 : 272000;
        for (var extra of [0, 1]) {
          var long = extra === 1;
          var usage = { inputTokens: threshold + extra, cacheRead: 60000, cacheWrite: 20000, outputTokens: 10000 };
          var expected = ((usage.inputTokens - 80000) * input + 60000 * input * 0.1 + 20000 * input * 1.25) * (long ? 2 : 1) / 1e6
            + 10000 * output * (long ? 1.5 : 1) / 1e6;
          expect(estimateCost(usage, model, { provider })).toBeCloseTo(expected, 8);
        }
      }
    });

    it.each(models)("applies %s explicit service tiers to every bucket", function (model, input, output, standard) {
      for (var [serviceTier, multiplier] of [["standard", 1], ["default", 1], ["fast", 2], ["priority", 2], ["batch", 0.5], ["flex", 0.5]]) {
        expect(estimateCost(example, model, { serviceTier })).toBeCloseTo(standard * multiplier, 8);
      }
      expect(estimateCost(example, model + "-fast")).toBeCloseTo(standard * 2, 8);
      expect(estimateCost(example, model, { serviceTier: "auto" })).toBeNull();
    });

    it("does not interpret reasoning effort as Fast or add reasoning output twice", function () {
      expect(estimateCost({ ...example, reasoningTokens: 5000 }, "gpt-5.6-sol", { reasoningEffort: "high" })).toBeCloseTo(0.404, 8);
      expect(estimateCostDetails(example, "gpt-5.6-sol").notes.join(" ")).toContain("Standard service tier assumed");
    });

    it("keeps provider-ambiguous Luna tiers unknown only where official thresholds disagree", function () {
      expect(estimateCost({ inputTokens: 200000 }, "gpt-5.6-luna")).toBeCloseTo(0.04, 8);
      expect(estimateCost({ inputTokens: 200001 }, "gpt-5.6-luna")).toBeNull();
      expect(estimateCost({ inputTokens: 272000 }, "gpt-5.6-luna")).toBeNull();
      expect(estimateCost({ inputTokens: 272001 }, "gpt-5.6-luna")).toBeCloseTo(0.1088004, 8);
    });

    it("does not apply request thresholds to accumulated model totals", function () {
      expect(estimateMultiModelCost({ "gpt-5.6-sol": { inputTokens: 400000 } })).toBeNull();
      expect(estimateMultiModelCost({ "gpt-5.6-sol": example, "gpt-6-astra": example })).toBeCloseTo(1.414, 8);
    });

    it("reports missing write evidence without inventing cache-write tokens", function () {
      var details = estimateCostDetails({ inputTokens: 100000, outputTokens: 10000, cacheRead: 60000 }, "gpt-5.6-sol");
      expect(details.cost).toBeCloseTo(0.384, 8);
      expect(details.notes.join(" ")).toContain("Cache-write usage not reported");
      expect(estimateCostDetails({ ...example, cacheWrite: 0 }, "gpt-5.6-sol").notes.join(" ")).not.toContain("Cache-write usage not reported");
    });

    it("does not assume short context for output-only telemetry", function () {
      expect(estimateCost({ outputTokens: 10000 }, "gpt-5.6-sol")).toBeNull();
      expect(estimateCostDetails({ outputTokens: 10000 }, "gpt-6-astra").notes.join(" ")).toContain("Request input usage required");
    });

    it.each(["gpt-5.6", "gpt-5.6-unknown", "gpt-5.6-sol-preview", "gpt-6", "gpt-6-astra-unknown", "gpt-5.7", "unknown-gpt-5"])("does not alias unknown %s to cheaper known pricing", function (model) {
      expect(hasModelPricing(model)).toBe(false);
      expect(estimateCost(example, model)).toBeNull();
      expect(formatCost(estimateCost(example, model))).toBe("--");
    });
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
