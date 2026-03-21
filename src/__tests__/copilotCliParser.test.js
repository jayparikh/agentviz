import { describe, it, expect } from "vitest";
import { detectCopilotCli, parseCopilotCliJSONL } from "../lib/copilotCliParser.js";
import { detectFormat, parseSession } from "../lib/parseSession.js";

// Helper to build a minimal Copilot CLI JSONL trace
function buildTrace(events) {
  return events.map(function (e) { return JSON.stringify(e); }).join("\n");
}

function ts(offsetMs) {
  return new Date(Date.UTC(2026, 2, 18, 15, 0, 0, 0) + offsetMs).toISOString();
}

var SESSION_START = {
  type: "session.start",
  data: {
    sessionId: "test-session-1",
    version: 1,
    producer: "copilot-agent",
    copilotVersion: "1.0.7",
    startTime: ts(0),
    context: {
      cwd: "/home/user/project",
      gitRoot: "/home/user/project",
      branch: "main",
      repository: "user/project",
    },
  },
  id: "evt-1",
  timestamp: ts(0),
  parentId: null,
};

var USER_MSG = {
  type: "user.message",
  data: { content: "Fix the login bug", transformedContent: "Fix the login bug", attachments: [] },
  id: "evt-2",
  timestamp: ts(1000),
  parentId: "evt-1",
};

var TURN_START = {
  type: "assistant.turn_start",
  data: { turnId: "0", interactionId: "int-1" },
  id: "evt-3",
  timestamp: ts(1100),
  parentId: "evt-2",
};

var ASSISTANT_MSG_WITH_REASONING = {
  type: "assistant.message",
  data: {
    messageId: "msg-1",
    content: "Let me look at the login code.",
    reasoningText: "The user wants to fix a login bug. I should check auth files.",
    toolRequests: [
      { toolCallId: "tc-1", name: "grep", arguments: { pattern: "login", path: "src/" }, type: "function" },
    ],
    outputTokens: 150,
    interactionId: "int-1",
  },
  id: "evt-4",
  timestamp: ts(2000),
  parentId: "evt-3",
};

var TOOL_START = {
  type: "tool.execution_start",
  data: { toolCallId: "tc-1", toolName: "grep", arguments: { pattern: "login", path: "src/" } },
  id: "evt-5",
  timestamp: ts(2100),
  parentId: "evt-4",
};

var TOOL_COMPLETE = {
  type: "tool.execution_complete",
  data: {
    toolCallId: "tc-1",
    model: "claude-opus-4.6",
    success: true,
    result: { content: "src/auth.js:15: function login() {" },
    toolTelemetry: {},
  },
  id: "evt-6",
  timestamp: ts(3000),
  parentId: "evt-5",
};

var TURN_END = {
  type: "assistant.turn_end",
  data: { turnId: "0" },
  id: "evt-7",
  timestamp: ts(3500),
  parentId: "evt-6",
};

var SESSION_SHUTDOWN = {
  type: "session.shutdown",
  data: {
    shutdownType: "routine",
    totalPremiumRequests: 1,
    totalApiDurationMs: 5000,
    sessionStartTime: Date.UTC(2026, 2, 18, 15, 0, 0, 0),
    codeChanges: { linesAdded: 10, linesRemoved: 3, filesModified: ["src/auth.js"] },
    modelMetrics: {
      "claude-opus-4.6": {
        requests: { count: 1, cost: 1 },
        usage: { inputTokens: 5000, outputTokens: 150, cacheReadTokens: 3000, cacheWriteTokens: 0 },
      },
    },
  },
  id: "evt-8",
  timestamp: ts(4000),
  parentId: "evt-7",
};

var BASIC_TRACE = [SESSION_START, USER_MSG, TURN_START, ASSISTANT_MSG_WITH_REASONING, TOOL_START, TOOL_COMPLETE, TURN_END, SESSION_SHUTDOWN];

// ---- Detection tests ----

