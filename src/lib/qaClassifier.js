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
  { id: "tools",     re: /\b(tools?\s+used|tool\s+calls?|which\s+tools?|what\s+tools?\s+(were|was|did)|most.?used\s+tool|top\s+tools?|tool\s+count|how\s+many\s+tools?|list\s+(all\s+)?tools|tool\s+(ranking|breakdown|stats?))\b/i },
  { id: "errors",    re: /\b(how\s+many\s+errors?|any\s+errors?|what\s+errors?|errors?\s+(occurred|found|count)|show\s+errors?|list\s+errors?|did\s+(anything|it|the)\s+fail|were\s+there\s+(errors?|failures?))\b/i },
  { id: "model",     re: /\b(what\s+model|which\s+model|model\s+(used|was|name)|what\s+llm|which\s+llm)\b/i },
  { id: "duration",  re: /\b(how\s+long\s+(did|was|does)|session\s+duration|total\s+(time|duration)|how\s+long\s+.*\s+(take|last|run))\b/i },
  { id: "cost",      re: /\b(how\s+much\s+(did\s+(it|this)|does\s+it)\s+cost|total\s+cost|estimated?\s+cost|token\s+(usage|count|stats?)|how\s+many\s+tokens?)\b/i },
  { id: "turnN",     re: /\bturn\s*#?\s*(\d+)\b/i },
  { id: "turnRange", re: /\bturns?\s*#?\s*(\d+)\s*[-\u2013]\s*(\d+)\b/i },
  { id: "turns",     re: /\b(how\s+many\s+turns|turn\s+count|number\s+of\s+turns|total\s+turns)\b/i },
  { id: "autonomy",  re: /\b(autonom\w*\s*(score|efficiency|rating|metric)?|how\s+autonom|babysit\w*\s*time|idle\s+time|human.?wait|intervention\s+(count|rate))\b/i },
  { id: "summary",   re: /\b(summarize?\s+(this|the)\s+session|session\s+(summary|overview|recap))\b/i },
  { id: "files",     re: /\b(what\s+files?|which\s+files?|files?\s+(edited|read|created|modified|changed|touched|written|viewed)|list\s+(all\s+)?files?|how\s+many\s+files?)\b/i },
  { id: "commands",  re: /\b(what\s+(commands?|bash|shell)|which\s+commands?|commands?\s+(run|ran|executed)|list\s+(all\s+)?commands?|bash\s+(commands?|history)|shell\s+commands?|terminal\s+commands?)\b/i },
  { id: "firstTurn", re: /\b(first\s+turn|first\s+thing\s+(done|asked|said)|what\s+(started|began|happened\s+first)|opening\s+turn|initial\s+turn|turn\s+0)\b/i },
  { id: "lastTurn",  re: /\b(last\s+turn|final\s+turn|most\s+recent\s+turn|what\s+(ended|finished|happened\s+last)|closing\s+turn)\b/i },
  { id: "format",    re: /\b(what\s+format|which\s+format|session\s+format|what\s+type\s+of\s+session|is\s+this\s+(claude|copilot))\b/i },
  { id: "userMsgs",  re: /\b(what\s+did\s+the\s+user\s+(ask|say|type|write|request)|user\s+(messages?|prompts?|questions?)|list\s+(all\s+)?(user\s+)?(messages?|prompts?))\b/i },
  { id: "events",    re: /\b(how\s+many\s+events?|event\s+count|total\s+events?|number\s+of\s+events?)\b/i },
  { id: "toolDetail",re: /\b(how\s+many\s+times?\s+(was|did|were)\s+(\w+)\s+(used|called|invoked)|(\w+)\s+tool\s+(count|usage|calls?)|how\s+was\s+(\w+)\s+used)\b/i },
  { id: "fileDetail",re: /\b(what\s+changes?\s+(were\s+)?made\s+to|how\s+many\s+times?\s+was\s+.+\s+accessed|what\s+happened\s+to\s+.+\.\w{1,5})\b/i },
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

  if (matched === "turnRange") {
    var rangeMatch = q.match(/\bturns?\s*#?\s*(\d+)\s*[-\u2013]\s*(\d+)\b/i);
    if (rangeMatch) {
      return answerTurnRange(parseInt(rangeMatch[1], 10), parseInt(rangeMatch[2], 10), data);
    }
  }

  if (matched === "tools")     return answerTools(data);
  if (matched === "errors")    return answerErrors(data);
  if (matched === "model")     return answerModel(data);
  if (matched === "duration")  return answerDuration(data);
  if (matched === "cost")      return answerCost(data);
  if (matched === "turns")     return answerTurnCount(data);
  if (matched === "autonomy")  return answerAutonomy(data);
  if (matched === "summary")   return answerSummary(data);
  if (matched === "files")     return answerFiles(data);
  if (matched === "commands")  return answerCommands(data);
  if (matched === "firstTurn") return answerTurnDetail(0, data);
  if (matched === "lastTurn")  return answerTurnDetail(data.turns ? data.turns.length - 1 : 0, data);
  if (matched === "format")    return answerFormat(data);
  if (matched === "userMsgs")  return answerUserMessages(data);
  if (matched === "events")    return answerEventCount(data);
  if (matched === "toolDetail") return answerToolDetail(q, data);
  if (matched === "fileDetail") return answerFileDetail(q, data);

  return { tier: "model", context: buildModelContext(q, data) };
}

/**
 * Build a lean, question-tailored context payload for the model fallback tier.
 * Sends only the data relevant to the question topic to minimize tokens.
 */
export function buildModelContext(question, data) {
  var ctx = {
    metadata: summarizeMetadata(data.metadata),
  };

  var q = question.toLowerCase();
  var wantsErrors = /error|fail|crash|bug|wrong|broke|exception/i.test(q);
  var wantsFiles = /file|path|edit|read|write|modif|creat|chang|touch/i.test(q);
  var wantsCommands = /command|bash|shell|terminal|run|ran|exec|npm|git|pip/i.test(q);
  var wantsTools = /tool|call|usage|invoke/i.test(q);

  // Turn references: include full events for referenced turns
  var turnRef = q.match(/\bturn\s*#?\s*(\d+)\b/i);
  var turnRangeRef = q.match(/\bturns?\s*#?\s*(\d+)\s*[-\u2013]\s*(\d+)\b/i);
  if (turnRangeRef) {
    var lo = parseInt(turnRangeRef[1], 10);
    var hi = parseInt(turnRangeRef[2], 10);
    ctx.relevantTurns = [];
    for (var t = lo; t <= Math.min(hi, (data.turns || []).length - 1); t++) {
      ctx.relevantTurns = ctx.relevantTurns.concat(getTurnEvents(t, data));
    }
    // Cap turn events to avoid huge contexts
    if (ctx.relevantTurns.length > 50) {
      ctx.relevantTurns = ctx.relevantTurns.slice(0, 50);
      ctx.relevantTurnsTruncated = true;
    }
    ctx.turnMessages = getTurnMessages(data.turns, lo, hi);
  } else if (turnRef) {
    var turnIdx = parseInt(turnRef[1], 10);
    ctx.relevantTurns = getTurnEvents(turnIdx, data);
    ctx.turnMessages = getTurnMessages(data.turns, turnIdx, turnIdx);
  }

  if (wantsErrors) {
    ctx.errorSamples = getErrorSamples(data.events, 10);
  }
  if (wantsFiles) {
    ctx.fileOperations = getFileOperations(data.events, 15);
  }
  if (wantsCommands) {
    ctx.commandHistory = getCommandHistory(data.events, 15);
  }
  if (wantsTools || (!wantsErrors && !wantsFiles && !wantsCommands && !turnRef)) {
    ctx.topTools = getTopTools(data.events, 10);
  }

  // For domain-specific questions, search event text for key terms from the question
  // to provide focused context instead of generic top-tools
  if (!wantsErrors && !wantsFiles && !wantsCommands && !turnRef && !turnRangeRef) {
    var keyTerms = extractKeyTerms(q);
    if (keyTerms.length > 0 && data.events) {
      var matchingEvents = [];
      for (var ei = 0; ei < data.events.length && matchingEvents.length < 20; ei++) {
        var evText = ((data.events[ei].text || "") + " " + (data.events[ei].toolName || "")).toLowerCase();
        var matched = keyTerms.some(function (term) { return evText.indexOf(term) !== -1; });
        if (matched) {
          matchingEvents.push({
            turn: data.events[ei].turnIndex,
            tool: data.events[ei].toolName,
            text: truncate(data.events[ei].text, 200),
            isError: data.events[ei].isError,
          });
        }
      }
      if (matchingEvents.length > 0) {
        ctx.relevantEvents = matchingEvents;
      }
    }
  }

  // Always include a sample of user messages for conversation context
  ctx.userMessages = getUserMessages(data.turns, 8);

  return ctx;
}

/**
 * Build a fingerprint for answer caching. Questions with the same fingerprint
 * produce the same answer (e.g., "what tools were used?" and "which tools did
 * it call?" both fingerprint to "tools").
 */
export function fingerprintQuestion(question) {
  if (!question) return null;
  var q = question.trim().toLowerCase();
  var matched = matchPattern(q);
  if (matched) {
    // For turn-specific patterns, include the turn number(s) in the fingerprint
    if (matched === "turnN") {
      var turnMatch = q.match(/\bturn\s*#?\s*(\d+)\b/i);
      return turnMatch ? "turnN:" + turnMatch[1] : "turnN";
    }
    if (matched === "turnRange") {
      var rangeMatch = q.match(/\bturns?\s*#?\s*(\d+)\s*[-\u2013]\s*(\d+)\b/i);
      return rangeMatch ? "turnRange:" + rangeMatch[1] + "-" + rangeMatch[2] : "turnRange";
    }
    if (matched === "toolDetail") {
      var toolMatch = q.match(/\b(?:how\s+many\s+times?\s+(?:was|did|were)\s+)(\w+)/i);
      if (!toolMatch) toolMatch = q.match(/\b(\w+)\s+tool\s+(?:count|usage|calls?)/i);
      if (!toolMatch) toolMatch = q.match(/\bhow\s+was\s+(\w+)\s+used/i);
      return toolMatch ? "toolDetail:" + toolMatch[1] : "toolDetail";
    }
    if (matched === "fileDetail") {
      var fileMatch = q.match(/(?:to|of|for|was)\s+([^\s?]+\.\w{1,5})/i);
      return fileMatch ? "fileDetail:" + fileMatch[1].split(/[/\\]/).pop().toLowerCase() : "fileDetail";
    }
    return matched;
  }
  return null;
}

// ── Pattern matching ────────────────────────────────────────────────────────

function matchPattern(q) {
  // Check turnRange before turnN so "turns 5-10" doesn't match as turnN
  var turnRangeMatch = PATTERNS.find(function (p) { return p.id === "turnRange"; });
  if (turnRangeMatch && turnRangeMatch.re.test(q)) return "turnRange";

  var turnNMatch = PATTERNS.find(function (p) { return p.id === "turnN"; });
  if (turnNMatch && turnNMatch.re.test(q)) return "turnN";

  for (var i = 0; i < PATTERNS.length; i++) {
    if (PATTERNS[i].id === "turnN" || PATTERNS[i].id === "turnRange") continue;
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

function answerTurnRange(lo, hi, data) {
  if (!data.turns || lo < 0) return instant("Invalid turn range.");
  var actualHi = Math.min(hi, data.turns.length - 1);
  if (lo > actualHi) return instant("Turn range " + lo + "-" + hi + " is out of bounds. This session has " + data.turns.length + " turns (0-indexed).");

  var lines = ["**Turns " + lo + "-" + actualHi + "**\n"];
  for (var i = lo; i <= actualHi; i++) {
    var turn = data.turns[i];
    var events = getTurnEvents(i, data);
    var tools = events.filter(function (e) { return e.track === "tool_call"; });
    var errors = events.filter(function (e) { return e.isError; });
    var label = "[Turn " + i + "]";
    var msg = turn.userMessage ? ': "' + truncate(turn.userMessage, 80) + '"' : "";
    var detail = tools.length + " tool call" + (tools.length !== 1 ? "s" : "");
    if (errors.length) detail += ", " + errors.length + " error" + (errors.length !== 1 ? "s" : "");
    lines.push("- " + label + msg + " -- " + detail);
  }
  return instant(lines.join("\n"));
}

function answerFiles(data) {
  if (!data.events) return instant("No events available.");
  var fileMap = {};
  for (var i = 0; i < data.events.length; i++) {
    var e = data.events[i];
    if (e.track !== "tool_call" || !e.toolName) continue;
    var name = e.toolName.toLowerCase();
    var input = e.toolInput || "";
    var inputStr = typeof input === "string" ? input : JSON.stringify(input);
    // Extract file paths from common tool patterns
    var pathMatch = inputStr.match(/(?:file_path|path|file|filename)["\s:=]+["']?([^\s"',}\]]+)/i);
    if (pathMatch) {
      var fp = pathMatch[1];
      if (!fileMap[fp]) fileMap[fp] = [];
      if (fileMap[fp].indexOf(name) === -1) fileMap[fp].push(name);
    }
  }
  var files = Object.keys(fileMap);
  if (files.length === 0) return instant("No file operations detected in this session.");
  var lines = ["**" + files.length + " file" + (files.length !== 1 ? "s" : "") + "** touched:\n"];
  files.slice(0, 30).forEach(function (f) {
    lines.push("- `" + f + "` (" + fileMap[f].join(", ") + ")");
  });
  if (files.length > 30) lines.push("\n(" + (files.length - 30) + " more not shown)");
  return instant(lines.join("\n"));
}

function answerCommands(data) {
  if (!data.events) return instant("No events available.");
  var cmds = [];
  for (var i = 0; i < data.events.length; i++) {
    var e = data.events[i];
    if (e.track !== "tool_call") continue;
    var name = (e.toolName || "").toLowerCase();
    if (name !== "bash" && name !== "shell" && name !== "powershell" && name !== "terminal" && name !== "execute_command" && name !== "run_command") continue;
    var input = e.toolInput || "";
    var inputStr = typeof input === "string" ? input : JSON.stringify(input);
    var cmdMatch = inputStr.match(/(?:command|cmd|script)["\s:=]+["']?([^\n"']{1,200})/i);
    if (cmdMatch) {
      cmds.push({ cmd: cmdMatch[1].trim(), turn: e.turnIndex });
    } else if (typeof input === "string" && input.length < 200) {
      cmds.push({ cmd: input.trim(), turn: e.turnIndex });
    }
  }
  if (cmds.length === 0) return instant("No shell commands found in this session.");
  var lines = ["**" + cmds.length + " command" + (cmds.length !== 1 ? "s" : "") + "** executed:\n"];
  cmds.slice(0, 20).forEach(function (c) {
    var turnLabel = c.turn != null ? " [Turn " + c.turn + "]" : "";
    lines.push("- `" + truncate(c.cmd, 120) + "`" + turnLabel);
  });
  if (cmds.length > 20) lines.push("\n(" + (cmds.length - 20) + " more not shown)");
  return instant(lines.join("\n"));
}

function answerFormat(data) {
  var fmt = data.metadata.format || "unknown";
  return instant("Session format: **" + fmt + "**");
}

function answerUserMessages(data) {
  if (!data.turns) return instant("No turns available.");
  var msgs = [];
  for (var i = 0; i < data.turns.length; i++) {
    if (data.turns[i].userMessage) {
      msgs.push({ turn: i, msg: data.turns[i].userMessage });
    }
  }
  if (msgs.length === 0) return instant("No user messages found.");
  var lines = ["**" + msgs.length + " user message" + (msgs.length !== 1 ? "s" : "") + "**:\n"];
  msgs.slice(0, 15).forEach(function (m) {
    lines.push("- [Turn " + m.turn + '] "' + truncate(m.msg, 120) + '"');
  });
  if (msgs.length > 15) lines.push("\n(" + (msgs.length - 15) + " more not shown)");
  return instant(lines.join("\n"));
}

function answerEventCount(data) {
  var count = data.metadata.totalEvents || (data.events ? data.events.length : 0);
  return instant("This session has **" + count + " event" + (count !== 1 ? "s" : "") + "**.");
}

function answerToolDetail(question, data) {
  var match = question.match(/\b(?:how\s+many\s+times?\s+(?:was|did|were)\s+)(\w+)/i);
  if (!match) match = question.match(/\b(\w+)\s+tool\s+(?:count|usage|calls?)/i);
  if (!match) match = question.match(/\bhow\s+was\s+(\w+)\s+used/i);
  if (!match) return { tier: "model", context: buildModelContext(question, data) };

  var toolName = match[1].toLowerCase();
  if (!data.events) return instant("No events available.");

  var count = 0;
  var matchedName = null;
  var turnSet = {};
  for (var i = 0; i < data.events.length; i++) {
    if (data.events[i].track === "tool_call" && data.events[i].toolName) {
      if (data.events[i].toolName.toLowerCase() === toolName) {
        count++;
        if (!matchedName) matchedName = data.events[i].toolName;
        if (data.events[i].turnIndex != null) turnSet[data.events[i].turnIndex] = true;
      }
    }
  }
  if (count === 0) return instant("Tool **" + toolName + "** was not used in this session.");
  var turnList = Object.keys(turnSet).map(Number).sort(function (a, b) { return a - b; });
  var lines = ["**" + matchedName + "** was called **" + count + "** time" + (count !== 1 ? "s" : "") + "."];
  if (turnList.length > 0 && turnList.length <= 15) {
    lines.push("\nUsed in: " + turnList.map(function (t) { return "[Turn " + t + "]"; }).join(", "));
  } else if (turnList.length > 15) {
    lines.push("\nUsed across " + turnList.length + " turns (first: [Turn " + turnList[0] + "], last: [Turn " + turnList[turnList.length - 1] + "])");
  }
  return instant(lines.join("\n"));
}

function answerFileDetail(question, data) {
  if (!data.events) return instant("No events available.");
  // Extract the file path from the question
  var pathMatch = question.match(/(?:to|of|for|was)\s+([A-Za-z]:\\[^\s?]+|\/[^\s?]+|[A-Za-z0-9_./-]+\.\w{1,5})/i);
  if (!pathMatch) return { tier: "model", context: buildModelContext(question, data) };

  var targetPath = pathMatch[1].replace(/[?'"]+$/, "");
  var targetLower = targetPath.toLowerCase();
  var basename = targetPath.split(/[/\\]/).pop().toLowerCase();

  var ops = [];
  for (var i = 0; i < data.events.length; i++) {
    var e = data.events[i];
    if (e.track !== "tool_call" || !e.toolName) continue;
    var input = e.toolInput || "";
    var inputStr = typeof input === "string" ? input : JSON.stringify(input);
    if (inputStr.toLowerCase().indexOf(basename) !== -1) {
      ops.push({ tool: e.toolName, turn: e.turnIndex, text: truncate(e.text, 80) });
    }
  }

  if (ops.length === 0) {
    return instant("No operations found involving `" + targetPath.split(/[/\\]/).pop() + "` in this session.");
  }

  var lines = ["**" + ops.length + " operation" + (ops.length !== 1 ? "s" : "") + "** on `" + targetPath.split(/[/\\]/).pop() + "`:\n"];
  ops.slice(0, 15).forEach(function (op) {
    var turnLabel = op.turn != null ? " [Turn " + op.turn + "]" : "";
    lines.push("- **" + op.tool + "**" + turnLabel + ": " + op.text);
  });
  if (ops.length > 15) lines.push("\n(" + (ops.length - 15) + " more not shown)");
  return instant(lines.join("\n"));
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function instant(answer) {
  return { tier: "instant", answer: answer };
}

function getTurnMessages(turns, lo, hi) {
  if (!turns) return [];
  var msgs = [];
  for (var i = lo; i <= Math.min(hi, turns.length - 1); i++) {
    if (turns[i] && turns[i].userMessage) {
      msgs.push("Turn " + i + ": " + turns[i].userMessage);
    }
  }
  return msgs;
}

function getFileOperations(events, limit) {
  if (!events) return [];
  var ops = [];
  for (var i = 0; i < events.length && ops.length < limit; i++) {
    var e = events[i];
    if (e.track !== "tool_call" || !e.toolName) continue;
    var input = e.toolInput || "";
    var inputStr = typeof input === "string" ? input : JSON.stringify(input);
    var pathMatch = inputStr.match(/(?:file_path|path|file|filename)["\s:=]+["']?([^\s"',}\]]+)/i);
    if (pathMatch) {
      ops.push({ file: pathMatch[1], tool: e.toolName, turn: e.turnIndex });
    }
  }
  return ops;
}

function getCommandHistory(events, limit) {
  if (!events) return [];
  var cmds = [];
  for (var i = 0; i < events.length && cmds.length < limit; i++) {
    var e = events[i];
    if (e.track !== "tool_call") continue;
    var name = (e.toolName || "").toLowerCase();
    if (name !== "bash" && name !== "shell" && name !== "powershell" && name !== "terminal" && name !== "execute_command" && name !== "run_command") continue;
    var input = e.toolInput || "";
    var inputStr = typeof input === "string" ? input : JSON.stringify(input);
    var cmdMatch = inputStr.match(/(?:command|cmd|script)["\s:=]+["']?([^\n"']{1,200})/i);
    if (cmdMatch) cmds.push({ cmd: cmdMatch[1].trim(), turn: e.turnIndex });
    else if (typeof input === "string" && input.length < 200) cmds.push({ cmd: input.trim(), turn: e.turnIndex });
  }
  return cmds;
}

function truncate(text, maxLen) {
  if (!text) return "";
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + "...";
}

var STOP_WORDS = new Set(["the","a","an","is","was","were","are","in","on","to","for","of","and","or","how","many","what","which","did","does","do","this","that","it","its","with","from","by","at","be","been","has","have","had","not","but","they","them","their","there","will","would","could","should","can","may","about","than","then","more","most","also","just","any","all","some","much","each","both"]);

function extractKeyTerms(question) {
  var words = question.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/);
  return words.filter(function (w) { return w.length > 2 && !STOP_WORDS.has(w); });
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
