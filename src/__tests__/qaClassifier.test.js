import { describe, expect, it } from "vitest";
import { classify, buildModelContext, getSessionIndex, searchToolIndex } from "../lib/qaClassifier.js";

// ── Fixtures ────────────────────────────────────────────────────────────────

function makeSession(overrides) {
  var events = overrides.events || [
    { t: 0, agent: "user", track: "output", text: "Fix the bug", duration: 1, intensity: 0.5, isError: false, turnIndex: 0 },
    { t: 2, agent: "assistant", track: "tool_call", text: "cat src/auth.ts", duration: 3, intensity: 0.8, isError: false, turnIndex: 0, toolName: "bash" },
    { t: 6, agent: "assistant", track: "tool_call", text: "grep -rn validate src/", duration: 2, intensity: 0.6, isError: false, turnIndex: 0, toolName: "grep" },
    { t: 10, agent: "assistant", track: "tool_call", text: "npm test", duration: 4, intensity: 0.9, isError: true, turnIndex: 1, toolName: "bash" },
    { t: 16, agent: "assistant", track: "tool_call", text: "edit src/auth.ts", duration: 2, intensity: 0.7, isError: false, turnIndex: 1, toolName: "edit" },
    { t: 20, agent: "assistant", track: "tool_call", text: "npm test (passed)", duration: 3, intensity: 0.8, isError: false, turnIndex: 1, toolName: "bash" },
  ];
  var turns = overrides.turns || [
    { index: 0, startTime: 0, endTime: 9, eventIndices: [0, 1, 2], userMessage: "Fix the bug", toolCount: 2, hasError: false },
    { index: 1, startTime: 10, endTime: 25, eventIndices: [3, 4, 5], userMessage: "Try again", toolCount: 3, hasError: true },
  ];
  var metadata = Object.assign({
    totalEvents: events.length,
    totalTurns: turns.length,
    totalToolCalls: 5,
    errorCount: 1,
    duration: 25,
    models: { "claude-sonnet-4": 3 },
    primaryModel: "claude-sonnet-4",
    format: "claude-code",
    tokenUsage: { inputTokens: 5000, outputTokens: 2000, cacheRead: 1000 },
  }, overrides.metadata || {});
  var autonomyMetrics = Object.assign({
    autonomyEfficiency: 0.72,
    productiveRuntime: 15,
    babysittingTime: 4,
    idleTime: 6,
    interventionCount: 1,
    totalToolCalls: 5,
    topTools: [{ name: "bash", count: 3 }, { name: "edit", count: 1 }, { name: "grep", count: 1 }],
  }, overrides.autonomyMetrics || {});

  return { events: events, turns: turns, metadata: metadata, autonomyMetrics: autonomyMetrics };
}

var SESSION = makeSession({});

// ── Tool questions ──────────────────────────────────────────────────────────

describe("classify: tools", function () {
  it("answers 'what tools were used?'", function () {
    var r = classify("What tools were used?", SESSION);
    expect(r.tier).toBe("instant");
    expect(r.answer).toContain("bash");
    expect(r.answer).toContain("5 tool call");
  });

  it("answers 'which tool was most used'", function () {
    var r = classify("Which tool was most used?", SESSION);
    expect(r.tier).toBe("instant");
    expect(r.answer).toContain("bash");
  });

  it("lists tools in descending order", function () {
    var r = classify("list all tools", SESSION);
    expect(r.tier).toBe("instant");
    var bashIdx = r.answer.indexOf("bash");
    var editIdx = r.answer.indexOf("edit");
    expect(bashIdx).toBeLessThan(editIdx);
  });

  it("handles session with no tool calls", function () {
    var empty = makeSession({ events: [], metadata: { totalToolCalls: 0 } });
    var r = classify("what tools were used", empty);
    expect(r.tier).toBe("instant");
    expect(r.answer).toContain("No tool calls");
  });
});

// ── Error questions ─────────────────────────────────────────────────────────

