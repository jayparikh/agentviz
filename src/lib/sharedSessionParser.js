/**
 * Shared session markdown parser for AGENTVIZ.
 *
 * Parses the markdown format produced by Copilot CLI's /share file command
 * into normalized events compatible with the AGENTVIZ replay engine.
 *
 * Format:
 *   # Copilot CLI Session
 *   > **Session ID:** `<uuid>`
 *   > **Started:** <date>
 *   > **Duration:** <time>
 *   > **Exported:** <date>
 *   <sub>timestamp</sub>
 *   ### <emoji> <type>
 *   content...
 *   ---
 */

var AGENT_MAP = {
  User: "user",
  Reasoning: "assistant",
  Info: "system",
};

var TRACK_MAP = {
  User: "context",
  Reasoning: "reasoning",
  Info: "output",
};

function parseDuration(durationStr) {
  if (!durationStr) return 0;
  var total = 0;
  var daysMatch = durationStr.match(/(\d+)d/);
  var hoursMatch = durationStr.match(/(\d+)h/);
  var minsMatch = durationStr.match(/(\d+)m/);
  var secsMatch = durationStr.match(/(\d+)s/);
  if (daysMatch) total += parseInt(daysMatch[1], 10) * 86400;
  if (hoursMatch) total += parseInt(hoursMatch[1], 10) * 3600;
  if (minsMatch) total += parseInt(minsMatch[1], 10) * 60;
  if (secsMatch) total += parseInt(secsMatch[1], 10);
  return total;
}

function parseTimestamp(tsStr) {
  if (!tsStr) return 0;
  return parseDuration(tsStr);
}

