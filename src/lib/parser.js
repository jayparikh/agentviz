/**
 * Parse Claude Code JSONL session files into normalized events.
 *
 * Sessions live at: ~/.claude/projects/<project>/<session-id>.jsonl
 *
 * Returns: { events, turns, metadata } or null
 *
 * Event shape:
 *   { t, agent, track, text, duration, intensity,
 *     toolName?, toolInput?, raw, turnIndex, isError,
 *     model?, tokenUsage? }
 *
 * Turn shape:
 *   { index, startTime, endTime, eventIndices, userMessage,
 *     toolCount, hasError }
 *
 * Metadata shape:
 *   { totalEvents, totalTurns, totalToolCalls, errorCount,
 *     duration, models, primaryModel, tokenUsage }
 */

function truncate(s, max) {
  if (!s) return "";
  return s.length > max ? s.substring(0, max) + "..." : s;
}

function extractContent(content) {
  if (!content) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map(function (c) {
        if (typeof c === "string") return c;
        if (c.type === "text") return c.text || "";
        if (c.type === "tool_use") return "[tool: " + c.name + "]";
        if (c.type === "tool_result") return "[result]";
        return "";
      })
      .filter(Boolean)
      .join(" ");
  }
  if (content.text) return content.text;
  return JSON.stringify(content).substring(0, 200);
}

function formatToolInput(input) {
  if (!input) return "";
  if (typeof input === "string") return truncate(input, 100);
  var keys = Object.keys(input);
  if (keys.length === 0) return "";
  var first = keys[0];
  var val = typeof input[first] === "string" ? input[first] : JSON.stringify(input[first]);
  var extra = keys.length > 1 ? ", +" + (keys.length - 1) + " more" : "";
  return truncate(first + ": " + val + extra, 120);
}

function isReasoningText(text) {
  if (!text || text.length > 600) return false;
  var lower = text.toLowerCase();
  var signals = [
    "i'll ", "i need to", "let me", "first,", "the approach",
    "i should", "plan:", "step 1", "thinking about", "considering",
    "my strategy", "i want to",
  ];
  return signals.some(function (s) { return lower.includes(s); });
}

// ── Timestamp extraction ──

function extractTimestamp(raw) {
  var ts = raw.timestamp || raw.ts || raw.created_at || raw.createdAt;
  if (!ts) return null;
  var d = new Date(ts);
  if (isNaN(d.getTime())) return null;
  return d.getTime() / 1000;
}

// ── Model and usage extraction ──

function extractModel(raw) {
  if (raw.model) return raw.model;
  var msg = raw.message || {};
  if (msg.model) return msg.model;
  return null;
}

function extractUsage(raw) {
  var usage = raw.usage || (raw.message && raw.message.usage) || null;
  if (!usage) return null;
  var inp = usage.input_tokens || usage.prompt_tokens || 0;
  var out = usage.output_tokens || usage.completion_tokens || 0;
  var cacheRead = usage.cache_read_input_tokens || usage.cache_read_tokens || 0;
  var cacheWrite = usage.cache_creation_input_tokens || usage.cache_write_tokens || 0;
  if (inp + out + cacheRead + cacheWrite === 0) return null;
  return { inputTokens: inp, outputTokens: out, cacheRead: cacheRead, cacheWrite: cacheWrite };
}

// ── Error detection ──

var ERROR_PATTERNS = [
  /\berror\b/i,
  /\bfailed\b/i,
  /\bexception\b/i,
  /\btraceback\b/i,
  /\bpanic\b/i,
  /\bfatal\b/i,
  /exit code [1-9]/,
  /exit status [1-9]/,
  /command not found/,
  /permission denied/i,
  /no such file/i,
  /cannot find/i,
];

function detectError(block, text) {
  if (block.is_error === true) return true;
  if (block.error) return true;
  if (!text) return false;
  return ERROR_PATTERNS.some(function (p) { return p.test(text); });
}

// ── Event extraction from a single record ──

