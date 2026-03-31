import { describe, it, expect } from "vitest";
import { buildGraphData, runLayout, mergeLayout, getGraphBounds, buildTurnSnippet, buildConcurrencyGroups } from "../lib/graphLayout.js";

// Helpers to create test data matching the EventEntry/SessionTurn shapes

function makeEvent(index, overrides) {
  return {
    index: index,
    event: Object.assign({
      t: index * 10,
      agent: "assistant",
      track: "reasoning",
      text: "event " + index,
      duration: 5,
      intensity: 0.5,
      isError: false,
      turnIndex: 0,
    }, overrides),
  };
}

function makeTurn(index, eventIndices, overrides) {
  return Object.assign({
    index: index,
    startTime: index * 30,
    endTime: index * 30 + 25,
    eventIndices: eventIndices,
    userMessage: "Turn " + index + " message",
    toolCount: 0,
    hasError: false,
  }, overrides);
}

describe("buildGraphData", function () {
  it("returns empty graph for no turns", function () {
    var result = buildGraphData([], [], {});
    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
  });

  it("creates one node per turn", function () {
    var events = [makeEvent(0), makeEvent(1)];
    var turns = [
      makeTurn(0, [0]),
      makeTurn(1, [1]),
    ];
    var result = buildGraphData(events, turns, {});
    expect(result.nodes).toHaveLength(2);
    expect(result.nodes[0].id).toBe("turn-0");
    expect(result.nodes[1].id).toBe("turn-1");
  });

  it("creates edges between consecutive turns", function () {
    var events = [makeEvent(0), makeEvent(1), makeEvent(2)];
    var turns = [
      makeTurn(0, [0]),
      makeTurn(1, [1]),
      makeTurn(2, [2]),
    ];
    var result = buildGraphData(events, turns, {});
    expect(result.edges).toHaveLength(2);
    expect(result.edges[0].sources[0]).toBe("turn-0");
    expect(result.edges[0].targets[0]).toBe("turn-1");
    expect(result.edges[1].sources[0]).toBe("turn-1");
    expect(result.edges[1].targets[0]).toBe("turn-2");
  });

  it("marks error turns", function () {
    var events = [makeEvent(0, { isError: true })];
    var turns = [makeTurn(0, [0], { hasError: true })];
    var result = buildGraphData(events, turns, {});
    expect(result.nodes[0].hasError).toBe(true);
  });

  it("counts tool calls in turn", function () {
    var events = [
      makeEvent(0, { track: "tool_call", toolName: "bash" }),
      makeEvent(1, { track: "tool_call", toolName: "edit" }),
      makeEvent(2, { track: "reasoning" }),
    ];
    var turns = [makeTurn(0, [0, 1, 2], { toolCount: 2 })];
    var result = buildGraphData(events, turns, {});
    expect(result.nodes[0].toolCount).toBe(2);
  });

  it("truncates long user messages", function () {
    var longMsg = "A".repeat(100);
    var turns = [makeTurn(0, [], { userMessage: longMsg })];
    var result = buildGraphData([], turns, {});
    expect(result.nodes[0].snippet.length).toBeLessThan(65);
    expect(result.nodes[0].snippet.endsWith("...")).toBe(true);
  });

  it("expands turns when expandedTurns has the index", function () {
    var events = [
      makeEvent(0, { track: "tool_call", toolName: "bash", turnIndex: 0 }),
      makeEvent(1, { track: "tool_call", toolName: "edit", turnIndex: 0 }),
    ];
    var turns = [makeTurn(0, [0, 1])];
    var result = buildGraphData(events, turns, { 0: true });
    expect(result.nodes[0].isExpanded).toBe(true);
    expect(result.nodes[0].children).toHaveLength(2);
    expect(result.nodes[0].children[0].label).toBe("bash");
    expect(result.nodes[0].children[1].label).toBe("edit");
  });

  it("auto-expands turns with parallel task agents", function () {
    var events = [
      makeEvent(0, { track: "tool_call", toolName: "task", toolCallId: "task-a", t: 0, duration: 8, agentName: "explore", agentDisplayName: "Explore Agent" }),
      makeEvent(1, { track: "tool_call", toolName: "task", toolCallId: "task-b", t: 1, duration: 8, agentName: "code-review", agentDisplayName: "Code Review Agent" }),
      makeEvent(2, { track: "tool_call", toolName: "view", parentToolCallId: "task-a", t: 2, duration: 1 }),
      makeEvent(3, { track: "tool_call", toolName: "grep", parentToolCallId: "task-b", t: 2.5, duration: 1 }),
    ];
    var turns = [makeTurn(0, [0, 1, 2, 3])];
    var result = buildGraphData(events, turns, {});
    expect(result.nodes.map(function (node) { return node.type; })).toEqual(["turn", "fork", "agent_branch", "agent_branch", "join"]);
  });

  it("does not fork for a single task agent", function () {
    var events = [
      makeEvent(0, { track: "tool_call", toolName: "task", toolCallId: "task-a", t: 0, duration: 8, agentName: "general-purpose", agentDisplayName: "General Purpose Agent" }),
      makeEvent(1, { track: "tool_call", toolName: "edit", parentToolCallId: "task-a", t: 1, duration: 1 }),
    ];
    var turns = [makeTurn(0, [0, 1])];
    var result = buildGraphData(events, turns, {});
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0].type).toBe("turn");
    expect(result.nodes[0].isExpanded).toBe(false);
  });

  it("uses toolCallId-based IDs for duplicate agent types", function () {
    var events = [
      makeEvent(0, { track: "tool_call", toolName: "task", toolCallId: "task-a", t: 0, duration: 8, agentName: "explore", agentDisplayName: "Explore Agent" }),
      makeEvent(1, { track: "tool_call", toolName: "task", toolCallId: "task-b", t: 1, duration: 8, agentName: "explore", agentDisplayName: "Explore Agent" }),
    ];
    var turns = [makeTurn(0, [0, 1])];
    var result = buildGraphData(events, turns, {});
    var agentIds = result.nodes.filter(function (node) { return node.type === "agent_branch"; }).map(function (node) { return node.id; });
    expect(agentIds).toEqual(["agent-0-task-a--0", "agent-0-task-b--1"]);
  });

  it("connects fork and join edges around agent branches", function () {
    var events = [
      makeEvent(0, { track: "tool_call", toolName: "task", toolCallId: "task-a", t: 0, duration: 8, agentName: "explore", agentDisplayName: "Explore Agent" }),
      makeEvent(1, { track: "tool_call", toolName: "task", toolCallId: "task-b", t: 1, duration: 8, agentName: "code-review", agentDisplayName: "Code Review Agent" }),
    ];
    var turns = [
      makeTurn(0, [0, 1]),
      makeTurn(1, [], { userMessage: "Next turn" }),
    ];
    var result = buildGraphData(events, turns, {});
    var edgeIds = result.edges.map(function (edge) { return edge.id; });
    expect(edgeIds).toContain("turn-0->fork-0");
    expect(edgeIds).toContain("fork-0->agent-0-task-a--0");
    expect(edgeIds).toContain("fork-0->agent-0-task-b--1");
    expect(edgeIds).toContain("agent-0-task-a--0->join-0");
    expect(edgeIds).toContain("agent-0-task-b--1->join-0");
    expect(edgeIds).toContain("join-0->turn-1");
  });

  it("preserves non-task tools in mixed turns (pre-fork and post-join)", function () {
    var events = [
      makeEvent(0, { track: "tool_call", toolName: "grep", t: 0, duration: 1 }),
      makeEvent(1, { track: "tool_call", toolName: "task", toolCallId: "task-a", t: 2, duration: 8, agentName: "explore", agentDisplayName: "Explore Agent" }),
      makeEvent(2, { track: "tool_call", toolName: "task", toolCallId: "task-b", t: 3, duration: 8, agentName: "code-review", agentDisplayName: "Code Review Agent" }),
      makeEvent(3, { track: "tool_call", toolName: "bash", t: 20, duration: 1 }),
    ];
    var turns = [makeTurn(0, [0, 1, 2, 3])];
    var result = buildGraphData(events, turns, {});
    var nodeTypes = result.nodes.map(function (n) { return n.type; });
    // Turn should contain pre-fork grep, then fork/branches/join, then post-join compound
    expect(nodeTypes).toContain("fork");
    expect(nodeTypes).toContain("agent_branch");
    expect(nodeTypes).toContain("join");
    // Pre-fork grep should be a child of the first turn node
    var turnNodes = result.nodes.filter(function (n) { return n.type === "turn"; });
    var hostTurn = turnNodes.find(function (n) { return n.isBranchHost; });
    expect(hostTurn.children).toBeDefined();
    expect(hostTurn.children.length).toBe(1);
    expect(hostTurn.children[0].label).toBe("grep");
    // Post-join bash should be in a compound node after join
    var postJoinNode = turnNodes.find(function (n) { return n.id.indexOf("postjoin") === 0; });
    expect(postJoinNode).toBeDefined();
    expect(postJoinNode.children.length).toBe(1);
    expect(postJoinNode.children[0].label).toBe("bash");
  });

  it("collects transitive descendants in agent branches", function () {
    var events = [
      makeEvent(0, { track: "tool_call", toolName: "task", toolCallId: "task-a", t: 0, duration: 10, agentName: "explore", agentDisplayName: "Explore Agent" }),
      makeEvent(1, { track: "tool_call", toolName: "task", toolCallId: "task-b", t: 1, duration: 10, agentName: "code-review", agentDisplayName: "Code Review Agent" }),
      makeEvent(2, { track: "tool_call", toolName: "view", toolCallId: "view-1", parentToolCallId: "task-a", t: 2, duration: 1 }),
      makeEvent(3, { track: "tool_call", toolName: "grep", parentToolCallId: "view-1", t: 3, duration: 1 }),
    ];
    var turns = [makeTurn(0, [0, 1, 2, 3])];
    var result = buildGraphData(events, turns, {});
    var exploreBranch = result.nodes.find(function (n) { return n.type === "agent_branch" && n.agentName === "explore"; });
    // Should include both view (direct child) and grep (grandchild)
    expect(exploreBranch.children.length).toBe(2);
    expect(exploreBranch.toolCount).toBe(2);
  });

  it("handles 3+ parallel agent branches", function () {
    var events = [
      makeEvent(0, { track: "tool_call", toolName: "task", toolCallId: "t-a", t: 0, duration: 8, agentName: "explore", agentDisplayName: "Explore" }),
      makeEvent(1, { track: "tool_call", toolName: "task", toolCallId: "t-b", t: 0.5, duration: 8, agentName: "code-review", agentDisplayName: "Review" }),
      makeEvent(2, { track: "tool_call", toolName: "task", toolCallId: "t-c", t: 1, duration: 8, agentName: "general-purpose", agentDisplayName: "GP" }),
    ];
    var turns = [makeTurn(0, [0, 1, 2])];
    var result = buildGraphData(events, turns, {});
    var branches = result.nodes.filter(function (n) { return n.type === "agent_branch"; });
    expect(branches.length).toBe(3);
    var forkNode = result.nodes.find(function (n) { return n.type === "fork"; });
    expect(forkNode.branchCount).toBe(3);
  });

  it("propagates error from failed agent branch to join node", function () {
    var events = [
      makeEvent(0, { track: "tool_call", toolName: "task", toolCallId: "task-ok", t: 0, duration: 5, agentName: "explore", agentDisplayName: "Explore Agent" }),
      makeEvent(1, { track: "tool_call", toolName: "task", toolCallId: "task-fail", t: 1, duration: 5, agentName: "code-review", agentDisplayName: "Review Agent", isError: true }),
    ];
    var turns = [makeTurn(0, [0, 1], { hasError: true })];
    var result = buildGraphData(events, turns, {});
    var failBranch = result.nodes.find(function (n) { return n.type === "agent_branch" && n.agentName === "code-review"; });
    expect(failBranch.hasError).toBe(true);
    var joinNode = result.nodes.find(function (n) { return n.type === "join"; });
    expect(joinNode.hasError).toBe(true);
  });

  it("avoids ID collisions when toolCallIds normalize identically", function () {
    var events = [
      makeEvent(0, { track: "tool_call", toolName: "task", toolCallId: "a/b", t: 0, duration: 8, agentName: "explore", agentDisplayName: "Explore Agent" }),
      makeEvent(1, { track: "tool_call", toolName: "task", toolCallId: "a:b", t: 1, duration: 8, agentName: "code-review", agentDisplayName: "Code Review Agent" }),
    ];
    var turns = [makeTurn(0, [0, 1])];
    var result = buildGraphData(events, turns, {});
    var branchIds = result.nodes.filter(function (n) { return n.type === "agent_branch"; }).map(function (n) { return n.id; });
    // Normalized forms are the same ("a-b") but --index suffix makes them unique
    expect(new Set(branchIds).size).toBe(2);
  });

  it("collapsed turns have no children", function () {
    var events = [makeEvent(0, { track: "tool_call", toolName: "bash" })];
    var turns = [makeTurn(0, [0])];
    var result = buildGraphData(events, turns, {});
    expect(result.nodes[0].isExpanded).toBe(false);
    expect(result.nodes[0].children).toBeUndefined();
  });

  it("includes post-join tool descendants in compound node", function () {
    var events = [
      makeEvent(0, { track: "tool_call", toolName: "task", toolCallId: "task-a", t: 0, duration: 8, agentName: "explore", agentDisplayName: "Explore" }),
      makeEvent(1, { track: "tool_call", toolName: "task", toolCallId: "task-b", t: 1, duration: 8, agentName: "review", agentDisplayName: "Review" }),
      makeEvent(2, { track: "tool_call", toolName: "bash", toolCallId: "bash-1", t: 20, duration: 2 }),
      makeEvent(3, { track: "tool_call", toolName: "view", parentToolCallId: "bash-1", t: 21, duration: 1 }),
    ];
    var turns = [makeTurn(0, [0, 1, 2, 3])];
    var result = buildGraphData(events, turns, {});
    var postJoinNode = result.nodes.find(function (n) { return n.id && n.id.indexOf("postjoin") === 0; });
    expect(postJoinNode).toBeDefined();
    expect(postJoinNode.children.length).toBe(2); // bash + view
  });
});

