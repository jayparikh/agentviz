import { buildAutonomyMetrics, buildAutonomySummary, formatAutonomyEfficiency } from "./autonomyMetrics.js";
import { formatDurationLong } from "./formatTime.js";
import { buildConfigSummary, hasKeyword, parseMarkdownSections } from "./projectConfig.js";

function buildInstructionsSurface(metadata) {
  return metadata && metadata.format === "copilot-cli" ? "copilot-instructions.md" : "CLAUDE.md";
}

export function getTargetPath(id, format) {
  if (id === "autonomy-contract") {
    return format === "copilot-cli" ? ".github/copilot-instructions.md" : "CLAUDE.md";
  }
  if (id === "agent-split") {
    return "AGENTS.md";
  }
  if (id === "subagent-draft") {
    return format === "copilot-cli"
      ? ".github/prompts/repo-ops-scout.prompt.md"
      : ".claude/agents/repo-ops-scout.md";
  }
  if (id === "tooling-upgrade") {
    return null;
  }
  return null;
}

function truncateText(text, max) {
  if (!text) return "";
  return text.length > max ? text.substring(0, max) + "..." : text;
}

function getPromptEvidence(metrics, turns) {
  var followUps = (metrics.userFollowUps || []).slice(0, 2).map(function (message) {
    return "\"" + truncateText(message, 100) + "\"";
  });

  var evidence = [
    metrics.interventionCount + " follow-up turn" + (metrics.interventionCount === 1 ? "" : "s"),
    formatDurationLong(metrics.babysittingTime) + " of babysitting time",
    formatAutonomyEfficiency(metrics.autonomyEfficiency) + " autonomy efficiency",
  ];

  if (followUps.length > 0) {
    evidence.push("follow-up prompts: " + followUps.join(" / "));
  }

  return evidence;
}

function getAgentEvidence(metrics, metadata) {
  var evidence = [
    (metadata.totalToolCalls || 0) + " tool call" + ((metadata.totalToolCalls || 0) === 1 ? "" : "s"),
    (metrics.topTools || []).slice(0, 3).map(function (tool) { return tool.name + " (" + tool.count + ")"; }).join(", "),
  ].filter(Boolean);

  if (metadata.errorCount > 0) {
    evidence.push(metadata.errorCount + " error" + (metadata.errorCount === 1 ? "" : "s") + " during the run");
  }

  return evidence;
}

function getToolingEvidence(metrics) {
  var evidence = [
    formatDurationLong(metrics.idleTime) + " of idle time",
    (metrics.topTools || []).slice(0, 2).map(function (tool) { return tool.name + " x" + tool.count; }).join(", "),
  ].filter(Boolean);

  if (metrics.idleGaps && metrics.idleGaps.length > 0) {
    evidence.push("largest idle gap: " + formatDurationLong(metrics.idleGaps[0].duration));
  }

  return evidence;
}

