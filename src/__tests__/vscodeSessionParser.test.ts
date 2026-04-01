import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { detectVSCodeChat, parseVSCodeChatJSON } from "../lib/vscodeSessionParser";
import { detectFormat, parseSession } from "../lib/parseSession";

var FIXTURE = readFileSync(join(__dirname, "../../test-files/test-vscode-chat.json"), "utf8");

describe("detectVSCodeChat", function () {
  it("detects valid VS Code session JSON", function () {
    expect(detectVSCodeChat(FIXTURE)).toBe(true);
  });

  it("detects JSONL wrapper format", function () {
    var session = JSON.parse(FIXTURE);
    var wrapped = JSON.stringify({ kind: 0, v: session });
    expect(detectVSCodeChat(wrapped)).toBe(true);
  });

  it("rejects Claude Code JSONL", function () {
    var claudeJSONL = '{"type":"human","message":{"content":"hello"}}\n{"type":"assistant","message":{"content":[{"type":"text","text":"hi"}]}}';
    expect(detectVSCodeChat(claudeJSONL)).toBe(false);
  });

  it("rejects Copilot CLI JSONL", function () {
    var copilotJSONL = '{"type":"session.start","data":{"producer":"copilot-agent"},"timestamp":"2026-03-18T15:00:00.000Z"}';
    expect(detectVSCodeChat(copilotJSONL)).toBe(false);
  });

  it("rejects empty input", function () {
    expect(detectVSCodeChat("")).toBe(false);
    expect(detectVSCodeChat("{}")).toBe(false);
  });

  it("rejects object missing required fields", function () {
    expect(detectVSCodeChat('{"version":3,"requests":[]}')).toBe(false);
    expect(detectVSCodeChat('{"version":3,"sessionId":"x"}')).toBe(false);
  });
});

describe("detectFormat routing", function () {
  it("routes VS Code JSON to vscode-chat", function () {
    expect(detectFormat(FIXTURE)).toBe("vscode-chat");
  });

  it("routes Copilot CLI before VS Code", function () {
    var copilotJSONL = '{"type":"session.start","data":{"producer":"copilot-agent"},"timestamp":"2026-03-18T15:00:00.000Z"}';
    expect(detectFormat(copilotJSONL)).toBe("copilot-cli");
  });
});

describe("parseVSCodeChatJSON", function () {
  var result = parseVSCodeChatJSON(FIXTURE);

  it("returns non-null result", function () {
    expect(result).not.toBeNull();
  });

  it("parses correct number of turns", function () {
    expect(result.turns.length).toBe(3);
  });

  it("assigns correct turn indices", function () {
    expect(result.turns[0].index).toBe(0);
    expect(result.turns[1].index).toBe(1);
    expect(result.turns[2].index).toBe(2);
  });

  it("captures user messages", function () {
    expect(result.turns[0].userMessage).toBe("Refactor the auth module to use JWT tokens");
    expect(result.turns[1].userMessage).toBe("Now add refresh token support");
    expect(result.turns[2].userMessage).toBe("Clean up unused imports");
  });

  it("sets format to vscode-chat", function () {
    expect(result.metadata.format).toBe("vscode-chat");
  });

  it("detects correct primary model", function () {
    expect(result.metadata.primaryModel).toBe("copilot/claude-opus-4.6");
  });

  it("counts tool calls correctly", function () {
    expect(result.metadata.totalToolCalls).toBeGreaterThanOrEqual(8);
  });

  it("detects errors", function () {
    expect(result.metadata.errorCount).toBeGreaterThan(0);
  });

  it("has null tokenUsage", function () {
    expect(result.metadata.tokenUsage).toBeNull();
  });

  it("extracts customTitle", function () {
    expect(result.metadata.customTitle).toBe("Refactor auth module");
  });

  it("extracts sessionMode", function () {
    expect(result.metadata.sessionMode).toBe("agent");
  });
});

