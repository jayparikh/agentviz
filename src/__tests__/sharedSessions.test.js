import { describe, it, expect } from "vitest";
import { readSharedSessionPreview, parseSharedSessionMarkdown } from "../../routes/sharedSessions.js";

var SAMPLE_MD = [
  "# \uD83E\uDD16 Copilot CLI Session",
  "",
  "> **Session ID:** `abc-123`",
  "> **Started:** 3/15/2026, 2:00:00 PM",
  "> **Duration:** 5m 30s",
  "> **Exported:** 3/15/2026, 2:05:30 PM",
  "",
  "<sub>\u23F1\uFE0F 0s</sub>",
  "",
  "### \u2139\uFE0F Info",
  "",
  "Welcome user (via gh)!",
  "",
  "---",
  "",
  "<sub>\u23F1\uFE0F 10s</sub>",
  "",
  "### \uD83D\uDC64 User",
  "",
  "What is the meaning of life?",
  "",
  "---",
  "",
  "<sub>\u23F1\uFE0F 12s</sub>",
  "",
  "### \uD83D\uDCAD Reasoning",
  "",
  "*The user asks a philosophical question.*",
  "",
  "---",
].join("\n");

describe("parseSharedSessionMarkdown (server-side)", function () {
  it("parses metadata fields", function () {
    var result = parseSharedSessionMarkdown(SAMPLE_MD);
    expect(result.metadata.sessionId).toBe("abc-123");
    expect(result.metadata.duration).toBe("5m 30s");
    expect(result.metadata.startedAt).toBe("3/15/2026, 2:00:00 PM");
    expect(result.metadata.exportedAt).toBe("3/15/2026, 2:05:30 PM");
  });

  it("extracts conversation turns", function () {
    var result = parseSharedSessionMarkdown(SAMPLE_MD);
    expect(result.turns.length).toBe(3);
    expect(result.turns[0].agent).toBe("system");
    expect(result.turns[1].agent).toBe("user");
    expect(result.turns[2].agent).toBe("assistant");
  });

  it("extracts turn text content", function () {
    var result = parseSharedSessionMarkdown(SAMPLE_MD);
    expect(result.turns[1].text).toBe("What is the meaning of life?");
  });

  it("handles tool call turns", function () {
    var withTool = SAMPLE_MD + "\n<sub>\u23F1\uFE0F 15s</sub>\n\n### \u2705 `grep`\n\nSearching files...\n\n---\n";
    var result = parseSharedSessionMarkdown(withTool);
    var toolTurn = result.turns.find(function (t) { return t.toolName; });
    expect(toolTurn).toBeTruthy();
    expect(toolTurn.toolName).toBe("grep");
    expect(toolTurn.track).toBe("tool_call");
  });

  it("handles empty input", function () {
    var result = parseSharedSessionMarkdown("");
    expect(result.turns.length).toBe(0);
  });
});

describe("readSharedSessionPreview", function () {
  // This function reads from disk; test with a synthetic approach
  it("is a function", function () {
    expect(typeof readSharedSessionPreview).toBe("function");
  });
});
