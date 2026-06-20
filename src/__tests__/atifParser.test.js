import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { parseAtifJSON, detectAtif } from "../lib/atifParser";

function loadFixture(name) {
  return fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8");
}

describe("detectAtif", function () {
  it("detects a minimal ATIF object by schema_version prefix", function () {
    const text = '{"schema_version":"ATIF-v1.6","session_id":"x","agent":{"name":"a","version":"1"},"steps":[]}';
    expect(detectAtif(text)).toBe(true);
  });

  it("rejects an object without ATIF schema_version", function () {
    expect(detectAtif('{"foo":"bar"}')).toBe(false);
  });

  it("does not throw on non-JSON input", function () {
    expect(detectAtif("not json")).toBe(false);
  });

  it("rejects JSONL input (multiple top-level documents)", function () {
    const text = '{"type":"session.start"}\n{"type":"user.message"}';
    expect(detectAtif(text)).toBe(false);
  });
});

describe("parseAtifJSON -- d2-parse-minimal", function () {
  const text = loadFixture("atif-minimal.json");
  const session = parseAtifJSON(text);

  it("returns a non-null parse result", function () {
    expect(session).not.toBeNull();
  });

  it("reports the atif format and primary model", function () {
    expect(session.metadata.format).toBe("atif");
    expect(session.metadata.primaryModel).toBe("gpt-test");
  });

  it("aggregates token usage from final_metrics", function () {
    expect(session.metadata.tokenUsage.inputTokens).toBe(220);
    expect(session.metadata.tokenUsage.outputTokens).toBe(25);
    expect(session.metadata.tokenUsage.cacheRead).toBe(50);
  });

  it("emits at least four normalized events", function () {
    expect(session.events.length).toBeGreaterThanOrEqual(4);
  });

  it("emits a tool_call event for write_file", function () {
    const toolEvents = session.events.filter(function (e) {
      return e.track === "tool_call" && e.toolName === "write_file";
    });
    expect(toolEvents.length).toBeGreaterThanOrEqual(1);
  });

  it("emits at least one turn", function () {
    expect(session.turns.length).toBeGreaterThanOrEqual(1);
  });

  it("emits both user and assistant events", function () {
    const hasUser = session.events.some(function (e) { return e.agent === "user"; });
    const hasAssistant = session.events.some(function (e) { return e.agent === "assistant"; });
    expect(hasUser).toBe(true);
    expect(hasAssistant).toBe(true);
  });
});

describe("parseAtifJSON -- d3-parse-tagged", function () {
  const text = loadFixture("atif-tagged.json");
  const session = parseAtifJSON(text);

  it("returns a non-null parse result", function () {
    expect(session).not.toBeNull();
  });

  it("emits events for all the tagged steps", function () {
    expect(session.metadata.totalEvents).toBeGreaterThan(0);
  });

  it("aggregates token usage from final_metrics", function () {
    expect(session.metadata.tokenUsage.inputTokens).toBe(12000);
    expect(session.metadata.tokenUsage.outputTokens).toBe(3400);
    expect(session.metadata.tokenUsage.cacheRead).toBe(9000);
  });

  it("reports the agent model as primaryModel", function () {
    expect(session.metadata.primaryModel).toBe("gpt-5.4");
  });

  it("emits at least one reasoning event", function () {
    const reasoning = session.events.filter(function (e) { return e.track === "reasoning"; });
    expect(reasoning.length).toBeGreaterThanOrEqual(1);
  });

  it("emits at least one tool_call event", function () {
    const tools = session.events.filter(function (e) { return e.track === "tool_call"; });
    expect(tools.length).toBeGreaterThanOrEqual(1);
  });
});

describe("parseAtifJSON -- d4-tool-linking", function () {
  const text = loadFixture("atif-minimal.json");
  const session = parseAtifJSON(text);

  it("links observations back to their tool call via parentToolCallId", function () {
    const toolCall = session.events.find(function (e) {
      return e.track === "tool_call" && e.toolCallId === "call_1";
    });
    expect(toolCall).toBeDefined();

    const observation = session.events.find(function (e) {
      return e.parentToolCallId === "call_1";
    });
    expect(observation).toBeDefined();
  });
});

describe("parseAtifJSON -- d5-multimodal", function () {
  const text = loadFixture("atif-multimodal.json");

  it("does not throw and returns a parse result", function () {
    let session;
    expect(function () {
      session = parseAtifJSON(text);
    }).not.toThrow();
    expect(session).not.toBeNull();
  });

  it("renders image content parts as a placeholder", function () {
    const session = parseAtifJSON(text);
    const imageEvent = session.events.find(function (e) {
      return typeof e.text === "string" && e.text.indexOf("[image:") !== -1;
    });
    expect(imageEvent).toBeDefined();
  });
});

