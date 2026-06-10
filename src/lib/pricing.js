/**
 * Model pricing table, USD cost estimation, and GitHub AI Credits helpers.
 *
 * Prices are per million tokens (USD). Rates track the official GitHub Copilot
 * reference:
 * https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing
 * (rates can change there; update this table when they do).
 *
 * Each row may carry explicit `cachedInput` and (Anthropic) `cacheWrite` rates.
 * When a row omits `cachedInput` we fall back to ~10% of input. Only Anthropic
 * rows have a separate cache-write bucket; for other providers cache-write
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
  // Generic GPT-5.x / GPT-5 fallback for unlisted variants (keep last in group).
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

// Fallback for unrecognized Claude model variants (new releases, etc.)
var DEFAULT_CLAUDE_PRICE = { input: 3.00, cachedInput: 0.30, cacheWrite: 3.75, output: 15.00 };

function normalizeModelName(modelName) {
  return String(modelName).toLowerCase().replace(/[^a-z0-9.]+/g, "-");
}

function lookupPrice(modelName) {
  if (!modelName) return null;
  var lower = normalizeModelName(modelName);
  for (var i = 0; i < PRICE_TABLE.length; i++) {
    if (lower.includes(PRICE_TABLE[i].match)) return PRICE_TABLE[i];
  }
  // Apply Claude default only to Claude variants we haven't explicitly listed.
  // For Gemini or other unknown models we return null -- cost unknown.
  if (lower.includes("claude")) return DEFAULT_CLAUDE_PRICE;
  return null;
}

// Resolve the effective rates for a price row, applying the long-context tier
// when the request's input token count exceeds the row threshold.
function resolveRates(price, inputTokens) {
  if (price.longContext && (inputTokens || 0) > price.longContext.threshold) {
    return price.longContext;
  }
  return price;
}

function cachedInputRate(rates) {
  return rates.cachedInput != null ? rates.cachedInput : rates.input * 0.1;
}

function cacheWriteRate(rates) {
  // Only Anthropic rows define a dedicated cache-write bucket. For other
  // providers there is no cache-write surcharge, so bill those tokens at the
  // standard input rate rather than inventing a multiplier.
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
export function estimateCost(tokenUsage, modelName) {
  if (!tokenUsage) return 0;
  var price = lookupPrice(modelName);
  if (!price) return 0; // unknown model -- don't fabricate a number
  var rates = resolveRates(price, tokenUsage.inputTokens || 0);
  var freshInputTokens = Math.max((tokenUsage.inputTokens || 0) - (tokenUsage.cacheRead || 0) - (tokenUsage.cacheWrite || 0), 0);
  var inputCost  = freshInputTokens / 1e6 * rates.input;
  var outputCost = (tokenUsage.outputTokens || 0) / 1e6 * rates.output;
  var cacheReadCost  = (tokenUsage.cacheRead  || 0) / 1e6 * cachedInputRate(rates);
  var cacheWriteCost = (tokenUsage.cacheWrite || 0) / 1e6 * cacheWriteRate(rates);
  return inputCost + outputCost + cacheReadCost + cacheWriteCost;
}

/**
 * Estimate cost across multiple models by pricing each model's tokens at its own rate.
 * modelTokenMap: { [modelName]: { inputTokens, outputTokens, cacheRead, cacheWrite } }
 * Returns 0 if no models have recognized pricing.
 */
export function estimateMultiModelCost(modelTokenMap) {
  if (!modelTokenMap) return 0;
  var total = 0;
  var keys = Object.keys(modelTokenMap);
  for (var i = 0; i < keys.length; i++) {
    total += estimateCost(modelTokenMap[keys[i]], keys[i]);
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
  return estimated ? "Est. Cost" : "Cost";
}