describe("classify: errors", function () {
  it("answers 'what errors occurred?'", function () {
    var r = classify("What errors occurred?", SESSION);
    expect(r.tier).toBe("instant");
    expect(r.answer).toContain("1 error");
  });

  it("matches 'did anything fail'", function () {
    var r = classify("Did anything fail?", SESSION);
    expect(r.tier).toBe("instant");
  });

  it("handles zero errors", function () {
    var clean = makeSession({ metadata: { errorCount: 0 }, events: [] });
    var r = classify("any errors?", clean);
    expect(r.tier).toBe("instant");
    expect(r.answer).toContain("No errors");
  });

  it("includes turn references in error answers", function () {
    var r = classify("what errors occurred?", SESSION);
    expect(r.answer).toContain("Turn 1");
  });
});

// ── Model questions ─────────────────────────────────────────────────────────

describe("classify: model", function () {
  it("answers 'what model was used?'", function () {
    var r = classify("What model was used?", SESSION);
    expect(r.tier).toBe("instant");
    expect(r.answer).toContain("claude-sonnet-4");
  });

  it("handles missing model info", function () {
    var noModel = makeSession({ metadata: { primaryModel: null, models: {} } });
    var r = classify("which model?", noModel);
    expect(r.tier).toBe("instant");
    expect(r.answer).toContain("No model information");
  });

  it("lists multiple models when present", function () {
    var multi = makeSession({ metadata: { primaryModel: "claude-sonnet-4", models: { "claude-sonnet-4": 3, "gpt-4o": 2 } } });
    var r = classify("what model was used?", multi);
    expect(r.answer).toContain("gpt-4o");
    expect(r.answer).toContain("claude-sonnet-4");
  });
});

// ── Duration questions ──────────────────────────────────────────────────────

describe("classify: duration", function () {
  it("answers 'how long did it take?'", function () {
    var r = classify("How long did it take?", SESSION);
    expect(r.tier).toBe("instant");
    expect(r.answer).toContain("25s");
  });

  it("handles missing duration", function () {
    var noDur = makeSession({ metadata: { duration: 0 } });
    var r = classify("how long did it take?", noDur);
    expect(r.tier).toBe("instant");
    expect(r.answer).toContain("not available");
  });
});

// ── Cost questions ──────────────────────────────────────────────────────────

describe("classify: cost", function () {
  it("answers 'how much did this cost?'", function () {
    var r = classify("How much did this cost?", SESSION);
    expect(r.tier).toBe("instant");
    expect(r.answer).toContain("$");
    expect(r.answer).toContain("Input tokens");
  });

  it("handles 'how many tokens'", function () {
    var r = classify("How many tokens were used?", SESSION);
    expect(r.tier).toBe("instant");
    expect(r.answer).toContain("5,000");
  });

  it("handles missing token data", function () {
    var noTokens = makeSession({ metadata: { tokenUsage: null } });
    var r = classify("how much did it cost?", noTokens);
    expect(r.tier).toBe("instant");
    expect(r.answer).toContain("No token usage");
  });
});

// ── Turn count questions ────────────────────────────────────────────────────

describe("classify: turn count", function () {
  it("answers 'how many turns?'", function () {
    var r = classify("How many turns?", SESSION);
    expect(r.tier).toBe("instant");
    expect(r.answer).toContain("2 turns");
  });
});

// ── Turn detail questions ───────────────────────────────────────────────────

describe("classify: turn N detail", function () {
  it("answers 'what happened in turn 0?'", function () {
    var r = classify("What happened in turn 0?", SESSION);
    expect(r.tier).toBe("instant");
    expect(r.answer).toContain("Turn 0");
    expect(r.answer).toContain("Fix the bug");
  });

  it("answers 'tell me about turn 1'", function () {
    var r = classify("Tell me about turn 1", SESSION);
    expect(r.tier).toBe("instant");
    expect(r.answer).toContain("Turn 1");
    expect(r.answer).toContain("Errors: 1");
  });

  it("handles out-of-range turn", function () {
    var r = classify("What happened in turn 99?", SESSION);
    expect(r.tier).toBe("instant");
    expect(r.answer).toContain("not found");
    expect(r.answer).toContain("2 turns");
  });

  it("handles 'turn #3' syntax", function () {
    var r = classify("describe turn #0", SESSION);
    expect(r.tier).toBe("instant");
    expect(r.answer).toContain("Turn 0");
  });
});

// ── Autonomy questions ──────────────────────────────────────────────────────

