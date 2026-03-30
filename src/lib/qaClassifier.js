/**
 * Q&A Question Classifier
 *
 * Routes user questions to instant (client-side) answers or marks them
 * for model fallback.  Uses simple keyword/regex matching -- not NLP.
 *
 * classify(question, sessionData) -> { tier, answer?, context? }
 *
 * Session data shape expected:
 *   { events, turns, metadata, autonomyMetrics }
 */

import { formatDuration, formatDurationLong } from "./formatTime.js";
import { estimateCost, formatCost } from "./pricing.js";

// ── Keyword patterns ────────────────────────────────────────────────────────

var PATTERNS = [
  { id: "tools",     re: /\b(tool|tools|which tool|what tool|most.?used)\b/i },
  { id: "errors",    re: /\b(error|errors|fail|failure|failures|crash|bug|broke|wrong)\b/i },
  { id: "model",     re: /\b(model|models|which model|what model|llm)\b/i },
  { id: "duration",  re: /\b(how long|duration|how.+time.+take|took|elapsed|minutes?|seconds?)\b/i },
  { id: "cost",      re: /\b(cost|price|expensive|cheap|token|tokens|spend|spent|billing)\b/i },
  { id: "turnN",     re: /\bturn\s*#?\s*(\d+)\b/i },
  { id: "turns",     re: /\b(how many turns|turn count|number of turns|total turns)\b/i },
  { id: "autonomy",  re: /\b(autonom|efficiency|babysit|idle\b|intervention|human.?wait)/i },
  { id: "summary",   re: /\b(summar|overview|recap|what happened|describe|explain this)/i },
];

// ── Classifier ──────────────────────────────────────────────────────────────

/**
 * Classify a question and optionally produce an instant answer.
 *
 * @param {string} question
 * @param {{ events, turns, metadata, autonomyMetrics }} data
 * @returns {{ tier: "instant"|"model", answer?: string, context?: object }}
 */
export function classify(question, data) {
  if (!question || !question.trim()) return { tier: "model" };
  if (!data || !data.metadata) return { tier: "model" };

  var q = question.trim();
  var matched = matchPattern(q);

  if (matched === "turnN") {
    var turnMatch = q.match(/\bturn\s*#?\s*(\d+)\b/i);
    if (turnMatch) {
      var idx = parseInt(turnMatch[1], 10);
      return answerTurnDetail(idx, data);
    }
  }

  if (matched === "tools")    return answerTools(data);
  if (matched === "errors")   return answerErrors(data);
  if (matched === "model")    return answerModel(data);
  if (matched === "duration") return answerDuration(data);
  if (matched === "cost")     return answerCost(data);
  if (matched === "turns")    return answerTurnCount(data);
  if (matched === "autonomy") return answerAutonomy(data);
  if (matched === "summary")  return answerSummary(data);

  return { tier: "model", context: buildModelContext(q, data) };
}

/**
 * Build a lean context payload for the model fallback tier.
 */
export function buildModelContext(question, data) {
  var ctx = {
    metadata: summarizeMetadata(data.metadata),
    topTools: getTopTools(data.events, 20),
    userMessages: getUserMessages(data.turns, 5),
  };

  // Include error samples if question seems error-related
  if (/error|fail|crash|bug|wrong/i.test(question)) {
    ctx.errorSamples = getErrorSamples(data.events, 5);
  }

  // Include specific turn events if question references a turn
  var turnRef = question.match(/\bturn\s*#?\s*(\d+)\b/i);
  if (turnRef) {
    var turnIdx = parseInt(turnRef[1], 10);
    ctx.relevantTurns = getTurnEvents(turnIdx, data);
  }

  return ctx;
}

// ── Pattern matching ────────────────────────────────────────────────────────

function matchPattern(q) {
  // TurnN is checked first because "what happened in turn 5" could also match summary
  var turnNMatch = PATTERNS.find(function (p) { return p.id === "turnN"; });
  if (turnNMatch && turnNMatch.re.test(q)) return "turnN";

  for (var i = 0; i < PATTERNS.length; i++) {
    if (PATTERNS[i].id === "turnN") continue;
    if (PATTERNS[i].re.test(q)) return PATTERNS[i].id;
  }
  return null;
}

// ── Instant answer builders ─────────────────────────────────────────────────

function answerTools(data) {
  var tools = getTopTools(data.events, 10);
  if (tools.length === 0) {
    return instant("No tool calls found in this session.");
  }

  var total = data.metadata.totalToolCalls || 0;
  var lines = ["This session made **" + total + " tool call" + (total !== 1 ? "s" : "") + "** across " + tools.length + " tool" + (tools.length !== 1 ? "s" : "") + ":\n"];
  for (var i = 0; i < tools.length; i++) {
    lines.push("- **" + tools[i].name + "**: " + tools[i].count);
  }
  return instant(lines.join("\n"));
}

function answerErrors(data) {
  var count = data.metadata.errorCount || 0;
  if (count === 0) {
    return instant("No errors found in this session.");
  }

  var samples = getErrorSamples(data.events, 5);
  var lines = ["**" + count + " error" + (count !== 1 ? "s" : "") + "** found:\n"];
  for (var i = 0; i < samples.length; i++) {
    var s = samples[i];
    var turnLabel = s.turnIndex != null ? " [Turn " + s.turnIndex + "]" : "";
    lines.push("- " + truncate(s.text, 120) + turnLabel);
  }
  if (count > samples.length) {
    lines.push("\n(" + (count - samples.length) + " more not shown)");
  }
  return instant(lines.join("\n"));
}

function answerModel(data) {
  var meta = data.metadata;
  if (!meta.primaryModel && (!meta.models || Object.keys(meta.models).length === 0)) {
    return instant("No model information available for this session.");
  }

  var lines = ["Primary model: **" + (meta.primaryModel || "unknown") + "**"];
  if (meta.models && Object.keys(meta.models).length > 1) {
    lines.push("\nAll models used:");
    var models = meta.models;
    for (var name in models) {
      lines.push("- " + name + ": " + models[name] + " call" + (models[name] !== 1 ? "s" : ""));
    }
  }
  return instant(lines.join("\n"));
}

function answerDuration(data) {
  var secs = data.metadata.duration;
  if (!secs) return instant("Duration not available.");
  return instant("Session duration: **" + formatDurationLong(secs) + "** (" + formatDuration(secs) + ")");
}

function answerCost(data) {
  var usage = data.metadata.tokenUsage;
  var model = data.metadata.primaryModel;
  if (!usage || (!usage.inputTokens && !usage.outputTokens)) {
    return instant("No token usage data available for this session.");
  }

  var cost = estimateCost(usage, model);
  var lines = ["Estimated cost: **" + formatCost(cost) + "**\n"];
  if (usage.inputTokens) lines.push("- Input tokens: " + usage.inputTokens.toLocaleString());
  if (usage.outputTokens) lines.push("- Output tokens: " + usage.outputTokens.toLocaleString());
  if (usage.cacheRead) lines.push("- Cache read: " + usage.cacheRead.toLocaleString());
  if (model) lines.push("- Model: " + model);
  return instant(lines.join("\n"));
}

function answerTurnCount(data) {
  var count = data.metadata.totalTurns || 0;
  return instant("This session has **" + count + " turn" + (count !== 1 ? "s" : "") + "**.");
}

function answerAutonomy(data) {
  var m = data.autonomyMetrics;
  if (!m) return instant("Autonomy metrics not available.");

  var eff = m.autonomyEfficiency != null ? (m.autonomyEfficiency * 100).toFixed(0) + "%" : "N/A";
  var lines = [
    "Autonomy efficiency: **" + eff + "**\n",
    "- Productive runtime: " + formatDurationLong(m.productiveRuntime),
    "- Human wait time: " + formatDurationLong(m.babysittingTime),
    "- Idle time: " + formatDurationLong(m.idleTime),
    "- Interventions: " + (m.interventionCount || 0),
  ];
  return instant(lines.join("\n"));
}

function answerSummary(data) {
  var meta = data.metadata;
  var m = data.autonomyMetrics || {};
  var tools = getTopTools(data.events, 5);

  var lines = [
    "**Session summary**\n",
    "- Format: " + (meta.format || "unknown"),
    "- Duration: " + formatDurationLong(meta.duration),
    "- Turns: " + (meta.totalTurns || 0),
    "- Tool calls: " + (meta.totalToolCalls || 0),
    "- Errors: " + (meta.errorCount || 0),
    "- Model: " + (meta.primaryModel || "unknown"),
  ];

  if (m.autonomyEfficiency != null) {
    lines.push("- Autonomy: " + (m.autonomyEfficiency * 100).toFixed(0) + "%");
  }

  var usage = meta.tokenUsage;
  if (usage && (usage.inputTokens || usage.outputTokens)) {
    var cost = estimateCost(usage, meta.primaryModel);
    lines.push("- Estimated cost: " + formatCost(cost));
  }

  if (tools.length > 0) {
    lines.push("\nTop tools: " + tools.map(function (t) { return t.name + " (" + t.count + ")"; }).join(", "));
  }

  return instant(lines.join("\n"));
}

function answerTurnDetail(idx, data) {
  if (!data.turns || idx < 0 || idx >= data.turns.length) {
    return instant("Turn " + idx + " not found. This session has " + (data.turns ? data.turns.length : 0) + " turns (0-indexed).");
  }

  var turn = data.turns[idx];
  var events = getTurnEvents(idx, data);
  var toolCalls = events.filter(function (e) { return e.track === "tool_call"; });
  var errors = events.filter(function (e) { return e.isError; });

  var lines = ["**Turn " + idx + "**\n"];
  if (turn.userMessage) {
    lines.push('User: "' + truncate(turn.userMessage, 200) + '"');
  }
  lines.push("- Events: " + events.length);
  lines.push("- Tool calls: " + toolCalls.length);
  if (toolCalls.length > 0) {
    var toolNames = {};
    toolCalls.forEach(function (e) {
      var n = e.toolName || "unknown";
      toolNames[n] = (toolNames[n] || 0) + 1;
    });
    var toolList = Object.keys(toolNames).map(function (n) { return n + " (" + toolNames[n] + ")"; }).join(", ");
    lines.push("  Tools: " + toolList);
  }
  if (errors.length > 0) {
    lines.push("- Errors: " + errors.length);
    errors.slice(0, 3).forEach(function (e) {
      lines.push("  - " + truncate(e.text, 100));
    });
  }

  return instant(lines.join("\n"));
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function instant(answer) {
  return { tier: "instant", answer: answer };
}

function truncate(text, maxLen) {
  if (!text) return "";
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + "...";
}

function getTopTools(events, limit) {
  if (!events) return [];
  var counts = {};
  for (var i = 0; i < events.length; i++) {
    if (events[i].track === "tool_call" && events[i].toolName) {
      counts[events[i].toolName] = (counts[events[i].toolName] || 0) + 1;
    }
  }
  return Object.keys(counts)
    .map(function (name) { return { name: name, count: counts[name] }; })
    .sort(function (a, b) { return b.count - a.count; })
    .slice(0, limit);
}

function getErrorSamples(events, limit) {
  if (!events) return [];
  var errors = [];
  for (var i = 0; i < events.length && errors.length < limit; i++) {
    if (events[i].isError) {
      errors.push({ text: events[i].text, turnIndex: events[i].turnIndex, toolName: events[i].toolName });
    }
  }
  return errors;
}

function getUserMessages(turns, limit) {
  if (!turns) return [];
  var msgs = [];
  for (var i = 0; i < turns.length && msgs.length < limit; i++) {
    if (turns[i].userMessage) msgs.push(turns[i].userMessage);
  }
  return msgs;
}

function getTurnEvents(turnIdx, data) {
  if (!data.events) return [];
  return data.events.filter(function (e) { return e.turnIndex === turnIdx; });
}

function summarizeMetadata(meta) {
  return {
    format: meta.format || "unknown",
    duration: meta.duration,
    totalTurns: meta.totalTurns,
    totalToolCalls: meta.totalToolCalls,
    errorCount: meta.errorCount,
    primaryModel: meta.primaryModel,
  };
}