describe("event mapping", function () {
  var result = parseVSCodeChatJSON(FIXTURE);
  var events = result.events;

  it("includes user message events", function () {
    var userEvents = events.filter(function (e) { return e.agent === "user"; });
    expect(userEvents.length).toBe(3);
  });

  it("includes thinking/reasoning events", function () {
    var reasoning = events.filter(function (e) { return e.track === "reasoning"; });
    expect(reasoning.length).toBeGreaterThanOrEqual(2);
  });

  it("includes tool_call events", function () {
    var toolCalls = events.filter(function (e) { return e.track === "tool_call"; });
    expect(toolCalls.length).toBeGreaterThanOrEqual(8);
  });

  it("includes output events", function () {
    var outputs = events.filter(function (e) { return e.track === "output" && e.agent === "assistant"; });
    expect(outputs.length).toBeGreaterThan(0);
  });

  it("includes context events", function () {
    var contexts = events.filter(function (e) { return e.track === "context"; });
    expect(contexts.length).toBeGreaterThan(0);
  });

  it("extracts tool names correctly", function () {
    var toolCalls = events.filter(function (e) { return e.track === "tool_call" && e.toolName; });
    var toolNames = toolCalls.map(function (e) { return e.toolName; });
    expect(toolNames).toContain("readFile");
    expect(toolNames).toContain("findTextInFiles");
    expect(toolNames).toContain("createFile");
    expect(toolNames).toContain("run_in_terminal");
    expect(toolNames).toContain("file_edit");
  });

  it("detects terminal tool errors by exit code", function () {
    var termErrors = events.filter(function (e) {
      return e.toolName === "run_in_terminal" && e.isError;
    });
    expect(termErrors.length).toBeGreaterThanOrEqual(1);
  });

  it("detects user-rejected tool call as error", function () {
    var rejected = events.filter(function (e) {
      return e.toolName === "replaceString" && e.isError;
    });
    expect(rejected.length).toBeGreaterThanOrEqual(1);
  });

  it("maps textEditGroup to file_edit tool", function () {
    var fileEdits = events.filter(function (e) { return e.toolName === "file_edit"; });
    expect(fileEdits.length).toBeGreaterThanOrEqual(1);
    expect(fileEdits[0].text).toContain("jwt.ts");
  });

  it("maps inlineReference to context track", function () {
    var inlineRefs = events.filter(function (e) {
      return e.track === "context" && e.text === "src/jwt.ts";
    });
    expect(inlineRefs.length).toBeGreaterThanOrEqual(1);
  });

  it("skips undoStop and prepareToolInvocation", function () {
    var badKinds = events.filter(function (e) {
      var raw = e.raw;
      return raw && (raw.kind === "undoStop" || raw.kind === "prepareToolInvocation");
    });
    expect(badKinds.length).toBe(0);
  });
});

describe("timestamp reconstruction", function () {
  var result = parseVSCodeChatJSON(FIXTURE);

  it("sets turn start times from request timestamps", function () {
    expect(result.turns[0].startTime).toBeCloseTo(10, 0);
    expect(result.turns[1].startTime).toBeCloseTo(70, 0);
    expect(result.turns[2].startTime).toBeCloseTo(100, 0);
  });

  it("all events have increasing t values", function () {
    for (var i = 1; i < result.events.length; i++) {
      expect(result.events[i].t).toBeGreaterThanOrEqual(result.events[i - 1].t);
    }
  });

  it("turn durations match totalElapsed", function () {
    expect(result.turns[0].endTime - result.turns[0].startTime).toBeCloseTo(55, 0);
    expect(result.turns[1].endTime - result.turns[1].startTime).toBeCloseTo(28, 0);
    expect(result.turns[2].endTime - result.turns[2].startTime).toBeCloseTo(8, 0);
  });
});

describe("JSONL wrapper format", function () {
  it("parses wrapped session correctly", function () {
    var session = JSON.parse(FIXTURE);
    var wrapped = JSON.stringify({ kind: 0, v: session });
    var result = parseVSCodeChatJSON(wrapped);
    expect(result).not.toBeNull();
    expect(result.metadata.format).toBe("vscode-chat");
    expect(result.turns.length).toBe(3);
  });
});

