import { formatDurationLong } from "./formatTime.js";
import { estimateCost } from "./pricing.js";
import { getSessionTotal } from "./session";

var LONG_IDLE_GAP_SECONDS = 30;
var SIGNIFICANT_GAP_SECONDS = 5;
var MAX_BABYSITTING_GAP_SECONDS = 45;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getEventEnd(event) {
  return (event.t || 0) + Math.max(0, event.duration || 0);
}

function getTopTools(events) {
  var counts = {};

  (events || []).forEach(function (event) {
    if (event.track === "tool_call" && event.toolName) {
      counts[event.toolName] = (counts[event.toolName] || 0) + 1;
    }
  });

  return Object.entries(counts)
    .map(function (entry) {
      return { name: entry[0], count: entry[1] };
    })
    .sort(function (left, right) {
      return right.count - left.count;
    });
}

function getTurnMessages(turns) {
  return (turns || [])
    .map(function (turn) { return turn.userMessage; })
    .filter(Boolean);
}

function isContinuationMessage(text) {
  if (!text) return false;
  return String(text).trim().toLowerCase() === "(continuation)";
}

export function getSessionCost(metadata) {
  if (!metadata) return 0;
  if (metadata.format === "copilot-cli") return metadata.totalCost || 0;
  return estimateCost(metadata.tokenUsage, metadata.primaryModel);
}

export function buildAutonomyMetrics(events, turns, metadata) {
  var safeEvents = events || [];
  var totalDuration = metadata && metadata.duration ? metadata.duration : getSessionTotal(safeEvents);
  var eventRuntime = safeEvents.reduce(function (sum, event) {
    return sum + Math.max(0, event.duration || 0);
  }, 0);
  var realUserTurns = (turns || []).filter(function (turn) { return !isContinuationMessage(turn.userMessage); });
  var interventionCount = Math.max(0, realUserTurns.length - 1);
  var userMessages = getTurnMessages(turns);
  var topTools = getTopTools(safeEvents);
  var idleTime = 0;
  var babysittingTime = 0;
  var idleGaps = [];
  var babysittingGaps = [];

  for (var index = 0; index < safeEvents.length - 1; index += 1) {
    var current = safeEvents[index];
    var next = safeEvents[index + 1];
    var gap = Math.max(0, (next.t || 0) - getEventEnd(current));

    if (gap < SIGNIFICANT_GAP_SECONDS) continue;

    if (next.agent === "user" && current.agent !== "user") {
      var estimatedGap = Math.min(gap, MAX_BABYSITTING_GAP_SECONDS);
      babysittingTime += estimatedGap;
      babysittingGaps.push({
        duration: estimatedGap,
        rawDuration: gap,
        before: current.text || "",
        after: next.text || "",
      });
      continue;
    }

    if (gap >= LONG_IDLE_GAP_SECONDS) {
      idleTime += gap;
      idleGaps.push({
        duration: gap,
        before: current.text || "",
        after: next.text || "",
      });
    }
  }

  var productiveRuntime = eventRuntime;
  var autonomyEfficiencyDenominator = productiveRuntime + babysittingTime + idleTime;
  var autonomyEfficiency = autonomyEfficiencyDenominator > 0
    ? clamp(productiveRuntime / autonomyEfficiencyDenominator, 0, 1)
    : 0;
  var userFollowUps = userMessages
    .slice(1)
    .filter(function (message) { return !isContinuationMessage(message); })
    .slice(0, 4);

  return {
    totalDuration: totalDuration,
    eventRuntime: eventRuntime,
    productiveRuntime: productiveRuntime,
    babysittingTime: babysittingTime,
    idleTime: idleTime,
    interventionCount: interventionCount,
    autonomyEfficiency: autonomyEfficiency,
    errorCount: metadata ? metadata.errorCount || 0 : 0,
    totalToolCalls: metadata ? metadata.totalToolCalls || 0 : 0,
    totalTurns: metadata ? metadata.totalTurns || 0 : (turns || []).length,
    cost: getSessionCost(metadata),
    topTools: topTools,
    userFollowUps: userFollowUps,
    idleGaps: idleGaps,
    babysittingGaps: babysittingGaps,
  };
}

export function getNeedsReviewScore(sessionLike) {
  var autonomy = sessionLike && sessionLike.autonomyMetrics ? sessionLike.autonomyMetrics : sessionLike;
  var errorCount = sessionLike && sessionLike.errorCount != null
    ? sessionLike.errorCount
    : (autonomy && autonomy.errorCount) || 0;

  if (!autonomy) return 0;

  return (
    errorCount * 6
    + autonomy.interventionCount * 2
    + autonomy.babysittingTime / 30
    + autonomy.idleTime / 45
    + Math.max(0, 0.7 - autonomy.autonomyEfficiency) * 20
  );
}

export function formatAutonomyEfficiency(value) {
  if (value == null || Number.isNaN(value)) return "--";
  return Math.round(value * 100) + "%";
}

export function buildAutonomySummary(metrics) {
  if (!metrics) return [];

  return [
    {
      label: "Productive runtime",
      value: formatDurationLong(metrics.productiveRuntime),
      tooltip: "Total time the agent spent actively executing: reasoning, tool calls, and outputs.",
    },
    {
      label: "Human response time",
      value: formatDurationLong(metrics.babysittingTime),
      tooltip: "Time the agent waited for you to send a follow-up. High values mean the session needed frequent human input.",
    },
    {
      label: "Idle time",
      value: formatDurationLong(metrics.idleTime),
      tooltip: "Long gaps (30s+) not caused by waiting for you -- the agent paused or you stepped away.",
    },
    {
      label: "Interventions",
      value: String(metrics.interventionCount),
      tooltip: "Number of follow-up messages you sent. Each intervention is a turn where the agent needed guidance.",
    },
    {
      label: "Autonomy efficiency",
      value: formatAutonomyEfficiency(metrics.autonomyEfficiency),
      tooltip: "Productive runtime as a share of total time (productive + human response + idle). Higher means the agent worked more independently.",
    },
  ];
}
