/**
 * Model pricing table, USD cost estimation, and GitHub AI Credits helpers.
 *
 * Prices are per million tokens (USD). Rates track the official GitHub Copilot
 * reference:
 * https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing
 * (rates can change there; update this table when they do).
 *
 * Each row may carry explicit `cachedInput` and `cacheWrite` rates.
 * When a row omits `cachedInput` we fall back to ~10% of input. Anthropic and
 * newer OpenAI rows price writes explicitly. For remaining providers cache-write
 * tokens are billed at the standard input rate (no surcharge). Rows with a
 * `longContext` tier switch to the higher rates once input tokens exceed
 * `threshold`.
 *
 * GitHub bills usage in AI Credits, where 1 AI credit = 1 AIU = 1e9 nano-AIU =
 * $0.01 USD. Copilot CLI logs report consumption as `totalNanoAiu`.
 */

export var NANO_AIU_PER_CREDIT = 1e9;
export var USD_PER_CREDIT = 0.01;

var PRICE_TABLE = [
  // OpenAI -- order specific variants before generic prefixes.
  // Verified 2026-09-09 against OpenAI pricing and GitHub Copilot pricing.
  // Sol promotional rates apply at least through 2026-11-21.
  // https://developers.openai.com/api/docs/pricing
  ...[
    ["gpt-5.6-sol", 4, 20],
    ["gpt-5.6-terra", 2, 12],
    ["gpt-5.6-luna", 0.2, 1.2],
    ["gpt-6-astra", 10, 50],
  ].map(function ([match, input, output]) {
    return {
      match, input, output, cachedInput: input * 0.1, cacheWrite: input * 1.25,
      serviceTiers: true,
      longContext: { threshold: 272000, input: input * 2, cachedInput: input * 0.2, cacheWrite: input * 2.5, output: output * 1.5 },
    };
  }),
  { match: "gpt-5.4-nano",  input:  0.20, cachedInput: 0.020, output:  1.25 },
  { match: "gpt-5.4-mini",  input:  0.75, cachedInput: 0.075, output:  4.50 },
  { match: "gpt-5-mini",    input:  0.25, cachedInput: 0.025, output:  2.00 },
  { match: "gpt-5.3-codex", input:  1.75, cachedInput: 0.175, output: 14.00 },
  {
    match: "gpt-5.5", input: 5.00, cachedInput: 0.50, output: 30.00,
    longContext: { threshold: 272000, input: 10.00, cachedInput: 1.00, output: 45.00 },
  },
  {
    match: "gpt-5.4", input: 2.50, cachedInput: 0.25, output: 15.00,
    longContext: { threshold: 272000, input: 5.00, cachedInput: 0.50, output: 22.50 },
  },
  // GPT-5 itself, not a fallback for unknown GPT-5.x variants.
  { match: "gpt-5",         input:  1.25, cachedInput: 0.125, output: 10.00 },
  { match: "gpt-4.1",       input:  2.00, cachedInput: 0.200, output:  8.00 },
  { match: "gpt-4o-mini",   input:  0.15, cachedInput: 0.015, output:  0.60 },
  { match: "gpt-4o",        input:  2.50, cachedInput: 0.250, output: 10.00 },
  { match: "o4-mini",       input:  1.10, output:  4.40 },
  { match: "o3-mini",       input:  1.10, output:  4.40 },
  { match: "o3",            input: 10.00, output: 40.00 },

  // Anthropic -- explicit cache-write bucket.
  { match: "claude-haiku-4",   input:  1.00, cachedInput: 0.10, cacheWrite:  1.25, output:  5.00 },
  { match: "claude-opus-4",    input:  5.00, cachedInput: 0.50, cacheWrite:  6.25, output: 25.00 },
  { match: "claude-sonnet-4",  input:  3.00, cachedInput: 0.30, cacheWrite:  3.75, output: 15.00 },
  { match: "claude-fable-5",   input: 10.00, cachedInput: 1.00, cacheWrite: 12.50, output: 50.00 },
  { match: "claude-3-5-sonnet", input:  3.00, cachedInput: 0.30, cacheWrite:  3.75, output: 15.00 },
  { match: "claude-3-5-haiku",  input:  0.80, cachedInput: 0.08, cacheWrite:  1.00, output:  4.00 },
  { match: "claude-3-opus",     input: 15.00, cachedInput: 1.50, cacheWrite: 18.75, output: 75.00 },
  { match: "claude-3-sonnet",   input:  3.00, cachedInput: 0.30, cacheWrite:  3.75, output: 15.00 },
  { match: "claude-3-haiku",    input:  0.25, cachedInput: 0.03, cacheWrite:  0.31, output:  1.25 },

  // Google
  { match: "gemini-2.5-pro",   input: 1.25, cachedInput: 0.125, output: 10.00 },
  { match: "gemini-3-flash",   input: 0.50, cachedInput: 0.050, output:  3.00 },
  { match: "gemini-3.5-flash", input: 1.50, cachedInput: 0.150, output:  9.00 },
  {
    match: "gemini-3.1-pro", input: 2.00, cachedInput: 0.20, output: 12.00,
    longContext: { threshold: 200000, input: 4.00, cachedInput: 0.40, output: 18.00 },
  },

  // GitHub fine-tuned
  { match: "raptor-mini", input: 0.25, cachedInput: 0.025, output: 2.00 },

  // Microsoft
  { match: "mai-code-1-flash", input: 0.75, cachedInput: 0.075, output: 4.50 },
];