describe("JSONL incremental patches", function () {
  it("applies kind:1 set and kind:2 append patches", function () {
    // Base session with empty requests
    var base = {
      version: 3,
      sessionId: "patch-test",
      creationDate: 1772000000000,
      requests: [],
    };
    var line0 = JSON.stringify({ kind: 0, v: base });
    // kind:1 sets customTitle
    var line1 = JSON.stringify({ kind: 1, k: ["customTitle"], v: "Patched Title" });
    // kind:2 appends a request
    var request = {
      requestId: "req-1",
      timestamp: 1772000010000,
      message: { text: "Hello from patch" },
      response: [],
      result: { timings: { totalElapsed: 5000 } },
    };
    var line2 = JSON.stringify({ kind: 2, k: ["requests"], v: [request] });
    // kind:2 appends response parts to the first request
    var line3 = JSON.stringify({ kind: 2, k: ["requests", 0, "response"], v: [
      { kind: "thinking", value: "Let me think..." },
      { kind: "toolInvocationSerialized", toolId: "copilot_readFile", invocationMessage: { value: "Read file.ts" }, isConfirmed: { type: 1 }, isComplete: true },
    ] });
    // kind:1 sets the result on the request
    var line4 = JSON.stringify({ kind: 1, k: ["requests", 0, "result"], v: { timings: { totalElapsed: 8000, firstProgress: 200 } } });

    var text = [line0, line1, line2, line3, line4].join("\n");

    expect(detectVSCodeChat(text)).toBe(true);

    var result = parseVSCodeChatJSON(text);
    expect(result).not.toBeNull();
    expect(result.metadata.customTitle).toBe("Patched Title");
    expect(result.turns.length).toBe(1);
    // user message + thinking + tool call = 3 events
    expect(result.events.length).toBe(3);
    expect(result.events[0].agent).toBe("user");
    expect(result.events[0].text).toBe("Hello from patch");
    expect(result.events[1].track).toBe("reasoning");
    expect(result.events[2].track).toBe("tool_call");
    expect(result.events[2].toolName).toBe("readFile");
  });

  it("handles base-only JSONL (no patch lines)", function () {
    var session = JSON.parse(FIXTURE);
    var text = JSON.stringify({ kind: 0, v: session });
    var result = parseVSCodeChatJSON(text);
    expect(result).not.toBeNull();
    expect(result.turns.length).toBe(3);
  });

  it("returns null for patched session with still-empty requests", function () {
    var base = { version: 3, sessionId: "empty-patched", requests: [] };
    var text = JSON.stringify({ kind: 0, v: base }) + "\n" + JSON.stringify({ kind: 1, k: ["customTitle"], v: "Title Only" });
    var result = parseVSCodeChatJSON(text);
    expect(result).toBeNull();
  });
});

describe("parseSession router", function () {
  it("routes VS Code JSON through parseSession", function () {
    var result = parseSession(FIXTURE);
    expect(result).not.toBeNull();
    expect(result.metadata.format).toBe("vscode-chat");
  });
});

describe("edge cases", function () {
  it("returns null for empty requests", function () {
    var empty = JSON.stringify({ version: 3, sessionId: "empty", requests: [] });
    var result = parseVSCodeChatJSON(empty);
    expect(result).toBeNull();
  });

  it("handles missing timings gracefully", function () {
    var session = {
      version: 3,
      sessionId: "no-timings",
      requests: [{
        requestId: "req-1",
        timestamp: 1772000010000,
        message: { text: "Hello" },
        response: [{ value: "Hi there" }],
        result: {},
      }],
    };
    var result = parseVSCodeChatJSON(JSON.stringify(session));
    expect(result).not.toBeNull();
    expect(result.events.length).toBeGreaterThan(0);
  });

  it("handles ask-mode session (no tool calls)", function () {
    var session = {
      version: 3,
      sessionId: "ask-mode",
      mode: null,
      requests: [{
        requestId: "req-1",
        timestamp: 1772000010000,
        modelId: "copilot/gpt-4o",
        message: { text: "Explain async/await" },
        response: [{ value: "Async/await is a pattern for handling asynchronous operations." }],
        result: { timings: { firstProgress: 500, totalElapsed: 3000 } },
      }],
    };
    var result = parseVSCodeChatJSON(JSON.stringify(session));
    expect(result).not.toBeNull();
    expect(result.metadata.totalToolCalls).toBe(0);
    expect(result.turns.length).toBe(1);
  });
});
