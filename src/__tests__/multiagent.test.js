import { describe, it, expect } from "vitest";
import { parseCopilotCliJSONL } from "../lib/copilotCliParser";
import { readFileSync } from "fs";
import { join } from "path";

var fixture = readFileSync(join(__dirname, "../../test-files/test-multiagent.jsonl"), "utf-8");

describe("multi-agent parser", function () {
  var result = parseCopilotCliJSONL(fixture);

  it("parses without errors", function () {
    expect(result).not.toBeNull();
    expect(result.events.length).toBeGreaterThan(0);
    expect(result.turns.length).toBe(2);
  });

  it("creates agent track events for subagent lifecycle", function () {
    var agentEvents = result.events.filter(function (e) { return e.track === "agent"; });
    // 3 subagents: explore (started+completed), code-review (started+completed), general-purpose (started+failed)
    expect(agentEvents.length).toBe(6);
  });

  it("tags subagent.started events with correct metadata", function () {
    var started = result.events.filter(function (e) {
      return e.track === "agent" && e.text.includes("started");
    });
    expect(started.length).toBe(3);

    var explore = started.find(function (e) { return e.agentName === "explore"; });
    expect(explore).toBeDefined();
    expect(explore.agentDisplayName).toBe("Explore Agent");
    expect(explore.toolCallId).toBe("tc-explore-1");

    var review = started.find(function (e) { return e.agentName === "code-review"; });
    expect(review).toBeDefined();
    expect(review.agentDisplayName).toBe("Code Review Agent");
    expect(review.toolCallId).toBe("tc-review-1");

    var gp = started.find(function (e) { return e.agentName === "general-purpose"; });
    expect(gp).toBeDefined();
    expect(gp.agentDisplayName).toBe("General Purpose Agent");
    expect(gp.toolCallId).toBe("tc-gp-1");
  });

  it("calculates duration for completed subagents", function () {
    var completed = result.events.filter(function (e) {
      return e.track === "agent" && e.text.includes("completed");
    });
    expect(completed.length).toBe(2);

    var exploreCompleted = completed.find(function (e) { return e.agentName === "explore"; });
    // started at T+5, completed at T+12 = 7 seconds
    expect(exploreCompleted.duration).toBeCloseTo(7, 0);

    var reviewCompleted = completed.find(function (e) { return e.agentName === "code-review"; });
    // started at T+5.5, completed at T+14 = 8.5 seconds
    expect(reviewCompleted.duration).toBeCloseTo(8.5, 0);
  });

  it("marks failed subagents as errors with duration", function () {
    var failed = result.events.filter(function (e) {
      return e.track === "agent" && e.isError;
    });
    expect(failed.length).toBe(1);
    expect(failed[0].agentName).toBe("general-purpose");
    expect(failed[0].text).toContain("failed");
    expect(failed[0].text).toContain("Context window exceeded");
    // started at T+24, failed at T+30 = 6 seconds
    expect(failed[0].duration).toBeCloseTo(6, 0);
  });

  it("propagates toolCallId on tool_call events", function () {
    var toolCalls = result.events.filter(function (e) { return e.track === "tool_call"; });
    // All tool calls should have a toolCallId
    for (var i = 0; i < toolCalls.length; i++) {
      expect(toolCalls[i].toolCallId).toBeTruthy();
    }
  });

  it("tags child tool calls with parent agent metadata", function () {
    // The view tool called by explore agent (parentToolCallId = tc-explore-1)
    var childView = result.events.find(function (e) {
      return e.toolName === "view" && e.parentToolCallId === "tc-explore-1";
    });
    expect(childView).toBeDefined();
    expect(childView.agentName).toBe("explore");
    // Lifecycle metadata preferred over task description
    expect(childView.agentDisplayName).toBe("Explore Agent");

    // The grep tool called by code-review agent (parentToolCallId = tc-review-1)
    var childGrep = result.events.find(function (e) {
      return e.toolName === "grep" && e.parentToolCallId === "tc-review-1";
    });
    expect(childGrep).toBeDefined();
    expect(childGrep.agentName).toBe("code-review");
    expect(childGrep.agentDisplayName).toBe("Code Review Agent");

    // The edit tool called by general-purpose agent (parentToolCallId = tc-gp-1)
    var childEdit = result.events.find(function (e) {
      return e.toolName === "edit" && e.parentToolCallId === "tc-gp-1";
    });
    expect(childEdit).toBeDefined();
    expect(childEdit.agentName).toBe("general-purpose");
    expect(childEdit.agentDisplayName).toBe("General Purpose Agent");
  });

  it("tags task tool calls with self-agent metadata", function () {
    // The task tool calls themselves should carry agent metadata
    var taskCalls = result.events.filter(function (e) {
      return e.toolName === "task";
    });
    expect(taskCalls.length).toBe(3);

    var exploreTask = taskCalls.find(function (e) { return e.toolCallId === "tc-explore-1"; });
    expect(exploreTask).toBeDefined();
    expect(exploreTask.agentName).toBe("explore");
    // Lifecycle displayName preferred over task description
    expect(exploreTask.agentDisplayName).toBe("Explore Agent");

    var reviewTask = taskCalls.find(function (e) { return e.toolCallId === "tc-review-1"; });
    expect(reviewTask).toBeDefined();
    expect(reviewTask.agentName).toBe("code-review");
    expect(reviewTask.agentDisplayName).toBe("Code Review Agent");

    var gpTask = taskCalls.find(function (e) { return e.toolCallId === "tc-gp-1"; });
    expect(gpTask).toBeDefined();
    expect(gpTask.agentName).toBe("general-purpose");
    expect(gpTask.agentDisplayName).toBe("General Purpose Agent");
  });

  it("does not add agent metadata to non-subagent events", function () {
    var userEvents = result.events.filter(function (e) { return e.agent === "user"; });
    for (var i = 0; i < userEvents.length; i++) {
      expect(userEvents[i].agentName).toBeFalsy();
    }

    // Top-level assistant messages (no parentToolCallId) should not have agent metadata
    var topLevelAssistant = result.events.filter(function (e) {
      return e.agent === "assistant" && !e.parentToolCallId && e.track !== "tool_call";
    });
    for (var j = 0; j < topLevelAssistant.length; j++) {
      expect(topLevelAssistant[j].agentName).toBeFalsy();
    }
  });

  it("preserves backward compatibility with metadata", function () {
    expect(result.metadata.format).toBe("copilot-cli");
    expect(result.metadata.totalTurns).toBe(2);
    expect(result.metadata.totalToolCalls).toBeGreaterThan(0);
    expect(result.metadata.primaryModel).toBe("claude-opus-4.6");
    expect(result.metadata.errorCount).toBeGreaterThan(0);
  });

  it("handles concurrent subagents (both active at same time)", function () {
    // Explore and code-review agents run concurrently (overlapping timestamps)
    var exploreStart = result.events.find(function (e) {
      return e.track === "agent" && e.agentName === "explore" && e.text.includes("started");
    });
    var reviewStart = result.events.find(function (e) {
      return e.track === "agent" && e.agentName === "code-review" && e.text.includes("started");
    });
    // Both start within 0.5s of each other
    expect(Math.abs(exploreStart.t - reviewStart.t)).toBeLessThan(1);
  });
});

