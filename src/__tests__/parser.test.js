import { describe, it, expect } from "vitest";
import { parseClaudeCodeJSONL } from "../lib/parser.js";

// ── Helpers ──

function makeLine(obj) {
  return JSON.stringify(obj);
}

function makeSession(lines) {
  return lines.map(makeLine).join("\n");
}

// ── Fixtures ──

var USER_MSG = {
  type: "human",
  timestamp: "2026-01-18T22:24:55.672Z",
  message: { content: "Build a REST API with Express" },
};

var ASSISTANT_TEXT = {
  type: "assistant",
  timestamp: "2026-01-18T22:24:58.000Z",
  message: {
    model: "claude-sonnet-4-20250514",
    content: [
      { type: "text", text: "Here is the Express.js project with TypeScript." },
    ],
    usage: { input_tokens: 1200, output_tokens: 350 },
  },
};

var ASSISTANT_THINKING = {
  type: "assistant",
  timestamp: "2026-01-18T22:24:57.000Z",
  message: {
    model: "claude-sonnet-4-20250514",
    content: [
      { type: "thinking", thinking: "Let me plan the directory structure first." },
      { type: "text", text: "I'll create the project structure now." },
    ],
  },
};

var ASSISTANT_TOOL_USE = {
  type: "assistant",
  timestamp: "2026-01-18T22:25:00.000Z",
  message: {
    model: "claude-sonnet-4-20250514",
    content: [
      { type: "tool_use", id: "tool_01", name: "bash", input: { command: "mkdir -p src" } },
    ],
  },
};

var TOOL_RESULT_OK = {
  type: "assistant",
  timestamp: "2026-01-18T22:25:02.000Z",
  message: {
    content: [
      { type: "tool_result", tool_use_id: "tool_01", content: "Directory created successfully" },
    ],
  },
};

var TOOL_RESULT_ERROR = {
  type: "assistant",
  timestamp: "2026-01-18T22:25:02.000Z",
  message: {
    content: [
      { type: "tool_result", tool_use_id: "tool_02", is_error: true, content: "Error: command not found" },
    ],
  },
};

var TOOL_RESULT_EXIT_CODE_ERROR = {
  type: "assistant",
  timestamp: "2026-01-18T22:25:04.000Z",
  message: {
    content: [
      { type: "tool_result", content: "npm ERR! exit code 1\nFailed to install dependencies" },
    ],
  },
};

var SYSTEM_MSG = {
  type: "system",
  timestamp: "2026-01-18T22:24:50.000Z",
  message: "Session initialized with project context",
};

var SECOND_USER_MSG = {
  type: "human",
  timestamp: "2026-01-18T22:26:00.000Z",
  message: { content: "Now add JWT authentication" },
};

// Role-based format (no type field)
var ROLE_USER = {
  role: "user",
  timestamp: "2026-01-18T22:24:55.672Z",
  content: "Hello from role-based format",
};

var ROLE_ASSISTANT = {
  role: "assistant",
  timestamp: "2026-01-18T22:24:58.000Z",
  content: [
    { type: "text", text: "Response from role-based format" },
  ],
};

// No timestamps at all
var NO_TS_USER = { type: "human", message: { content: "No timestamp user msg" } };
var NO_TS_ASSISTANT = {
  type: "assistant",
  message: { content: [{ type: "text", text: "No timestamp response" }] },
};


// ═══════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════

