/**
 * projectConfig.js
 *
 * Utilities for reading and summarising project configuration surfaces.
 * Supports both claude-code (CLAUDE.md, .claude/) and copilot-cli (.github/) layouts.
 */

// Known config surfaces. Each entry has:
//   id: unique key
//   path: file path relative to project root (or directory path)
//   glob: glob pattern suffix for directories (or null for single files)
//   label: display label
//   format: "claude-code" | "copilot-cli" | "both"
//   type: "instructions" | "agents" | "skills" | "mcp" | "settings" | "roster"
export var KNOWN_CONFIG_SURFACES = [
  // Instructions / memory layer
  { id: "claude-md",            path: "CLAUDE.md",                       glob: null,          label: "CLAUDE.md",                 format: "claude-code",  type: "instructions" },
  { id: "copilot-instructions", path: ".github/copilot-instructions.md", glob: null,          label: "copilot-instructions.md",   format: "copilot-cli",  type: "instructions" },
  // Agent roster file (both assistants support this)
  { id: "agents-md",            path: "AGENTS.md",                       glob: null,          label: "AGENTS.md",                 format: "both",         type: "roster" },
  // Claude Code: subagents, rules, slash commands, skills, settings
  { id: "claude-agents",        path: ".claude/agents",                  glob: "*.md",        label: ".claude/agents/",           format: "claude-code",  type: "agents" },
  { id: "claude-commands",      path: ".claude/commands",                glob: "*.md",        label: ".claude/commands/",         format: "claude-code",  type: "commands" },
  { id: "claude-rules",         path: ".claude/rules",                   glob: "*.md",        label: ".claude/rules/",            format: "claude-code",  type: "instructions" },
  { id: "claude-skills",        path: ".claude/skills",                  glob: null,          label: ".claude/skills/",           format: "claude-code",  type: "skills" },
  { id: "mcp-json",             path: ".mcp.json",                       glob: null,          label: ".mcp.json",                 format: "claude-code",  type: "mcp" },
  { id: "claude-settings",      path: ".claude/settings.json",           glob: null,          label: ".claude/settings.json",     format: "claude-code",  type: "settings" },
  // Copilot CLI: prompt templates and extensions
  { id: "github-prompts",       path: ".github/prompts",                 glob: "*.prompt.md", label: ".github/prompts/",          format: "copilot-cli",  type: "skills" },
  { id: "github-extensions",    path: ".github/extensions",              glob: "*.yml",       label: ".github/extensions/",       format: "copilot-cli",  type: "skills" },
];

/**
 * Returns surfaces relevant to a given format.
 * @param {string|null|undefined} format - "claude-code" | "copilot-cli" | null/undefined = all
 * @returns {Array}
 */
export function getRelevantSurfaces(format) {
  if (!format) return KNOWN_CONFIG_SURFACES.slice();
  return KNOWN_CONFIG_SURFACES.filter(function (surface) {
    return surface.format === format || surface.format === "both";
  });
}

/**
 * Parses markdown content into sections.
 * @param {string|null} content
 * @returns {Array<{ heading: string, level: number, body: string }>}
 */
export function parseMarkdownSections(content) {
  if (!content) return [];
  var lines = content.split("\n");
  var sections = [];
  var current = null;

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var headingMatch = line.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      if (current) sections.push(current);
      current = { heading: headingMatch[2].trim(), level: headingMatch[1].length, body: "" };
    } else if (current) {
      current.body = current.body ? current.body + "\n" + line : line;
    }
  }

  if (current) sections.push(current);
  return sections;
}

/**
 * Returns true if content contains keyword (case-insensitive).
 * @param {string|null} content
 * @param {string} keyword
 * @returns {boolean}
 */
export function hasKeyword(content, keyword) {
  if (!content || !keyword) return false;
  return content.toLowerCase().indexOf(keyword.toLowerCase()) !== -1;
}

/**
 * Parses .mcp.json content and returns server names as string[].
 * @param {string|null} content
 * @returns {string[]}
 */
export function parseMcpServerNames(content) {
  if (!content) return [];
  try {
    var parsed = JSON.parse(content);
    var names = [];
    if (parsed.mcpServers && typeof parsed.mcpServers === "object") {
      names = names.concat(Object.keys(parsed.mcpServers));
    }
    if (parsed.servers && typeof parsed.servers === "object") {
      names = names.concat(Object.keys(parsed.servers));
    }
    return names;
  } catch (e) {
    return [];
  }
}