function extractEventsFromRecord(raw, syntheticTime) {
  var events = [];
  var ts = extractTimestamp(raw);
  var tSeconds = ts !== null ? ts : syntheticTime;
  var model = extractModel(raw);
  var usage = extractUsage(raw);

  function pushEvent(ev) {
    if (model && !ev.model) ev.model = model;
    if (usage && !ev.tokenUsage) ev.tokenUsage = usage;
    events.push(ev);
  }

  // Human / user messages
  if (raw.type === "human" || raw.type === "user") {
    var content = extractContent(raw.message && raw.message.content != null ? raw.message.content : raw.message || raw.content || raw);
    if (content) {
      pushEvent({
        t: tSeconds, agent: "user", track: "output",
        text: truncate(content, 300), duration: 1, intensity: 0.6,
        raw: raw, isError: false,
      });
    }
  }

  // Assistant messages (may contain text, tool_use, tool_result, thinking blocks)
  if (raw.type === "assistant" || raw.role === "assistant") {
    var msg = raw.message || raw;
    var contentArr = msg.content || raw.content;

    if (Array.isArray(contentArr)) {
      var offset = 0;
      for (var j = 0; j < contentArr.length; j++) {
        var block = contentArr[j];

        if (block.type === "text" && block.text) {
          pushEvent({
            t: tSeconds + offset,
            agent: "assistant",
            track: isReasoningText(block.text) ? "reasoning" : "output",
            text: truncate(block.text, 300),
            duration: Math.max(1, Math.ceil(block.text.length / 500)),
            intensity: 0.7, raw: block, isError: false,
          });
          offset += 0.2;
        }

        if (block.type === "tool_use") {
          pushEvent({
            t: tSeconds + offset,
            agent: "assistant", track: "tool_call",
            text: block.name + "(" + formatToolInput(block.input) + ")",
            toolName: block.name, toolInput: block.input,
            duration: 2, intensity: 0.9, raw: block, isError: false,
          });
          offset += 0.3;
        }

        if (block.type === "tool_result") {
          var resultText = extractContent(block.content || block.output);
          var hasError = detectError(block, resultText);
          pushEvent({
            t: tSeconds + offset,
            agent: "assistant", track: "context",
            text: "Result: " + truncate(resultText, 200),
            duration: 1, intensity: hasError ? 1.0 : 0.5,
            raw: block, isError: hasError,
          });
          offset += 0.2;
        }

        if (block.type === "thinking" || block.type === "reasoning") {
          pushEvent({
            t: tSeconds + offset,
            agent: "assistant", track: "reasoning",
            text: truncate(block.thinking || block.text || block.content || "", 300),
            duration: 2, intensity: 0.8, raw: block, isError: false,
          });
          offset += 0.2;
        }
      }
    } else if (typeof contentArr === "string" && contentArr.length > 0) {
      pushEvent({
        t: tSeconds, agent: "assistant", track: "output",
        text: truncate(contentArr, 300), duration: 2, intensity: 0.7,
        raw: raw, isError: false,
      });
    }
  }

  // Direct role: "user" (no type field)
  if (raw.role === "user" && !raw.type) {
    var userContent = extractContent(raw.content);
    if (userContent) {
      pushEvent({
        t: tSeconds, agent: "user", track: "output",
        text: truncate(userContent, 300), duration: 1, intensity: 0.6,
        raw: raw, isError: false,
      });
    }
  }

  // Top-level tool events
  if (raw.type === "tool_use") {
    var name = raw.name || raw.tool_name || "unknown_tool";
    pushEvent({
      t: tSeconds, agent: "assistant", track: "tool_call",
      text: name + "(" + formatToolInput(raw.input || raw.parameters || {}) + ")",
      toolName: name, toolInput: raw.input || raw.parameters,
      duration: 2, intensity: 0.9, raw: raw, isError: false,
    });
  }

  if (raw.type === "tool_result") {
    var trText = extractContent(raw.content || raw.output);
    var trError = detectError(raw, trText);
    pushEvent({
      t: tSeconds, agent: "assistant", track: "context",
      text: "Result: " + truncate(trText, 200),
      duration: 1, intensity: trError ? 1.0 : 0.5,
      raw: raw, isError: trError,
    });
  }

  // System / summary
  if (raw.type === "system" || raw.type === "summary") {
    var sysContent = extractContent(raw.message || raw.content || raw.summary);
    if (sysContent) {
      pushEvent({
        t: tSeconds, agent: "system", track: "context",
        text: truncate(sysContent, 200), duration: 1, intensity: 0.4,
        raw: raw, isError: false,
      });
    }
  }

  return events;
}

// ── Duration computation from real timestamps ──

function computeDurations(events) {
  for (var i = 0; i < events.length; i++) {
    if (i < events.length - 1) {
      var gap = events[i + 1].t - events[i].t;
      // Use timestamp gap as duration if reasonable (0.1s to 5min)
      if (gap >= 0.1 && gap < 300) {
        events[i].duration = gap;
      }
    }
  }
}