function normalizeModelName(modelName) {
  return String(modelName).trim().toLowerCase().replace(/[^a-z0-9.]+/g, "-");
}

function lookupPrice(modelName) {
  if (!modelName) return null;
  var lower = normalizeModelName(modelName);
  for (var i = 0; i < PRICE_TABLE.length; i++) {
    var row = PRICE_TABLE[i];
    // OpenAI variants must be known identifiers, optionally provider-prefixed,
    // dated, or explicitly suffixed Fast. Never price a new model as GPT-5.
    if (/^(gpt-|o[34])/.test(row.match)) {
      var pattern = new RegExp("^(?:openai-|azure-openai-)?" + row.match.replace(/\./g, "\\.") + "(?:-\\d{4}-\\d{2}-\\d{2})?" + (row.serviceTiers ? "(?:-fast)?" : "") + "$");
      if (pattern.test(lower)) return row;
    } else if (lower.includes(row.match)) return row;
  }
  return null;
}

function cachedInputRate(rates) {
  return rates.cachedInput != null ? rates.cachedInput : rates.input * 0.1;
}

function cacheWriteRate(rates) {
  // A write rate is the whole bucket price, not an additional surcharge.
  return rates.cacheWrite != null ? rates.cacheWrite : rates.input;
}

/** Returns true when we have pricing data for the given model name. */
export function hasModelPricing(modelName) {
  return lookupPrice(modelName) !== null;
}

/**
 * Estimate cost in USD for a tokenUsage object.
 * tokenUsage.inputTokens is normalized total input tokens, including cache reads
 * and cache writes. Cache write tokens are billed in their own bucket.
 * modelName: string (optional, used to look up pricing)
 */
export function estimateCostDetails(tokenUsage, modelName, context = {}) {
  var notes = [];
  if (!tokenUsage) return { cost: null, notes: ["Token usage unavailable."] };
  var price = lookupPrice(modelName);
  if (!price) return { cost: null, notes: ["Pricing unavailable for " + (modelName || "unknown model") + "."] };
  var threshold = price.longContext && price.longContext.threshold;
  if (threshold && tokenUsage.inputTokens == null) {
    return { cost: null, notes: ["Request input usage required to determine the context pricing tier."] };
  }
  var inputTokens = tokenUsage.inputTokens || 0;
  if (price.match === "gpt-5.6-luna") {
    if (context.provider === "copilot") threshold = 200000;
    else if (context.provider !== "openai" && inputTokens > 200000 && inputTokens <= 272000) {
      return { cost: null, notes: ["Luna long-context pricing needs a billing provider: Copilot uses >200k; OpenAI uses >272k."] };
    }
  }
  if (context.aggregate && threshold && inputTokens > threshold) {
    return { cost: null, notes: ["Per-request usage required for long-context pricing; session totals are not request lengths."] };
  }
  var rates = threshold && inputTokens > threshold ? price.longContext : price;
  var multiplier = 1;
  if (price.serviceTiers) {
    var tier = context.serviceTier || (/-fast$/.test(normalizeModelName(modelName)) ? "fast" : null);
    if (tier === "fast" || tier === "priority") multiplier = 2;
    else if (tier === "batch" || tier === "flex") multiplier = 0.5;
    else if (tier && tier !== "standard" && tier !== "default") {
      return { cost: null, notes: ["Pricing unavailable for service tier " + tier + "."] };
    }
    if (!tier) notes.push("Standard service tier assumed; actual billed charges may differ.");
    if (tokenUsage.cacheWrite == null || tokenUsage.cacheWriteReported === false) notes.push("Cache-write usage not reported; estimate excludes any unreported write premium.");
  }
  var freshInputTokens = Math.max((tokenUsage.inputTokens || 0) - (tokenUsage.cacheRead || 0) - (tokenUsage.cacheWrite || 0), 0);
  var inputCost  = freshInputTokens / 1e6 * rates.input;
  var outputCost = (tokenUsage.outputTokens || 0) / 1e6 * rates.output;
  var cacheReadCost  = (tokenUsage.cacheRead  || 0) / 1e6 * cachedInputRate(rates);
  var cacheWriteCost = (tokenUsage.cacheWrite || 0) / 1e6 * cacheWriteRate(rates);
  return { cost: (inputCost + outputCost + cacheReadCost + cacheWriteCost) * multiplier, notes };
}