/**
 * Finds a config file result by surface id.
 * @param {Array} configFiles
 * @param {string} id
 * @returns {object|null}
 */
function findById(configFiles, id) {
  if (!configFiles) return null;
  for (var i = 0; i < configFiles.length; i++) {
    if (configFiles[i].id === id) return configFiles[i];
  }
  return null;
}

/**
 * Given configFiles array (from /api/config response), returns a summary object.
 * @param {Array} configFiles
 * @param {string|null} format - "claude-code" | "copilot-cli"
 * @returns {{
 *   instructionsContent: string|null,
 *   agentFiles: Array<{ path: string, content: string }>,
 *   skillFiles: Array<{ path: string, content: string }>,
 *   mcpServerNames: string[],
 *   hasInstructions: boolean,
 *   hasAgents: boolean,
 *   hasCommands: boolean,
 *   hasSkills: boolean,
 *   hasMcp: boolean,
 *   hasAnyConfig: boolean,
 * }}
 */
export function buildConfigSummary(configFiles, format) {
  var files = configFiles || [];

  // Instructions: CLAUDE.md for claude-code, copilot-instructions.md for copilot-cli
  var instructionsId = format === "copilot-cli" ? "copilot-instructions" : "claude-md";
  var instructionsResult = findById(files, instructionsId);
  var instructionsContent = (instructionsResult && instructionsResult.exists && instructionsResult.content)
    ? instructionsResult.content
    : null;

  // Agents: from claude-agents (claude-code) or github-prompts (copilot-cli)
  var agentFiles = [];
  var claudeAgentsResult = findById(files, "claude-agents");
  if (claudeAgentsResult && claudeAgentsResult.exists && claudeAgentsResult.entries) {
    for (var i = 0; i < claudeAgentsResult.entries.length; i++) {
      agentFiles.push(claudeAgentsResult.entries[i]);
    }
  }
  var githubPromptsResult = findById(files, "github-prompts");
  if (githubPromptsResult && githubPromptsResult.exists && githubPromptsResult.entries) {
    for (var j = 0; j < githubPromptsResult.entries.length; j++) {
      agentFiles.push(githubPromptsResult.entries[j]);
    }
  }

  // Commands: from claude-commands (claude-code) or github-prompts (copilot-cli)
  var claudeCommandsResult = findById(files, "claude-commands");
  var hasClaudeCommands = Boolean(claudeCommandsResult && claudeCommandsResult.exists && claudeCommandsResult.entries && claudeCommandsResult.entries.length > 0);
  // github-prompts doubles as both agents and commands for copilot-cli
  var hasGithubPromptCommands = Boolean(githubPromptsResult && githubPromptsResult.exists && githubPromptsResult.entries && githubPromptsResult.entries.length > 0);
  var hasCommands = hasClaudeCommands || hasGithubPromptCommands;

  // Skills: from github-extensions
  var skillFiles = [];
  var githubExtResult = findById(files, "github-extensions");
  if (githubExtResult && githubExtResult.exists && githubExtResult.entries) {
    for (var k = 0; k < githubExtResult.entries.length; k++) {
      skillFiles.push(githubExtResult.entries[k]);
    }
  }

  // MCP servers: from .mcp.json
  var mcpResult = findById(files, "mcp-json");
  var mcpServerNames = (mcpResult && mcpResult.exists && mcpResult.content)
    ? parseMcpServerNames(mcpResult.content)
    : [];

  // AGENTS.md for hasAgents
  var agentsMdResult = findById(files, "agents-md");
  var hasAgentsMd = Boolean(agentsMdResult && agentsMdResult.exists && agentsMdResult.content);

  var hasInstructions = Boolean(instructionsContent);
  var hasAgents = hasAgentsMd || agentFiles.length > 0;
  var hasSkills = skillFiles.length > 0;
  var hasMcp = mcpServerNames.length > 0;
  var hasAnyConfig = hasInstructions || hasAgents || hasSkills || hasMcp;

  return {
    instructionsContent: instructionsContent,
    instructionsFile: instructionsId === "copilot-instructions" ? ".github/copilot-instructions.md" : "CLAUDE.md",
    agentsMdContent: hasAgentsMd ? agentsMdResult.content : null,
    agentFiles: agentFiles,
    skillFiles: skillFiles,
    mcpServerNames: mcpServerNames,
    hasInstructions: hasInstructions,
    hasAgents: hasAgents,
    hasCommands: hasCommands,
    hasSkills: hasSkills,
    hasMcp: hasMcp,
    hasAnyConfig: hasAnyConfig,
  };
}
