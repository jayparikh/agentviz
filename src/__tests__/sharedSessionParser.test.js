import { describe, it, expect } from "vitest";
import { parseSharedMarkdown } from "../lib/sharedSessionParser.js";

var SAMPLE_SHARED_SESSION = [
  "# \uD83E\uDD16 Copilot CLI Session",
  "",
  "> **Session ID:** `57588cd3-d08d-4cd9-b0e8-8a28601305ec`",
  "> **Started:** 1/22/2026, 11:05:28 AM",
  "> **Duration:** 274m 2s",
  "> **Exported:** 1/22/2026, 3:39:30 PM",
  "",
  "<sub>\u23F1\uFE0F 0s</sub>",
  "",
  "### \u2139\uFE0F Info",
  "",
  "Welcome spboyer (via gh)!",
  "",
  "---",
  "",
  "<sub>\u23F1\uFE0F 1s</sub>",
  "",
  "### \u2139\uFE0F Info",
  "",
  "Configured MCP servers: azure-mcp",
  "",
  "---",
  "",
  "<sub>\u23F1\uFE0F 272m 41s</sub>",
  "",
  "### \uD83D\uDC64 User",
  "",
  "can you list the top 10 repos in my profile",
  "",
  "---",
  "",
  "<sub>\u23F1\uFE0F 272m 45s</sub>",
  "",
  "### \uD83D\uDCAD Reasoning",
  "",
  "*The user wants to list the top 10 repositories in their GitHub profile.*",
  "",
  "---",
  "",
  "<sub>\u23F1\uFE0F 272m 59s</sub>",
  "",
  "### \u2705 `bash`",
  "",
  "**List top 10 repos by stars**",
  "",
  "$ gh repo list --limit 10",
  "",
  "<details>",
  "<summary>15 lines</summary>",
  "",
  "```",
  "spboyer/agentviz     Session replay visualizer",
  "spboyer/waza         CLI for Agent Skills",
  "```",
  "",
  "</details>",
  "",
  "---",
].join("\n");

describe("parseSharedMarkdown", function () {
  it("returns null for empty input", function () {
    expect(parseSharedMarkdown("")).toBe(null);
    expect(parseSharedMarkdown(null)).toBe(null);
    expect(parseSharedMarkdown(undefined)).toBe(null);
  });

  it("returns null for non-shared-session text", function () {
    expect(parseSharedMarkdown("# Some other markdown doc\n\nHello world")).toBe(null);
    expect(parseSharedMarkdown('{"type":"user.message"}')).toBe(null);
  });

  it("parses metadata from header", function () {
    var result = parseSharedMarkdown(SAMPLE_SHARED_SESSION);
    expect(result).not.toBe(null);
    expect(result.metadata.sessionId).toBe("57588cd3-d08d-4cd9-b0e8-8a28601305ec");
    expect(result.metadata.format).toBe("shared-md");
  });

  it("extracts events from sections", function () {
    var result = parseSharedMarkdown(SAMPLE_SHARED_SESSION);
    expect(result.events.length).toBeGreaterThanOrEqual(4);
  });

  it("identifies agent types correctly", function () {
    var result = parseSharedMarkdown(SAMPLE_SHARED_SESSION);
    var agents = result.events.map(function (e) { return e.agent; });
    expect(agents).toContain("user");
    expect(agents).toContain("assistant");
    expect(agents).toContain("system");
  });

  it("identifies track types correctly", function () {
    var result = parseSharedMarkdown(SAMPLE_SHARED_SESSION);
    var tracks = result.events.map(function (e) { return e.track; });
    expect(tracks).toContain("context"); // user
    expect(tracks).toContain("reasoning"); // reasoning
    expect(tracks).toContain("tool_call"); // bash
    expect(tracks).toContain("output"); // info
  });

  it("parses tool names from backtick headers", function () {
    var result = parseSharedMarkdown(SAMPLE_SHARED_SESSION);
    var toolEvents = result.events.filter(function (e) { return e.toolName; });
    expect(toolEvents.length).toBeGreaterThan(0);
    expect(toolEvents[0].toolName).toBe("bash");
  });

  it("parses timestamps as seconds", function () {
    var result = parseSharedMarkdown(SAMPLE_SHARED_SESSION);
    // First info event should be at t=0
    expect(result.events[0].t).toBe(0);
    // User event at 272m 41s = 16361s
    var userEvent = result.events.find(function (e) { return e.agent === "user"; });
    expect(userEvent.t).toBe(272 * 60 + 41);
  });

  it("builds turns from user messages", function () {
    var result = parseSharedMarkdown(SAMPLE_SHARED_SESSION);
    expect(result.turns.length).toBeGreaterThan(0);
  });

  it("strips details/summary wrappers from tool output", function () {
    var result = parseSharedMarkdown(SAMPLE_SHARED_SESSION);
    var toolEvent = result.events.find(function (e) { return e.toolName === "bash"; });
    expect(toolEvent.text).not.toContain("<details>");
    expect(toolEvent.text).not.toContain("<summary>");
  });

  it("sets metadata.totalEvents and totalToolCalls", function () {
    var result = parseSharedMarkdown(SAMPLE_SHARED_SESSION);
    expect(result.metadata.totalEvents).toBe(result.events.length);
    expect(result.metadata.totalToolCalls).toBeGreaterThan(0);
  });

  it("handles duration parsing", function () {
    var result = parseSharedMarkdown(SAMPLE_SHARED_SESSION);
    // 274m 2s = 16442s
    expect(result.metadata.duration).toBe(274 * 60 + 2);
  });

  it("detects error events", function () {
    var withError = SAMPLE_SHARED_SESSION + "\n<sub>\u23F1\uFE0F 273m 0s</sub>\n\n### \u2705 `bash`\n\nError: command failed\n<exited with exit code 1>\n\n---\n";
    var result = parseSharedMarkdown(withError);
    var errors = result.events.filter(function (e) { return e.isError; });
    expect(errors.length).toBeGreaterThan(0);
  });
});
