import { describe, it, expect } from "vitest";
import {
  parseMarkdownSections,
  hasKeyword,
  parseMcpServerNames,
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

  it("getRelevantSurfaces returns all surfaces for null format", function () {
    expect(getRelevantSurfaces(null)).toHaveLength(KNOWN_CONFIG_SURFACES.length);
  });
});
