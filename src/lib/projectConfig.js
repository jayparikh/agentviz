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
  // Copilot CLI: prompt templates, skills, and extensions
  { id: "github-prompts",       path: ".github/prompts",                 glob: "*.prompt.md", label: ".github/prompts/",          format: "copilot-cli",  type: "skills" },
  { id: "github-skills",        path: ".github/skills",                  glob: null,          label: ".github/skills/",           format: "copilot-cli",  type: "skills" },
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
 * Extracts skill names from a github-skills result (subdirectory listing with SKILL.md entries).
 * Also works for claude-skills entries array.
 * @param {object|null} result - config surface result with entries[]
 * @returns {string[]}
 */
export function parseSkillNames(result) {
  if (!result || !result.exists) return [];
  // entries are { path, content } where path is e.g. ".github/skills/foo/SKILL.md"
  if (result.entries && result.entries.length > 0) {
    return result.entries.map(function (e) {
      // Extract skill name from frontmatter `name:` field, fall back to directory name
      var nameMatch = e.content && e.content.match(/^name:\s*(.+)$/m);
      if (nameMatch) return nameMatch[1].trim();
      var parts = e.path.replace(/\\/g, "/").split("/");
      // For paths like .github/skills/foo/SKILL.md, the skill name is the second-to-last segment
      if (parts.length >= 2) return parts[parts.length - 2];
      return parts[parts.length - 1].replace(/\.(md|yml)$/, "");
    });
  }
  // Directory scan result with subdirNames
  if (result.subdirNames && result.subdirNames.length > 0) return result.subdirNames;
  return [];
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