export function parseSharedMarkdown(text) {
  if (!text || typeof text !== "string") return null;
  if (!text.includes("Copilot CLI Session") && !text.includes("copilot-session")) return null;

  var lines = text.split("\n");
  var events = [];
  var metadata = {
    sessionId: null,
    startedAt: null,
    duration: null,
    exportedAt: null,
  };

  var currentEvent = null;
  var lastTimestamp = 0;
  var turnIndex = 0;
  var turnIndices = [];

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];

    // Parse header metadata
    var sessionIdMatch = line.match(/\*\*Session ID:\*\*\s*`(.+)`/);
    if (sessionIdMatch) { metadata.sessionId = sessionIdMatch[1]; continue; }

    var startedMatch = line.match(/\*\*Started:\*\*\s*(.+)/);
    if (startedMatch) { metadata.startedAt = startedMatch[1].trim(); continue; }

    var durationMatch = line.match(/\*\*Duration:\*\*\s*(.+)/);
    if (durationMatch) { metadata.duration = durationMatch[1].trim(); continue; }

    var exportedMatch = line.match(/\*\*Exported:\*\*\s*(.+)/);
    if (exportedMatch) { metadata.exportedAt = exportedMatch[1].trim(); continue; }

    // Parse timestamp lines: <sub>timestamp</sub>
    var tsMatch = line.match(/<sub>\s*\u23F1\uFE0F?\s*(.+?)\s*<\/sub>/);
    if (tsMatch) {
      lastTimestamp = parseTimestamp(tsMatch[1]);
      continue;
    }

    // Parse turn headers: ### <emoji> <Type> or ### <emoji> `toolName`
    var turnMatch = line.match(/^###\s+\S+\s+(.+)$/);
    if (turnMatch) {
      if (currentEvent) {
        currentEvent.text = currentEvent.text.trim();
        events.push(currentEvent);
      }

      var rawType = turnMatch[1].trim();
      var toolMatch = rawType.match(/^`(.+)`$/);
      var toolName = null;
      var agent = "system";
      var track = "output";

      if (toolMatch) {
        toolName = toolMatch[1];
        agent = "assistant";
        track = "tool_call";
      } else if (AGENT_MAP[rawType]) {
        agent = AGENT_MAP[rawType];
        track = TRACK_MAP[rawType];
      }

      if (agent === "user") {
        turnIndex++;
      }

      currentEvent = {
        t: lastTimestamp,
        agent: agent,
        track: track,
        text: "",
        duration: 1,
        intensity: track === "tool_call" ? 0.8 : 0.5,
        toolName: toolName,
        turnIndex: turnIndex,
        isError: false,
      };

      continue;
    }

    // Separator ends current event
    if (line.trim() === "---") {
      if (currentEvent) {
        currentEvent.text = currentEvent.text.trim();
        events.push(currentEvent);
        currentEvent = null;
      }
      continue;
    }

    // Accumulate content
    if (currentEvent) {
      // Strip markdown details/summary wrappers
      if (line.match(/^<details>|^<\/details>|^<summary>.*<\/summary>/)) continue;
      currentEvent.text += (currentEvent.text ? "\n" : "") + line;
    }
  }

  if (currentEvent) {
    currentEvent.text = currentEvent.text.trim();
    events.push(currentEvent);
  }

  if (events.length === 0) return null;

  // Compute durations between events
  for (var j = 0; j < events.length - 1; j++) {
    events[j].duration = Math.max(0.1, events[j + 1].t - events[j].t);
  }
  if (events.length > 0) {
    events[events.length - 1].duration = 1;
  }

  // Check for errors
  for (var k = 0; k < events.length; k++) {
    if (events[k].text && (
      events[k].text.includes("<exited with exit code 1>") ||
      events[k].text.includes("Error:") ||
      events[k].text.includes("error:")
    )) {
      events[k].isError = true;
    }
  }

  // Build turns
  var turns = [];
  var currentTurnEvents = [];
  var currentTurnIndex = 0;

  for (var m = 0; m < events.length; m++) {
    if (events[m].turnIndex > currentTurnIndex && currentTurnEvents.length > 0) {
      turns.push({
        index: currentTurnIndex,
        startTime: events[currentTurnEvents[0]].t,
        endTime: events[currentTurnEvents[currentTurnEvents.length - 1]].t,
        eventIndices: currentTurnEvents.slice(),
        userMessage: events[currentTurnEvents[0]].agent === "user" ? events[currentTurnEvents[0]].text : null,
        toolCount: currentTurnEvents.filter(function (idx) { return events[idx].track === "tool_call"; }).length,
        hasError: currentTurnEvents.some(function (idx) { return events[idx].isError; }),
      });
      currentTurnEvents = [];
      currentTurnIndex = events[m].turnIndex;
    }
    currentTurnEvents.push(m);
  }

  // Push final turn
  if (currentTurnEvents.length > 0) {
    turns.push({
      index: currentTurnIndex,
      startTime: events[currentTurnEvents[0]].t,
      endTime: events[currentTurnEvents[currentTurnEvents.length - 1]].t,
      eventIndices: currentTurnEvents.slice(),
      userMessage: events[currentTurnEvents[0]].agent === "user" ? events[currentTurnEvents[0]].text : null,
      toolCount: currentTurnEvents.filter(function (idx) { return events[idx].track === "tool_call"; }).length,
      hasError: currentTurnEvents.some(function (idx) { return events[idx].isError; }),
    });
  }

  // Build metadata
  var totalDuration = metadata.duration ? parseDuration(metadata.duration) : 0;
  if (totalDuration === 0 && events.length > 0) {
    totalDuration = events[events.length - 1].t + events[events.length - 1].duration;
  }

  var toolCalls = events.filter(function (e) { return e.track === "tool_call"; });
  var errorCount = events.filter(function (e) { return e.isError; }).length;

  return {
    events: events,
    turns: turns,
    metadata: {
      totalEvents: events.length,
      totalTurns: turns.length,
      totalToolCalls: toolCalls.length,
      errorCount: errorCount,
      duration: totalDuration,
      models: [],
      primaryModel: null,
      tokenUsage: null,
      format: "shared-md",
      sessionId: metadata.sessionId,
    },
  };
}
