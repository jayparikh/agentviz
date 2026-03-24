import { describe, it, expect } from "vitest";
import { buildDebriefRecommendations, getTargetPath, checkApplied } from "../lib/debriefRecommendations.js";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeMetadata(overrides) {
  return Object.assign(
    { totalTurns: 4, totalToolCalls: 8, errorCount: 0, format: "claude-code" },
    overrides
  );
}

function makeAutonomyMetrics(overrides) {
  return Object.assign(
    {
      interventionCount: 2,
      babysittingTime: 60,
      autonomyEfficiency: 0.7,
      idleTime: 10,
      idleGaps: [],
      topTools: [
        { name: "bash", count: 5 },
        { name: "read_file", count: 3 },
        { name: "write_file", count: 2 },
      ],
      totalToolCalls: 10,
      userFollowUps: ["Can you also check X?", "What about Y?"],
    },
    overrides
  );
}

function findRec(result, id) {
  return (result.recommendations || []).find(function (r) { return r.id === id; }) || null;
}

// ─────────────────────────────────────────────────────────────────────────────
// getTargetPath
// ─────────────────────────────────────────────────────────────────────────────

describe("getTargetPath", function () {
  it("returns CLAUDE.md for autonomy-contract (claude-code)", function () {
    expect(getTargetPath("autonomy-contract", "claude-code")).toBe("CLAUDE.md");
  });

  it("returns copilot-instructions for autonomy-contract (copilot-cli)", function () {
    expect(getTargetPath("autonomy-contract", "copilot-cli")).toBe(".github/copilot-instructions.md");
  });

  it("returns CLAUDE.md for instructions-structure (claude-code)", function () {
    expect(getTargetPath("instructions-structure", "claude-code")).toBe("CLAUDE.md");
  });

  it("returns copilot-instructions for instructions-structure (copilot-cli)", function () {
    expect(getTargetPath("instructions-structure", "copilot-cli")).toBe(".github/copilot-instructions.md");
  });

  it("returns .claude/commands/ for sprint-commands (claude-code)", function () {
    expect(getTargetPath("sprint-commands", "claude-code")).toBe(".claude/commands/");
  });

  it("returns .github/prompts/ for sprint-commands (copilot-cli)", function () {
    expect(getTargetPath("sprint-commands", "copilot-cli")).toBe(".github/prompts/");
  });

  it("returns AGENTS.md for agent-split", function () {
    expect(getTargetPath("agent-split", "claude-code")).toBe("AGENTS.md");
  });

  it("returns .mcp.json for tooling-upgrade", function () {
    expect(getTargetPath("tooling-upgrade", "claude-code")).toBe(".mcp.json");
  });

  it("returns .claude/agents path for subagent-draft (claude-code)", function () {
    expect(getTargetPath("subagent-draft", "claude-code")).toBe(".claude/agents/repo-ops-scout.md");
  });

  it("returns .github/prompts path for subagent-draft (copilot-cli)", function () {
    expect(getTargetPath("subagent-draft", "copilot-cli")).toBe(".github/prompts/repo-ops-scout.prompt.md");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// instructions-structure recommendation
// ─────────────────────────────────────────────────────────────────────────────

describe("instructions-structure recommendation", function () {
  it("appears with high priority when no instructions file exists", function () {
    var configFiles = [
      { id: "claude-md", path: "CLAUDE.md", exists: false, content: null },
    ];
    var result = buildDebriefRecommendations([], [], makeMetadata(), makeAutonomyMetrics(), configFiles);
    var rec = findRec(result, "instructions-structure");
    expect(rec).not.toBeNull();
    expect(rec.priority).toBe("high");
    expect(rec.draftText).toContain("Role & project");
    expect(rec.draftText).toContain("Commands");
    expect(rec.draftText).toContain("Rules");
    expect(rec.draftText).toContain("Autonomous run contract");
  });

  it("appears with medium priority when instructions file is thin (< 200 chars)", function () {
    var configFiles = [
      { id: "claude-md", path: "CLAUDE.md", exists: true, content: "# Short\nJust a tiny file." },
    ];
    var result = buildDebriefRecommendations([], [], makeMetadata(), makeAutonomyMetrics(), configFiles);
    var rec = findRec(result, "instructions-structure");
    expect(rec).not.toBeNull();
    expect(rec.priority).toBe("medium");
    expect(rec.draftText).toContain("missing sections");
  });

  it("appears with medium priority when instructions missing commands section", function () {
    var content = "# My Project\n\n## Rules\n- Do stuff.\n\n## Role\nI am a developer.".repeat(5); // > 200 chars but no commands
    var configFiles = [
      { id: "claude-md", path: "CLAUDE.md", exists: true, content: content },
    ];
    var result = buildDebriefRecommendations([], [], makeMetadata(), makeAutonomyMetrics(), configFiles);
    var rec = findRec(result, "instructions-structure");
    expect(rec).not.toBeNull();
    expect(rec.priority).toBe("medium");
  });

  it("does NOT appear when instructions file is complete (> 200 chars with commands and rules)", function () {
    var content = [
      "# My Project",
      "",
      "## Role & project",
      "I am building a great app using React and Node.js.",
      "",
      "## Commands",
      "npm run dev",
      "npm test",
      "npm run build",
      "",
      "## Rules",
      "- Search existing code before writing new abstractions.",
      "- Run tests after every non-trivial change.",
      "- Prefer editing existing files over creating new ones.",
    ].join("\n");
    var configFiles = [
      { id: "claude-md", path: "CLAUDE.md", exists: true, content: content },
    ];
    var result = buildDebriefRecommendations([], [], makeMetadata(), makeAutonomyMetrics(), configFiles);
    var rec = findRec(result, "instructions-structure");
    expect(rec).toBeNull();
  });

  it("uses copilot-cli target path for copilot-cli format", function () {
    var configFiles = [
      { id: "copilot-instructions", path: ".github/copilot-instructions.md", exists: false, content: null },
    ];
    var result = buildDebriefRecommendations([], [], makeMetadata({ format: "copilot-cli" }), makeAutonomyMetrics(), configFiles);
    var rec = findRec(result, "instructions-structure");
    expect(rec).not.toBeNull();
    expect(rec.targetPath).toBe(".github/copilot-instructions.md");
    expect(rec.draftText).toContain(".github/prompts/");
  });

  it("is first in recommendations order", function () {
    var configFiles = [
      { id: "claude-md", path: "CLAUDE.md", exists: false, content: null },
    ];
    var result = buildDebriefRecommendations([], [], makeMetadata(), makeAutonomyMetrics(), configFiles);
    expect(result.recommendations.length).toBeGreaterThan(0);
    expect(result.recommendations[0].id).toBe("instructions-structure");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// sprint-commands recommendation
// ─────────────────────────────────────────────────────────────────────────────

describe("sprint-commands recommendation", function () {
  it("appears when >= 4 tool calls and no existing commands", function () {
    var configFiles = [
      { id: "claude-commands", path: ".claude/commands", exists: false, entries: [] },
      { id: "github-prompts", path: ".github/prompts", exists: false, entries: [] },
    ];
    var result = buildDebriefRecommendations([], [], makeMetadata({ totalToolCalls: 5 }), makeAutonomyMetrics({ totalToolCalls: 5 }), configFiles);
    var rec = findRec(result, "sprint-commands");
    expect(rec).not.toBeNull();
    expect(rec.priority).toBe("medium");
    expect(rec.draftText).toContain("review.md");
    expect(rec.draftText).toContain("qa.md");
    expect(rec.draftText).toContain("ship.md");
  });

  it("does NOT appear when commands already exist (claude-commands has entries)", function () {
    var configFiles = [
      { id: "claude-commands", path: ".claude/commands", exists: true, entries: [
        { path: ".claude/commands/review.md", content: "Review stuff." },
      ]},
    ];
    var result = buildDebriefRecommendations([], [], makeMetadata({ totalToolCalls: 5 }), makeAutonomyMetrics({ totalToolCalls: 5 }), configFiles);
    var rec = findRec(result, "sprint-commands");
    expect(rec).toBeNull();
  });

  it("does NOT appear when github-prompts already exist (copilot-cli)", function () {
    var configFiles = [
      { id: "github-prompts", path: ".github/prompts", exists: true, entries: [
        { path: ".github/prompts/review.prompt.md", content: "Review." },
      ]},
    ];
    var result = buildDebriefRecommendations([], [], makeMetadata({ format: "copilot-cli", totalToolCalls: 5 }), makeAutonomyMetrics({ totalToolCalls: 5 }), configFiles);
    var rec = findRec(result, "sprint-commands");
    expect(rec).toBeNull();
  });

  it("uses prompt.md format for copilot-cli", function () {
    var configFiles = [
      { id: "github-prompts", path: ".github/prompts", exists: false, entries: [] },
    ];
    var result = buildDebriefRecommendations([], [], makeMetadata({ format: "copilot-cli", totalToolCalls: 5 }), makeAutonomyMetrics({ totalToolCalls: 5 }), configFiles);
    var rec = findRec(result, "sprint-commands");
    expect(rec).not.toBeNull();
    expect(rec.draftText).toContain("review.prompt.md");
    expect(rec.draftText).toContain("mode: agent");
    expect(rec.draftText).toContain("tools:");
  });

  it("has low priority when tool calls < 4 but multiple turns", function () {
    var configFiles = [
      { id: "claude-commands", path: ".claude/commands", exists: false, entries: [] },
    ];
    var result = buildDebriefRecommendations([], [], makeMetadata({ totalToolCalls: 2, totalTurns: 3 }), makeAutonomyMetrics({ totalToolCalls: 2 }), configFiles);
    var rec = findRec(result, "sprint-commands");
    if (rec) {
      expect(rec.priority).toBe("low");
    }
  });

  it("appears after autonomy-contract in recommendations order", function () {
    var configFiles = [
      { id: "claude-md", path: "CLAUDE.md", exists: false, content: null },
      { id: "claude-commands", path: ".claude/commands", exists: false, entries: [] },
    ];
    var result = buildDebriefRecommendations([], [], makeMetadata(), makeAutonomyMetrics(), configFiles);
    var ids = result.recommendations.map(function (r) { return r.id; });
    var contractIdx = ids.indexOf("autonomy-contract");
    var commandsIdx = ids.indexOf("sprint-commands");
    if (contractIdx !== -1 && commandsIdx !== -1) {
      expect(commandsIdx).toBeGreaterThan(contractIdx);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// subagent-draft: YAML frontmatter format
// ─────────────────────────────────────────────────────────────────────────────

describe("subagent-draft YAML frontmatter", function () {
  it("uses proper YAML frontmatter for claude-code format", function () {
    var configFiles = [];
    var result = buildDebriefRecommendations([], [], makeMetadata(), makeAutonomyMetrics({ totalToolCalls: 10, topTools: [
      { name: "bash", count: 5 },
      { name: "read_file", count: 3 },
      { name: "grep", count: 2 },
    ] }), configFiles);
    var rec = findRec(result, "subagent-draft");
    expect(rec).not.toBeNull();
    expect(rec.draftText).toContain("---");
    expect(rec.draftText).toContain("name: repo-ops-scout");
    expect(rec.draftText).toContain("description:");
    expect(rec.draftText).toContain("You are a codebase scout");
    expect(rec.draftText).toContain("## Workflow");
    expect(rec.draftText).toContain("## Handoff format");
  });

  it("uses proper YAML frontmatter for copilot-cli format", function () {
    var configFiles = [];
    var result = buildDebriefRecommendations([], [], makeMetadata({ format: "copilot-cli" }), makeAutonomyMetrics({ totalToolCalls: 10, topTools: [
      { name: "bash", count: 5 },
      { name: "read_file", count: 3 },
      { name: "grep", count: 2 },
    ] }), configFiles);
    var rec = findRec(result, "subagent-draft");
    expect(rec).not.toBeNull();
    expect(rec.draftText).toContain("---");
    expect(rec.draftText).toContain("mode: agent");
    expect(rec.draftText).toContain("tools:");
    expect(rec.draftText).toContain("You are a codebase scout");
    // Should NOT have `name:` (that's claude-code only)
    expect(rec.draftText).not.toContain("name: repo-ops-scout");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// autonomy-contract: gstack bullets
// ─────────────────────────────────────────────────────────────────────────────

describe("autonomy-contract gstack bullets", function () {
  it("includes the search-before-abstracting bullet", function () {
    var result = buildDebriefRecommendations([], [], makeMetadata(), makeAutonomyMetrics(), []);
    var rec = findRec(result, "autonomy-contract");
    expect(rec).not.toBeNull();
    expect(rec.draftText).toContain("Search existing code before writing new abstractions");
  });

  it("includes the persist-discovery bullet", function () {
    var result = buildDebriefRecommendations([], [], makeMetadata(), makeAutonomyMetrics(), []);
    var rec = findRec(result, "autonomy-contract");
    expect(rec.draftText).toContain("Persist any project-specific discovery");
  });

  it("includes the blocker-repeat bullet", function () {
    var result = buildDebriefRecommendations([], [], makeMetadata(), makeAutonomyMetrics(), []);
    var rec = findRec(result, "autonomy-contract");
    expect(rec.draftText).toContain("When a blocker repeats twice, switch strategies");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// tooling-upgrade: specific MCP server recommendations
// ─────────────────────────────────────────────────────────────────────────────

describe("tooling-upgrade MCP server recommendations", function () {
  it("always includes memory server", function () {
    var configFiles = [];
    var result = buildDebriefRecommendations([], [], makeMetadata(), makeAutonomyMetrics({ topTools: [{ name: "bash", count: 5 }] }), configFiles);
    var rec = findRec(result, "tooling-upgrade");
    expect(rec).not.toBeNull();
    expect(rec.draftText).toContain("memory");
    expect(rec.draftText).toContain("@anthropic/mcp-server-memory");
  });

  it("includes git and filesystem servers when bash is a top tool", function () {
    var configFiles = [];
    var result = buildDebriefRecommendations([], [], makeMetadata(), makeAutonomyMetrics({ topTools: [{ name: "bash", count: 10 }] }), configFiles);
    var rec = findRec(result, "tooling-upgrade");
    expect(rec).not.toBeNull();
    expect(rec.draftText).toContain("@modelcontextprotocol/server-git");
    expect(rec.draftText).toContain("@modelcontextprotocol/server-filesystem");
  });

  it("includes brave-search when WebFetch is in top tools", function () {
    var configFiles = [];
    var result = buildDebriefRecommendations([], [], makeMetadata(), makeAutonomyMetrics({
      topTools: [{ name: "bash", count: 3 }, { name: "WebFetch", count: 2 }],
      idleTime: 40,
    }), configFiles);
    var rec = findRec(result, "tooling-upgrade");
    expect(rec).not.toBeNull();
    expect(rec.draftText).toContain("brave-search");
  });

  it("includes github MCP when there are errors", function () {
    var configFiles = [];
    var result = buildDebriefRecommendations([], [], makeMetadata({ errorCount: 3 }), makeAutonomyMetrics({
      topTools: [{ name: "bash", count: 5 }],
    }), configFiles);
    var rec = findRec(result, "tooling-upgrade");
    expect(rec).not.toBeNull();
    expect(rec.draftText).toContain("@modelcontextprotocol/server-github");
  });

  it("outputs valid JSON snippet in draft text", function () {
    var configFiles = [];
    var result = buildDebriefRecommendations([], [], makeMetadata(), makeAutonomyMetrics({ topTools: [{ name: "bash", count: 5 }] }), configFiles);
    var rec = findRec(result, "tooling-upgrade");
    // Extract JSON from draftText — it starts with { after "additions to .mcp.json:\n\n"
    var jsonStart = rec.draftText.indexOf("{");
    var jsonEnd = rec.draftText.lastIndexOf("}") + 1;
    var jsonStr = rec.draftText.substring(jsonStart, jsonEnd);
    expect(function () { JSON.parse(jsonStr); }).not.toThrow();
    var parsed = JSON.parse(jsonStr);
    expect(parsed).toHaveProperty("mcpServers");
  });

  it("mentions existing MCP servers when hasMcp is true", function () {
    var configFiles = [
      { id: "mcp-json", path: ".mcp.json", exists: true, content: JSON.stringify({ mcpServers: { "my-existing-server": {} } }) },
    ];
    var result = buildDebriefRecommendations([], [], makeMetadata(), makeAutonomyMetrics({ topTools: [{ name: "bash", count: 5 }] }), configFiles);
    var rec = findRec(result, "tooling-upgrade");
    expect(rec).not.toBeNull();
    expect(rec.draftText).toContain("mcpServers");
    // existing server name should appear in evidence context, not draftText
    expect(rec.evidence.join(" ")).toContain("my-existing-server");
  });

  it("adds copilot note for copilot-cli format", function () {
    var configFiles = [];
    var result = buildDebriefRecommendations([], [], makeMetadata({ format: "copilot-cli" }), makeAutonomyMetrics({ topTools: [{ name: "bash", count: 5 }] }), configFiles);
    var rec = findRec(result, "tooling-upgrade");
    expect(rec).not.toBeNull();
    // copilot note goes in evidence, draftText is clean JSON
    expect(rec.draftText).toContain("mcpServers");
    expect(rec.evidence.join(" ")).toContain("github.copilot.chat.mcp.servers");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Recommendation ordering
// ─────────────────────────────────────────────────────────────────────────────

describe("recommendation ordering", function () {
  it("orders recommendations: instructions-structure first, tooling-upgrade last", function () {
    var configFiles = [
      { id: "claude-md", path: "CLAUDE.md", exists: false, content: null },
      { id: "claude-commands", path: ".claude/commands", exists: false, entries: [] },
    ];
    var result = buildDebriefRecommendations([], [], makeMetadata(), makeAutonomyMetrics(), configFiles);
    var ids = result.recommendations.map(function (r) { return r.id; });

    // instructions-structure should be first if present
    if (ids.indexOf("instructions-structure") !== -1) {
      expect(ids[0]).toBe("instructions-structure");
    }

    // tooling-upgrade should be after agent-split, subagent-draft
    var toolingIdx = ids.indexOf("tooling-upgrade");
    var agentIdx = ids.indexOf("agent-split");
    var subagentIdx = ids.indexOf("subagent-draft");
    if (toolingIdx !== -1 && agentIdx !== -1) {
      expect(toolingIdx).toBeGreaterThan(agentIdx);
    }
    if (toolingIdx !== -1 && subagentIdx !== -1) {
      expect(toolingIdx).toBeGreaterThan(subagentIdx);
    }
  });

  it("sprint-commands appears before agent-split", function () {
    var configFiles = [
      { id: "claude-commands", path: ".claude/commands", exists: false, entries: [] },
    ];
    var result = buildDebriefRecommendations([], [], makeMetadata(), makeAutonomyMetrics(), configFiles);
    var ids = result.recommendations.map(function (r) { return r.id; });
    var sprintIdx = ids.indexOf("sprint-commands");
    var agentIdx = ids.indexOf("agent-split");
    if (sprintIdx !== -1 && agentIdx !== -1) {
      expect(sprintIdx).toBeLessThan(agentIdx);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// checkApplied
// ─────────────────────────────────────────────────────────────────────────────

describe("checkApplied -- instructions-structure", function () {
  function makeRec(overrides) {
    return Object.assign({
      id: "instructions-structure",
      targetPath: "CLAUDE.md",
      detectionKeywords: ["## Commands", "## Rules"],
    }, overrides);
  }

  it("returns pending when target file does not exist", function () {
    var configFiles = [
      { id: "claude-md", path: "CLAUDE.md", exists: false, content: null },
    ];
    expect(checkApplied(makeRec(), configFiles)).toBe("pending");
  });

  it("returns pending when file exists but no keywords match", function () {
    var configFiles = [
      { id: "claude-md", path: "CLAUDE.md", exists: true, content: "# Hello\nNo relevant content here." },
    ];
    expect(checkApplied(makeRec(), configFiles)).toBe("pending");
  });

  it("returns partial when only some keywords match", function () {
    var configFiles = [
      { id: "claude-md", path: "CLAUDE.md", exists: true, content: "# Project\n\n## Commands\nnpm test" },
    ];
    expect(checkApplied(makeRec(), configFiles)).toBe("partial");
  });

  it("returns handled when all keywords match", function () {
    var configFiles = [
      { id: "claude-md", path: "CLAUDE.md", exists: true, content: "# Project\n\n## Commands\nnpm test\n\n## Rules\n- Be good." },
    ];
    expect(checkApplied(makeRec(), configFiles)).toBe("handled");
  });

  it("uses copilot-instructions path for copilot-cli format", function () {
    var configFiles = [
      { id: "copilot-instructions", path: ".github/copilot-instructions.md", exists: true, content: "## Commands\nnpm test\n## Rules\n- do stuff" },
    ];
    var rec = makeRec({ targetPath: ".github/copilot-instructions.md" });
    expect(checkApplied(rec, configFiles)).toBe("handled");
  });
});

describe("checkApplied -- autonomy-contract", function () {
  function makeRec(overrides) {
    return Object.assign({
      id: "autonomy-contract",
      targetPath: "CLAUDE.md",
      detectionKeywords: ["autonomous", "search existing code before"],
    }, overrides);
  }

  it("returns pending when file is missing", function () {
    expect(checkApplied(makeRec(), [])).toBe("pending");
  });

  it("returns partial when only 'autonomous' is present", function () {
    var configFiles = [
      { id: "claude-md", path: "CLAUDE.md", exists: true, content: "Be autonomous and keep going." },
    ];
    expect(checkApplied(makeRec(), configFiles)).toBe("partial");
  });

  it("returns handled when both keywords are present", function () {
    var configFiles = [
      { id: "claude-md", path: "CLAUDE.md", exists: true, content: "Be autonomous.\nAlways search existing code before writing new code." },
    ];
    expect(checkApplied(makeRec(), configFiles)).toBe("handled");
  });
});

describe("checkApplied -- sprint-commands", function () {
  function makeRec() {
    return { id: "sprint-commands", targetPath: ".claude/commands/", detectionKeywords: [] };
  }

  it("returns pending when both command dirs are absent", function () {
    var configFiles = [
      { id: "claude-commands", path: ".claude/commands", exists: false, entries: [] },
      { id: "github-prompts", path: ".github/prompts", exists: false, entries: [] },
    ];
    expect(checkApplied(makeRec(), configFiles)).toBe("pending");
  });

  it("returns pending when dir exists but has no entries", function () {
    var configFiles = [
      { id: "claude-commands", path: ".claude/commands", exists: true, entries: [] },
    ];
    expect(checkApplied(makeRec(), configFiles)).toBe("pending");
  });

  it("returns handled when claude-commands has entries", function () {
    var configFiles = [
      { id: "claude-commands", path: ".claude/commands", exists: true, entries: [
        { path: ".claude/commands/review.md", content: "Review stuff." },
      ]},
    ];
    expect(checkApplied(makeRec(), configFiles)).toBe("handled");
  });

  it("returns handled when github-prompts has entries (copilot-cli)", function () {
    var configFiles = [
      { id: "github-prompts", path: ".github/prompts", exists: true, entries: [
        { path: ".github/prompts/review.prompt.md", content: "Review stuff." },
      ]},
    ];
    expect(checkApplied(makeRec(), configFiles)).toBe("handled");
  });
});

describe("checkApplied -- agent-split", function () {
  function makeRec() {
    return { id: "agent-split", targetPath: "AGENTS.md", detectionKeywords: ["scout", "builder", "verifier"] };
  }

  it("returns pending when AGENTS.md is missing", function () {
    expect(checkApplied(makeRec(), [])).toBe("pending");
  });

  it("returns partial when only 'scout' is present", function () {
    var configFiles = [
      { id: "agents-md", path: "AGENTS.md", exists: true, content: "# Agents\n## scout\nExplore the repo." },
    ];
    expect(checkApplied(makeRec(), configFiles)).toBe("partial");
  });

  it("returns partial when scout and builder but not verifier", function () {
    var configFiles = [
      { id: "agents-md", path: "AGENTS.md", exists: true, content: "## scout\nExplore.\n## builder\nBuild it." },
    ];
    expect(checkApplied(makeRec(), configFiles)).toBe("partial");
  });

  it("returns handled when all three roles are present", function () {
    var configFiles = [
      { id: "agents-md", path: "AGENTS.md", exists: true, content: "## scout\nExplore.\n## builder\nBuild.\n## verifier\nVerify." },
    ];
    expect(checkApplied(makeRec(), configFiles)).toBe("handled");
  });
});

describe("checkApplied -- subagent-draft", function () {
  function makeRec() {
    return { id: "subagent-draft", targetPath: ".claude/agents/repo-ops-scout.md", detectionKeywords: ["scout", "repo-ops"] };
  }

  it("returns pending when agents dir is empty", function () {
    var configFiles = [
      { id: "claude-agents", path: ".claude/agents", exists: false, entries: [] },
    ];
    expect(checkApplied(makeRec(), configFiles)).toBe("pending");
  });

  it("returns pending when agents dir has entries but no keyword match", function () {
    var configFiles = [
      { id: "claude-agents", path: ".claude/agents", exists: true, entries: [
        { path: ".claude/agents/helper.md", content: "A helper agent." },
      ]},
    ];
    expect(checkApplied(makeRec(), configFiles)).toBe("pending");
  });

  it("returns handled when an agent file contains scout in path", function () {
    var configFiles = [
      { id: "claude-agents", path: ".claude/agents", exists: true, entries: [
        { path: ".claude/agents/repo-ops-scout.md", content: "You are a codebase scout." },
      ]},
    ];
    expect(checkApplied(makeRec(), configFiles)).toBe("handled");
  });

  it("returns handled when github-prompts has a file with both keywords", function () {
    var configFiles = [
      { id: "github-prompts", path: ".github/prompts", exists: true, entries: [
        { path: ".github/prompts/repo-ops-scout.prompt.md", content: "Scout the repo-ops codebase." },
      ]},
    ];
    expect(checkApplied(makeRec(), configFiles)).toBe("handled");
  });

  it("returns handled when content contains both scout and repo-ops keywords", function () {
    var configFiles = [
      { id: "claude-agents", path: ".claude/agents", exists: true, entries: [
        { path: ".claude/agents/ops.md", content: "A scout for repo-ops workflows." },
      ]},
    ];
    expect(checkApplied(makeRec(), configFiles)).toBe("handled");
  });
});

describe("checkApplied -- tooling-upgrade", function () {
  function makeRec() {
    return { id: "tooling-upgrade", targetPath: null, detectionKeywords: ["mcp-server-memory"] };
  }

  it("returns pending when .mcp.json does not exist", function () {
    var configFiles = [
      { id: "mcp-json", path: ".mcp.json", exists: false, content: null },
    ];
    expect(checkApplied(makeRec(), configFiles)).toBe("pending");
  });

  it("returns pending when .mcp.json exists but keyword is absent", function () {
    var configFiles = [
      { id: "mcp-json", path: ".mcp.json", exists: true, content: JSON.stringify({ mcpServers: { git: {} } }) },
    ];
    expect(checkApplied(makeRec(), configFiles)).toBe("pending");
  });

  it("returns handled when .mcp.json contains mcp-server-memory", function () {
    var configFiles = [
      { id: "mcp-json", path: ".mcp.json", exists: true, content: JSON.stringify({ mcpServers: { memory: { command: "npx", args: ["-y", "@anthropic/mcp-server-memory"] } } }) },
    ];
    expect(checkApplied(makeRec(), configFiles)).toBe("handled");
  });

  it("returns pending when configFiles is empty", function () {
    expect(checkApplied(makeRec(), [])).toBe("pending");
  });
});

describe("checkApplied -- edge cases", function () {
  it("returns pending for unknown id with no targetPath", function () {
    var rec = { id: "unknown-rec", targetPath: null, detectionKeywords: ["something"] };
    expect(checkApplied(rec, [])).toBe("pending");
  });

  it("returns pending when detectionKeywords is empty for a file-based rec", function () {
    var configFiles = [
      { id: "claude-md", path: "CLAUDE.md", exists: true, content: "# Full content with lots of stuff." },
    ];
    var rec = { id: "instructions-structure", targetPath: "CLAUDE.md", detectionKeywords: [] };
    expect(checkApplied(rec, configFiles)).toBe("pending");
  });

  it("is case-insensitive for keyword matching", function () {
    var configFiles = [
      { id: "agents-md", path: "AGENTS.md", exists: true, content: "## Scout\n## Builder\n## Verifier" },
    ];
    var rec = { id: "agent-split", targetPath: "AGENTS.md", detectionKeywords: ["scout", "builder", "verifier"] };
    expect(checkApplied(rec, configFiles)).toBe("handled");
  });
});