describe("parseAtifJSON -- d6-copied-context", function () {
  const text = loadFixture("atif-edge.json");
  const session = parseAtifJSON(text);

  it("retains all events from copied-context steps", function () {
    const copiedEvents = session.events.filter(function (e) {
      return e.raw && e.raw.isCopiedContext === true;
    });
    expect(copiedEvents.length).toBeGreaterThanOrEqual(1);
  });

  it("excludes copied tool_calls from totalToolCalls", function () {
    const allToolCalls = session.events.filter(function (e) { return e.track === "tool_call"; });
    const copiedToolCalls = allToolCalls.filter(function (e) {
      return e.raw && e.raw.isCopiedContext === true;
    });
    expect(session.metadata.totalToolCalls + copiedToolCalls.length).toBe(allToolCalls.length);
  });
});

describe("parseAtifJSON -- d9-warnings", function () {
  it("emits a warning for non-sequential step_ids without dropping the parse", function () {
    const text = JSON.stringify({
      schema_version: "ATIF-v1.6",
      session_id: "test-bad-ids",
      agent: { name: "test", version: "1.0", model_name: "x" },
      steps: [
        { step_id: 1, source: "user", message: "hi" },
        { step_id: 3, source: "agent", message: "yo" },
        { step_id: 4, source: "agent", message: "ok" },
      ],
    });

    const session = parseAtifJSON(text);
    expect(session).not.toBeNull();
    expect(Array.isArray(session.metadata.warnings)).toBe(true);
    expect(session.metadata.warnings.length).toBeGreaterThan(0);
    const hasStepIdWarning = session.metadata.warnings.some(function (w) {
      return typeof w === "string" && /step_id/i.test(w);
    });
    expect(hasStepIdWarning).toBe(true);
  });
});