describe("detectCopilotCli", function () {
  it("detects copilot-agent producer", function () {
    expect(detectCopilotCli(buildTrace(BASIC_TRACE))).toBe(true);
  });

  it("detects copilotVersion without producer", function () {
    var start = JSON.parse(JSON.stringify(SESSION_START));
    delete start.data.producer;
    expect(detectCopilotCli(JSON.stringify(start))).toBe(true);
  });

  it("rejects Claude Code JSONL", function () {
    var claudeLine = JSON.stringify({ type: "system", message: { role: "system" }, timestamp: ts(0) });
    expect(detectCopilotCli(claudeLine)).toBe(false);
  });

  it("rejects malformed JSON", function () {
    expect(detectCopilotCli("not json at all")).toBe(false);
  });

  it("detects session.resume as start", function () {
    var resume = {
      type: "session.resume",
      data: { copilotVersion: "1.0.7", resumeTime: ts(0), eventCount: 50, context: {} },
      id: "evt-r1",
      timestamp: ts(0),
      parentId: null,
    };
    expect(detectCopilotCli(JSON.stringify(resume))).toBe(true);
  });
});

// ---- Auto-detect router ----

describe("detectFormat", function () {
  it("routes copilot traces to copilot-cli", function () {
    expect(detectFormat(buildTrace(BASIC_TRACE))).toBe("copilot-cli");
  });

  it("routes unknown formats to claude-code", function () {
    var claudeLine = JSON.stringify({ type: "system", message: { role: "system" }, timestamp: ts(0) });
    expect(detectFormat(claudeLine)).toBe("claude-code");
  });
});

// ---- Parser: basic structure ----

describe("parseCopilotCliJSONL", function () {
  it("returns events, turns, metadata", function () {
    var result = parseCopilotCliJSONL(buildTrace(BASIC_TRACE));
    expect(result).not.toBeNull();
    expect(result.events).toBeDefined();
    expect(result.turns).toBeDefined();
    expect(result.metadata).toBeDefined();
  });

  it("returns null for empty input", function () {
    expect(parseCopilotCliJSONL("")).toBeNull();
    expect(parseCopilotCliJSONL("\n\n")).toBeNull();
  });

  it("returns null for input with no displayable events", function () {
    var trace = buildTrace([SESSION_START, SESSION_SHUTDOWN]);
    expect(parseCopilotCliJSONL(trace)).toBeNull();
  });
});

// ---- Parser: event normalization ----

describe("event normalization", function () {
  var result = parseCopilotCliJSONL(buildTrace(BASIC_TRACE));
  var events = result.events;

  it("produces user message event", function () {
    var userEvents = events.filter(function (e) { return e.agent === "user"; });
    expect(userEvents.length).toBe(1);
    expect(userEvents[0].track).toBe("output");
    expect(userEvents[0].text).toBe("Fix the login bug");
    expect(userEvents[0].intensity).toBe(0.9);
  });

  it("produces reasoning event from assistant.message", function () {
    var reasoning = events.filter(function (e) { return e.track === "reasoning"; });
    expect(reasoning.length).toBeGreaterThanOrEqual(1);
    expect(reasoning[0].text).toContain("login bug");
    expect(reasoning[0].agent).toBe("assistant");
  });

  it("produces output event from assistant.message content", function () {
    var output = events.filter(function (e) { return e.track === "output" && e.agent === "assistant"; });
    expect(output.length).toBe(1);
    expect(output[0].text).toBe("Let me look at the login code.");
  });

  it("produces tool_call event with duration from start to complete", function () {
    var tools = events.filter(function (e) { return e.track === "tool_call"; });
    expect(tools.length).toBe(1);
    expect(tools[0].toolName).toBe("grep");
    expect(tools[0].duration).toBeCloseTo(0.9, 1);
    expect(tools[0].isError).toBe(false);
    expect(tools[0].model).toBe("claude-opus-4.6");
  });

  it("builds arg preview for tool calls", function () {
    var tools = events.filter(function (e) { return e.track === "tool_call"; });
    expect(tools[0].text).toContain("grep");
    expect(tools[0].text).toContain("'login'");
    expect(tools[0].text).toContain("src/");
  });

  it("events are sorted by time", function () {
    for (var i = 1; i < events.length; i++) {
      expect(events[i].t).toBeGreaterThanOrEqual(events[i - 1].t);
    }
  });

  it("all events have required fields", function () {
    events.forEach(function (ev) {
      expect(typeof ev.t).toBe("number");
      expect(typeof ev.agent).toBe("string");
      expect(typeof ev.track).toBe("string");
      expect(typeof ev.text).toBe("string");
      expect(typeof ev.duration).toBe("number");
      expect(typeof ev.intensity).toBe("number");
      expect(typeof ev.turnIndex).toBe("number");
      expect(typeof ev.isError).toBe("boolean");
      expect(ev.raw).toBeDefined();
    });
  });
});

