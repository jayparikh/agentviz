import { describe, it, expect } from "vitest";
import {
  parseMarkdownSections,
  hasKeyword,
  parseMcpServerNames,
  buildConfigSummary,
  getRelevantSurfaces,
  KNOWN_CONFIG_SURFACES,
} from "../lib/projectConfig.js";

describe("projectConfig", function () {
  it("parses markdown sections", function () {
    var content = [
      "# Heading One",
      "body line one",
      "body line two",
      "## Heading Two",
      "nested body",
      "### Heading Three",
      "deeper body",
    ].join("\n");

    var sections = parseMarkdownSections(content);

    expect(sections).toHaveLength(3);
    expect(sections[0].heading).toBe("Heading One");
    expect(sections[0].level).toBe(1);
    expect(sections[0].body).toContain("body line one");
    expect(sections[1].heading).toBe("Heading Two");
    expect(sections[1].level).toBe(2);
    expect(sections[2].heading).toBe("Heading Three");
    expect(sections[2].level).toBe(3);
    expect(sections[2].body).toContain("deeper body");
  });

  it("returns empty array when content is null or empty", function () {
    expect(parseMarkdownSections(null)).toEqual([]);
    expect(parseMarkdownSections("")).toEqual([]);
    expect(parseMarkdownSections("   ")).toEqual([]);
  });

  it("handles content with no headings", function () {
    var sections = parseMarkdownSections("just some text\nno headings here");
    expect(sections).toEqual([]);
  });

  it("detects keywords case-insensitively", function () {
    expect(hasKeyword("This is an Autonomous agent", "autonomous")).toBe(true);
    expect(hasKeyword("This is an AUTONOMOUS agent", "autonomous")).toBe(true);
    expect(hasKeyword("No matches here", "autonomous")).toBe(false);
    expect(hasKeyword("Contract details", "CONTRACT")).toBe(true);
  });

  it("returns false for null or empty content", function () {
    expect(hasKeyword(null, "test")).toBe(false);
    expect(hasKeyword("", "test")).toBe(false);
    expect(hasKeyword("something", "")).toBe(false);
    expect(hasKeyword(null, null)).toBe(false);
  });

  it("parses mcp server names from mcpServers key", function () {
    var content = JSON.stringify({
      mcpServers: {
        "filesystem": { command: "npx" },
        "github": { command: "npx" },
      },
    });
    var names = parseMcpServerNames(content);
    expect(names).toContain("filesystem");
    expect(names).toContain("github");
    expect(names).toHaveLength(2);
  });

  it("parses mcp server names from servers key", function () {
    var content = JSON.stringify({
      servers: {
        "my-server": {},
        "another-server": {},
      },
    });
    var names = parseMcpServerNames(content);
    expect(names).toContain("my-server");
    expect(names).toContain("another-server");
  });

  it("combines mcpServers and servers keys", function () {
    var content = JSON.stringify({
      mcpServers: { "server-a": {} },
      servers: { "server-b": {} },
    });
    var names = parseMcpServerNames(content);
    expect(names).toContain("server-a");
    expect(names).toContain("server-b");
    expect(names).toHaveLength(2);
  });

  it("returns empty on invalid mcp json", function () {
    expect(parseMcpServerNames("not valid json")).toEqual([]);
    expect(parseMcpServerNames("{}")).toEqual([]);
    expect(parseMcpServerNames(null)).toEqual([]);
    expect(parseMcpServerNames("")).toEqual([]);
  });

  it("builds config summary from file list", function () {
    var configFiles = [
      { id: "claude-md", path: "CLAUDE.md", exists: true, content: "# Autonomous run contract\nDo stuff." },
      { id: "mcp-json", path: ".mcp.json", exists: true, content: JSON.stringify({ mcpServers: { "brave-search": {}, "memory": {} } }) },
      { id: "claude-agents", path: ".claude/agents", exists: true, entries: [
        { path: ".claude/agents/scout.md", content: "Scout agent content" },
      ]},
      { id: "agents-md", path: "AGENTS.md", exists: false, content: null },
    ];

    var summary = buildConfigSummary(configFiles, "claude-code");

    expect(summary.hasInstructions).toBe(true);
    expect(summary.instructionsContent).toContain("Autonomous run contract");
    expect(summary.hasMcp).toBe(true);
    expect(summary.mcpServerNames).toContain("brave-search");
    expect(summary.mcpServerNames).toContain("memory");
    expect(summary.agentFiles).toHaveLength(1);
    expect(summary.agentFiles[0].path).toBe(".claude/agents/scout.md");
    expect(summary.hasAgents).toBe(true);
    expect(summary.hasAnyConfig).toBe(true);
  });

  it("builds config summary for copilot-cli format", function () {
    var configFiles = [
      { id: "copilot-instructions", path: ".github/copilot-instructions.md", exists: true, content: "# Instructions" },
      { id: "github-prompts", path: ".github/prompts", exists: true, entries: [
        { path: ".github/prompts/repo.prompt.md", content: "Scout content" },
      ]},
    ];

    var summary = buildConfigSummary(configFiles, "copilot-cli");

    expect(summary.hasInstructions).toBe(true);
    expect(summary.instructionsFile).toBe(".github/copilot-instructions.md");
    expect(summary.agentFiles).toHaveLength(1);
    expect(summary.hasAgents).toBe(true);
  });

  it("returns hasAnyConfig false when no config exists", function () {
    var configFiles = [
      { id: "claude-md", path: "CLAUDE.md", exists: false, content: null },
      { id: "mcp-json", path: ".mcp.json", exists: false, content: null },
    ];
    var summary = buildConfigSummary(configFiles, "claude-code");
    expect(summary.hasAnyConfig).toBe(false);
    expect(summary.hasInstructions).toBe(false);
    expect(summary.hasMcp).toBe(false);
  });

  it("getRelevantSurfaces filters by format", function () {
    var claudeSurfaces = getRelevantSurfaces("claude-code");
    var copilotSurfaces = getRelevantSurfaces("copilot-cli");
    var allSurfaces = getRelevantSurfaces(null);

    // claude-code should include claude-md and agents but not copilot-instructions
    var claudeIds = claudeSurfaces.map(function (s) { return s.id; });
    expect(claudeIds).toContain("claude-md");
    expect(claudeIds).toContain("agents-md"); // "both"
    expect(claudeIds).not.toContain("copilot-instructions");
    expect(claudeIds).not.toContain("github-prompts");

    // copilot-cli should include copilot-instructions but not claude-md
    var copilotIds = copilotSurfaces.map(function (s) { return s.id; });
    expect(copilotIds).toContain("copilot-instructions");
    expect(copilotIds).toContain("agents-md"); // "both"
    expect(copilotIds).not.toContain("claude-md");
    expect(copilotIds).not.toContain("mcp-json");

    // null = all surfaces
    expect(allSurfaces).toHaveLength(KNOWN_CONFIG_SURFACES.length);
  });

  it("returns hasCommands true when claude-commands has entries", function () {
    var configFiles = [
      { id: "claude-md", path: "CLAUDE.md", exists: true, content: "# Instructions" },
      { id: "claude-commands", path: ".claude/commands", exists: true, entries: [
        { path: ".claude/commands/review.md", content: "Review changes." },
      ]},
    ];
    var summary = buildConfigSummary(configFiles, "claude-code");
    expect(summary.hasCommands).toBe(true);
  });

  it("returns hasCommands true when github-prompts has entries (copilot-cli)", function () {
    var configFiles = [
      { id: "copilot-instructions", path: ".github/copilot-instructions.md", exists: true, content: "# Instructions" },
      { id: "github-prompts", path: ".github/prompts", exists: true, entries: [
        { path: ".github/prompts/review.prompt.md", content: "Review." },
      ]},
    ];
    var summary = buildConfigSummary(configFiles, "copilot-cli");
    expect(summary.hasCommands).toBe(true);
  });

  it("returns hasCommands false when no commands exist", function () {
    var configFiles = [
      { id: "claude-md", path: "CLAUDE.md", exists: true, content: "# Instructions" },
      { id: "claude-commands", path: ".claude/commands", exists: false, entries: [] },
      { id: "github-prompts", path: ".github/prompts", exists: false, entries: [] },
    ];
    var summary = buildConfigSummary(configFiles, "claude-code");
    expect(summary.hasCommands).toBe(false);
  });

  it("returns hasCommands false when commands directory is empty", function () {
    var configFiles = [
      { id: "claude-commands", path: ".claude/commands", exists: true, entries: [] },
    ];
    var summary = buildConfigSummary(configFiles, "claude-code");
    expect(summary.hasCommands).toBe(false);
  });
});