describe("runLayout + mergeLayout", function () {
  it("produces positioned nodes", async function () {
    var events = [makeEvent(0), makeEvent(1)];
    var turns = [makeTurn(0, [0]), makeTurn(1, [1])];
    var graphData = buildGraphData(events, turns, {});
    var elkResult = await runLayout(graphData);
    var positioned = mergeLayout(graphData, elkResult);

    expect(positioned.nodes).toHaveLength(2);
    expect(typeof positioned.nodes[0].x).toBe("number");
    expect(typeof positioned.nodes[0].y).toBe("number");
    expect(positioned.nodes[0].width).toBeGreaterThan(0);
  });

  it("lays out left-to-right (first node left of second)", async function () {
    var events = [makeEvent(0), makeEvent(1)];
    var turns = [makeTurn(0, [0]), makeTurn(1, [1])];
    var graphData = buildGraphData(events, turns, {});
    var elkResult = await runLayout(graphData);
    var positioned = mergeLayout(graphData, elkResult);

    expect(positioned.nodes[0].x).toBeLessThan(positioned.nodes[1].x);
  });

  it("positions children inside expanded turn", async function () {
    var events = [
      makeEvent(0, { track: "tool_call", toolName: "bash", turnIndex: 0 }),
      makeEvent(1, { track: "tool_call", toolName: "edit", turnIndex: 0 }),
    ];
    var turns = [makeTurn(0, [0, 1])];
    var graphData = buildGraphData(events, turns, { 0: true });
    var elkResult = await runLayout(graphData);
    var positioned = mergeLayout(graphData, elkResult);

    expect(positioned.nodes[0].isExpanded).toBe(true);
    expect(positioned.nodes[0].children).toHaveLength(2);
    expect(typeof positioned.nodes[0].children[0].x).toBe("number");
    expect(typeof positioned.nodes[0].children[1].x).toBe("number");
  });

  it("lays out fork/join DAG nodes", async function () {
    var events = [
      makeEvent(0, { track: "tool_call", toolName: "task", toolCallId: "task-a", t: 0, duration: 8, agentName: "explore", agentDisplayName: "Explore Agent" }),
      makeEvent(1, { track: "tool_call", toolName: "task", toolCallId: "task-b", t: 1, duration: 8, agentName: "code-review", agentDisplayName: "Code Review Agent" }),
      makeEvent(2, { track: "tool_call", toolName: "view", parentToolCallId: "task-a", t: 2, duration: 1 }),
      makeEvent(3, { track: "tool_call", toolName: "grep", parentToolCallId: "task-b", t: 2.5, duration: 1 }),
    ];
    var turns = [makeTurn(0, [0, 1, 2, 3])];
    var graphData = buildGraphData(events, turns, {});
    var elkResult = await runLayout(graphData);
    var positioned = mergeLayout(graphData, elkResult);
    var forkNode = positioned.nodes.find(function (node) { return node.type === "fork"; });
    var joinNode = positioned.nodes.find(function (node) { return node.type === "join"; });
    var branchNodes = positioned.nodes.filter(function (node) { return node.type === "agent_branch"; });

    expect(typeof forkNode.x).toBe("number");
    expect(typeof joinNode.x).toBe("number");
    expect(branchNodes).toHaveLength(2);
    expect(branchNodes[0].children.length).toBeGreaterThan(0);
  });

  it("keeps branch nodes ordered by start time", async function () {
    var events = [
      makeEvent(0, { track: "tool_call", toolName: "task", toolCallId: "task-later", t: 2, duration: 8, agentName: "code-review", agentDisplayName: "Code Review Agent" }),
      makeEvent(1, { track: "tool_call", toolName: "task", toolCallId: "task-earlier", t: 1, duration: 8, agentName: "explore", agentDisplayName: "Explore Agent" }),
      makeEvent(2, { track: "tool_call", toolName: "view", parentToolCallId: "task-earlier", t: 2.5, duration: 1 }),
      makeEvent(3, { track: "tool_call", toolName: "grep", parentToolCallId: "task-later", t: 3, duration: 1 }),
    ];
    var turns = [makeTurn(0, [0, 1, 2, 3])];
    var graphData = buildGraphData(events, turns, {});
    var branchNodes = graphData.nodes.filter(function (node) { return node.type === "agent_branch"; });

    expect(branchNodes.map(function (node) { return node.agentDisplayName; })).toEqual([
      "Explore Agent",
      "Code Review Agent",
    ]);
  });
});

