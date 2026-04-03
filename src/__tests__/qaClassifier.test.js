import { describe, expect, it } from "vitest";
import { classify, buildModelContext } from "../lib/qaClassifier.js";

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

// ── File edits ───────────────────────────────────────────────────────────────

describe("classify: files", function () {
  it("answers 'what files were edited?'", function () {
    var session = makeSession({
      events: [
        { t: 0, agent: "assistant", track: "tool_call", text: "path: src/auth.ts", duration: 2, intensity: 0.7, isError: false, turnIndex: 0, toolName: "edit" },
        { t: 5, agent: "assistant", track: "tool_call", text: "path: src/auth.ts", duration: 2, intensity: 0.7, isError: false, turnIndex: 0, toolName: "edit" },
        { t: 10, agent: "assistant", track: "tool_call", text: "path: src/index.ts", duration: 2, intensity: 0.7, isError: false, turnIndex: 1, toolName: "create" },
      ],
    });
    var r = classify("what files were edited?", session);
    expect(r.tier).toBe("instant");
    expect(r.answer).toContain("src/auth.ts");
    expect(r.answer).toContain("src/index.ts");
    expect(r.answer).toContain("2 files");
  });

  it("answers 'which files were changed'", function () {
    var session = makeSession({
      events: [
        { t: 0, agent: "assistant", track: "tool_call", text: "path: src/app.js", duration: 1, intensity: 0.5, isError: false, turnIndex: 0, toolName: "write" },
      ],
    });
    var r = classify("which files were changed", session);
    expect(r.tier).toBe("instant");
    expect(r.answer).toContain("src/app.js");
  });

  it("reports no edits when none found", function () {
    var session = makeSession({
      events: [
        { t: 0, agent: "assistant", track: "tool_call", text: "npm test", duration: 1, intensity: 0.5, isError: false, turnIndex: 0, toolName: "bash" },
      ],
    });
    var r = classify("what files were edited?", session);
    expect(r.tier).toBe("instant");
    expect(r.answer).toContain("No file edits");
  });

  it("matches 'file changes'", function () {
    var r = classify("show me the file changes", SESSION);
    expect(r.tier).toBe("instant");
  });

  it("matches 'list files'", function () {
    var r = classify("list files modified", SESSION);
    expect(r.tier).toBe("instant");
  });
});

// ── Longest turn ─────────────────────────────────────────────────────────────

describe("classify: longest turn", function () {
  it("answers 'which turn took the longest?'", function () {
    var r = classify("which turn took the longest?", SESSION);
    expect(r.tier).toBe("instant");
    expect(r.answer).toContain("[Turn ");
  });

  it("answers 'slowest turn'", function () {
    var r = classify("slowest turn", SESSION);
    expect(r.tier).toBe("instant");
  });

  it("answers 'which turn was the slowest'", function () {
    var r = classify("which turn was the slowest?", SESSION);
    expect(r.tier).toBe("instant");
  });

  it("finds the turn with max duration", function () {
    var session = makeSession({
      turns: [
        { index: 0, startTime: 0, endTime: 5, eventIndices: [0], userMessage: "short", toolCount: 1, hasError: false },
        { index: 1, startTime: 5, endTime: 50, eventIndices: [1], userMessage: "long turn", toolCount: 5, hasError: true },
        { index: 2, startTime: 50, endTime: 60, eventIndices: [2], userMessage: "medium", toolCount: 2, hasError: false },
      ],
    });
    var r = classify("longest turn", session);
    expect(r.tier).toBe("instant");
    expect(r.answer).toContain("[Turn 1]");
    expect(r.answer).toContain("45s");
  });
});

// ── Turn detail clickable refs ────────────────────────────────────────────────

describe("classify: turn detail uses clickable refs", function () {
  it("uses [Turn N] format for clickable links", function () {
    var r = classify("what happened in turn 0?", SESSION);
    expect(r.tier).toBe("instant");
    expect(r.answer).toContain("[Turn 0]");
    // Should NOT use the old **Turn N** format for the header
    expect(r.answer).not.toMatch(/^\*\*Turn \d+\*\*/m);
  });
});

// ── Broader pattern matching ─────────────────────────────────────────────────

describe("classify: broader pattern matching", function () {
  it("matches 'what went wrong'", function () {
    var r = classify("what went wrong?", SESSION);
    expect(r.tier).toBe("instant");
  });

  it("matches 'what failed'", function () {
    var r = classify("what failed?", SESSION);
    expect(r.tier).toBe("instant");
  });

  it("matches 'what was the cost'", function () {
    var r = classify("what was the cost?", SESSION);
    expect(r.tier).toBe("instant");
  });

  it("matches 'how much time'", function () {
    var r = classify("how much time did this take?", SESSION);
    expect(r.tier).toBe("instant");
  });

  it("matches 'give me a summary'", function () {
    var r = classify("give me a summary", SESSION);
    expect(r.tier).toBe("instant");
  });

  it("matches 'give me an overview'", function () {
    var r = classify("give me an overview", SESSION);
    expect(r.tier).toBe("instant");
  });

  it("matches 'tool breakdown'", function () {
    var r = classify("show me the tool breakdown", SESSION);
    expect(r.tier).toBe("instant");
  });
});

// ── Insight binding test ──────────────────────────────────────────────────────

describe("classify: INSIGHT_DEFS always resolve as instant", function () {
  var INSIGHT_QUESTIONS = [
    "summarize this session",
    "what tools were used",
    "what errors occurred",
    "how much did this cost",
    "what files were edited",
    "which turn took the longest",
  ];

  INSIGHT_QUESTIONS.forEach(function (q) {
    it("'" + q + "' resolves as instant", function () {
      var session = makeSession({
        events: [
          { t: 0, agent: "assistant", track: "tool_call", text: "path: src/app.ts", duration: 2, intensity: 0.7, isError: true, turnIndex: 0, toolName: "edit" },
        ],
        metadata: {
          errorCount: 1,
          tokenUsage: { inputTokens: 100, outputTokens: 50 },
        },
      });
      var r = classify(q, session);
      expect(r.tier).toBe("instant");
    });
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
