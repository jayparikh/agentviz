/**
 * Parse Copilot CLI JSONL session traces into normalized events.
 *
 * Persisted event types (non-ephemeral):
 *   session.start, session.resume, session.shutdown, session.error,
 *   session.context_changed, session.model_change, session.mode_changed,
 *   session.compaction_start, session.compaction_complete, session.truncation,
 *   session.task_complete, session.info, session.warning,
 *   session.plan_changed, session.snapshot_rewind, session.handoff,
 *   user.message,
 *   assistant.turn_start, assistant.message, assistant.turn_end,
 *   assistant.reasoning,
 *   tool.execution_start, tool.execution_complete, tool.user_requested,
 *   subagent.started, subagent.completed, subagent.failed,
 *   subagent.selected, subagent.deselected,
 *   hook.start, hook.end,
 *   system.message, system.notification,
 *   skill.invoked
 *
 * Returns: { events, turns, metadata } matching the same shape as
 * parseClaudeCodeJSONL so all downstream views work unchanged.
 */

var MAX_TEXT_LENGTH = 4000;

function truncate(s, max) {
  if (!s) return "";
  return s.length > max ? s.substring(0, max) + "..." : s;
}

function parseTimestamp(ts) {
  if (!ts) return null;
  var d = new Date(ts);
  if (isNaN(d.getTime())) return null;
  return d.getTime() / 1000;
}

function parseRawRecords(text) {
  var lines = text.split("\n");
  var records = [];
  var malformed = 0;

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (!line) continue;

    try {
      records.push(JSON.parse(line));
    } catch (e) {
      malformed++;
    }
  }

  return { records: records, malformedLines: malformed };
}

// Match tool.execution_start -> tool.execution_complete by toolCallId
function buildToolPairs(records) {
  var starts = {};
  var completes = {};

  for (var i = 0; i < records.length; i++) {
    var rec = records[i];
    if (rec.type === "tool.execution_start") {
      starts[rec.data.toolCallId] = rec;
    } else if (rec.type === "tool.execution_complete") {
      completes[rec.data.toolCallId] = rec;
    }
  }

  return { starts: starts, completes: completes };
}

function makeEvent(t, agent, track, text, duration, intensity, raw, extra) {
  var ev = {
    t: t,
    agent: agent,
    track: track,
    text: truncate(text, MAX_TEXT_LENGTH),
    duration: duration,
    intensity: intensity,
    raw: raw,
    turnIndex: 0,
    isError: false,
  };
  if (extra) {
    for (var k in extra) {
      ev[k] = extra[k];
    }
  }
  return ev;
}