describe("getGraphBounds", function () {
  it("returns default bounds for empty array", function () {
    var bounds = getGraphBounds([]);
    expect(bounds.width).toBeGreaterThan(0);
    expect(bounds.height).toBeGreaterThan(0);
  });

  it("computes bounding box with padding", function () {
    var nodes = [
      { x: 0, y: 0, width: 100, height: 50 },
      { x: 200, y: 100, width: 100, height: 50 },
    ];
    var bounds = getGraphBounds(nodes);
    expect(bounds.x).toBeLessThan(0); // padding
    expect(bounds.y).toBeLessThan(0);
    expect(bounds.width).toBeGreaterThan(300);
    expect(bounds.height).toBeGreaterThan(150);
  });
});

describe("buildTurnSnippet", function () {
  it("uses real user message when present", function () {
    var turn = makeTurn(0, [], { userMessage: "Fix the login bug" });
    expect(buildTurnSnippet(turn, [])).toBe("Fix the login bug");
  });

  it("truncates long user messages", function () {
    var longMsg = "A".repeat(100);
    var turn = makeTurn(0, [], { userMessage: longMsg });
    var snippet = buildTurnSnippet(turn, []);
    expect(snippet.length).toBeLessThan(65);
    expect(snippet.endsWith("...")).toBe(true);
  });

  it("summarizes tool calls when userMessage is (continuation)", function () {
    var events = [
      makeEvent(0, { track: "tool_call", toolName: "bash" }),
      makeEvent(1, { track: "tool_call", toolName: "edit" }),
      makeEvent(2, { track: "tool_call", toolName: "grep" }),
    ];
    var turn = makeTurn(0, [0, 1, 2], { userMessage: "(continuation)" });
    var snippet = buildTurnSnippet(turn, events);
    expect(snippet).toBe("bash, edit, grep");
  });

  it("deduplicates repeated tool names", function () {
    var events = [
      makeEvent(0, { track: "tool_call", toolName: "bash" }),
      makeEvent(1, { track: "tool_call", toolName: "bash" }),
      makeEvent(2, { track: "tool_call", toolName: "edit" }),
    ];
    var turn = makeTurn(0, [0, 1, 2], { userMessage: "(continuation)" });
    var snippet = buildTurnSnippet(turn, events);
    expect(snippet).toBe("bash, edit");
  });

  it("caps tool list at 4 with overflow count", function () {
    var events = [
      makeEvent(0, { track: "tool_call", toolName: "bash" }),
      makeEvent(1, { track: "tool_call", toolName: "edit" }),
      makeEvent(2, { track: "tool_call", toolName: "grep" }),
      makeEvent(3, { track: "tool_call", toolName: "view" }),
      makeEvent(4, { track: "tool_call", toolName: "create" }),
      makeEvent(5, { track: "tool_call", toolName: "glob" }),
    ];
    var turn = makeTurn(0, [0, 1, 2, 3, 4, 5], { userMessage: "(continuation)" });
    var snippet = buildTurnSnippet(turn, events);
    expect(snippet).toBe("bash, edit, grep, view +2");
  });

  it("falls back to reasoning text when no tools and no user message", function () {
    var events = [
      makeEvent(0, { track: "reasoning", text: "Let me analyze the codebase structure" }),
    ];
    var turn = makeTurn(0, [0], { userMessage: "(continuation)" });
    var snippet = buildTurnSnippet(turn, events);
    expect(snippet).toBe("Let me analyze the codebase structure");
  });

  it("handles (system) placeholder same as (continuation)", function () {
    var events = [
      makeEvent(0, { track: "tool_call", toolName: "bash" }),
    ];
    var turn = makeTurn(0, [0], { userMessage: "(system)" });
    var snippet = buildTurnSnippet(turn, events);
    expect(snippet).toBe("bash");
  });

  it("returns empty string when no data at all", function () {
    var turn = makeTurn(0, [], { userMessage: "" });
    expect(buildTurnSnippet(turn, [])).toBe("");
  });
});