describe("parseAtifJSON -- recent regressions (turn segmentation, message duration cap, optional tool durations)", function () {
  function makeAtif(steps) {
    return JSON.stringify({
      schema_version: "ATIF-v1.6",
      session_id: "regression-test",
      agent: { name: "test-agent", version: "1.0", model_name: "test-model" },
      steps,
    });
  }

  it("creates one turn per step instead of collapsing all agent steps into turn 0", function () {
    const text = makeAtif([
      { step_id: 1, timestamp: "2026-04-18T05:48:00.000Z", source: "user", message: "do thing" },
      { step_id: 2, timestamp: "2026-04-18T05:48:05.000Z", source: "agent", message: "step 1", tool_calls: [{ tool_call_id: "c1", function_name: "bash", arguments: {} }] },
      { step_id: 3, timestamp: "2026-04-18T05:48:10.000Z", source: "agent", message: "step 2" },
      { step_id: 4, timestamp: "2026-04-18T05:48:15.000Z", source: "agent", message: "step 3" },
    ]);
    const session = parseAtifJSON(text);
    expect(session).not.toBeNull();
    expect(session.turns.length).toBe(4);
    // Each event should be assigned to the turn matching its step.
    const turnIndices = session.events.map(function (e) { return e.turnIndex; });
    expect(turnIndices.every(function (i) { return typeof i === "number" && i >= 0 && i < 4; })).toBe(true);
    // Steps must produce distinct turn indices (no collapse onto turn 0).
    const distinct = Array.from(new Set(turnIndices));
    expect(distinct.length).toBeGreaterThan(1);
  });

  it("ignores extra.turn collisions so user step and first agent step do not share a turn id", function () {
    const text = makeAtif([
      { step_id: 1, timestamp: "2026-04-18T05:48:00.000Z", source: "user", message: "do thing" },
      // Agent emitter sets extra.turn=0; the array index is 1, which is what we use.
      { step_id: 2, timestamp: "2026-04-18T05:48:05.000Z", source: "agent", message: "first agent", extra: { turn: 0 } },
    ]);
    const session = parseAtifJSON(text);
    const userEvents = session.events.filter(function (e) { return e.agent === "user"; });
    const agentEvents = session.events.filter(function (e) { return e.agent === "assistant"; });
    expect(userEvents.length).toBeGreaterThan(0);
    expect(agentEvents.length).toBeGreaterThan(0);
    expect(userEvents[0].turnIndex).not.toBe(agentEvents[0].turnIndex);
  });

  it("preserves per-step turn indices when steps share a timestamp", function () {
    const text = makeAtif([
      { step_id: 1, timestamp: "2026-04-18T05:48:00.000Z", source: "user", message: "first" },
      { step_id: 2, timestamp: "2026-04-18T05:48:00.000Z", source: "agent", message: "second" },
      { step_id: 3, timestamp: "2026-04-18T05:48:00.000Z", source: "agent", message: "third" },
    ]);

    const session = parseAtifJSON(text);
    expect(session).not.toBeNull();
    expect(session.events.map(function (event) { return event.turnIndex; })).toEqual([0, 1, 2]);
    for (let index = 0; index < session.turns.length; index += 1) {
      expect(session.turns[index].eventIndices).toEqual([index]);
    }
  });

  it("caps message duration to the step's wall-clock gap so the bar does not bleed into the next step", function () {
    const text = makeAtif([
      { step_id: 1, timestamp: "2026-04-18T05:48:00.000Z", source: "user", message: "go" },
      // ttft_ms (141s) is far larger than the gap to next step (10s). Must clamp.
      {
        step_id: 2,
        timestamp: "2026-04-18T05:48:05.000Z",
        source: "agent",
        message: "long streaming reply",
        extra: { ttft_ms: 141000 },
      },
      { step_id: 3, timestamp: "2026-04-18T05:48:15.000Z", source: "agent", message: "next" },
    ]);
    const session = parseAtifJSON(text);
    const messageEvent = session.events.find(function (e) {
      return e.agent === "assistant" && e.text === "long streaming reply";
    });
    expect(messageEvent).toBeDefined();
    // Step 2 starts at 5s, step 3 at 15s -- max allowed duration is 10s, never 141s.
    expect(messageEvent.duration).toBeLessThanOrEqual(10);
    expect(messageEvent.duration).toBeGreaterThan(0);
  });

  it("places parallel tool calls within a step at the same start time", function () {
    const text = makeAtif([
      { step_id: 1, timestamp: "2026-04-18T05:48:00.000Z", source: "user", message: "go" },
      {
        step_id: 2,
        timestamp: "2026-04-18T05:48:05.000Z",
        source: "agent",
        message: "",
        tool_calls: [
          { tool_call_id: "a", function_name: "tool_a", arguments: {} },
          { tool_call_id: "b", function_name: "tool_b", arguments: {} },
          { tool_call_id: "c", function_name: "tool_c", arguments: {} },
        ],
      },
    ]);
    const session = parseAtifJSON(text);
    const toolEvents = session.events.filter(function (e) { return e.track === "tool_call"; });
    expect(toolEvents.length).toBe(3);
    const times = toolEvents.map(function (e) { return e.t; });
    expect(times[0]).toBe(times[1]);
    expect(times[1]).toBe(times[2]);
  });

  it("honours optional duration_ms / latency_ms / elapsed_ms on tool calls (forward compatible)", function () {
    const text = makeAtif([
      { step_id: 1, timestamp: "2026-04-18T05:48:00.000Z", source: "user", message: "go" },
      {
        step_id: 2,
        timestamp: "2026-04-18T05:48:05.000Z",
        source: "agent",
        message: "",
        tool_calls: [
          { tool_call_id: "a", function_name: "fast", arguments: {}, duration_ms: 250 },
          { tool_call_id: "b", function_name: "slow", arguments: {}, metrics: { latency_ms: 4000 } },
          { tool_call_id: "c", function_name: "extra", arguments: {}, extra: { elapsed_ms: 1500 } },
          { tool_call_id: "d", function_name: "untimed", arguments: {} },
        ],
      },
    ]);
    const session = parseAtifJSON(text);
    const byName = function (n) {
      return session.events.find(function (e) { return e.toolName === n; });
    };
    expect(byName("fast").duration).toBeCloseTo(0.25, 5);
    expect(byName("slow").duration).toBeCloseTo(4, 5);
    expect(byName("extra").duration).toBeCloseTo(1.5, 5);
    expect(byName("untimed").duration).toBe(0);
  });

  it("honours optional duration_ms on observation results", function () {
    const text = makeAtif([
      { step_id: 1, timestamp: "2026-04-18T05:48:00.000Z", source: "user", message: "go" },
      {
        step_id: 2,
        timestamp: "2026-04-18T05:48:05.000Z",
        source: "agent",
        message: "",
        tool_calls: [{ tool_call_id: "a", function_name: "bash", arguments: {} }],
        observation: {
          results: [
            { source_call_id: "a", content: "ok", duration_ms: 750 },
          ],
        },
      },
    ]);
    const session = parseAtifJSON(text);
    const obsEvent = session.events.find(function (e) { return e.track === "context"; });
    expect(obsEvent).toBeDefined();
    expect(obsEvent.duration).toBeCloseTo(0.75, 5);
  });

  it("surfaces metrics.cost_usd by summing per-step costs into totalCostUsd", function () {
    const text = makeAtif([
      { step_id: 1, timestamp: "2026-04-18T05:48:00.000Z", source: "user", message: "go" },
      { step_id: 2, timestamp: "2026-04-18T05:48:05.000Z", source: "agent", message: "a", metrics: { cost_usd: 0.012 } },
      { step_id: 3, timestamp: "2026-04-18T05:48:10.000Z", source: "agent", message: "b", metrics: { cost_usd: 0.008 } },
    ]);
    const session = parseAtifJSON(text);
    expect(session.metadata.totalCost).toBeCloseTo(0.02, 5);
  });

  it("prefers final_metrics.total_cost_usd when present", function () {
    const text = JSON.stringify({
      schema_version: "ATIF-v1.6",
      session_id: "cost-test",
      agent: { name: "test", version: "1.0", model_name: "m" },
      steps: [
        { step_id: 1, timestamp: "2026-04-18T05:48:00.000Z", source: "user", message: "go" },
        { step_id: 2, timestamp: "2026-04-18T05:48:05.000Z", source: "agent", message: "a", metrics: { cost_usd: 0.012 } },
      ],
      final_metrics: { total_cost_usd: 1.23 },
    });
    const session = parseAtifJSON(text);
    expect(session.metadata.totalCost).toBeCloseTo(1.23, 5);
  });

  it("emits metadata.modelTokenUsage per model so StatsView can compute per-model cost", function () {
    const text = JSON.stringify({
      schema_version: "ATIF-v1.6",
      session_id: "mt-test",
      agent: { name: "test", version: "1.0", model_name: "m1" },
      steps: [
        { step_id: 1, timestamp: "2026-04-18T05:48:00.000Z", source: "user", message: "go" },
        { step_id: 2, timestamp: "2026-04-18T05:48:05.000Z", source: "agent", model_name: "m1", message: "a", metrics: { prompt_tokens: 100, completion_tokens: 20, cached_tokens: 50 } },
        { step_id: 3, timestamp: "2026-04-18T05:48:10.000Z", source: "agent", model_name: "m2", message: "b", metrics: { prompt_tokens: 40, completion_tokens: 5, cached_tokens: 10 } },
      ],
    });
    const session = parseAtifJSON(text);
    expect(session.metadata.modelTokenUsage).toBeDefined();
    expect(session.metadata.modelTokenUsage.m1.inputTokens).toBe(100);
    expect(session.metadata.modelTokenUsage.m1.outputTokens).toBe(20);
    expect(session.metadata.modelTokenUsage.m1.cacheRead).toBe(50);
    expect(session.metadata.modelTokenUsage.m2.inputTokens).toBe(40);
  });

  it("pairs tool_call events with their observation result via source_call_id and exposes it as toolOutput", function () {
    const text = makeAtif([
      { step_id: 1, timestamp: "2026-04-18T05:48:00.000Z", source: "user", message: "go" },
      {
        step_id: 2,
        timestamp: "2026-04-18T05:48:05.000Z",
        source: "agent",
        message: "",
        tool_calls: [
          { tool_call_id: "call_a", function_name: "bash", arguments: { command: "ls" } },
          { tool_call_id: "call_b", function_name: "bash", arguments: { command: "pwd" } },
        ],
        observation: {
          results: [
            { source_call_id: "call_b", content: "/tmp" },
            { source_call_id: "call_a", content: "file1.txt\nfile2.txt" },
          ],
        },
      },
    ]);
    const session = parseAtifJSON(text);
    const toolEvents = session.events.filter(function (e) { return e.track === "tool_call"; });
    const callA = toolEvents.find(function (e) { return e.toolCallId === "call_a"; });
    const callB = toolEvents.find(function (e) { return e.toolCallId === "call_b"; });
    expect(callA.toolOutput).toBe("file1.txt\nfile2.txt");
    expect(callB.toolOutput).toBe("/tmp");
  });

  it("reads subagent_trajectory_ref from observation results (per ATIF v1.6 spec) as a list", function () {
    const text = makeAtif([
      { step_id: 1, timestamp: "2026-04-18T05:48:00.000Z", source: "user", message: "go" },
      {
        step_id: 2,
        timestamp: "2026-04-18T05:48:05.000Z",
        source: "agent",
        message: "",
        tool_calls: [{ tool_call_id: "a", function_name: "delegate", arguments: {} }],
        observation: {
          results: [
            {
              source_call_id: "a",
              content: "delegated",
              subagent_trajectory_ref: [
                { session_id: "sub-1", trajectory_path: "sub-1.json" },
                { session_id: "sub-2" },
              ],
            },
          ],
        },
      },
    ]);
    const session = parseAtifJSON(text);
    const obsEvent = session.events.find(function (e) { return e.track === "context"; });
    expect(obsEvent).toBeDefined();
    const refs = obsEvent.raw && obsEvent.raw.subagentTrajectoryRefs;
    expect(Array.isArray(refs)).toBe(true);
    expect(refs.length).toBe(2);
    expect(refs[0].session_id).toBe("sub-1");
    expect(refs[0].trajectory_path).toBe("sub-1.json");
    expect(refs[1].session_id).toBe("sub-2");
  });
});