describe("classify: autonomy", function () {
  it("answers 'how autonomous was this session?'", function () {
    var r = classify("How autonomous was this session?", SESSION);
    expect(r.tier).toBe("instant");
    expect(r.answer).toContain("72%");
  });

  it("matches 'babysitting time' keyword", function () {
    var r = classify("How much babysitting time?", SESSION);
    expect(r.tier).toBe("instant");
    expect(r.answer).toContain("Human wait time");
  });

  it("handles missing autonomy metrics", function () {
    var noAuto = makeSession({});
    noAuto.autonomyMetrics = null;
    var r = classify("autonomy score?", noAuto);
    expect(r.tier).toBe("instant");
    expect(r.answer).toContain("not available");
  });
});

// ── Summary questions ───────────────────────────────────────────────────────

describe("classify: summary", function () {
  it("answers 'summarize this session'", function () {
    var r = classify("Summarize this session", SESSION);
    expect(r.tier).toBe("instant");
    expect(r.answer).toContain("Session summary");
    expect(r.answer).toContain("claude-code");
    expect(r.answer).toContain("bash");
  });

  it("matches 'session overview'", function () {
    var r = classify("session overview", SESSION);
    expect(r.tier).toBe("instant");
    expect(r.answer).toContain("Session summary");
  });

  it("includes cost when token data available", function () {
    var r = classify("session summary", SESSION);
    expect(r.answer).toContain("$");
  });
});

// ── Definitional bypass ──────────────────────────────────────────────────────

describe("classify: definitional questions bypass instant", function () {
  it("sends 'what is the sql tool?' to model", function () {
    var r = classify("what is the sql tool?", SESSION);
    expect(r.tier).toBe("model");
  });

  it("sends 'what is the error handling approach?' to model", function () {
    var r = classify("what is the error handling approach?", SESSION);
    expect(r.tier).toBe("model");
  });

  it("sends 'what does the view tool do?' to model", function () {
    var r = classify("what does the view tool do?", SESSION);
    expect(r.tier).toBe("model");
  });

  it("sends 'explain the model selection' to model", function () {
    var r = classify("explain the model selection", SESSION);
    expect(r.tier).toBe("model");
  });

  it("sends 'how does the cost estimation work?' to model", function () {
    var r = classify("how does the cost estimation work?", SESSION);
    expect(r.tier).toBe("model");
  });

  it("still answers stats questions instantly", function () {
    expect(classify("what tools were used?", SESSION).tier).toBe("instant");
    expect(classify("how many errors?", SESSION).tier).toBe("instant");
    expect(classify("what model was used?", SESSION).tier).toBe("instant");
    expect(classify("how long did it take?", SESSION).tier).toBe("instant");
  });
});

// ── Follow-up question bypass ───────────────────────────────────────────────

describe("classify: follow-up questions bypass instant", function () {
  it("sends 'how many seconds is that?' to model", function () {
    var r = classify("how many seconds is that?", SESSION);
    expect(r.tier).toBe("model");
  });

  it("sends 'convert that to seconds' to model", function () {
    var r = classify("convert that to seconds", SESSION);
    expect(r.tier).toBe("model");
  });

  it("sends 'what is that in minutes?' to model", function () {
    var r = classify("what's that in minutes?", SESSION);
    expect(r.tier).toBe("model");
  });

  it("sends 'break that down' to model", function () {
    var r = classify("break that down", SESSION);
    expect(r.tier).toBe("model");
  });

  it("sends 'can you explain that?' to model", function () {
    var r = classify("can you explain that?", SESSION);
    expect(r.tier).toBe("model");
  });

  it("sends 'in seconds?' to model", function () {
    var r = classify("in seconds?", SESSION);
    expect(r.tier).toBe("model");
  });
});

// ── Model fallback ──────────────────────────────────────────────────────────

describe("classify: model fallback", function () {
  it("falls through for open-ended questions", function () {
    var r = classify("Why did the agent choose to use grep instead of find?", SESSION);
    expect(r.tier).toBe("model");
    expect(r.answer).toBeUndefined();
  });

  it("falls through for ambiguous questions", function () {
    var r = classify("Is this a good approach?", SESSION);
    expect(r.tier).toBe("model");
  });

  it("falls through for empty question", function () {
    var r = classify("", SESSION);
    expect(r.tier).toBe("model");
  });

  it("falls through for null data", function () {
    var r = classify("what tools?", null);
    expect(r.tier).toBe("model");
  });
});

// ── buildModelContext ───────────────────────────────────────────────────────