describe("buildConcurrencyGroups", function () {
  it("returns empty array for no tools", function () {
    expect(buildConcurrencyGroups([])).toEqual([]);
  });

  it("puts a single tool in one group", function () {
    var tools = [{ event: { t: 0, duration: 5 }, index: 0 }];
    var groups = buildConcurrencyGroups(tools);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(1);
  });

  it("groups sequential tools into separate groups", function () {
    var tools = [
      { event: { t: 0, duration: 2 }, index: 0 },
      { event: { t: 5, duration: 2 }, index: 1 },
      { event: { t: 10, duration: 2 }, index: 2 },
    ];
    var groups = buildConcurrencyGroups(tools);
    expect(groups).toHaveLength(3);
    expect(groups[0]).toHaveLength(1);
    expect(groups[1]).toHaveLength(1);
    expect(groups[2]).toHaveLength(1);
  });

  it("groups overlapping tools into one group", function () {
    var tools = [
      { event: { t: 0, duration: 10 }, index: 0 },
      { event: { t: 2, duration: 8 }, index: 1 },
      { event: { t: 4, duration: 6 }, index: 2 },
    ];
    var groups = buildConcurrencyGroups(tools);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(3);
  });

  it("separates concurrent group from sequential follower", function () {
    var tools = [
      { event: { t: 0, duration: 5 }, index: 0 },
      { event: { t: 1, duration: 5 }, index: 1 },
      { event: { t: 20, duration: 3 }, index: 2 },
    ];
    var groups = buildConcurrencyGroups(tools);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toHaveLength(2);
    expect(groups[1]).toHaveLength(1);
  });

  it("handles multiple concurrent groups", function () {
    // Group 1: tools at t=0-5 and t=2-7 (overlap)
    // Group 2: tools at t=10-15 and t=12-17 (overlap)
    var tools = [
      { event: { t: 0, duration: 5 }, index: 0 },
      { event: { t: 2, duration: 5 }, index: 1 },
      { event: { t: 10, duration: 5 }, index: 2 },
      { event: { t: 12, duration: 5 }, index: 3 },
    ];
    var groups = buildConcurrencyGroups(tools);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toHaveLength(2);
    expect(groups[1]).toHaveLength(2);
  });

  it("treats zero-duration tools at same time as concurrent", function () {
    var tools = [
      { event: { t: 5, duration: 0 }, index: 0 },
      { event: { t: 5, duration: 0 }, index: 1 },
    ];
    var groups = buildConcurrencyGroups(tools);
    // Both start at t=5, end at t=5 — not overlapping (start < end fails)
    expect(groups).toHaveLength(2);
  });

  it("detects overlap when next tool starts before previous ends", function () {
    var tools = [
      { event: { t: 0, duration: 10 }, index: 0 },
      { event: { t: 9.9, duration: 5 }, index: 1 },
    ];
    var groups = buildConcurrencyGroups(tools);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(2);
  });
});