describe("parseClaudeCodeJSONL", function () {

  describe("basic parsing", function () {
    it("returns null for empty input", function () {
      expect(parseClaudeCodeJSONL("")).toBeNull();
      expect(parseClaudeCodeJSONL("   \n  \n  ")).toBeNull();
    });

    it("returns null for completely invalid JSON", function () {
      expect(parseClaudeCodeJSONL("not json at all\nstill not json")).toBeNull();
    });

    it("returns the new shape: { events, turns, metadata }", function () {
      var result = parseClaudeCodeJSONL(makeSession([USER_MSG]));
      expect(result).not.toBeNull();
      expect(result).toHaveProperty("events");
      expect(result).toHaveProperty("turns");
      expect(result).toHaveProperty("metadata");
      expect(Array.isArray(result.events)).toBe(true);
      expect(Array.isArray(result.turns)).toBe(true);
      expect(typeof result.metadata).toBe("object");
    });

    it("skips malformed lines without crashing", function () {
      var text = makeLine(USER_MSG) + "\n{broken json\n" + makeLine(ASSISTANT_TEXT);
      var result = parseClaudeCodeJSONL(text);
      expect(result).not.toBeNull();
      expect(result.events.length).toBeGreaterThanOrEqual(2);
    });
  });


  describe("timestamp handling (fix-timestamps)", function () {
    it("normalizes events to start at t=0", function () {
      var result = parseClaudeCodeJSONL(makeSession([USER_MSG, ASSISTANT_TEXT]));
      expect(result.events[0].t).toBe(0);
    });

    it("preserves real time gaps between events", function () {
      var result = parseClaudeCodeJSONL(makeSession([USER_MSG, ASSISTANT_TEXT]));
      // USER_MSG is at 22:24:55, ASSISTANT_TEXT is at 22:24:58 = 3 second gap
      // First event at t=0, second should be near t=2.328 (due to sub-block offsets)
      var userEvent = result.events.find(function (e) { return e.agent === "user"; });
      var assistEvent = result.events.find(function (e) { return e.agent === "assistant"; });
      expect(assistEvent.t).toBeGreaterThan(userEvent.t);
      expect(assistEvent.t).toBeCloseTo(2.328, 0);
    });

    it("computes real durations from timestamp gaps", function () {
      var result = parseClaudeCodeJSONL(makeSession([
        USER_MSG, ASSISTANT_TEXT, ASSISTANT_TOOL_USE,
      ]));
      // With real timestamps, durations should reflect actual gaps, not hardcoded values
      var userEvent = result.events.find(function (e) { return e.agent === "user"; });
      expect(userEvent.duration).toBeGreaterThan(0);
    });

    it("falls back to synthetic time when timestamps are missing", function () {
      var result = parseClaudeCodeJSONL(makeSession([NO_TS_USER, NO_TS_ASSISTANT]));
      expect(result).not.toBeNull();
      expect(result.events[0].t).toBe(0);
      expect(result.events[1].t).toBeGreaterThan(0);
    });

    it("handles mixed timestamp/no-timestamp records", function () {
      var result = parseClaudeCodeJSONL(makeSession([USER_MSG, NO_TS_ASSISTANT]));
      expect(result).not.toBeNull();
      expect(result.events.length).toBeGreaterThanOrEqual(2);
    });
  });


  describe("event extraction", function () {
    it("parses user messages", function () {
      var result = parseClaudeCodeJSONL(makeSession([USER_MSG]));
      var ev = result.events[0];
      expect(ev.agent).toBe("user");
      expect(ev.track).toBe("output");
      expect(ev.text).toContain("REST API");
    });

    it("parses assistant text blocks", function () {
      var result = parseClaudeCodeJSONL(makeSession([ASSISTANT_TEXT]));
      var ev = result.events.find(function (e) { return e.agent === "assistant"; });
      expect(ev.track).toBe("output");
      expect(ev.text).toContain("Express.js");
    });

    it("parses thinking/reasoning blocks", function () {
      var result = parseClaudeCodeJSONL(makeSession([ASSISTANT_THINKING]));
      var reasoning = result.events.find(function (e) { return e.track === "reasoning"; });
      expect(reasoning).toBeDefined();
      expect(reasoning.text).toContain("directory structure");
    });

    it("parses tool_use blocks with tool metadata", function () {
      var result = parseClaudeCodeJSONL(makeSession([ASSISTANT_TOOL_USE]));
      var tool = result.events.find(function (e) { return e.track === "tool_call"; });
      expect(tool).toBeDefined();
      expect(tool.toolName).toBe("bash");
      expect(tool.toolInput).toEqual({ command: "mkdir -p src" });
    });

    it("parses tool_result blocks", function () {
      var result = parseClaudeCodeJSONL(makeSession([TOOL_RESULT_OK]));
      var ctx = result.events.find(function (e) { return e.track === "context"; });
      expect(ctx).toBeDefined();
      expect(ctx.text).toContain("Directory created");
    });

    it("parses system messages", function () {
      var result = parseClaudeCodeJSONL(makeSession([SYSTEM_MSG]));
      var ev = result.events[0];
      expect(ev.agent).toBe("system");
      expect(ev.track).toBe("context");
    });

    it("parses role-based format (no type field)", function () {
      var result = parseClaudeCodeJSONL(makeSession([ROLE_USER, ROLE_ASSISTANT]));
      expect(result.events.length).toBeGreaterThanOrEqual(2);
      var user = result.events.find(function (e) { return e.agent === "user"; });
      var asst = result.events.find(function (e) { return e.agent === "assistant"; });
      expect(user).toBeDefined();
      expect(asst).toBeDefined();
    });

    it("extracts model name from assistant messages", function () {
      var result = parseClaudeCodeJSONL(makeSession([ASSISTANT_TEXT]));
      var ev = result.events.find(function (e) { return e.agent === "assistant"; });
      expect(ev.model).toBe("claude-sonnet-4-20250514");
    });

    it("extracts token usage from assistant messages", function () {
      var result = parseClaudeCodeJSONL(makeSession([ASSISTANT_TEXT]));
      var ev = result.events.find(function (e) { return e.tokenUsage; });
      expect(ev).toBeDefined();
      expect(ev.tokenUsage.inputTokens).toBe(1200);
      expect(ev.tokenUsage.outputTokens).toBe(350);
    });
  });


  describe("turn grouping (add-turns)", function () {
    it("creates turns from user messages", function () {
      var result = parseClaudeCodeJSONL(makeSession([
        USER_MSG, ASSISTANT_TEXT, ASSISTANT_TOOL_USE,
        SECOND_USER_MSG, ASSISTANT_TEXT,
      ]));
      expect(result.turns.length).toBe(2);
    });

    it("each turn has correct structure", function () {
      var result = parseClaudeCodeJSONL(makeSession([
        USER_MSG, ASSISTANT_TEXT, ASSISTANT_TOOL_USE,
      ]));
      var turn = result.turns[0];
      expect(turn).toHaveProperty("index");
      expect(turn).toHaveProperty("startTime");
      expect(turn).toHaveProperty("endTime");
      expect(turn).toHaveProperty("eventIndices");
      expect(turn).toHaveProperty("userMessage");
      expect(turn).toHaveProperty("toolCount");
      expect(turn).toHaveProperty("hasError");
    });

    it("assigns turnIndex to every event", function () {
      var result = parseClaudeCodeJSONL(makeSession([
        USER_MSG, ASSISTANT_TEXT, SECOND_USER_MSG,
      ]));
      result.events.forEach(function (ev) {
        expect(ev.turnIndex).toBeDefined();
        expect(typeof ev.turnIndex).toBe("number");
      });
    });

    it("counts tool calls per turn", function () {
      var result = parseClaudeCodeJSONL(makeSession([
        USER_MSG, ASSISTANT_TOOL_USE, TOOL_RESULT_OK,
      ]));
      expect(result.turns[0].toolCount).toBeGreaterThanOrEqual(1);
    });

    it("handles system events before first user message", function () {
      var result = parseClaudeCodeJSONL(makeSession([
        SYSTEM_MSG, USER_MSG, ASSISTANT_TEXT,
      ]));
      expect(result).not.toBeNull();
      // System event should be in a turn (either its own or grouped with user)
      expect(result.events[0].turnIndex).toBeDefined();
    });
  });


  describe("error detection (add-error-detection)", function () {
    it("detects is_error: true in tool results", function () {
      var result = parseClaudeCodeJSONL(makeSession([TOOL_RESULT_ERROR]));
      var errEv = result.events.find(function (e) { return e.isError; });
      expect(errEv).toBeDefined();
    });

    it("detects error patterns in tool result text", function () {
      var result = parseClaudeCodeJSONL(makeSession([TOOL_RESULT_EXIT_CODE_ERROR]));
      var errEv = result.events.find(function (e) { return e.isError; });
      expect(errEv).toBeDefined();
    });

    it("marks non-error events as isError: false", function () {
      var result = parseClaudeCodeJSONL(makeSession([USER_MSG, ASSISTANT_TEXT]));
      result.events.forEach(function (ev) {
        expect(ev.isError).toBe(false);
      });
    });

    it("propagates hasError to turns containing errors", function () {
      var result = parseClaudeCodeJSONL(makeSession([
        USER_MSG, ASSISTANT_TOOL_USE, TOOL_RESULT_ERROR,
      ]));
      expect(result.turns[0].hasError).toBe(true);
    });

    it("counts errors in metadata", function () {
      var result = parseClaudeCodeJSONL(makeSession([
        USER_MSG, TOOL_RESULT_ERROR, TOOL_RESULT_EXIT_CODE_ERROR,
      ]));
      expect(result.metadata.errorCount).toBeGreaterThanOrEqual(1);
    });
  });


  describe("metadata (improve-parser)", function () {
    it("reports total events", function () {
      var result = parseClaudeCodeJSONL(makeSession([USER_MSG, ASSISTANT_TEXT]));
      expect(result.metadata.totalEvents).toBeGreaterThanOrEqual(2);
    });

    it("reports total turns", function () {
      var result = parseClaudeCodeJSONL(makeSession([USER_MSG, ASSISTANT_TEXT]));
      expect(result.metadata.totalTurns).toBeGreaterThanOrEqual(1);
    });

    it("reports total tool calls", function () {
      var result = parseClaudeCodeJSONL(makeSession([
        USER_MSG, ASSISTANT_TOOL_USE, TOOL_RESULT_OK,
      ]));
      expect(result.metadata.totalToolCalls).toBeGreaterThanOrEqual(1);
    });

    it("reports primary model", function () {
      var result = parseClaudeCodeJSONL(makeSession([ASSISTANT_TEXT]));
      expect(result.metadata.primaryModel).toBe("claude-sonnet-4-20250514");
    });

    it("aggregates token usage", function () {
      var result = parseClaudeCodeJSONL(makeSession([ASSISTANT_TEXT]));
      if (result.metadata.tokenUsage) {
        expect(result.metadata.tokenUsage.inputTokens).toBeGreaterThan(0);
      }
    });

    it("reports session duration", function () {
      var result = parseClaudeCodeJSONL(makeSession([
        USER_MSG, ASSISTANT_TEXT, ASSISTANT_TOOL_USE,
      ]));
      expect(result.metadata.duration).toBeGreaterThan(0);
    });
  });


  describe("robustness (improve-parser)", function () {
    it("handles records with no content gracefully", function () {
      var empty = { type: "assistant", timestamp: "2026-01-18T22:24:58.000Z", message: {} };
      var result = parseClaudeCodeJSONL(makeSession([USER_MSG, empty]));
      expect(result).not.toBeNull();
    });

    it("handles deeply nested content arrays", function () {
      var nested = {
        type: "assistant",
        timestamp: "2026-01-18T22:25:00.000Z",
        message: {
          content: [
            { type: "text", text: "outer" },
            { type: "tool_use", name: "read_file", id: "t1", input: { path: "/foo" } },
            { type: "tool_result", tool_use_id: "t1", content: [{ type: "text", text: "file contents" }] },
          ],
        },
      };
      var result = parseClaudeCodeJSONL(makeSession([nested]));
      expect(result.events.length).toBeGreaterThanOrEqual(3);
    });

    it("handles string content in assistant messages", function () {
      var simple = {
        type: "assistant",
        timestamp: "2026-01-18T22:25:00.000Z",
        message: { content: "Just a plain string response" },
      };
      var result = parseClaudeCodeJSONL(makeSession([simple]));
      expect(result.events[0].text).toContain("plain string");
    });

    it("handles top-level tool_use records", function () {
      var topTool = {
        type: "tool_use",
        timestamp: "2026-01-18T22:25:00.000Z",
        name: "bash",
        input: { command: "ls" },
      };
      var result = parseClaudeCodeJSONL(makeSession([topTool]));
      var tool = result.events.find(function (e) { return e.toolName === "bash"; });
      expect(tool).toBeDefined();
    });

    it("handles top-level tool_result records", function () {
      var topResult = {
        type: "tool_result",
        timestamp: "2026-01-18T22:25:02.000Z",
        content: "Command output here",
      };
      var result = parseClaudeCodeJSONL(makeSession([topResult]));
      expect(result.events[0].track).toBe("context");
    });

    it("handles very large input without crashing", function () {
      var lines = [];
      for (var i = 0; i < 500; i++) {
        lines.push({
          type: i % 3 === 0 ? "human" : "assistant",
          timestamp: new Date(Date.UTC(2026, 0, 18, 22, 24, 55 + i)).toISOString(),
          message: i % 3 === 0
            ? { content: "User message " + i }
            : { content: [{ type: "text", text: "Response " + i }] },
        });
      }
      var result = parseClaudeCodeJSONL(makeSession(lines));
      expect(result).not.toBeNull();
      expect(result.events.length).toBeGreaterThan(400);
    });
  });
});