// ---- Parser: turn grouping ----

describe("turn grouping", function () {
  it("creates turns from turn_start/turn_end", function () {
    var result = parseCopilotCliJSONL(buildTrace(BASIC_TRACE));
    expect(result.turns.length).toBe(1);

    var turn = result.turns[0];
    expect(turn.index).toBe(0);
    expect(turn.userMessage).toBe("Fix the login bug");
    expect(turn.toolCount).toBe(1);
    expect(turn.hasError).toBe(false);
    expect(turn.eventIndices.length).toBeGreaterThan(0);
  });

  it("assigns events to correct turns", function () {
    var result = parseCopilotCliJSONL(buildTrace(BASIC_TRACE));
    result.events.forEach(function (ev) {
      expect(ev.turnIndex).toBe(0);
    });
  });

  it("handles multi-turn sessions", function () {
    var msg2 = {
      type: "user.message",
      data: { content: "Now add tests" },
      id: "evt-9",
      timestamp: ts(5000),
      parentId: "evt-7",
    };
    var turn2Start = {
      type: "assistant.turn_start",
      data: { turnId: "1" },
      id: "evt-10",
      timestamp: ts(5100),
      parentId: "evt-9",
    };
    var turn2Msg = {
      type: "assistant.message",
      data: { content: "I will add tests.", toolRequests: [], outputTokens: 50 },
      id: "evt-11",
      timestamp: ts(6000),
      parentId: "evt-10",
    };
    var turn2End = {
      type: "assistant.turn_end",
      data: { turnId: "1" },
      id: "evt-12",
      timestamp: ts(7000),
      parentId: "evt-11",
    };

    var trace = [SESSION_START, USER_MSG, TURN_START, ASSISTANT_MSG_WITH_REASONING, TOOL_START, TOOL_COMPLETE, TURN_END, msg2, turn2Start, turn2Msg, turn2End, SESSION_SHUTDOWN];
    var result = parseCopilotCliJSONL(buildTrace(trace));

    expect(result.turns.length).toBe(2);
    expect(result.turns[0].userMessage).toBe("Fix the login bug");
    expect(result.turns[1].userMessage).toBe("Now add tests");
  });

  it("uses (continuation) for turns without preceding user message", function () {
    // assistant.turn_start immediately after another turn_end without user.message
    var turn2Start = {
      type: "assistant.turn_start",
      data: { turnId: "1" },
      id: "evt-9",
      timestamp: ts(4000),
      parentId: "evt-7",
    };
    var turn2Msg = {
      type: "assistant.message",
      data: { content: "Continuing work.", toolRequests: [] },
      id: "evt-10",
      timestamp: ts(4500),
      parentId: "evt-9",
    };
    var turn2End = {
      type: "assistant.turn_end",
      data: { turnId: "1" },
      id: "evt-11",
      timestamp: ts(5000),
      parentId: "evt-10",
    };

    var trace = [SESSION_START, USER_MSG, TURN_START, ASSISTANT_MSG_WITH_REASONING, TURN_END, turn2Start, turn2Msg, turn2End, SESSION_SHUTDOWN];
    var result = parseCopilotCliJSONL(buildTrace(trace));

    expect(result.turns[1].userMessage).toBe("(continuation)");
  });
});

// ---- Parser: tool error handling ----