function buildNormalizedEvents(records, sessionStartSec, toolPairs) {
  var events = [];
  var seenToolStarts = {};

  for (var i = 0; i < records.length; i++) {
    var rec = records[i];
    var tsSec = parseTimestamp(rec.timestamp);
    if (tsSec === null) continue;

    var t = tsSec - sessionStartSec;
    if (t < 0) t = 0;

    var type = rec.type;
    var data = rec.data || {};

    // -- User messages --
    if (type === "user.message") {
      events.push(makeEvent(t, "user", "output", data.content || "", 0.5, 0.9, rec));
      continue;
    }

    // -- Assistant messages: reasoning + content + tool request markers --
    if (type === "assistant.message") {
      emitAssistantMessage(events, t, data, rec, toolPairs);
      continue;
    }

    // -- Standalone reasoning (extended thinking, separate from assistant.message) --
    if (type === "assistant.reasoning") {
      if (data.content && data.content.trim()) {
        events.push(makeEvent(t, "assistant", "reasoning", data.content, 0.3, 0.5, rec));
      }
      continue;
    }

    // -- Tool execution (paired start -> complete) --
    if (type === "tool.execution_start") {
      if (seenToolStarts[data.toolCallId]) continue;
      seenToolStarts[data.toolCallId] = true;
      emitToolCall(events, t, tsSec, data, rec, toolPairs);
      continue;
    }

    // -- Sub-agent lifecycle --
    if (type === "subagent.started") {
      var agentLabel = data.agentDisplayName || data.agentName || "Sub-agent";
      events.push(makeEvent(t, "system", "context", agentLabel + " spawned", 0.3, 0.5, rec));
      continue;
    }
    if (type === "subagent.completed") {
      var completedLabel = data.agentDisplayName || data.agentName || "Sub-agent";
      events.push(makeEvent(t, "system", "context", completedLabel + " completed", 0.2, 0.4, rec));
      continue;
    }
    if (type === "subagent.failed") {
      var failedLabel = data.agentDisplayName || data.agentName || "Sub-agent";
      var failMsg = failedLabel + " failed";
      if (data.error) failMsg += ": " + truncate(data.error, 200);
      events.push(makeEvent(t, "system", "context", failMsg, 0.3, 0.8, rec, { isError: true }));
      continue;
    }

    // -- System messages and notifications --
    if (type === "system.message") {
      var sysText = data.content || "";
      if (sysText) {
        events.push(makeEvent(t, "system", "context", sysText, 0.3, 0.3, rec));
      }
      continue;
    }
    if (type === "system.notification") {
      var notifText = data.content || "";
      if (notifText) {
        events.push(makeEvent(t, "system", "context", notifText, 0.2, 0.2, rec));
      }
      continue;
    }

    // -- Session errors --
    if (type === "session.error") {
      var errMsg = data.message || data.errorType || "Session error";
      events.push(makeEvent(t, "system", "context", errMsg, 0.5, 1.0, rec, { isError: true }));
      continue;
    }

    // -- Model changes --
    if (type === "session.model_change") {
      var changeText = "Model: " + (data.previousModel || "?") + " \u2192 " + (data.newModel || "?");
      events.push(makeEvent(t, "system", "context", changeText, 0.2, 0.3, rec));
      continue;
    }

    // -- Mode changes (interactive/plan/autopilot) --
    if (type === "session.mode_changed") {
      var modeText = "Mode: " + (data.previousMode || "?") + " \u2192 " + (data.newMode || "?");
      events.push(makeEvent(t, "system", "context", modeText, 0.2, 0.3, rec));
      continue;
    }

    // -- Compaction --
    if (type === "session.compaction_complete") {
      var compactText = "Context compacted";
      if (data.tokensRemoved) compactText += " (" + data.tokensRemoved.toLocaleString() + " tokens removed)";
      events.push(makeEvent(t, "system", "context", compactText, 0.3, 0.4, rec));
      continue;
    }

    // -- Truncation --
    if (type === "session.truncation") {
      var truncText = "Context truncated";
      if (data.tokensRemoved) truncText += " (" + data.tokensRemoved.toLocaleString() + " tokens removed)";
      events.push(makeEvent(t, "system", "context", truncText, 0.3, 0.4, rec));
      continue;
    }

    // -- Task completion --
    if (type === "session.task_complete") {
      var taskText = data.summary || "Task completed";
      events.push(makeEvent(t, "system", "output", taskText, 0.3, 0.5, rec));
      continue;
    }

    // -- Info/warning messages --
    if (type === "session.info") {
      events.push(makeEvent(t, "system", "context", data.message || "Info", 0.2, 0.2, rec));
      continue;
    }
    if (type === "session.warning") {
      events.push(makeEvent(t, "system", "context", data.message || "Warning", 0.2, 0.4, rec));
      continue;
    }

    // Structural events (turn lifecycle, hooks, session start/resume/shutdown)
    // are used for turn grouping and metadata, not emitted as replay events.
  }

  events.sort(function (a, b) { return a.t - b.t || 0; });
  return events;
}

function emitAssistantMessage(events, t, data, rec, toolPairs) {
  var model = getModelFromMessage(data, toolPairs);

  // Reasoning (if present)
  if (data.reasoningText && data.reasoningText.trim()) {
    events.push(makeEvent(t, "assistant", "reasoning", data.reasoningText, 0.3, 0.5, rec, {
      model: model,
      tokenUsage: data.outputTokens ? { outputTokens: data.outputTokens } : null,
    }));
  }

  // Content/output (if non-empty)
  var content = (data.content || "").trim();
  if (content) {
    events.push(makeEvent(t + 0.01, "assistant", "output", content, 0.5, 0.7, rec, {
      model: model,
    }));
  }

  // If no reasoning and no content but has tool requests, emit a brief marker
  if (!content && (!data.reasoningText || !data.reasoningText.trim()) && data.toolRequests && data.toolRequests.length > 0) {
    var toolNames = data.toolRequests.map(function (tr) { return tr.name; }).join(", ");
    events.push(makeEvent(t, "assistant", "reasoning", "Invoking: " + toolNames, 0.2, 0.3, rec, {
      model: model,
    }));
  }
}

function emitToolCall(events, t, tsSec, data, rec, toolPairs) {
  var complete = toolPairs.completes[data.toolCallId];
  var endSec = complete ? parseTimestamp(complete.timestamp) : null;
  var duration = endSec ? Math.max(endSec - tsSec, 0.1) : 0.5;
  var isError = complete ? (complete.data && complete.data.success === false) : false;

  var resultText = "";
  if (complete && complete.data && complete.data.result) {
    resultText = complete.data.result.content || complete.data.result.detailedContent || "";
  }

  var displayText = data.toolName;
  if (data.arguments) {
    var argPreview = buildArgPreview(data.arguments);
    if (argPreview) displayText += ": " + argPreview;
  }
  if (isError) {
    var errorContent = (complete && complete.data && complete.data.error) || resultText;
    if (errorContent) displayText += "\n" + truncate(errorContent, 200);
  }

  events.push(makeEvent(t, "assistant", "tool_call", displayText, duration, isError ? 0.9 : 0.6, rec, {
    toolName: data.toolName,
    toolInput: data.arguments,
    isError: isError,
    model: complete && complete.data ? (complete.data.model || null) : null,
    parentToolCallId: data.parentToolCallId || null,
  }));
}