/** Unknown prices return null, never a fabricated zero-dollar charge. */
export function estimateCost(tokenUsage, modelName, context) {
  return estimateCostDetails(tokenUsage, modelName, context).cost;
}

/**
 * Estimate cost across multiple models by pricing each model's tokens at its own rate.
 * modelTokenMap: { [modelName]: { inputTokens, outputTokens, cacheRead, cacheWrite } }
 * This map contains aggregates, not individual requests. Ambiguous tiers and
 * unrecognized models make the total unknown rather than silently undercounted.
 */
export function estimateMultiModelCost(modelTokenMap, context) {
  if (!modelTokenMap) return null;
  var total = 0;
  var keys = Object.keys(modelTokenMap);
  for (var i = 0; i < keys.length; i++) {
    var cost = estimateCost(modelTokenMap[keys[i]], keys[i], { ...context, aggregate: true });
    if (cost == null) return null;
    total += cost;
  }
  return total;
}

/**
 * Format a cost in USD for display.
 * < $0.01  -> "<$0.01"
 * < $1     -> "$0.XX"
 * >= $1    -> "$X.XX"
 */
export function formatCost(usd) {
  if (usd == null || !Number.isFinite(usd)) return "--";
  if (usd <= 0) return "$0.00";
  if (usd < 0.01) return "<$0.01";
  if (usd < 1) return "$" + usd.toFixed(3);
  return "$" + usd.toFixed(2);
}

// --- GitHub AI Credits -----------------------------------------------------

/** Convert nano-AIU (as reported by Copilot CLI logs) to AI credits. */
export function nanoAiuToCredits(nanoAiu) {
  if (nanoAiu == null || !Number.isFinite(nanoAiu)) return null;
  return nanoAiu / NANO_AIU_PER_CREDIT;
}

/** Convert AI credits to their USD equivalent (1 credit = $0.01). */
export function creditsToUsd(credits) {
  if (credits == null || !Number.isFinite(credits)) return 0;
  return credits * USD_PER_CREDIT;
}

export function isAiCreditsUnit(unit) {
  return unit === "ai_credits";
}

/** Format a credit amount, e.g. "17.12 credits" or "1 credit". */
export function formatCredits(value) {
  if (value == null || !Number.isFinite(value)) return "--";
  var rounded = Math.round(value * 100) / 100;
  var label = Math.abs(rounded) === 1 ? "credit" : "credits";
  return rounded.toLocaleString(undefined, { maximumFractionDigits: 2 }) + " " + label;
}

/** Format credits with their USD equivalent, e.g. "17.12 credits (~$0.17)". */
export function formatCreditsWithUsd(value) {
  if (value == null || !Number.isFinite(value)) return "--";
  return formatCredits(value) + " (~" + formatCost(creditsToUsd(value)) + ")";
}

export function formatCostValue(value, unit) {
  if (isAiCreditsUnit(unit)) return formatCreditsWithUsd(value);
  return formatCost(value);
}

export function formatSessionCost(metadata) {
  if (!metadata || metadata.totalCost == null) return null;
  return formatCostValue(metadata.totalCost, metadata.totalCostUnit);
}

export function getSessionCostLabel(metadata, estimated) {
  if (metadata && metadata.totalCost != null) {
    return isAiCreditsUnit(metadata.totalCostUnit) ? "AI Credits" : "Cost";
  }
  return estimated ? "Est. cost" : "Cost";
}
