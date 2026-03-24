import { buildAutonomyMetrics, buildAutonomySummary, formatAutonomyEfficiency } from "./autonomyMetrics.js";
import { formatDurationLong } from "./formatTime.js";
import { buildConfigSummary, hasKeyword, parseMarkdownSections } from "./projectConfig.js";

// ─────────────────────────────────────────────────────────────────────────────
// checkApplied -- pure function to detect if a recommendation is already done
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Finds a config file entry by its id field.
 * @param {Array} configFiles
 * @param {string} id
 * @returns {object|null}
 */
function findConfigById(configFiles, id) {
  if (!configFiles) return null;
  for (var i = 0; i < configFiles.length; i++) {
    if (configFiles[i].id === id) return configFiles[i];
  }
  return null;
}

/**
 * Finds a config file entry whose path matches targetPath (exact match).
 * @param {Array} configFiles
 * @param {string} targetPath
 * @returns {object|null}
 */
function findConfigByPath(configFiles, targetPath) {
  for (var i = 0; i < configFiles.length; i++) {
    if (configFiles[i].path === targetPath) return configFiles[i];
  }
  return null;
}

/**
 * Given a recommendation and the current set of config file results,
 * returns whether the recommendation appears to already be handled.
 *
 * Returns: "handled" | "partial" | "pending"
 *   "handled" -- target file exists AND all detectionKeywords are present in content
 *   "partial"  -- target file exists AND some (but not all) detectionKeywords are present
 *   "pending"  -- target file is missing OR no keywords match
 *
 * @param {{ id: string, targetPath: string|null, detectionKeywords: string[] }} recommendation
 * @param {Array} configFiles -- results from /api/config
 * @returns {"handled"|"partial"|"pending"}
 */
export function checkApplied(recommendation, configFiles) {
  if (!recommendation) return "pending";
  var files = configFiles || [];
  var id = recommendation.id;
  var keywords = recommendation.detectionKeywords || [];

  // sprint-commands: presence-based -- check if commands dir (or prompts dir) has any entries
  if (id === "sprint-commands") {
    var commandsDirIds = ["claude-commands", "github-prompts"];
    for (var i = 0; i < commandsDirIds.length; i++) {
      var dir = findConfigById(files, commandsDirIds[i]);
      if (dir && dir.exists && dir.entries && dir.entries.length > 0) {
        return "handled";
      }
    }
    return "pending";
  }

  // subagent-draft: check if agents/prompts dir has files matching keywords
  if (id === "subagent-draft") {
    var agentDirIds = ["claude-agents", "github-prompts"];
    for (var j = 0; j < agentDirIds.length; j++) {
      var agentDir = findConfigById(files, agentDirIds[j]);
      if (agentDir && agentDir.exists && agentDir.entries && agentDir.entries.length > 0) {
        if (keywords.length === 0) return "handled";
        var anyMatch = keywords.some(function (kw) {
          return agentDir.entries.some(function (e) {
            return hasKeyword(e.content, kw) || hasKeyword(e.path, kw);
          });
        });
        var allMatch = keywords.every(function (kw) {
          return agentDir.entries.some(function (e) {
            return hasKeyword(e.content, kw) || hasKeyword(e.path, kw);
          });
        });
        if (allMatch) return "handled";
        if (anyMatch) return "partial";
      }
    }
    return "pending";
  }

  // tooling-upgrade: check .mcp.json content for keywords
  if (id === "tooling-upgrade") {
    var mcpFile = findConfigById(files, "mcp-json");
    if (!mcpFile || !mcpFile.exists || !mcpFile.content) return "pending";
    if (keywords.length === 0) return "pending";
    var matchCount = 0;
    for (var k = 0; k < keywords.length; k++) {
      if (hasKeyword(mcpFile.content, keywords[k])) matchCount++;
    }
    if (matchCount === keywords.length) return "handled";
    if (matchCount > 0) return "partial";
    return "pending";
  }

  // File-based recommendations: find file by targetPath, check content for keywords
  var targetPath = recommendation.targetPath;
  if (!targetPath) return "pending";

  var configFile = findConfigByPath(files, targetPath);
  if (!configFile || !configFile.exists) return "pending";
  if (keywords.length === 0) return "pending";

  var content = configFile.content || "";
  var fileMatchCount = 0;
  for (var m = 0; m < keywords.length; m++) {
    if (hasKeyword(content, keywords[m])) fileMatchCount++;
  }
  if (fileMatchCount === keywords.length) return "handled";
  if (fileMatchCount > 0) return "partial";
  return "pending";
}