describe("buildModelContext", function () {
  it("includes metadata summary", function () {
    var ctx = buildModelContext("why did it fail?", SESSION);
    expect(ctx.metadata).toBeDefined();
    expect(ctx.metadata.totalTurns).toBe(2);
  });

  it("includes top tools", function () {
    var ctx = buildModelContext("explain", SESSION);
    expect(ctx.topTools.length).toBeGreaterThan(0);
    expect(ctx.topTools[0].name).toBe("bash");
  });

  it("includes error samples when question is error-related", function () {
    var ctx = buildModelContext("why did it fail?", SESSION);
    expect(ctx.errorSamples).toBeDefined();
    expect(ctx.errorSamples.length).toBeGreaterThan(0);
  });

  it("omits error samples for non-error questions", function () {
    var ctx = buildModelContext("explain the approach", SESSION);
    expect(ctx.errorSamples).toBeUndefined();
  });

  it("includes turn events when question references a turn", function () {
    var ctx = buildModelContext("what happened in turn 0?", SESSION);
    expect(ctx.relevantTurns).toBeDefined();
    expect(ctx.relevantTurns.length).toBeGreaterThan(0);
  });

  it("includes user messages", function () {
    var ctx = buildModelContext("explain", SESSION);
    expect(ctx.userMessages).toContain("Fix the bug");
  });
});

// ── New classifier patterns ────────────────────────────────────────────────

describe("classify: files", function () {
  it("answers 'what files were edited?'", function () {
    var s = makeSession({ events: [
      { t: 0, track: "tool_call", toolName: "edit", toolInput: '{"file_path":"src/auth.ts"}', turnIndex: 0, isError: false },
      { t: 1, track: "tool_call", toolName: "Read", toolInput: '{"path":"README.md"}', turnIndex: 0, isError: false },
    ]});
    var r = classify("What files were edited?", s);
    expect(r.tier).toBe("instant");
    expect(r.answer).toContain("src/auth.ts");
  });

  it("reports no files when none found", function () {
    var s = makeSession({ events: [] });
    var r = classify("Which files were modified?", s);
    expect(r.tier).toBe("instant");
    expect(r.answer).toContain("No file operations");
  });
});

describe("classify: commands", function () {
  it("answers 'what commands were run?'", function () {
    var s = makeSession({ events: [
      { t: 0, track: "tool_call", toolName: "bash", toolInput: '{"command":"npm test"}', turnIndex: 0, isError: false },
      { t: 1, track: "tool_call", toolName: "bash", toolInput: '{"command":"git status"}', turnIndex: 1, isError: false },
    ]});
    var r = classify("What commands were run?", s);
    expect(r.tier).toBe("instant");
    expect(r.answer).toContain("npm test");
    expect(r.answer).toContain("git status");
  });

  it("answers 'list bash commands'", function () {
    var r = classify("List all bash commands", SESSION);
    expect(r.tier).toBe("instant");
  });
});

describe("classify: turn range", function () {
  it("answers 'what happened in turns 0-1?'", function () {
    var r = classify("What happened in turns 0-1?", SESSION);
    expect(r.tier).toBe("instant");
    expect(r.answer).toContain("Turn 0");
    expect(r.answer).toContain("Turn 1");
  });

  it("handles out-of-bounds range", function () {
    var r = classify("What happened in turns 5-10?", SESSION);
    expect(r.tier).toBe("instant");
    expect(r.answer).toContain("out of bounds");
  });
});

describe("classify: first/last turn", function () {
  it("answers 'what was the first thing done?'", function () {
    var r = classify("What was the first thing done?", SESSION);
    expect(r.tier).toBe("instant");
    expect(r.answer).toContain("Turn 0");
  });

  it("answers 'what was the last turn?'", function () {
    var r = classify("What was the last turn?", SESSION);
    expect(r.tier).toBe("instant");
    expect(r.answer).toContain("Turn 1");
  });
});

describe("classify: format", function () {
  it("answers 'what format is this session?'", function () {
    var r = classify("What format is this session?", SESSION);
    expect(r.tier).toBe("instant");
    expect(r.answer).toContain("claude-code");
  });
});

describe("classify: user messages", function () {
  it("answers 'what did the user ask?'", function () {
    var r = classify("What did the user ask?", SESSION);
    expect(r.tier).toBe("instant");
    expect(r.answer).toContain("Fix the bug");
    expect(r.answer).toContain("Try again");
  });
});