describe("tool errors", function () {
  it("marks failed tools as errors", function () {
    var failedComplete = JSON.parse(JSON.stringify(TOOL_COMPLETE));
    failedComplete.data.success = false;
    failedComplete.data.error = "Command failed with exit code 1";
    var trace = [SESSION_START, USER_MSG, TURN_START, ASSISTANT_MSG_WITH_REASONING, TOOL_START, failedComplete, TURN_END, SESSION_SHUTDOWN];

    var result = parseCopilotCliJSONL(buildTrace(trace));
    var tools = result.events.filter(function (e) { return e.track === "tool_call"; });
    expect(tools[0].isError).toBe(true);
    expect(tools[0].intensity).toBe(0.9);
    expect(tools[0].text).toContain("Command failed");
  });

  it("handles orphaned tool starts (no complete)", function () {
    var trace = [SESSION_START, USER_MSG, TURN_START, ASSISTANT_MSG_WITH_REASONING, TOOL_START, TURN_END, SESSION_SHUTDOWN];
    var result = parseCopilotCliJSONL(buildTrace(trace));
    var tools = result.events.filter(function (e) { return e.track === "tool_call"; });
    expect(tools.length).toBe(1);
    expect(tools[0].duration).toBe(0.5);
    expect(tools[0].isError).toBe(false);
  });
});

// ---- Parser: metadata ----

describe("metadata", function () {
  var result = parseCopilotCliJSONL(buildTrace(BASIC_TRACE));
  var meta = result.metadata;

  it("extracts session info", function () {
    expect(meta.format).toBe("copilot-cli");
    expect(meta.sessionId).toBe("test-session-1");
    expect(meta.producer).toBe("copilot-agent");
    expect(meta.copilotVersion).toBe("1.0.7");
    expect(meta.repository).toBe("user/project");
    expect(meta.branch).toBe("main");
    expect(meta.cwd).toBe("/home/user/project");
  });

  it("extracts shutdown info", function () {
    expect(meta.shutdownType).toBe("routine");
    expect(meta.premiumRequests).toBe(1);
    expect(meta.totalApiDurationMs).toBe(5000);
    expect(meta.codeChanges.linesAdded).toBe(10);
    expect(meta.codeChanges.filesModified).toContain("src/auth.js");
  });

  it("computes token usage from modelMetrics", function () {
    expect(meta.tokenUsage.inputTokens).toBe(5000);
    expect(meta.tokenUsage.outputTokens).toBe(150);
    expect(meta.tokenUsage.cacheReadTokens).toBe(3000);
  });

  it("uses null tokenUsage when no token counters are present", function () {
    var shutdownNoUsage = JSON.parse(JSON.stringify(SESSION_SHUTDOWN));
    shutdownNoUsage.data.modelMetrics = {};
    var trace = [SESSION_START, USER_MSG, TURN_START, ASSISTANT_MSG_WITH_REASONING, TOOL_START, TOOL_COMPLETE, TURN_END, shutdownNoUsage];
    var parsed = parseCopilotCliJSONL(buildTrace(trace));
    expect(parsed.metadata.tokenUsage).toBeNull();
  });

  it("identifies primary model", function () {
    expect(meta.primaryModel).toBe("claude-opus-4.6");
    expect(meta.models).toHaveProperty("claude-opus-4.6");
  });

  it("counts events and turns", function () {
    expect(meta.totalEvents).toBeGreaterThan(0);
    expect(meta.totalTurns).toBe(1);
    expect(meta.totalToolCalls).toBe(1);
    expect(meta.errorCount).toBe(0);
  });

  it("computes total cost", function () {
    expect(meta.totalCost).toBe(1);
  });
});

// ---- Parser: additional event types ----

