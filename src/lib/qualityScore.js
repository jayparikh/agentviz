/**
 * Session quality scoring for AGENTVIZ landing page.
 *
 * Computes a composite quality score from session stats
 * and autonomy metrics, inspired by waza readiness checks.
 */

import { theme } from "./theme.js";

var WEIGHTS = {
  errorRate: 0.30,
  autonomy: 0.25,
  toolDiversity: 0.20,
  completion: 0.15,
  efficiency: 0.10,
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

// Error rate: 0 errors = 1.0, scales down with more errors per event
function scoreErrorRate(stats) {
  if (!stats || !stats.totalEvents || stats.totalEvents === 0) return 1.0;
  var rate = (stats.errorCount || 0) / stats.totalEvents;
  return clamp(1.0 - (rate * 10), 0, 1);
}

// Autonomy: uses existing efficiency metric (0-1 scale, higher is better)
function scoreAutonomy(autonomyMetrics) {
  if (!autonomyMetrics || autonomyMetrics.efficiency == null) return 0.5;
  return clamp(autonomyMetrics.efficiency, 0, 1);
}

// Tool diversity: unique tools / total tool calls (moderate diversity is good)
function scoreToolDiversity(stats) {
  if (!stats || !stats.totalToolCalls || stats.totalToolCalls === 0) return 0.5;
  var uniqueTools = stats.uniqueToolCount || 1;
  var ratio = uniqueTools / Math.min(stats.totalToolCalls, 50);
  // Sweet spot is 0.05-0.5 (some variety but not random)
  if (ratio >= 0.05 && ratio <= 0.5) return 1.0;
  if (ratio > 0.5) return 0.7; // Too many unique tools relative to calls
  return 0.3; // Only 1 tool used repeatedly
}

// Completion: sessions that end naturally score higher
function scoreCompletion(stats) {
  if (!stats) return 0.5;
  // Heuristic: sessions with > 2 turns and no errors at the end are "complete"
  if ((stats.totalTurns || 0) >= 2 && (stats.errorCount || 0) === 0) return 1.0;
  if ((stats.totalTurns || 0) >= 2) return 0.7;
  return 0.3;
}

// Efficiency: tool calls per turn (lower is more focused)
function scoreEfficiency(stats) {
  if (!stats || !stats.totalTurns || stats.totalTurns === 0) return 0.5;
  var toolsPerTurn = (stats.totalToolCalls || 0) / stats.totalTurns;
  // 2-15 tools per turn is healthy
  if (toolsPerTurn >= 2 && toolsPerTurn <= 15) return 1.0;
  if (toolsPerTurn > 15 && toolsPerTurn <= 30) return 0.7;
  if (toolsPerTurn > 30) return 0.4;
  return 0.6; // Less than 2 is low-tool session
}

export function computeQualityScore(stats, autonomyMetrics) {
  var components = {
    errorRate: scoreErrorRate(stats),
    autonomy: scoreAutonomy(autonomyMetrics),
    toolDiversity: scoreToolDiversity(stats),
    completion: scoreCompletion(stats),
    efficiency: scoreEfficiency(stats),
  };

  var score = 0;
  var keys = Object.keys(WEIGHTS);
  for (var i = 0; i < keys.length; i++) {
    score += components[keys[i]] * WEIGHTS[keys[i]];
  }

  return {
    score: Math.round(score * 100) / 100,
    grade: scoreToGrade(score),
    components: components,
  };
}

export function scoreToGrade(score) {
  if (score >= 0.9) return "A";
  if (score >= 0.8) return "B";
  if (score >= 0.65) return "C";
  if (score >= 0.5) return "D";
  return "F";
}

export function gradeColor(grade) {
  if (grade === "A" || grade === "B") return theme.semantic.success;
  if (grade === "C") return theme.semantic.warning;
  return theme.semantic.error;
}

export function formatScoreTooltip(result) {
  if (!result) return "";
  var lines = [
    "Quality: " + result.grade + " (" + Math.round(result.score * 100) + "%)",
    "Errors: " + Math.round(result.components.errorRate * 100) + "%",
    "Autonomy: " + Math.round(result.components.autonomy * 100) + "%",
    "Tool diversity: " + Math.round(result.components.toolDiversity * 100) + "%",
    "Completion: " + Math.round(result.components.completion * 100) + "%",
    "Efficiency: " + Math.round(result.components.efficiency * 100) + "%",
  ];
  return lines.join("\n");
}