describe("multi-agent parser edge cases", function () {
  function buildTrace(events) {
    return events.map(function (e) { return JSON.stringify(e); }).join("\n");
  }

  function ts(offsetMs) {
    return new Date(Date.UTC(2026, 2, 28, 10, 0, 0, 0) + offsetMs).toISOString();
  }

  var START = {
    type: "session.start",
    data: { sessionId: "edge-test", version: 1, producer: "copilot-agent", copilotVersion: "1.0.0", startTime: ts(0) },
    id: "e-1", timestamp: ts(0), parentId: null,
  };

  it("handles subagent with no matching task tool", function () {
    // subagent.started without a preceding task tool.execution_start
    var trace = buildTrace([
      START,
      { type: "user.message", data: { content: "test" }, id: "e-2", timestamp: ts(1000), parentId: null },
      { type: "assistant.turn_start", data: { turnId: "0" }, id: "e-3", timestamp: ts(2000), parentId: null },
      { type: "subagent.started", data: { toolCallId: "orphan-tc", agentName: "explore", agentDisplayName: "Explore" }, id: "e-4", timestamp: ts(3000), parentId: null },
      { type: "subagent.completed", data: { toolCallId: "orphan-tc", agentName: "explore" }, id: "e-5", timestamp: ts(5000), parentId: null },
      { type: "assistant.turn_end", data: { turnId: "0" }, id: "e-6", timestamp: ts(6000), parentId: null },
    ]);

    var result = parseCopilotCliJSONL(trace);
    var agentEvents = result.events.filter(function (e) { return e.track === "agent"; });
    expect(agentEvents.length).toBe(2);
    // Should still have agent name from the subagent event data
    expect(agentEvents[0].agentName).toBe("explore");
    expect(agentEvents[1].agentName).toBe("explore");
  });

  it("handles subagent with missing completion event", function () {
    var trace = buildTrace([
      START,
      { type: "user.message", data: { content: "test" }, id: "e-2", timestamp: ts(1000), parentId: null },
      { type: "assistant.turn_start", data: { turnId: "0" }, id: "e-3", timestamp: ts(2000), parentId: null },
      { type: "subagent.started", data: { toolCallId: "tc-lost", agentName: "task" }, id: "e-4", timestamp: ts(3000), parentId: null },
      // No subagent.completed or subagent.failed
      { type: "assistant.turn_end", data: { turnId: "0" }, id: "e-5", timestamp: ts(6000), parentId: null },
    ]);

    var result = parseCopilotCliJSONL(trace);
    var agentEvents = result.events.filter(function (e) { return e.track === "agent"; });
    // Only the started event, no crash
    expect(agentEvents.length).toBe(1);
    expect(agentEvents[0].text).toContain("started");
  });

  it("sessions with no subagents produce no agent events", function () {
    var trace = buildTrace([
      START,
      { type: "user.message", data: { content: "hello" }, id: "e-2", timestamp: ts(1000), parentId: null },
      { type: "assistant.turn_start", data: { turnId: "0" }, id: "e-3", timestamp: ts(2000), parentId: null },
      { type: "assistant.message", data: { content: "Hi there" }, id: "e-4", timestamp: ts(3000), parentId: null },
      { type: "assistant.turn_end", data: { turnId: "0" }, id: "e-5", timestamp: ts(4000), parentId: null },
    ]);

    var result = parseCopilotCliJSONL(trace);
    var agentEvents = result.events.filter(function (e) { return e.track === "agent"; });
    expect(agentEvents.length).toBe(0);
  });

  it("handles subagent events without toolCallId", function () {
    var trace = buildTrace([
      START,
      { type: "user.message", data: { content: "test" }, id: "e-2", timestamp: ts(1000), parentId: null },
      { type: "assistant.turn_start", data: { turnId: "0" }, id: "e-3", timestamp: ts(2000), parentId: null },
      { type: "subagent.started", data: { agentName: "explore", agentDisplayName: "Explore" }, id: "e-4", timestamp: ts(3000), parentId: null },
      { type: "subagent.completed", data: { agentName: "explore", agentDisplayName: "Explore" }, id: "e-5", timestamp: ts(5000), parentId: null },
      { type: "assistant.turn_end", data: { turnId: "0" }, id: "e-6", timestamp: ts(6000), parentId: null },
    ]);

    var result = parseCopilotCliJSONL(trace);
    var agentEvents = result.events.filter(function (e) { return e.track === "agent"; });
    expect(agentEvents.length).toBe(2);
    expect(agentEvents[0].agentName).toBe("explore");
    expect(agentEvents[0].toolCallId).toBeFalsy();
    // Without toolCallId, duration falls back to 0.5
    expect(agentEvents[1].duration).toBe(0.5);
  });

  it("subagent.completed without preceding started falls back gracefully", function () {
    var trace = buildTrace([
      START,
      { type: "user.message", data: { content: "test" }, id: "e-2", timestamp: ts(1000), parentId: null },
      { type: "assistant.turn_start", data: { turnId: "0" }, id: "e-3", timestamp: ts(2000), parentId: null },
      // No subagent.started, just completed
      { type: "subagent.completed", data: { toolCallId: "tc-ghost", agentName: "task" }, id: "e-4", timestamp: ts(5000), parentId: null },
      { type: "assistant.turn_end", data: { turnId: "0" }, id: "e-5", timestamp: ts(6000), parentId: null },
    ]);

    var result = parseCopilotCliJSONL(trace);
    var agentEvents = result.events.filter(function (e) { return e.track === "agent"; });
    expect(agentEvents.length).toBe(1);
    expect(agentEvents[0].text).toContain("completed");
    // No start time, so duration falls back to 0.5
    expect(agentEvents[0].duration).toBe(0.5);
  });

  it("lifecycle metadata takes precedence over task tool args", function () {
    // Task tool has description="my task", but subagent.started has agentDisplayName="Explore Agent"
    var trace = buildTrace([
      START,
      { type: "user.message", data: { content: "test" }, id: "e-2", timestamp: ts(1000), parentId: null },
      { type: "assistant.turn_start", data: { turnId: "0" }, id: "e-3", timestamp: ts(2000), parentId: null },
      { type: "assistant.message", data: { content: "", toolRequests: [{ toolCallId: "tc-x", name: "task" }] }, id: "e-4", timestamp: ts(3000), parentId: null },
      { type: "tool.execution_start", data: { toolCallId: "tc-x", toolName: "task", arguments: { agent_type: "explore", description: "my task description" } }, id: "e-5", timestamp: ts(3500), parentId: null },
      { type: "subagent.started", data: { toolCallId: "tc-x", agentName: "explore", agentDisplayName: "Explore Agent" }, id: "e-6", timestamp: ts(4000), parentId: null },
      { type: "subagent.completed", data: { toolCallId: "tc-x", agentName: "explore" }, id: "e-7", timestamp: ts(6000), parentId: null },
      { type: "tool.execution_complete", data: { toolCallId: "tc-x", toolName: "task", success: true, result: { content: "done" } }, id: "e-8", timestamp: ts(6500), parentId: null },
      { type: "assistant.turn_end", data: { turnId: "0" }, id: "e-9", timestamp: ts(7000), parentId: null },
    ]);

    var result = parseCopilotCliJSONL(trace);

    // Lifecycle "Explore Agent" should win over task description "my task description"
    var started = result.events.find(function (e) { return e.track === "agent" && e.text.includes("started"); });
    expect(started.agentDisplayName).toBe("Explore Agent");

    // Task tool call itself should also prefer lifecycle name
    var taskCall = result.events.find(function (e) { return e.toolName === "task"; });
    expect(taskCall.agentDisplayName).toBe("Explore Agent");
    expect(taskCall.agentName).toBe("explore");
  });

  it("assistant messages always preserve parentToolCallId even without resolved agent", function () {
    // assistant.message with parentToolCallId but no matching task/lifecycle
    var trace = buildTrace([
      START,
      { type: "user.message", data: { content: "test" }, id: "e-2", timestamp: ts(1000), parentId: null },
      { type: "assistant.turn_start", data: { turnId: "0" }, id: "e-3", timestamp: ts(2000), parentId: null },
      { type: "assistant.message", data: { content: "I am a child message", parentToolCallId: "unknown-tc" }, id: "e-4", timestamp: ts(3000), parentId: null },
      { type: "assistant.turn_end", data: { turnId: "0" }, id: "e-5", timestamp: ts(4000), parentId: null },
    ]);

    var result = parseCopilotCliJSONL(trace);
    var childMsg = result.events.find(function (e) { return e.text === "I am a child message"; });
    expect(childMsg).toBeDefined();
    // parentToolCallId preserved even though agent identity is unresolved
    expect(childMsg.parentToolCallId).toBe("unknown-tc");
    // Agent fields should be null (unresolved)
    expect(childMsg.agentName).toBeFalsy();
  });

  it("child tool calls resolve agent from lifecycle even without task tool start", function () {
    // subagent.started exists but no preceding tool.execution_start for task
    var trace = buildTrace([
      START,
      { type: "user.message", data: { content: "test" }, id: "e-2", timestamp: ts(1000), parentId: null },
      { type: "assistant.turn_start", data: { turnId: "0" }, id: "e-3", timestamp: ts(2000), parentId: null },
      { type: "subagent.started", data: { toolCallId: "tc-orphan", agentName: "explore", agentDisplayName: "Explore Agent" }, id: "e-4", timestamp: ts(3000), parentId: null },
      { type: "tool.execution_start", data: { toolCallId: "tc-child-view", toolName: "view", arguments: { path: "src/index.ts" }, parentToolCallId: "tc-orphan" }, id: "e-5", timestamp: ts(4000), parentId: null },
      { type: "tool.execution_complete", data: { toolCallId: "tc-child-view", toolName: "view", success: true, result: { content: "ok" } }, id: "e-6", timestamp: ts(5000), parentId: null },
      { type: "subagent.completed", data: { toolCallId: "tc-orphan", agentName: "explore" }, id: "e-7", timestamp: ts(6000), parentId: null },
      { type: "assistant.turn_end", data: { turnId: "0" }, id: "e-8", timestamp: ts(7000), parentId: null },
    ]);

    var result = parseCopilotCliJSONL(trace);
    var childTool = result.events.find(function (e) { return e.toolName === "view"; });
    expect(childTool).toBeDefined();
    expect(childTool.parentToolCallId).toBe("tc-orphan");
    // Should resolve from lifecycle metadata even without task tool start
    expect(childTool.agentName).toBe("explore");
    expect(childTool.agentDisplayName).toBe("Explore Agent");
  });
});
