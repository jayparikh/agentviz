import { describe, it, expect } from "vitest";
import { extractSkills } from "../lib/skillExtractor";

// ── Test helpers ─────────────────────────────────────────────────────────────

function makeEvent(overrides) {
  return Object.assign({
    t: 0,
    agent: "assistant",
    track: "tool_call",
    text: "test",
    duration: 1,
    intensity: 0.6,
    raw: {},
    turnIndex: 0,
    isError: false,
  }, overrides);
}

function makeMeta(overrides) {
  return Object.assign({
    totalEvents: 0,
    totalTurns: 0,
    totalToolCalls: 0,
    errorCount: 0,
    duration: 0,
    models: {},
    primaryModel: null,
    format: "vscode-chat",
  }, overrides);
}

function makeTurn(overrides) {
  return Object.assign({
    index: 0,
    startTime: 0,
    endTime: 10,
    eventIndices: [0],
    userMessage: "",
    toolCount: 0,
    hasError: false,
  }, overrides);
}

// ── extractSkills ────────────────────────────────────────────────────────────

describe("extractSkills", function () {

  it("returns empty summary for empty events", function () {
    var result = extractSkills([], [], makeMeta());
    expect(result.totalSkills).toBe(0);
    expect(result.totalInvocations).toBe(0);
    expect(result.skills).toEqual([]);
  });

  it("extracts built-in tool calls with full lifecycle", function () {
    var events = [
      makeEvent({ toolName: "readFile", track: "tool_call" }),
      makeEvent({ toolName: "readFile", track: "tool_call", t: 1 }),
      makeEvent({ toolName: "run_in_terminal", track: "tool_call", t: 2 }),
    ];
    var result = extractSkills(events, [], makeMeta({ totalEvents: 3 }));

    expect(result.totalSkills).toBe(2);
    var readFile = result.skills.find(function (s) { return s.name === "readFile"; });
    expect(readFile).toBeDefined();
    expect(readFile.source).toBe("built-in");
    expect(readFile.category).toBe("tool");
    expect(readFile.invocationCount).toBe(2);
    expect(readFile.maxStage).toBe("completed");
    // First call should have discovered + invoked + completed = 3 events
    // Second call should have invoked + completed = 2 events
    // Total: 5 events for readFile
    expect(readFile.events.length).toBe(5);
    // First event should be "discovered"
    expect(readFile.events[0].stage).toBe("discovered");
    expect(readFile.events[1].stage).toBe("invoked");
    expect(readFile.events[2].stage).toBe("completed");
  });

  it("extracts MCP tool by source field", function () {
    var events = [
      makeEvent({
        toolName: "query_database",
        track: "tool_call",
        raw: { source: { type: "mcp", label: "postgres-mcp" } },
      }),
    ];
    var result = extractSkills(events, [], makeMeta());
    var tool = result.skills.find(function (s) { return s.name === "query_database"; });
    expect(tool).toBeDefined();
    expect(tool.source).toBe("mcp");
  });

  it("extracts extension tools", function () {
    var events = [
      makeEvent({
        toolName: "custom_lint",
        track: "tool_call",
        raw: { source: { type: "extension", label: "My Extension" } },
      }),
    ];
    var result = extractSkills(events, [], makeMeta());
    var tool = result.skills.find(function (s) { return s.name === "custom_lint"; });
    expect(tool).toBeDefined();
    expect(tool.source).toBe("extension");
  });

  it("classifies unrecognized tools as built-in (no false extension guessing)", function () {
    var events = [
      makeEvent({ toolName: "some_exotic_tool", track: "tool_call" }),
    ];
    var result = extractSkills(events, [], makeMeta());
    var tool = result.skills.find(function (s) { return s.name === "some_exotic_tool"; });
    expect(tool.source).toBe("built-in");
  });

  it("classifies hyphenated tools as MCP by naming convention", function () {
    var events = [
      makeEvent({ toolName: "binlog-mcp-load_binlog", track: "tool_call" }),
    ];
    var result = extractSkills(events, [], makeMeta());
    var tool = result.skills.find(function (s) { return s.name === "binlog-mcp-load_binlog"; });
    expect(tool.source).toBe("mcp");
    expect(tool.sourceLabel).toMatch(/binlog-mcp/);
  });

  it("tracks errored tools", function () {
    var events = [
      makeEvent({ toolName: "run_in_terminal", track: "tool_call", isError: true }),
    ];
    var result = extractSkills(events, [], makeMeta());
    var tool = result.skills.find(function (s) { return s.name === "run_in_terminal"; });
    expect(tool.errorCount).toBe(1);
    expect(tool.maxStage).toBe("errored");
  });

  it("errored overrides completed when completed comes first", function () {
    var events = [
      makeEvent({ toolName: "run_in_terminal", track: "tool_call", t: 0, isError: false }),
      makeEvent({ toolName: "run_in_terminal", track: "tool_call", t: 1, isError: true }),
    ];
    var result = extractSkills(events, [], makeMeta());
    var tool = result.skills.find(function (s) { return s.name === "run_in_terminal"; });
    expect(tool.maxStage).toBe("errored");
    expect(tool.errorCount).toBe(1);
    expect(tool.invocationCount).toBe(2);
  });

  it("extracts custom instructions with discovered + loaded stages", function () {
    var events = [
      makeEvent({
        agent: "user",
        track: "output",
        text: "Help me fix a bug",
        raw: {
          variableData: {
            variables: [
              {
                kind: "promptFile",
                name: "prompt:copilot-instructions.md",
                value: { path: "/.github/copilot-instructions.md" },
                automaticallyAdded: true,
                originLabel: "Automatically attached",
              },
            ],
          },
        },
      }),
    ];
    var result = extractSkills(events, [], makeMeta({ format: "vscode-chat" }));
    var instr = result.skills.find(function (s) { return s.category === "instruction"; });
    expect(instr).toBeDefined();
    expect(instr.source).toBe("project");
    expect(instr.autoLoaded).toBe(true);
    expect(instr.maxStage).toBe("loaded");
    // Should have discovered + loaded
    expect(instr.events.length).toBe(2);
    expect(instr.events[0].stage).toBe("discovered");
    expect(instr.events[1].stage).toBe("loaded");
  });

  it("extracts custom agent with discovered + invoked stages", function () {
    var events = [
      makeEvent({
        agent: "user",
        track: "output",
        text: "Help",
        raw: {
          inputState: {
            mode: { id: "file:///c%3A/project/.github/agents/reviewer.agent.md", kind: "agent" },
          },
        },
      }),
    ];
    var result = extractSkills(events, [], makeMeta());
    var agent = result.skills.find(function (s) { return s.category === "agent"; });
    expect(agent).toBeDefined();
    expect(agent.name).toBe("reviewer");
    expect(agent.maxStage).toBe("invoked");
    // Should have discovered + invoked
    expect(agent.events.length).toBe(2);
    expect(agent.events[0].stage).toBe("discovered");
    expect(agent.events[1].stage).toBe("invoked");
  });

  it("extracts MCP server starts with discovered + loaded stages", function () {
    var events = [
      makeEvent({
        track: "context",
        text: "MCP servers starting",
        raw: { kind: "mcpServersStarting", didStartServerIds: ["postgres", "github"] },
      }),
    ];
    var result = extractSkills(events, [], makeMeta());
    expect(result.byCategory["mcp-server"].length).toBe(2);
    var pg = result.skills.find(function (s) { return s.name === "postgres"; });
    expect(pg).toBeDefined();
    expect(pg.source).toBe("mcp");
    expect(pg.maxStage).toBe("loaded");
    // Should have discovered + loaded = 2 events
    expect(pg.events.length).toBe(2);
    expect(pg.events[0].stage).toBe("discovered");
    expect(pg.events[1].stage).toBe("loaded");
  });

  it("detects slash-command skill invocations", function () {
    var events = [
      makeEvent({ agent: "user", track: "output", text: "/webapp-testing for login", t: 0 }),
    ];
    var turns = [
      makeTurn({ index: 0, userMessage: "/webapp-testing for login", eventIndices: [0] }),
    ];
    var result = extractSkills(events, turns, makeMeta());
    var skill = result.skills.find(function (s) { return s.name === "/webapp-testing"; });
    expect(skill).toBeDefined();
    expect(skill.category).toBe("skill");
    expect(skill.maxStage).toBe("invoked");
  });

  it("ignores built-in slash commands", function () {
    var events = [
      makeEvent({ agent: "user", track: "output", text: "/help" }),
    ];
    var turns = [
      makeTurn({ index: 0, userMessage: "/help", eventIndices: [0] }),
    ];
    var result = extractSkills(events, turns, makeMeta());
    var help = result.skills.find(function (s) { return s.name === "/help"; });
    expect(help).toBeUndefined();
  });

  it("detects context references to skill files", function () {
    var events = [
      makeEvent({
        track: "context",
        text: ".github/skills/webapp-testing/SKILL.md",
      }),
    ];
    var result = extractSkills(events, [], makeMeta());
    var skill = result.skills.find(function (s) { return s.category === "skill"; });
    expect(skill).toBeDefined();
    expect(skill.source).toBe("project");
    expect(skill.maxStage).toBe("resource-accessed");
  });

  it("groups by source correctly", function () {
    var events = [
      makeEvent({ toolName: "readFile", track: "tool_call" }),
      makeEvent({
        toolName: "db_query", track: "tool_call",
        raw: { source: { type: "mcp", label: "db" } },
      }),
      makeEvent({
        track: "context", text: ".github/skills/test/SKILL.md",
      }),
    ];
    var result = extractSkills(events, [], makeMeta());
    expect(result.bySource["built-in"].length).toBe(1);
    expect(result.bySource["mcp"].length).toBe(1);
    expect(result.bySource["project"].length).toBe(1);
  });

  it("sorts skills by stage then invocation count", function () {
    var events = [
      makeEvent({ toolName: "readFile", track: "tool_call", t: 0 }),
      makeEvent({ toolName: "readFile", track: "tool_call", t: 1 }),
      makeEvent({ toolName: "readFile", track: "tool_call", t: 2 }),
      makeEvent({
        track: "context",
        text: ".github/copilot-instructions.md",
        t: 3,
      }),
    ];
    var result = extractSkills(events, [], makeMeta());
    // readFile (completed, 3 invocations) should come before instruction (resource-accessed)
    expect(result.skills[0].name).toBe("readFile");
  });

  it("handles mixed session with multiple capability types", function () {
    var events = [
      // User message with instructions attached
      makeEvent({
        agent: "user", track: "output", text: "Fix the bug", t: 0,
        raw: {
          variableData: {
            variables: [{
              kind: "promptFile",
              name: "prompt:copilot-instructions.md",
              value: { path: "/.github/copilot-instructions.md" },
              automaticallyAdded: true,
            }],
          },
        },
      }),
      // MCP server start
      makeEvent({
        track: "context", text: "MCP starting", t: 1,
        raw: { kind: "mcpServersStarting", didStartServerIds: ["github-mcp"] },
      }),
      // Built-in tool calls
      makeEvent({ toolName: "readFile", track: "tool_call", t: 2 }),
      makeEvent({ toolName: "replaceString", track: "tool_call", t: 3 }),
      // MCP tool call
      makeEvent({
        toolName: "create_issue", track: "tool_call", t: 4,
        raw: { source: { type: "mcp", label: "github-mcp" } },
      }),
    ];
    var turns = [makeTurn({ index: 0, userMessage: "Fix the bug", eventIndices: [0, 1, 2, 3, 4] })];
    var result = extractSkills(events, turns, makeMeta({ format: "vscode-chat" }));

    expect(result.totalSkills).toBeGreaterThanOrEqual(4); // instruction, mcp-server, 2 tools, mcp tool
    expect(result.bySource["built-in"].length).toBe(2);
    expect(result.bySource["mcp"].length).toBeGreaterThanOrEqual(1);
    expect(result.byCategory["instruction"].length).toBe(1);
    expect(result.byCategory["mcp-server"].length).toBe(1);
  });
});