describe("additional event types", function () {
  it("handles subagent.started/completed/failed", function () {
    var started = {
      type: "subagent.started",
      data: { toolCallId: "tc-sub", agentName: "explore", agentDisplayName: "Explore Agent" },
      id: "evt-s1",
      timestamp: ts(2500),
      parentId: null,
    };
    var completed = {
      type: "subagent.completed",
      data: { toolCallId: "tc-sub", agentName: "explore", agentDisplayName: "Explore Agent" },
      id: "evt-s2",
      timestamp: ts(3200),
      parentId: null,
    };

    var trace = [SESSION_START, USER_MSG, TURN_START, ASSISTANT_MSG_WITH_REASONING, started, completed, TURN_END, SESSION_SHUTDOWN];
    var result = parseCopilotCliJSONL(buildTrace(trace));

    var sysEvents = result.events.filter(function (e) { return e.agent === "system"; });
    expect(sysEvents.length).toBe(2);
    expect(sysEvents[0].text).toContain("spawned");
    expect(sysEvents[1].text).toContain("completed");
  });

  it("handles subagent.failed as error", function () {
    var failed = {
      type: "subagent.failed",
      data: { toolCallId: "tc-sub", agentName: "explore", agentDisplayName: "Explore Agent", error: "Timeout" },
      id: "evt-sf",
      timestamp: ts(2500),
      parentId: null,
    };

    var trace = [SESSION_START, USER_MSG, TURN_START, ASSISTANT_MSG_WITH_REASONING, failed, TURN_END, SESSION_SHUTDOWN];
    var result = parseCopilotCliJSONL(buildTrace(trace));

    var errorEvents = result.events.filter(function (e) { return e.isError && e.agent === "system"; });
    expect(errorEvents.length).toBe(1);
    expect(errorEvents[0].text).toContain("failed");
    expect(errorEvents[0].text).toContain("Timeout");
  });

  it("handles session.error", function () {
    var err = {
      type: "session.error",
      data: { errorType: "api_error", message: "Rate limit exceeded" },
      id: "evt-e1",
      timestamp: ts(2500),
      parentId: null,
    };

    var trace = [SESSION_START, USER_MSG, TURN_START, ASSISTANT_MSG_WITH_REASONING, err, TURN_END, SESSION_SHUTDOWN];
    var result = parseCopilotCliJSONL(buildTrace(trace));

    var errors = result.events.filter(function (e) { return e.isError; });
    expect(errors.length).toBeGreaterThanOrEqual(1);
    var sessionErr = errors.find(function (e) { return e.text.includes("Rate limit"); });
    expect(sessionErr).toBeDefined();
  });

  it("handles session.model_change", function () {
    var change = {
      type: "session.model_change",
      data: { previousModel: "claude-haiku-4.5", newModel: "claude-opus-4.6" },
      id: "evt-mc",
      timestamp: ts(2500),
      parentId: null,
    };

    var trace = [SESSION_START, USER_MSG, TURN_START, change, ASSISTANT_MSG_WITH_REASONING, TURN_END, SESSION_SHUTDOWN];
    var result = parseCopilotCliJSONL(buildTrace(trace));

    var modelEvents = result.events.filter(function (e) { return e.text.includes("\u2192"); });
    expect(modelEvents.length).toBe(1);
    expect(modelEvents[0].text).toContain("claude-haiku-4.5");
    expect(modelEvents[0].text).toContain("claude-opus-4.6");
  });

  it("handles session.compaction_complete", function () {
    var compact = {
      type: "session.compaction_complete",
      data: { success: true, tokensRemoved: 50000, preCompactionTokens: 100000, postCompactionTokens: 50000 },
      id: "evt-cc",
      timestamp: ts(2500),
      parentId: null,
    };

    var trace = [SESSION_START, USER_MSG, TURN_START, compact, ASSISTANT_MSG_WITH_REASONING, TURN_END, SESSION_SHUTDOWN];
    var result = parseCopilotCliJSONL(buildTrace(trace));

    var compactEvents = result.events.filter(function (e) { return e.text.includes("compacted"); });
    expect(compactEvents.length).toBe(1);
    expect(compactEvents[0].text).toContain("50,000");
  });

  it("handles assistant.reasoning standalone event", function () {
    var reasoning = {
      type: "assistant.reasoning",
      data: { reasoningId: "r-1", content: "Let me think about this carefully." },
      id: "evt-r1",
      timestamp: ts(1800),
      parentId: null,
    };

    var trace = [SESSION_START, USER_MSG, TURN_START, reasoning, ASSISTANT_MSG_WITH_REASONING, TURN_END, SESSION_SHUTDOWN];
    var result = parseCopilotCliJSONL(buildTrace(trace));

    var reasoningEvents = result.events.filter(function (e) { return e.track === "reasoning"; });
    var standalone = reasoningEvents.find(function (e) { return e.text.includes("think about this"); });
    expect(standalone).toBeDefined();
    expect(standalone.agent).toBe("assistant");
  });

  it("handles system.notification", function () {
    var notif = {
      type: "system.notification",
      data: { content: "Background agent completed", kind: "agent_completed" },
      id: "evt-n1",
      timestamp: ts(2500),
      parentId: null,
    };

    var trace = [SESSION_START, USER_MSG, TURN_START, notif, ASSISTANT_MSG_WITH_REASONING, TURN_END, SESSION_SHUTDOWN];
    var result = parseCopilotCliJSONL(buildTrace(trace));

    var notifEvents = result.events.filter(function (e) { return e.text.includes("Background agent"); });
    expect(notifEvents.length).toBe(1);
    expect(notifEvents[0].agent).toBe("system");
  });
});

