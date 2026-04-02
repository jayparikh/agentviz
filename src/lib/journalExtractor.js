/**
 * Journal Extractor — Heuristic extraction of narrative moments from sessions
 *
 * Identifies steering moments, level-ups, pivots, mistakes, and milestones
 * from raw session events and turns. No AI required — pure signal extraction.
 */

// ── Entry types ──────────────────────────────────────────────────────────────

export var JOURNAL_TYPES = {
  steering:  { id: "steering",  label: "Steering",  emoji: "🎯", color: "#6475e8" },
  levelup:   { id: "levelup",   label: "Level-Up",  emoji: "🆙", color: "#10d97a" },
  pivot:     { id: "pivot",     label: "Pivot",      emoji: "🔄", color: "#eab308" },
  mistake:   { id: "mistake",   label: "Mistake",    emoji: "❌", color: "#f43f5e" },
  milestone: { id: "milestone", label: "Milestone",  emoji: "✅", color: "#a78bfa" },
  insight:   { id: "insight",   label: "Insight",    emoji: "💡", color: "#06b6d4" },
};

// ── Pattern matchers ─────────────────────────────────────────────────────────

var STEERING_PATTERNS = [
  /\b(instead|actually|let'?s try|no,?\s|don'?t|change|switch to|go back|revert|undo|stop|wait|hold on|scratch that|forget|never\s?mind)\b/i,
  /\b(wrong|incorrect|that'?s not|fix|broken|not what I|try again|different approach)\b/i,
];

var MILESTONE_TOOL_PATTERNS = [
  /test/i, /build/i, /deploy/i, /commit/i, /push/i,
];

var INSIGHT_PATTERNS = [
  /\b(found|discovered|realized|turns out|interesting|the issue is|root cause|because|the reason)\b/i,
  /\b(aha|got it|I see|makes sense|that explains)\b/i,
];

// ── Core extraction ──────────────────────────────────────────────────────────

/**
 * Extract journal entries from session events and turns.
 * Returns an array of { type, turnIndex, time, title, detail, events }.
 */
export function extractJournal(events, turns) {
  if (!events || !turns || turns.length === 0) return [];

  var entries = [];

  // Build a map of turn -> events for quick lookup
  var turnEventsMap = {};
  turns.forEach(function (turn) {
    turnEventsMap[turn.index] = (turn.eventIndices || []).map(function (i) {
      return events[i];
    }).filter(Boolean);
  });

  // ── Pass 1: Identify steering moments from user messages ───────────────
  turns.forEach(function (turn, i) {
    if (i === 0) return; // skip first turn (initial prompt, not steering)

    var userMsg = turn.userMessage || "";
    if (!userMsg || userMsg.length < 5) return;

    var isSteering = STEERING_PATTERNS.some(function (pat) {
      return pat.test(userMsg);
    });

    if (isSteering) {
      // Collect the assistant's response from this turn's events
      // Skip tool invocations, only keep substantive reasoning and output
      var turnEvents = turnEventsMap[turn.index] || [];
      var responseChunks = [];
      var totalLen = 0;
      for (var j = 0; j < turnEvents.length; j++) {
        var ev = turnEvents[j];
        if (!ev || !ev.text) continue;
        // Skip tool calls, invocations, and short noise
        if (ev.track === "tool_call" || ev.track === "context") continue;
        var chunk = ev.text.trim();
        if (chunk.length < 15) continue;
        if (chunk.indexOf("Invoking:") === 0) continue;
        if (chunk.indexOf("invoke") !== -1 && chunk.length < 40) continue;
        if (ev.track === "assistant" || ev.track === "output" || ev.track === "reasoning") {
          if (totalLen + chunk.length > 6000) {
            if (totalLen < 500) {
              responseChunks.push(chunk.substring(0, 6000 - totalLen) + "...");
            }
            break;
          }
          responseChunks.push(chunk);
          totalLen += chunk.length;
        }
      }
      var assistantResponse = responseChunks.join("\n\n");

      entries.push({
        type: "steering",
        turnIndex: turn.index,
        time: turn.startTime,
        title: extractTitle(userMsg, "Redirected approach"),
        detail: userMsg,
        assistantResponse: assistantResponse,
        severity: 1,
      });
    }
  });

  // ── Pass 2: Identify error-recovery arcs (mistake → level-up) ──────────
  turns.forEach(function (turn, i) {
    if (!turn.hasError) return;

    var turnEvents = turnEventsMap[turn.index] || [];
    var errorEvents = turnEvents.filter(function (e) { return e && e.isError; });
    if (errorEvents.length === 0) return;

    var errorText = errorEvents.map(function (e) {
      return e.text || e.toolName || "unknown error";
    }).join("; ");

    entries.push({
      type: "mistake",
      turnIndex: turn.index,
      time: turn.startTime,
      title: extractTitle(errorText, "Error encountered"),
      detail: "Error in turn " + turn.index + ": " + truncate(errorText, 200),
      severity: errorEvents.length,
    });

    // Check if next turn(s) recovered
    var nextTurn = turns[i + 1];
    if (nextTurn && !nextTurn.hasError && nextTurn.toolCount > 0) {
      entries.push({
        type: "levelup",
        turnIndex: nextTurn.index,
        time: nextTurn.startTime,
        title: "Recovered from error",
        detail: "Successfully recovered after error in turn " + turn.index,
        severity: 1,
      });
    }
  });

  // ── Pass 3: Identify heavy-work milestones ─────────────────────────────
  var avgToolCount = turns.reduce(function (s, t) { return s + (t.toolCount || 0); }, 0) / Math.max(turns.length, 1);
  var heavyThreshold = turns.length > 1 ? Math.max(avgToolCount * 2.5, 5) : 5;

  turns.forEach(function (turn) {
    if ((turn.toolCount || 0) < heavyThreshold) return;

    var turnEvents = turnEventsMap[turn.index] || [];
    var toolNames = [];
    turnEvents.forEach(function (e) {
      if (e && e.toolName && toolNames.indexOf(e.toolName) === -1) {
        toolNames.push(e.toolName);
      }
    });

    // Check if this is a milestone (test/build/deploy tool used)
    var isMilestone = toolNames.some(function (name) {
      return MILESTONE_TOOL_PATTERNS.some(function (pat) { return pat.test(name); });
    });

    if (isMilestone) {
      entries.push({
        type: "milestone",
        turnIndex: turn.index,
        time: turn.startTime,
        title: "Major work completed",
        detail: turn.toolCount + " tool calls including: " + toolNames.join(", "),
        severity: turn.toolCount,
      });
    } else if (turn.toolCount >= heavyThreshold * 1.5) {
      entries.push({
        type: "milestone",
        turnIndex: turn.index,
        time: turn.startTime,
        title: "Intensive implementation",
        detail: turn.toolCount + " tool calls: " + toolNames.slice(0, 5).join(", ") +
          (toolNames.length > 5 ? " + " + (toolNames.length - 5) + " more" : ""),
        severity: turn.toolCount,
      });
    }
  });

  // ── Pass 4: Identify insights from assistant reasoning ─────────────────
  events.forEach(function (event) {
    if (event.track !== "reasoning" && event.track !== "assistant") return;
    if (!event.text || event.text.length < 30) return;

    var isInsight = INSIGHT_PATTERNS.some(function (pat) {
      return pat.test(event.text);
    });

    if (isInsight && event.text.length > 80) {
      // Only capture substantial insights, not tiny mentions
      entries.push({
        type: "insight",
        turnIndex: event.turnIndex != null ? event.turnIndex : -1,
        time: event.t,
        title: extractTitle(event.text, "Discovery"),
        detail: truncate(event.text, 300),
        severity: 0.5,
      });
    }
  });

  // ── Pass 5: Compute impactTurns for steering entries ────────────────────
  // Count turns between this steering and the next one (or end of session)
  var steeringEntries = entries.filter(function (e) { return e.type === "steering"; });
  steeringEntries.sort(function (a, b) { return a.turnIndex - b.turnIndex; });
  for (var si = 0; si < steeringEntries.length; si++) {
    var nextTurnIdx = si < steeringEntries.length - 1
      ? steeringEntries[si + 1].turnIndex
      : turns.length;
    steeringEntries[si].impactTurns = nextTurnIdx - steeringEntries[si].turnIndex;
  }

  // ── Pass 6: First and last turn as bookends ────────────────────────────
  if (turns.length > 0) {
    var firstTurn = turns[0];
    entries.push({
      type: "milestone",
      turnIndex: 0,
      time: firstTurn.startTime,
      title: "Session started",
      detail: firstTurn.userMessage ? truncate(firstTurn.userMessage, 200) : "Session began",
      severity: 0,
    });

    var lastTurn = turns[turns.length - 1];
    if (turns.length > 1) {
      entries.push({
        type: "milestone",
        turnIndex: lastTurn.index,
        time: lastTurn.startTime,
        title: "Session ended",
        detail: turns.length + " turns, " + events.length + " events total",
        severity: 0,
      });
    }
  }

  // ── Deduplicate and sort ───────────────────────────────────────────────
  entries = deduplicateEntries(entries);
  entries.sort(function (a, b) { return a.time - b.time; });

  // Limit insights to the top few to avoid noise
  var insightCount = 0;
  var maxInsights = Math.max(3, Math.floor(turns.length / 5));
  entries = entries.filter(function (e) {
    if (e.type === "insight") {
      insightCount++;
      return insightCount <= maxInsights;
    }
    return true;
  });

  return entries;
}

// ── Computed summary stats ───────────────────────────────────────────────────

export function computeJournalStats(entries) {
  var stats = {
    total: entries.length,
    steering: 0,
    levelup: 0,
    pivot: 0,
    mistake: 0,
    milestone: 0,
    insight: 0,
  };

  entries.forEach(function (e) {
    if (stats[e.type] !== undefined) stats[e.type]++;
  });

  return stats;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function extractTitle(text, fallback) {
  if (!text) return fallback;
  // Take first sentence or first 60 chars
  var firstSentence = text.split(/[.!?\n]/)[0].trim();
  if (firstSentence.length > 60) {
    return firstSentence.substring(0, 57) + "...";
  }
  return firstSentence || fallback;
}

function truncate(text, max) {
  if (!text) return "";
  if (text.length <= max) return text;
  return text.substring(0, max - 3) + "...";
}

function deduplicateEntries(entries) {
  var seen = {};
  return entries.filter(function (e) {
    var key = e.type + ":" + e.turnIndex;
    if (seen[key]) return false;
    seen[key] = true;
    return true;
  });
}