function getModelFromMessage(msgData, toolPairs) {
  if (msgData.toolRequests && msgData.toolRequests.length > 0) {
    for (var i = 0; i < msgData.toolRequests.length; i++) {
      var complete = toolPairs.completes[msgData.toolRequests[i].toolCallId];
      if (complete && complete.data && complete.data.model) return complete.data.model;
    }
  }
  return null;
}

function buildArgPreview(args) {
  if (!args) return "";

  // Common patterns for readable arg previews
  if (args.command) return truncate(args.command, 120);
  if (args.pattern) return "'" + truncate(args.pattern, 60) + "'" + (args.path ? " in " + args.path : "");
  if (args.path) return args.path;
  if (args.query) return truncate(args.query, 120);
  if (args.prompt) return truncate(args.prompt, 120);
  if (args.intent) return args.intent;
  if (args.description) return truncate(args.description, 120);
  if (args.url) return truncate(args.url, 120);
  if (args.issue_number) return "#" + args.issue_number;
  if (args.pullNumber) return "PR #" + args.pullNumber;
  if (args.owner && args.repo) return args.owner + "/" + args.repo;

  var keys = Object.keys(args);
  if (keys.length === 0) return "";
  if (keys.length <= 3) {
    return keys.map(function (k) {
      var v = args[k];
      if (typeof v === "string") return k + "=" + truncate(v, 40);
      return k;
    }).join(", ");
  }
  return keys.length + " args";
}

function buildTurns(records, events, sessionStartSec) {
  var turns = [];
  var currentTurn = null;
  var lastUserMessage = null;

  for (var i = 0; i < records.length; i++) {
    var rec = records[i];

    if (rec.type === "user.message") {
      lastUserMessage = rec.data.content || "";
    }

    if (rec.type === "assistant.turn_start") {
      if (currentTurn) {
        turns.push(currentTurn);
      }

      var turnStartSec = parseTimestamp(rec.timestamp);
      currentTurn = {
        index: turns.length,
        startTime: turnStartSec ? turnStartSec - sessionStartSec : 0,
        endTime: 0,
        eventIndices: [],
        userMessage: lastUserMessage || "(continuation)",
        toolCount: 0,
        hasError: false,
      };
      lastUserMessage = null;
    }

    if (rec.type === "assistant.turn_end" && currentTurn) {
      var turnEndSec = parseTimestamp(rec.timestamp);
      if (turnEndSec) currentTurn.endTime = turnEndSec - sessionStartSec;
    }
  }

  if (currentTurn) {
    turns.push(currentTurn);
  }

  // Assign events to turns by time range
  for (var j = 0; j < events.length; j++) {
    var ev = events[j];
    var assignedTurn = null;

    for (var k = turns.length - 1; k >= 0; k--) {
      if (ev.t >= turns[k].startTime) {
        assignedTurn = turns[k];
        break;
      }
    }

    if (!assignedTurn && turns.length > 0) {
      assignedTurn = turns[0];
    }

    if (assignedTurn) {
      ev.turnIndex = assignedTurn.index;
      assignedTurn.eventIndices.push(j);
      if (ev.track === "tool_call") assignedTurn.toolCount++;
      if (ev.isError) assignedTurn.hasError = true;
      if (assignedTurn.endTime < ev.t + ev.duration) {
        assignedTurn.endTime = ev.t + ev.duration;
      }
    }
  }

  return turns;
}

