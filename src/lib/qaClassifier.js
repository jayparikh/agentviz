import { getTopTools } from "./autonomyMetrics.js";

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
import { getSessionCost } from "./autonomyMetrics.js";
import { formatCost } from "./pricing.js";

// ── Keyword patterns ────────────────────────────────────────────────────────

var PATTERNS = [
  { id: "tools",     re: /\b(tools?\s+used|tool\s+calls?|which\s+tools?|what\s+tools?\s+(were|was|did)|most.?used\s+tool|top\s+tools?|tool\s+count|how\s+many\s+tools?|list\s+(all\s+)?tools|tool\s+(ranking|breakdown|stats?)|tool\s+breakdown)\b/i },
  { id: "errors",    re: /\b(how\s+many\s+errors?|any\s+errors?|what\s+errors?|errors?\s+(occurred|found|count)|show\s+errors?|list\s+errors?|did\s+(anything|it|the)\s+fail|were\s+there\s+(errors?|failures?)|what\s+(went\s+wrong|failed))\b/i },
  { id: "model",     re: /\b(what\s+model|which\s+model|model\s+(used|was|name)|what\s+llm|which\s+llm)\b/i },
  { id: "duration",  re: /\b(how\s+long\s+(did|was|does)|session\s+duration|total\s+(time|duration)|how\s+long\s+.*\s+(take|last|run)|how\s+much\s+time)\b/i },
  { id: "cost",      re: /\b(how\s+much\s+(did\s+(it|this)|does\s+it)\s+cost|total\s+cost|estimated?\s+cost|token\s+(usage|count|stats?)|how\s+many\s+tokens?|what\s+(did\s+this|was\s+the)\s+cost)\b/i },
  { id: "turnN",     re: /\bturn\s*#?\s*(\d+)\b/i },
  { id: "turns",     re: /\b(how\s+many\s+turns|turn\s+count|number\s+of\s+turns|total\s+turns)\b/i },
  { id: "autonomy",  re: /\b(autonom\w*\s*(score|efficiency|rating|metric)?|how\s+autonom|babysit\w*\s*time|idle\s+time|human.?wait|intervention\s+(count|rate))\b/i },
  { id: "summary",   re: /\b(summarize?\s+(this|the)\s+session|session\s+(summary|overview|recap)|give\s+me\s+(a\s+|an\s+)?(summary|overview|recap))\b/i },
  { id: "files",     re: /\b(what\s+files?\s+(were\s+)?(edited|changed|modified|touched|created|written)|files?\s+(edited|changed|modified)|which\s+files?|show\s+files?|list\s+files?|file\s+changes?)\b/i },
  { id: "longest",   re: /\b(longest\s+turn|slowest\s+turn|which\s+turn\s+(took|was)\s+(the\s+)?(longest|slowest|most\s+time)|most\s+time|biggest\s+turn)\b/i },
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
  if (matched === "files")    return answerFiles(data);
  if (matched === "longest")  return answerLongestTurn(data);

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

  var cost = getSessionCost(data.metadata);
  var lines = [];
  if (cost != null) {
    var label = data.metadata.totalCost != null ? "Cost" : "Estimated cost";
    lines.push(label + ": **" + formatCost(cost) + "**\n");
  } else {
    lines.push("Cost data not available for this session.\n");
  }
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

  var sessionCost = getSessionCost(meta);
  if (sessionCost != null) {
    var costLabel = meta.totalCost != null ? "Cost" : "Estimated cost";
    lines.push("- " + costLabel + ": " + formatCost(sessionCost));
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

  var lines = ["**[Turn " + idx + "]**\n"];
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

function answerFiles(data) {
  if (!data.events) return instant("No file edit data available.");

  var fileEdits = {};
  for (var i = 0; i < data.events.length; i++) {
    var e = data.events[i];
    if (e.track === "tool_call" && isFileEditTool(e.toolName)) {
      var fname = extractFileName(e.text, e.toolName);
      if (fname) {
        if (!fileEdits[fname]) fileEdits[fname] = { count: 0, tools: {} };
        fileEdits[fname].count++;
        fileEdits[fname].tools[e.toolName] = (fileEdits[fname].tools[e.toolName] || 0) + 1;
      }
    }
  }

  var files = Object.keys(fileEdits);
  if (files.length === 0) {
    return instant("No file edits detected in this session.");
  }

  // Sort by edit count descending
  files.sort(function (a, b) { return fileEdits[b].count - fileEdits[a].count; });

  var lines = ["**" + files.length + " file" + (files.length !== 1 ? "s" : "") + " edited:**\n"];
  var shown = Math.min(files.length, 15);
  for (var j = 0; j < shown; j++) {
    var f = files[j];
    var info = fileEdits[f];
    lines.push("- **" + f + "** (" + info.count + " edit" + (info.count !== 1 ? "s" : "") + ")");
  }
  if (files.length > shown) {
    lines.push("\n(" + (files.length - shown) + " more not shown)");
  }
  return instant(lines.join("\n"));
}

function answerLongestTurn(data) {
  if (!data.turns || data.turns.length === 0) {
    return instant("No turns found in this session.");
  }

  var longest = data.turns[0];
  for (var i = 1; i < data.turns.length; i++) {
    var dur = (data.turns[i].endTime || 0) - (data.turns[i].startTime || 0);
    var longestDur = (longest.endTime || 0) - (longest.startTime || 0);
    if (dur > longestDur) longest = data.turns[i];
  }

  var secs = (longest.endTime || 0) - (longest.startTime || 0);
  var lines = [
    "Longest turn: **[Turn " + longest.index + "]** (" + formatDurationLong(secs) + ")\n",
  ];
  if (longest.userMessage) {
    lines.push('User: "' + truncate(longest.userMessage, 150) + '"');
  }
  lines.push("- Tool calls: " + (longest.toolCount || 0));
  if (longest.hasError) lines.push("- Had errors");
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

var FILE_EDIT_TOOLS = ["edit", "create", "write", "file_edit", "str_replace_editor", "write_to_file", "insert_code_at_cursor"];

function isFileEditTool(toolName) {
  if (!toolName) return false;
  var lower = toolName.toLowerCase();
  for (var i = 0; i < FILE_EDIT_TOOLS.length; i++) {
    if (lower === FILE_EDIT_TOOLS[i] || lower.indexOf(FILE_EDIT_TOOLS[i]) !== -1) return true;
  }
  return false;
}

function extractFileName(text, toolName) {
  if (!text) return null;
  // Try common patterns: "path: /foo/bar.js", "/foo/bar.ext", "Edit: foo.ts"
  var pathMatch = text.match(/(?:path|file|editing|created?|writ\w+)[:\s]+([^\s,\n]+\.\w+)/i);
  if (pathMatch) return pathMatch[1];
  // Try any file-like path
  var fileMatch = text.match(/([^\s,()]+\/[^\s,()]+\.\w{1,10})\b/);
  if (fileMatch) return fileMatch[1];
  return null;
}

function formatDurationLong(seconds) {
  if (!seconds || seconds <= 0) return "0s";
  var mins = Math.floor(seconds / 60);
  var secs = Math.round(seconds % 60);
  if (mins > 0) return mins + "m " + secs + "s";
  return secs + "s";
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
  for (var i = turns.length - 1; i >= 0 && msgs.length < limit; i--) {
    if (turns[i].userMessage) msgs.push(turns[i].userMessage);
  }
  msgs.reverse();
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