function buildInstructionsSurface(metadata) {
  return metadata && metadata.format === "copilot-cli" ? "copilot-instructions.md" : "CLAUDE.md";
}

export function getTargetPath(id, format) {
  if (id === "autonomy-contract") {
    return format === "copilot-cli" ? ".github/copilot-instructions.md" : "CLAUDE.md";
  }
  if (id === "instructions-structure") {
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
  if (id === "sprint-commands") {
    return format === "copilot-cli" ? ".github/prompts/" : ".claude/commands/";
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

  var configSummary = buildConfigSummary(configFiles || [], format);

  // Collect each recommendation separately so we can assemble in desired order.
  var recInstructionsStructure = null;
  var recAutonomyContract = null;
  var recSprintCommands = null;
  var recAgentSplit = null;
  var recSubagentDraft = null;
  var recToolingUpgrade = null;

  // ─────────────────────────────────────────────
  // 1. instructions-structure
  // ─────────────────────────────────────────────
  var instructionsIsThin = !configSummary.instructionsContent
    || configSummary.instructionsContent.length < 200
    || !hasKeyword(configSummary.instructionsContent, "commands")
    || !hasKeyword(configSummary.instructionsContent, "rules");

  if (!configSummary.hasInstructions || instructionsIsThin) {
    var instructionsTargetFile = format === "copilot-cli" ? ".github/copilot-instructions.md" : "CLAUDE.md";
    var projectName = (metadata && metadata.projectName) || "this project";

    var commandsBlock = format === "copilot-cli"
      ? "See `.github/prompts/` for slash commands and `.github/extensions/` for skills."
      : "```bash\nnpm run dev    # start dev server\nnpm test       # run tests\nnpm run build  # production build\n```";

    var structureTemplate = [
      "# " + projectName + " — " + (format === "copilot-cli" ? "Copilot" : "Claude") + " context",
      "",
      "## Role & project",
      "I'm building " + projectName + ". Stack: [tech]. Repo: [path].",
      "",
      "## Commands",
      commandsBlock,
      "",
      "## Rules",
      "- Search existing code before writing new abstractions.",
      "- Run tests after every non-trivial change.",
      "- Prefer editing existing files over creating new ones.",
      "- Never silently apply config changes — surface drafts first.",
      "",
      "## Autonomous run contract",
      "- Work independently until you hit a destructive action, missing permission, or requirement conflict.",
      "- Before asking the user, finish the next obvious investigation step and summarize what you checked.",
      "- When editing code, run the narrowest relevant tests before handing back control.",
      "- If the run stalls on repeated clarification, propose one concrete plan with tradeoffs.",
    ].join("\n");

    var instructionsDraftText;
    var instructionsPriority;
    if (!configSummary.hasInstructions) {
      instructionsDraftText = "# Create " + instructionsTargetFile + "\n\n" + structureTemplate;
      instructionsPriority = "high";
    } else {
      // File exists but is thin — suggest adding missing sections
      var missingSections = [];
      if (!hasKeyword(configSummary.instructionsContent, "commands")) {
        missingSections.push("## Commands\n" + commandsBlock);
      }
      if (!hasKeyword(configSummary.instructionsContent, "rules")) {
        missingSections.push("## Rules\n- Search existing code before writing new abstractions.\n- Run tests after every non-trivial change.\n- Prefer editing existing files over creating new ones.\n- Never silently apply config changes — surface drafts first.");
      }
      var addendum = missingSections.length > 0
        ? "Add these missing sections to " + instructionsTargetFile + ":\n\n" + missingSections.join("\n\n")
        : "Expand " + instructionsTargetFile + " — it is currently too short to give Claude useful context.";
      instructionsDraftText = addendum;
      instructionsPriority = "medium";
    }

    recInstructionsStructure = {
      id: "instructions-structure",
      surface: instructionsTargetFile,
      targetPath: getTargetPath("instructions-structure", format),
      priority: instructionsPriority,
      title: "Create a proper instructions file",
      summary: "Give Claude a role, commands section, and behavioral rules so it starts with full context every session — not from zero.",
      evidence: [
        configSummary.hasInstructions
          ? instructionsTargetFile + " exists but is thin (" + (configSummary.instructionsContent || "").length + " chars)"
          : instructionsTargetFile + " does not exist yet",
        "Without it, Claude re-discovers project layout every session",
      ],
      draftText: instructionsDraftText,
      detectionKeywords: ["## Commands", "## Rules"],
    };
  }

  // ─────────────────────────────────────────────
  // 2. autonomy-contract
  // ─────────────────────────────────────────────
  var contractBullets = [
    "- Work independently until you hit a destructive action, missing permission, or a requirement conflict.",
    "- Before asking the user for help, finish the next obvious investigation step and summarize what you already checked.",
    "- When editing code, run the narrowest relevant tests or build command before handing back control.",
    "- If the run stalls on repeated clarification, propose one concrete plan with tradeoffs instead of asking an open-ended question.",
    "- Surface reviewable drafts for config or workflow changes; do not silently apply them.",
    "- Search existing code before writing new abstractions — read 3 relevant files before creating a new one.",
    "- Persist any project-specific discovery (test commands, deploy commands, tech stack) back to " + instructionsSurface + " so you never have to re-ask.",
    "- When a blocker repeats twice, switch strategies — do not ask the operator for the same information twice.",
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
    recAutonomyContract = {
      id: "autonomy-contract",
      surface: instructionsSurface,
      targetPath: getTargetPath("autonomy-contract", format),
      priority: metrics.interventionCount > 1 || metrics.babysittingTime > 60 ? "high" : "medium",
      title: "Tighten the autonomous run contract",
      summary: "Reduce operator babysitting by documenting when the agent should keep going, when it should verify, and when it should stop for review.",
      evidence: getPromptEvidence(metrics, turns),
      draftText: autonomyContractDraftText,
      detectionKeywords: ["autonomous", "search existing code before"],
    };
  }

  // ─────────────────────────────────────────────
  // 3. sprint-commands
  // ─────────────────────────────────────────────
  var hasEnoughActivity = metrics.totalToolCalls >= 4 || (metadata && metadata.totalTurns >= 2);

  if (hasEnoughActivity && !configSummary.hasCommands) {
    var reviewBody = [
      "Review all staged changes for bugs, security issues, and missing tests.",
      "For each issue found: rate severity (high/medium/low), explain the bug with a concrete exploit or failure scenario, and propose a fix.",
      "Auto-fix low-severity issues. For medium/high: show the fix and ask before applying.",
      "Finish with a summary: N issues found, M auto-fixed, K need review.",
    ].join("\n");

    var qaBody = [
      "Run the full test suite and report any failures with exact commands to reproduce.",
      "For each failure: show the failing assertion, the likely root cause, and a suggested fix.",
      "If all tests pass, confirm and report coverage if available.",
    ].join("\n");

    var shipBody = [
      "Prepare the change for shipping:",
      "1. Run tests and confirm they pass.",
      "2. Summarize what changed and why in one paragraph.",
      "3. Draft a commit message following conventional commits format.",
      "4. List any follow-up tasks or known limitations.",
    ].join("\n");

    var commandFiles;
    if (format === "copilot-cli") {
      commandFiles = [
        {
          path: ".github/prompts/review.prompt.md",
          content: "---\nmode: agent\ndescription: Review staged changes for bugs, security issues, and missing tests\ntools: ['codebase', 'terminal', 'github']\n---\n\n" + reviewBody,
        },
        {
          path: ".github/prompts/qa.prompt.md",
          content: "---\nmode: agent\ndescription: Run full test suite and report failures with reproduction steps\ntools: ['codebase', 'terminal']\n---\n\n" + qaBody,
        },
        {
          path: ".github/prompts/ship.prompt.md",
          content: "---\nmode: agent\ndescription: Prepare change for shipping with tests, summary, and commit message\ntools: ['codebase', 'terminal', 'github']\n---\n\n" + shipBody,
        },
      ];
    } else {
      commandFiles = [
        { path: ".claude/commands/review.md", content: reviewBody },
        { path: ".claude/commands/qa.md", content: qaBody },
        { path: ".claude/commands/ship.md", content: shipBody },
      ];
    }

    var sprintDraftText = commandFiles.map(function (f) {
      return "# " + f.path + "\n\n" + f.content;
    }).join("\n\n---\n\n");

    recSprintCommands = {
      id: "sprint-commands",
      surface: format === "copilot-cli" ? ".github/prompts/" : ".claude/commands/",
      targetPath: getTargetPath("sprint-commands", format),
      priority: metrics.totalToolCalls >= 4 ? "medium" : "low",
      title: "Codify your sprint as slash commands",
      summary: "Turn your review, QA, and ship steps into reusable commands so every session ends with a consistent quality gate.",
      evidence: [
        metrics.totalToolCalls + " tool call" + (metrics.totalToolCalls === 1 ? "" : "s") + " this session",
        "No existing commands found in " + (format === "copilot-cli" ? ".github/prompts/" : ".claude/commands/"),
      ],
      draftText: sprintDraftText,
      detectionKeywords: [],
    };
  }

  // ─────────────────────────────────────────────
  // 4. agent-split
  // ─────────────────────────────────────────────
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

    recAgentSplit = {
      id: "agent-split",
      surface: "AGENTS.md",
      targetPath: getTargetPath("agent-split", format),
      priority: metadata && metadata.errorCount > 0 ? "high" : "medium",
      title: "Create a lightweight execution roster",
      summary: "Codify which agent owns exploration, implementation, and verification so long runs do not bounce back to the operator.",
      evidence: getAgentEvidence(metrics, metadata || {}),
      draftText: agentSplitDraftText,
      detectionKeywords: ["scout", "builder", "verifier"],
    };
  }

  // ─────────────────────────────────────────────
  // 5. subagent-draft
  // ─────────────────────────────────────────────
  if (topToolNames.length >= 3 || metrics.totalToolCalls >= 8) {
    var subagentTargetPath = getTargetPath("subagent-draft", format);

    var scoutBody = [
      "You are a codebase scout. Explore first, never modify.",
      "",
      "## Workflow",
      "1. Search for existing patterns before proposing new structure.",
      "2. Gather the 3-5 most relevant files and their key sections.",
      "3. Run read-only commands (find, grep, cat) to understand current state.",
      "4. Identify risks and unresolved questions.",
      "",
      "## Handoff format",
      "- Key files: [paths with line numbers]",
      "- Relevant patterns: [what already exists]",
      "- Risks: [what could break]",
      "- Suggested next steps: [commands for the builder]",
      "",
      "Never ask the operator for routine repo navigation help.",
    ].join("\n");

    var subagentTemplate;
    if (format === "copilot-cli") {
      subagentTemplate = [
        "---",
        "mode: agent",
        "description: Explore codebase, gather relevant files, and assess risks before changes",
        "tools: ['codebase', 'terminal', 'github']",
        "---",
        "",
        scoutBody,
      ].join("\n");
    } else {
      subagentTemplate = [
        "---",
        "name: repo-ops-scout",
        "description: Use this agent when you need to explore the codebase, gather relevant files, and assess risks before making changes. Do NOT use for implementation.",
        "---",
        "",
        scoutBody,
      ].join("\n");
    }

    var subagentDraftText;
    if (configSummary.agentFiles.length > 0) {
      var existingNames = configSummary.agentFiles.map(function (f) {
        var parts = f.path.replace(/\\/g, "/").split("/");
        return parts[parts.length - 1];
      });
      subagentDraftText = "Existing agents: " + existingNames.join(", ") + ". New agent to add:\n\n";
      if (subagentTargetPath) {
        subagentDraftText += "# Save as: " + subagentTargetPath + "\n\n";
      }
      subagentDraftText += subagentTemplate;
    } else {
      subagentDraftText = (subagentTargetPath ? "# Save as: " + subagentTargetPath + "\n\n" : "") + subagentTemplate;
    }

    recSubagentDraft = {
      id: "subagent-draft",
      surface: "Skill / subagent draft",
      targetPath: subagentTargetPath,
      priority: metrics.interventionCount > 0 ? "medium" : "low",
      title: "Draft a repeatable repo-ops subagent",
      summary: "Package the most repetitive tool sequence into a reusable subagent prompt so the operator does not have to restate it every session.",
      evidence: [
        "Top tools: " + topToolNames.join(", "),
        metrics.totalToolCalls + " total tool call" + (metrics.totalToolCalls === 1 ? "" : "s"),
      ],
      draftText: subagentDraftText,
      detectionKeywords: ["scout", "repo-ops"],
    };
  }

  // ─────────────────────────────────────────────
  // 6. tooling-upgrade
  // ─────────────────────────────────────────────
  if (metrics.idleTime >= 30 || topToolNames.indexOf("bash") !== -1) {
    var recommendedServers = {};

    // Always recommend memory for persistent context
    recommendedServers["memory"] = {
      command: "npx",
      args: ["-y", "@anthropic/mcp-server-memory"],
      why: "gives Claude persistent context across sessions — stops it from re-asking questions you've already answered",
    };

    // bash in top tools → suggest git + filesystem
    if (topToolNames.indexOf("bash") !== -1) {
      recommendedServers["git"] = {
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-git", "--repository", "."],
        why: "native git operations (log, diff, blame) without shelling out",
      };
      recommendedServers["filesystem"] = {
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/project"],
        why: "safer file operations with explicit path restrictions",
      };
    }

    // WebFetch / web_fetch in top tools → suggest search
    if (topToolNames.indexOf("WebFetch") !== -1 || topToolNames.indexOf("web_fetch") !== -1) {
      recommendedServers["brave-search"] = {
        command: "npx",
        args: ["-y", "brave-search-mcp"],
        why: "fast web search without leaving the agent loop",
      };
    }

    // GitHub-related tools or errors → suggest github MCP
    var hasGithubTool = topToolNames.some(function (n) { return n.toLowerCase().indexOf("github") !== -1; });
    if (hasGithubTool || (metadata && metadata.errorCount > 0)) {
      recommendedServers["github"] = {
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-github"],
        why: "issue/PR access, code search, and repo metadata without browser round-trips",
      };
    }

    var mcpSnippetObj = { mcpServers: {} };
    var whyLines = [];
    var serverKeys = Object.keys(recommendedServers);
    for (var si = 0; si < serverKeys.length; si++) {
      var sKey = serverKeys[si];
      var sData = recommendedServers[sKey];
      mcpSnippetObj.mcpServers[sKey] = { command: sData.command, args: sData.args };
      whyLines.push("- " + sKey + ": " + sData.why);
    }

    var mcpJsonSnippet = JSON.stringify(mcpSnippetObj, null, 2);

    var toolingIntro;
    if (configSummary.hasMcp && configSummary.mcpServerNames.length > 0) {
      toolingIntro = "Current MCP servers: " + configSummary.mcpServerNames.join(", ") + ".\n\nRecommended additions to .mcp.json:";
    } else {
      toolingIntro = "Recommended additions to .mcp.json:";
    }

    var copilotNote = format === "copilot-cli"
      ? "\n\nFor Copilot CLI: add MCP servers in VS Code settings under `github.copilot.chat.mcp.servers` or in a `.mcp.json` at project root."
      : "";

    var toolingDraftText = [
      toolingIntro,
      "",
      mcpJsonSnippet,
      "",
      "Why:",
      whyLines.join("\n"),
      copilotNote,
    ].filter(function (l) { return l !== undefined; }).join("\n");

    recToolingUpgrade = {
      id: "tooling-upgrade",
      surface: "MCP / tooling recommendation",
      targetPath: getTargetPath("tooling-upgrade", format),
      priority: metrics.idleTime >= 90 ? "high" : "medium",
      title: "Add tooling that removes dead air",
      summary: "Reduce idle gaps by upgrading the agent's access to fast code search, workspace metadata, or safer command execution helpers.",
      evidence: getToolingEvidence(metrics),
      draftText: toolingDraftText,
      detectionKeywords: ["mcp-server-memory"],
    };
  }

  // Assemble in desired order, skipping nulls
  var recommendations = [
    recInstructionsStructure,
    recAutonomyContract,
    recSprintCommands,
    recAgentSplit,
    recSubagentDraft,
    recToolingUpgrade,
  ].filter(function (r) { return r !== null; });

  return {
    metrics: metrics,
    summary: summary,
    recommendations: recommendations,
  };
}