// ── Turn grouping ──

function buildTurns(events) {
  var turns = [];
  var currentTurn = null;

  for (var i = 0; i < events.length; i++) {
    var ev = events[i];

    if (ev.agent === "user") {
      // Close previous turn
      if (currentTurn) {
        turns.push(currentTurn);
      }
      currentTurn = {
        index: turns.length,
        startTime: ev.t,
        endTime: ev.t + ev.duration,
        eventIndices: [i],
        userMessage: ev.text,
        toolCount: 0,
        hasError: ev.isError || false,
      };
    } else if (currentTurn) {
      currentTurn.eventIndices.push(i);
      currentTurn.endTime = ev.t + ev.duration;
      if (ev.track === "tool_call") currentTurn.toolCount++;
      if (ev.isError) currentTurn.hasError = true;
    } else {
      // Events before first user message
      currentTurn = {
        index: 0,
        startTime: ev.t,
        endTime: ev.t + ev.duration,
        eventIndices: [i],
        userMessage: "(system)",
        toolCount: ev.track === "tool_call" ? 1 : 0,
        hasError: ev.isError || false,
      };
    }

    ev.turnIndex = currentTurn.index;
  }

  if (currentTurn) turns.push(currentTurn);
  return turns;
}

// ── Session metadata ──

function buildMetadata(events, turns) {
  var models = {};
  var totalInput = 0;
  var totalOutput = 0;
  var errorCount = 0;
  var toolCalls = 0;

  for (var i = 0; i < events.length; i++) {
    var ev = events[i];
    if (ev.model) models[ev.model] = (models[ev.model] || 0) + 1;
    if (ev.tokenUsage) {
      totalInput += ev.tokenUsage.inputTokens;
      totalOutput += ev.tokenUsage.outputTokens;
    }
    if (ev.isError) errorCount++;
    if (ev.track === "tool_call") toolCalls++;
  }

  var duration = events.length > 0
    ? events[events.length - 1].t + events[events.length - 1].duration - events[0].t
    : 0;

  var modelEntries = Object.entries(models).sort(function (a, b) { return b[1] - a[1]; });

  return {
    totalEvents: events.length,
    totalTurns: turns.length,
    totalToolCalls: toolCalls,
    errorCount: errorCount,
    duration: duration,
    models: models,
    primaryModel: modelEntries.length > 0 ? modelEntries[0][0] : null,
    tokenUsage: (totalInput + totalOutput > 0)
      ? { inputTokens: totalInput, outputTokens: totalOutput }
      : null,
  };
}

// ── Main parser ──

export function parseClaudeCodeJSONL(text) {
  var lines = text.trim().split("\n").filter(Boolean);
  var rawRecords = [];

  for (var i = 0; i < lines.length; i++) {
    try {
      rawRecords.push(JSON.parse(lines[i]));
    } catch (e) {
      // skip malformed
    }
  }

  if (rawRecords.length === 0) return null;

  // Check how many records have real timestamps
  var timestampCount = 0;
  for (var i = 0; i < rawRecords.length; i++) {
    if (extractTimestamp(rawRecords[i]) !== null) timestampCount++;
  }
  var hasRealTimestamps = timestampCount > rawRecords.length * 0.5;

  // Extract events
  var events = [];
  var syntheticTime = 0;

  for (var i = 0; i < rawRecords.length; i++) {
    var parsed = extractEventsFromRecord(rawRecords[i], syntheticTime);
    events.push.apply(events, parsed);
    syntheticTime += Math.max(1, parsed.length);
  }

  if (events.length === 0) return null;

  // Normalize to start at t=0
  var minT = events[0].t;
  for (var i = 0; i < events.length; i++) {
    events[i].t = events[i].t - minT;
  }

  // Compute real durations when timestamps are available
  if (hasRealTimestamps) {
    computeDurations(events);
  }

  // Build turns and metadata
  var turns = buildTurns(events);
  var metadata = buildMetadata(events, turns);

  return { events: events, turns: turns, metadata: metadata };
}

// Re-export for building sessions from pre-made event arrays (e.g. sample data)
export function buildSessionFromEvents(events) {
  var turns = buildTurns(events);
  var metadata = buildMetadata(events, turns);
  return { events: events, turns: turns, metadata: metadata };
}