// ---- Parser: session.resume support ----

describe("session.resume", function () {
  it("uses resumeTime as session start for resumed sessions", function () {
    var resume = {
      type: "session.resume",
      data: { copilotVersion: "1.0.7", resumeTime: ts(0), eventCount: 50, context: { cwd: "/test" } },
      id: "evt-r1",
      timestamp: ts(0),
      parentId: null,
    };

    var trace = [resume, USER_MSG, TURN_START, ASSISTANT_MSG_WITH_REASONING, TURN_END, SESSION_SHUTDOWN];
    var result = parseCopilotCliJSONL(buildTrace(trace));

    expect(result).not.toBeNull();
    expect(result.events.length).toBeGreaterThan(0);
    // First event should have t > 0 (user message is at ts(1000), resume at ts(0))
    var userEv = result.events.find(function (e) { return e.agent === "user"; });
    expect(userEv.t).toBeCloseTo(1.0, 1);
  });
});

// ---- Parser: edge cases ----

describe("edge cases", function () {
  it("handles malformed lines gracefully", function () {
    var trace = JSON.stringify(SESSION_START) + "\nNOT JSON\n" + JSON.stringify(USER_MSG) + "\n" + JSON.stringify(TURN_START) + "\n" + JSON.stringify(ASSISTANT_MSG_WITH_REASONING) + "\n" + JSON.stringify(TURN_END) + "\n" + JSON.stringify(SESSION_SHUTDOWN);
    var result = parseCopilotCliJSONL(trace);

    expect(result).not.toBeNull();
    expect(result.metadata.parseIssues.malformedLines).toBe(1);
    expect(result.metadata.warnings.length).toBeGreaterThan(0);
  });

  it("handles assistant.message with only tool requests (no content/reasoning)", function () {
    var toolOnly = {
      type: "assistant.message",
      data: {
        messageId: "msg-2",
        content: "",
        toolRequests: [
          { toolCallId: "tc-2", name: "bash", arguments: { command: "ls" } },
          { toolCallId: "tc-3", name: "view", arguments: { path: "src/" } },
        ],
        outputTokens: 50,
      },
      id: "evt-to",
      timestamp: ts(2000),
      parentId: null,
    };

    var trace = [SESSION_START, USER_MSG, TURN_START, toolOnly, TURN_END, SESSION_SHUTDOWN];
    var result = parseCopilotCliJSONL(buildTrace(trace));

    var invoking = result.events.find(function (e) { return e.text.includes("Invoking"); });
    expect(invoking).toBeDefined();
    expect(invoking.text).toContain("bash");
    expect(invoking.text).toContain("view");
  });

  it("handles shutdown with error warning", function () {
    var errorShutdown = JSON.parse(JSON.stringify(SESSION_SHUTDOWN));
    errorShutdown.data.shutdownType = "error";
    errorShutdown.data.errorReason = "API failure";

    var trace = [SESSION_START, USER_MSG, TURN_START, ASSISTANT_MSG_WITH_REASONING, TURN_END, errorShutdown];
    var result = parseCopilotCliJSONL(buildTrace(trace));

    expect(result.metadata.shutdownType).toBe("error");
    var errorWarning = result.metadata.warnings.find(function (w) { return w.includes("error"); });
    expect(errorWarning).toBeDefined();
  });
});

// ---- Integration: parseSession auto-detection ----

describe("parseSession integration", function () {
  it("auto-detects and parses Copilot CLI traces", function () {
    var result = parseSession(buildTrace(BASIC_TRACE));
    expect(result).not.toBeNull();
    expect(result.metadata.format).toBe("copilot-cli");
    expect(result.events.length).toBeGreaterThan(0);
  });
});