describe("classify: event count", function () {
  it("answers 'how many events?'", function () {
    var r = classify("How many events are there?", SESSION);
    expect(r.tier).toBe("instant");
    expect(r.answer).toContain("6 event");
  });
});

describe("classify: tool detail", function () {
  it("answers 'how many times was bash used?'", function () {
    var r = classify("How many times was bash used?", SESSION);
    expect(r.tier).toBe("instant");
    expect(r.answer).toContain("bash");
    expect(r.answer).toContain("3");
  });

  it("reports when tool not found", function () {
    var r = classify("How many times was python used?", SESSION);
    expect(r.tier).toBe("instant");
    expect(r.answer).toContain("not used");
  });
});

// ── Session index ───────────────────────────────────────────────────────────

describe("getSessionIndex", function () {
  it("builds tool index from events", function () {
    var index = getSessionIndex("test-idx-" + Date.now(), SESSION);
    expect(index).toBeTruthy();
    expect(index.toolIndex).toBeTruthy();
    expect(index.toolIndex["bash"]).toBeTruthy();
    expect(index.toolIndex["bash"].length).toBe(3);
    expect(index.toolIndex["bash"][0].turn).toBe(0);
  });

  it("builds chunk summaries", function () {
    var index = getSessionIndex("test-chunks-" + Date.now(), SESSION);
    expect(index.chunks).toBeTruthy();
    expect(index.chunks.length).toBeGreaterThan(0);
    expect(index.chunks[0].turns).toBeDefined();
    expect(index.chunks[0].eventCount).toBeGreaterThan(0);
  });

  it("extracts clean snippets from toolInput objects", function () {
    var s = makeSession({ events: [
      { t: 0, track: "tool_call", toolName: "kusto", text: "", toolInput: { query: "StormEvents | take 10" }, isError: false, turnIndex: 0 },
    ]});
    var index = getSessionIndex("test-snippet-" + Date.now(), s);
    expect(index.toolIndex["kusto"][0].snippet).toContain("StormEvents");
  });

  it("chunks use single-pass bucketing (no O(n*m) filter)", function () {
    // Build a session with 1000 events across 100 turns
    var events = [];
    var turns = [];
    for (var t = 0; t < 100; t++) {
      turns.push({ index: t, startTime: t, endTime: t + 1, eventIndices: [], userMessage: t === 0 ? "start" : null, toolCount: 0, hasError: false });
      for (var e = 0; e < 10; e++) {
        events.push({ t: t * 10 + e, track: "tool_call", toolName: "bash", text: "cmd " + e, toolInput: "", isError: false, turnIndex: t, duration: 1, intensity: 0.5 });
      }
    }
    var s = makeSession({ events: events, turns: turns });
    var index = getSessionIndex("test-perf-" + Date.now(), s);
    // Verify all events are accounted for in chunks
    var totalChunkEvents = index.chunks.reduce(function (sum, c) { return sum + c.eventCount; }, 0);
    expect(totalChunkEvents).toBe(1000);
  });
});

describe("searchToolIndex", function () {
  it("finds tools by name", function () {
    var index = getSessionIndex("test-search-" + Date.now(), SESSION);
    var results = searchToolIndex(index, "bash");
    expect(results.length).toBe(3);
    expect(results[0].turn).toBe(0);
  });

  it("finds tools by snippet content", function () {
    var s = makeSession({ events: [
      { t: 0, track: "tool_call", toolName: "powershell", text: "", toolInput: { command: "Get-AzureKusto" }, isError: false, turnIndex: 0 },
    ]});
    var index = getSessionIndex("test-snippet-search-" + Date.now(), s);
    var results = searchToolIndex(index, "kusto");
    expect(results.length).toBe(1);
  });

  it("returns empty for no match", function () {
    var index = getSessionIndex("test-nomatch-" + Date.now(), SESSION);
    var results = searchToolIndex(index, "nonexistent");
    expect(results.length).toBe(0);
  });

  it("sorts results by turn index", function () {
    var index = getSessionIndex("test-sort-" + Date.now(), SESSION);
    var results = searchToolIndex(index, "bash");
    for (var i = 1; i < results.length; i++) {
      expect(results[i].turn).toBeGreaterThanOrEqual(results[i - 1].turn);
    }
  });
});
