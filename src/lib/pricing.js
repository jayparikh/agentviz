/**
 * Claude model pricing table and cost estimation.
 *
 * Prices are per million tokens (USD).
 * Cache read is ~10% of input price; cache write is ~125% of input price.
 */

var PRICE_TABLE = [
  // Claude 4 family
  { match: "claude-opus-4",    input: 15.00, output: 75.00 },
  { match: "claude-sonnet-4",  input:  3.00, output: 15.00 },
  { match: "claude-haiku-4",   input:  0.80, output:  4.00 },
  // Claude 3.5 family
  { match: "claude-3-5-sonnet", input:  3.00, output: 15.00 },
  { match: "claude-3-5-haiku",  input:  0.80, output:  4.00 },
  // Claude 3 family
  { match: "claude-3-opus",     input: 15.00, output: 75.00 },
  { match: "claude-3-sonnet",   input:  3.00, output: 15.00 },
  { match: "claude-3-haiku",    input:  0.25, output:  1.25 },
];

var DEFAULT_PRICE = { input: 3.00, output: 15.00 };

function lookupPrice(modelName) {
  if (!modelName) return DEFAULT_PRICE;
  var lower = modelName.toLowerCase();
  for (var i = 0; i < PRICE_TABLE.length; i++) {
    if (lower.includes(PRICE_TABLE[i].match)) return PRICE_TABLE[i];
  }
  return DEFAULT_PRICE;
}

/**
 * Estimate cost in USD for a tokenUsage object.
 * tokenUsage: { inputTokens, outputTokens, cacheRead, cacheWrite }
 * modelName: string (optional, used to look up pricing)
 */
export function estimateCost(tokenUsage, modelName) {
  if (!tokenUsage) return 0;
  var price = lookupPrice(modelName);
  var inputCost  = (tokenUsage.inputTokens  || 0) / 1e6 * price.input;
  var outputCost = (tokenUsage.outputTokens || 0) / 1e6 * price.output;
  var cacheReadCost  = (tokenUsage.cacheRead  || 0) / 1e6 * price.input * 0.1;
  var cacheWriteCost = (tokenUsage.cacheWrite || 0) / 1e6 * price.input * 1.25;
  return inputCost + outputCost + cacheReadCost + cacheWriteCost;
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