describe("buildGraphData temporal overlap", function () {
  it("does not create edges between concurrent root tools", function () {
    var events = [
      makeEvent(0, { track: "tool_call", toolName: "grep", t: 0, duration: 5 }),
      makeEvent(1, { track: "tool_call", toolName: "grep", t: 1, duration: 5 }),
      makeEvent(2, { track: "tool_call", toolName: "grep", t: 2, duration: 5 }),
    ];
    var turns = [makeTurn(0, [0, 1, 2])];
    var result = buildGraphData(events, turns, { 0: true });

    // All 3 tools overlap, so there should be NO sequential edges between them
    var node = result.nodes[0];
    expect(node.isExpanded).toBe(true);
    expect(node.children).toHaveLength(3);
    expect(node.edges).toHaveLength(0);
  });

  it("creates edges between sequential groups but not within", function () {
    var events = [
      // Concurrent group 1: two overlapping greps
      makeEvent(0, { track: "tool_call", toolName: "grep", t: 0, duration: 5 }),
      makeEvent(1, { track: "tool_call", toolName: "grep", t: 1, duration: 5 }),
      // Sequential: one edit after both greps finish
      makeEvent(2, { track: "tool_call", toolName: "edit", t: 10, duration: 3 }),
    ];
    var turns = [makeTurn(0, [0, 1, 2])];
    var result = buildGraphData(events, turns, { 0: true });

    var node = result.nodes[0];
    // One edge: last of group 1 -> first of group 2
    expect(node.edges).toHaveLength(1);
    expect(node.edges[0].sources[0]).toBe("tool-0-1"); // last of concurrent group
    expect(node.edges[0].targets[0]).toBe("tool-0-2"); // the sequential edit
  });

  it("still creates parentToolCallId edges for subagent children", function () {
    var events = [
      makeEvent(0, { track: "tool_call", toolName: "task", t: 0, duration: 10, toolCallId: "tc-1" }),
      makeEvent(1, { track: "tool_call", toolName: "view", t: 2, duration: 3, parentToolCallId: "tc-1" }),
      makeEvent(2, { track: "tool_call", toolName: "grep", t: 4, duration: 3, parentToolCallId: "tc-1" }),
    ];
    var turns = [makeTurn(0, [0, 1, 2])];
    var result = buildGraphData(events, turns, { 0: true });

    var node = result.nodes[0];
    // 2 parentToolCallId edges (task->view, task->grep), no sequential edges (root has 1 tool)
    expect(node.edges).toHaveLength(2);
    expect(node.edges[0].sources[0]).toBe("tool-0-0");
    expect(node.edges[0].targets[0]).toBe("tool-0-1");
    expect(node.edges[1].sources[0]).toBe("tool-0-0");
    expect(node.edges[1].targets[0]).toBe("tool-0-2");
  });
});