function buildMetadata(records, events, turns, malformedLines) {
  var sessionStart = null;
  var sessionResume = null;
  var sessionShutdown = null;

  for (var i = 0; i < records.length; i++) {
    if (records[i].type === "session.start") sessionStart = records[i].data;
    if (records[i].type === "session.resume") sessionResume = records[i].data;
    if (records[i].type === "session.shutdown") sessionShutdown = records[i].data;
  }

  // Prefer session.start, fall back to session.resume for resumed sessions
  var sessionInfo = sessionStart || sessionResume;

  var totalToolCalls = 0;
  var errorCount = 0;
  var models = {};

  for (var j = 0; j < events.length; j++) {
    if (events[j].track === "tool_call") totalToolCalls++;
    if (events[j].isError) errorCount++;
    if (events[j].model) models[events[j].model] = (models[events[j].model] || 0) + 1;
  }

  // Use session.shutdown modelMetrics for accurate token counts
  var totalInputTokens = 0;
  var totalOutputTokens = 0;
  var totalCacheReadTokens = 0;
  var totalCacheWriteTokens = 0;
  var totalCost = 0;

  if (sessionShutdown && sessionShutdown.modelMetrics) {
    var mm = sessionShutdown.modelMetrics;
    for (var model in mm) {
      if (mm[model].usage) {
        totalInputTokens += mm[model].usage.inputTokens || 0;
        totalOutputTokens += mm[model].usage.outputTokens || 0;
        totalCacheReadTokens += mm[model].usage.cacheReadTokens || 0;
        totalCacheWriteTokens += mm[model].usage.cacheWriteTokens || 0;
      }
      if (mm[model].requests) {
        totalCost += mm[model].requests.cost || 0;
      }
      if (!models[model]) models[model] = mm[model].requests ? mm[model].requests.count : 0;
    }
  }

  var modelEntries = Object.entries(models).sort(function (a, b) {
    return (b[1] || 0) - (a[1] || 0);
  });
  var primaryModel = modelEntries.length > 0 ? modelEntries[0][0] : null;

  var duration = events.length > 0
    ? events[events.length - 1].t + events[events.length - 1].duration
    : 0;

  var warnings = [];
  if (malformedLines > 0) {
    warnings.push(malformedLines + " malformed line(s) skipped");
  }
  if (sessionShutdown && sessionShutdown.shutdownType === "error") {
    warnings.push("Session ended with error: " + (sessionShutdown.errorReason || "unknown"));
  }

  var ctx = sessionInfo && sessionInfo.context ? sessionInfo.context : {};

  return {
    totalEvents: events.length,
    totalTurns: turns.length,
    totalToolCalls: totalToolCalls,
    errorCount: errorCount,
    duration: duration,
    models: models,
    primaryModel: primaryModel,
    tokenUsage: (totalInputTokens + totalOutputTokens + totalCacheReadTokens + totalCacheWriteTokens > 0)
      ? {
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        cacheReadTokens: totalCacheReadTokens,
        cacheWriteTokens: totalCacheWriteTokens,
      }
      : null,
    warnings: warnings,
    parseIssues: { malformedLines: malformedLines, invalidEvents: 0 },
    // Copilot-specific metadata
    format: "copilot-cli",
    sessionId: sessionInfo ? sessionInfo.sessionId : null,
    producer: sessionInfo ? sessionInfo.producer : null,
    copilotVersion: sessionInfo ? sessionInfo.copilotVersion : null,
    selectedModel: sessionInfo ? sessionInfo.selectedModel : null,
    repository: ctx.repository || null,
    branch: ctx.branch || null,
    cwd: ctx.cwd || null,
    gitRoot: ctx.gitRoot || null,
    shutdownType: sessionShutdown ? sessionShutdown.shutdownType : null,
    codeChanges: sessionShutdown ? sessionShutdown.codeChanges : null,
    premiumRequests: sessionShutdown ? sessionShutdown.totalPremiumRequests : null,
    totalApiDurationMs: sessionShutdown ? sessionShutdown.totalApiDurationMs : null,
    totalCost: totalCost,
  };
}

export function detectCopilotCli(text) {
  var firstNewline = text.indexOf("\n");
  var firstLine = firstNewline > 0 ? text.substring(0, firstNewline) : text;

  try {
    var obj = JSON.parse(firstLine.trim());
    // session.start or session.resume for resumed sessions
    if (obj.type === "session.start" || obj.type === "session.resume") {
      return Boolean(obj.data && (obj.data.producer === "copilot-agent" || obj.data.copilotVersion));
    }
    return false;
  } catch (e) {
    return false;
  }
}

export function parseCopilotCliJSONL(text) {
  var parsed = parseRawRecords(text);
  var records = parsed.records;
  if (records.length === 0) return null;

  // Find session start time from session.start or session.resume
  var sessionStartSec = null;
  for (var i = 0; i < records.length; i++) {
    var rec = records[i];
    if (rec.type === "session.start" && rec.data && rec.data.startTime) {
      sessionStartSec = parseTimestamp(rec.data.startTime);
      break;
    }
    if (rec.type === "session.resume" && rec.data && rec.data.resumeTime) {
      sessionStartSec = parseTimestamp(rec.data.resumeTime);
      break;
    }
  }

  // Fall back to first record timestamp
  if (sessionStartSec === null) {
    sessionStartSec = parseTimestamp(records[0].timestamp) || 0;
  }

  var toolPairs = buildToolPairs(records);
  var events = buildNormalizedEvents(records, sessionStartSec, toolPairs);

  if (events.length === 0) return null;

  var turns = buildTurns(records, events, sessionStartSec);
  var metadata = buildMetadata(records, events, turns, parsed.malformedLines);

  return { events: events, turns: turns, metadata: metadata };
}