export function buildDebriefRecommendations(events, turns, metadata, autonomyMetrics, configFiles) {
  var metrics = autonomyMetrics || buildAutonomyMetrics(events, turns, metadata);
  var summary = buildAutonomySummary(metrics);
  var instructionsSurface = buildInstructionsSurface(metadata || {});
  var format = metadata && metadata.format;
  var topToolNames = (metrics.topTools || []).slice(0, 3).map(function (tool) { return tool.name; });
  var recommendations = [];

  var configSummary = buildConfigSummary(configFiles || [], format);

  var contractBullets = [
    "- Work independently until you hit a destructive action, missing permission, or a requirement conflict.",
    "- Before asking the user for help, finish the next obvious investigation step and summarize what you already checked.",
    "- When editing code, run the narrowest relevant tests or build command before handing back control.",
    "- If the run stalls on repeated clarification, propose one concrete plan with tradeoffs instead of asking an open-ended question.",
    "- Surface reviewable drafts for config or workflow changes; do not silently apply them.",
  ].join("\n");

  var autonomyContractDraftText;
  if (configSummary.hasInstructions) {
    var alreadyHasContract = hasKeyword(configSummary.instructionsContent, "autonomous") || hasKeyword(configSummary.instructionsContent, "contract");
    if (alreadyHasContract) {
      autonomyContractDraftText = "Add to your existing " + configSummary.instructionsFile + ":\n\n" + contractBullets;
    } else {
      autonomyContractDraftText = "Append this section to " + configSummary.instructionsFile + ":\n\n# Autonomous run contract\n" + contractBullets;
    }
  } else {
    autonomyContractDraftText = [
      "# Autonomous run contract",
      contractBullets,
    ].join("\n");
  }

  var hasInterventionEvidence = metrics.interventionCount > 0 || metrics.babysittingTime > 30;
  var hasMinimalActivity = (metadata && metadata.totalTurns >= 3) || metrics.totalToolCalls >= 4;

  if (hasInterventionEvidence || hasMinimalActivity) {
    recommendations.push({
      id: "autonomy-contract",
      surface: instructionsSurface,
      targetPath: getTargetPath("autonomy-contract", format),
      priority: metrics.interventionCount > 1 || metrics.babysittingTime > 60 ? "high" : "medium",
      title: "Tighten the autonomous run contract",
      summary: "Reduce operator babysitting by documenting when the agent should keep going, when it should verify, and when it should stop for review.",
      evidence: getPromptEvidence(metrics, turns),
      draftText: autonomyContractDraftText,
    });
  }

  if ((metadata && metadata.totalToolCalls >= 4) || topToolNames.length >= 2) {
    var rosterTemplate = [
      "# Suggested agent roster",
      "## scout",
      "- Gather file paths, APIs, and risks before any edits.",
      "## builder",
      "- Implement the change in small steps and keep tests green.",
      "## verifier",
      "- Run focused regression checks and summarize failures with exact commands.",
      "",
      "Escalation rule: if builder hits the same blocker twice, hand off to scout or verifier instead of asking the operator to manually triage.",
    ].join("\n");

    var agentSplitDraftText;
    if (configSummary.hasAgents && configSummary.agentsMdContent) {
      var agentSections = parseMarkdownSections(configSummary.agentsMdContent);
      var existingHeadings = agentSections.map(function (s) { return s.heading; });
      var headingList = existingHeadings.length > 0 ? existingHeadings.join(", ") : "(no sections yet)";
      agentSplitDraftText = "Your current AGENTS.md has: " + headingList + ". Consider adding:\n\n" + rosterTemplate;
    } else {
      agentSplitDraftText = rosterTemplate;
    }

    recommendations.push({
      id: "agent-split",
      surface: "AGENTS.md",
      targetPath: getTargetPath("agent-split", format),
      priority: metadata && metadata.errorCount > 0 ? "high" : "medium",
      title: "Create a lightweight execution roster",
      summary: "Codify which agent owns exploration, implementation, and verification so long runs do not bounce back to the operator.",
      evidence: getAgentEvidence(metrics, metadata || {}),
      draftText: agentSplitDraftText,
    });
  }

  if (topToolNames.length > 0) {
    var targetPath = getTargetPath("subagent-draft", format);
    var subagentTemplate = [
      "name: repo-ops-scout",
      "goal: Explore the codebase, gather the 3-5 most relevant files, and hand implementation off with concrete risks.",
      "workflow:",
      "  1. Search for existing patterns before proposing new structure.",
      "  2. Summarize findings in bullets, including tests to run next.",
      "  3. Avoid asking the user for routine repo navigation help.",
      "handoff:",
      "  - Provide file paths, commands run, and unresolved risks.",
    ].join("\n");

    var subagentDraftText;
    if (configSummary.agentFiles.length > 0) {
      var existingNames = configSummary.agentFiles.map(function (f) {
        var parts = f.path.replace(/\\/g, "/").split("/");
        return parts[parts.length - 1];
      });
      subagentDraftText = "Existing agents: " + existingNames.join(", ") + ". New agent to add:\n\n";
      if (targetPath) {
        subagentDraftText += "# Save as: " + targetPath + "\n\n";
      }
      subagentDraftText += subagentTemplate;
    } else {
      subagentDraftText = (targetPath ? "# Save as: " + targetPath + "\n\n" : "") + subagentTemplate;
    }

    recommendations.push({
      id: "subagent-draft",
      surface: "Skill / subagent draft",
      targetPath: targetPath,
      priority: metrics.interventionCount > 0 ? "medium" : "low",
      title: "Draft a repeatable repo-ops subagent",
      summary: "Package the most repetitive tool sequence into a reusable subagent prompt so the operator does not have to restate it every session.",
      evidence: [
        "Top tools: " + topToolNames.join(", "),
        metrics.totalToolCalls + " total tool call" + (metrics.totalToolCalls === 1 ? "" : "s"),
      ],
      draftText: subagentDraftText,
    });
  }

  if (metrics.idleTime >= 30 || topToolNames.indexOf("bash") !== -1) {
    var toolingChecklist = [
      "Recommendation:",
      "- Audit the top slow or repetitive tasks from this session.",
      "- Prefer a dedicated MCP/server integration for workspace search, issue lookup, or repo metadata if the agent repeatedly shells out for the same information.",
      "- Add a standard verification command block so the agent can run the expected checks without waiting for operator confirmation.",
      "",
      "Review checklist:",
      "1. Which lookup/search steps were repeated?",
      "2. Which permissions caused the agent to pause?",
      "3. Which commands should become one-click or pre-approved drafts?",
    ].join("\n");

    var toolingDraftText;
    if (configSummary.hasMcp && configSummary.mcpServerNames.length > 0) {
      toolingDraftText = "Current MCP servers: " + configSummary.mcpServerNames.join(", ") + ".\n\n" + toolingChecklist;
    } else {
      toolingDraftText = toolingChecklist;
    }

    recommendations.push({
      id: "tooling-upgrade",
      surface: "MCP / tooling recommendation",
      targetPath: getTargetPath("tooling-upgrade", format),
      priority: metrics.idleTime >= 90 ? "high" : "medium",
      title: "Add tooling that removes dead air",
      summary: "Reduce idle gaps by upgrading the agent's access to fast code search, workspace metadata, or safer command execution helpers.",
      evidence: getToolingEvidence(metrics),
      draftText: toolingDraftText,
    });
  }

  return {
    metrics: metrics,
    summary: summary,
    recommendations: recommendations,
  };
}
