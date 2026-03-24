/**
 * AI Coach Agent
 *
 * Analyzes an AgentViz session using a tool-calling agent loop.
 * The agent can read real config files from disk before proposing changes,
 * and commits each recommendation via a structured `recommend` tool call --
 * ensuring every suggestion targets a real file with valid, apply-able content.
 *
 * Auth: GitHub Models API (OpenAI-compatible), authenticated via `gh auth token`.
 * No additional setup needed -- reuses the developer's existing gh credential.
 *
 * Agent loop:
 *   1. Send session stats + tool definitions
 *   2. Model calls read_config(path) to inspect real files
 *   3. Server executes tool calls and returns results
 *   4. Model calls recommend(...) for each concrete fix
 *   5. Loop until model stops calling tools (max 6 rounds)
 */

import { execFile } from "child_process";
import OpenAI from "openai";

var GITHUB_MODELS_BASE_URL = "https://models.inference.ai.azure.com";
var COACH_MODEL = "gpt-4o";
var MAX_TOKENS = 2000;
var MAX_AGENT_ROUNDS = 6;

// Format-specific config paths the agent may read and target
var CONFIG_PATHS_CLAUDE = [
  "CLAUDE.md",
  "AGENTS.md",
  ".mcp.json",
  ".claude/settings.json",
  ".claude/agents",
  ".claude/commands",
];

var CONFIG_PATHS_COPILOT = [
  ".github/copilot-instructions.md",
  ".github/prompts",
  ".github/extensions",
];

// Shared paths available regardless of agent type
var CONFIG_PATHS_SHARED = [
  ".mcp.json",
  ".github/copilot-instructions.md",
];

export function getConfigPathsForFormat(format) {
  if (format === "copilot-cli") return CONFIG_PATHS_COPILOT.concat([".mcp.json"]);
  return CONFIG_PATHS_CLAUDE; // claude-code default
}

// Kept for backwards compat / tests
export var KNOWN_CONFIG_PATHS = CONFIG_PATHS_CLAUDE.concat(CONFIG_PATHS_COPILOT.filter(function (p) {
  return !CONFIG_PATHS_CLAUDE.includes(p);
}));

// ─────────────────────────────────────────────────────────────────────────────
// Token acquisition
// ─────────────────────────────────────────────────────────────────────────────

export function getGhToken() {
  return new Promise(function (resolve, reject) {
    execFile("gh", ["auth", "token"], { timeout: 6000 }, function (err, stdout) {
      var token = (stdout || "").trim();
      if (err || !token) {
        reject(new Error("Could not get gh auth token. Run: gh auth login"));
        return;
      }
      resolve(token);
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool definitions (built per-request so paths match session format)
// ─────────────────────────────────────────────────────────────────────────────

function buildAgentTools(configPaths) {
  var pathList = configPaths.join(", ");
  return [
    {
      type: "function",
      function: {
        name: "read_config",
        description:
          "Read an actual config file from the developer's project. Call this BEFORE proposing changes so you know what already exists. Returns file content, or a 'not found' message with a starter template if the file is missing.",
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "Relative path to the config file. Must be one of: " + pathList,
            },
          },
          required: ["path"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "recommend",
        description:
          "Commit one concrete recommendation. draftText must be valid content ready to write/append -- no pseudo-code, no placeholder URLs. Call this 2-4 times total.",
        parameters: {
          type: "object",
          properties: {
            title: { type: "string", description: "Short title (< 8 words)" },
            priority: { type: "string", enum: ["high", "medium"] },
            summary: { type: "string", description: "1-2 sentences describing the problem seen in the session data" },
            fix: { type: "string", description: "Specific action to take, referencing the actual error or metric" },
            targetPath: {
              type: "string",
              description: "Config file to write to. Must be one of: " + pathList + ". Use null for advice-only (no file change).",
            },
            draftText: {
              type: "string",
              description: "Content to write or append. For .mcp.json: full valid JSON with mcpServers object. For markdown: only the new section. Must be copy-paste ready.",
            },
          },
          required: ["title", "priority", "summary", "fix", "targetPath", "draftText"],
        },
      },
    },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// System prompt (format-aware)
// ─────────────────────────────────────────────────────────────────────────────

var MCP_JSON_SCHEMA = [
  "## .mcp.json schema (MUST follow exactly)",
  "{",
  '  "mcpServers": {',
  '    "serverName": {',
  '      "command": "uvx",',
  '      "args": ["mcp-server-package-name"],',
  '      "env": {}',
  "    }",
  "  }",
  "}",
  "NEVER output {\"servers\": [...urls...]} -- that is not valid .mcp.json format.",
  "NEVER add mcp-server-fetch for Copilot CLI -- web_fetch is already a built-in tool there.",
].join("\n");

var CLAUDE_CODE_GUIDANCE = [
  "Agent type: CLAUDE CODE",
  "Config files and what they control:",
  "  CLAUDE.md -- main instructions, autonomy rules, what the agent can do without asking",
  "  .mcp.json -- adds new tools (MCP servers) the agent can call",
  "  .claude/settings.json -- allowedTools/disallowedTools permission lists",
  "  .claude/agents/ -- sub-agent definitions for delegating tasks",
  "",
  "Diagnosis guide (match errors to fixes):",
  "  web_fetch errors repeatedly: add mcp-server-fetch to .mcp.json so the agent can fetch URLs",
  "  'permission denied' / tool blocked: add the tool to allowedTools in .claude/settings.json",
  "  High idle time / many user follow-ups: agent is asking permission -- add autonomy grants to CLAUDE.md",
  "  'apply_patch failed': patch too large or agent needs smaller steps -- add guidance to CLAUDE.md",
  "  Agent uses wrong tool repeatedly: add tool usage guidance to CLAUDE.md",
].join("\n");

var COPILOT_CLI_GUIDANCE = [
  "Agent type: GITHUB COPILOT CLI",
  "Config files and what they control:",
  "  .github/copilot-instructions.md -- instructions, context, autonomy rules, coding standards",
  "  .github/prompts/*.prompt.md -- custom slash commands / reusable task templates",
  "  .github/extensions/*.yml -- skill extensions that add new tool capabilities",
  "  .mcp.json -- adds new MCP server tools (NOT for built-in tools)",
  "",
  "Diagnosis guide (match errors to fixes):",
  "  web_fetch errors: web_fetch is a BUILT-IN tool in Copilot CLI -- the issue is not a missing MCP server.",
  "    If URLs consistently fail: add instructions to copilot-instructions.md like",
  "    'If web_fetch fails, try an alternative source or skip and continue rather than retrying'",
  "    If a specific domain fails: that domain may be blocked -- note it in instructions",
  "  High idle time: agent is waiting for human approval -- add autonomy permissions to copilot-instructions.md",
  "    Example: 'You may create, edit, and delete files without asking for confirmation.'",
  "  Agent lacks domain knowledge: add project context, architecture overview to copilot-instructions.md",
  "  Agent repeats same mistake: add explicit 'never do X, instead do Y' rules to copilot-instructions.md",
  "  Many human corrections: analyze WHAT the human corrected and add that as a rule",
].join("\n");

function buildSystemPrompt(format) {
  var formatGuidance = format === "copilot-cli" ? COPILOT_CLI_GUIDANCE : CLAUDE_CODE_GUIDANCE;
  return [
    "You are an AI agent workflow coach. Your ONLY job is to recommend changes to",
    "AI agent configuration files that will make the agent more autonomous and effective.",
    "",
    "CRITICAL SCOPE RULES -- you will be penalized for violating these:",
    "- You are NOT advising on the project the agent was working on.",
    "- You are NOT recommending features the developer should implement.",
    "- You are NOT giving general best practices or task management tips.",
    "- You are ONLY recommending changes to config files that directly fix observed problems.",
    "- Every recommendation MUST cite a specific error text, metric, or user message from the session.",
    "- If you cannot connect a recommendation to a specific session observation, do NOT make it.",
    "- Prefer fewer, higher-quality recommendations over many generic ones.",
    "",
    formatGuidance,
    "",
    MCP_JSON_SCHEMA,
    "",
    "WORKFLOW:",
    "1. Read the session stats and errors carefully.",
    "2. Check the 'Patterns already detected' section -- these are your starting points.",
    "3. For each triggered pattern: call read_config() for its targetPath, then recommend() with",
    "   a draftText that references the SPECIFIC errors/metrics/tool names from THIS session.",
    "   Do NOT copy the template verbatim -- make it specific. E.g. if the pattern says 'add autonomy rules'",
    "   and the session shows 8 interventions about file editing, write: 'You may create/edit/delete files",
    "   in src/ without asking for confirmation.'",
    "4. If there are errors/metrics with no matching pattern, add a new recommendation for those.",
    "5. Skip patterns that are already-applied.",
    "6. For .mcp.json: read it first, then output the FULL merged JSON with new servers added.",
    "7. For markdown: output ONLY the new section to append (be specific, not generic).",
  ].join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Prompt builder
// ─────────────────────────────────────────────────────────────────────────────

export function buildCoachPrompt(payload) {
  var {
    format, primaryModel, totalEvents, totalTurns, errorCount, totalToolCalls,
    productiveRuntime, humanResponseTime, idleTime, interventions, autonomyEfficiency,
    topTools, errorSamples, userFollowUps, triggeredPatterns,
  } = payload;

  var agentType = format === "copilot-cli" ? "GitHub Copilot CLI" : "Claude Code";
  var configPaths = getConfigPathsForFormat(format);
  var toolList = (topTools || []).slice(0, 10).map(function (t) { return t.name + " x" + t.count; }).join(", ");
  var errors = (errorSamples || []).slice(0, 6).map(function (e, i) { return (i + 1) + ". " + e; }).join("\n");
  var followUps = (userFollowUps || []).slice(0, 5).map(function (m) { return "- " + m; }).join("\n");

  var sections = [
    "Analyze this " + agentType + " session. Call read_config() to inspect relevant files, then recommend() for each fix.",
    "",
    "## Session stats",
    "- Model: " + (primaryModel || "unknown"),
    "- Events: " + (totalEvents || 0) + ", Turns: " + (totalTurns || 0) + ", Tool calls: " + (totalToolCalls || 0),
    "- Errors: " + (errorCount || 0),
    "- Productive runtime: " + (productiveRuntime || "0s"),
    "- Human response time: " + (humanResponseTime || "0s") + " (time agent waited for human)",
    "- Idle time: " + (idleTime || "0s"),
    "- Interventions needed: " + (interventions || 0),
    "- Autonomy efficiency: " + (autonomyEfficiency || "0%"),
    "- Top tools used: " + (toolList || "none"),
  ];

  if (errors) {
    sections.push("", "## Errors observed (diagnose these first)", errors);
  }
  if (followUps) {
    sections.push("", "## Human follow-up messages (where agent got stuck)", followUps);
  }

  // Pass triggered static patterns as seeds -- agent enhances these with real session data
  var pending = (triggeredPatterns || []).filter(function (p) { return !p.alreadyApplied; });
  var applied = (triggeredPatterns || []).filter(function (p) { return p.alreadyApplied; });
  if (pending.length > 0) {
    sections.push("", "## Patterns already detected in this session (enhance these -- make them specific to the data above)");
    pending.forEach(function (p) {
      sections.push(
        "- [" + p.id + "] " + p.title + (p.targetPath ? " -> " + p.targetPath : " (no file target)"),
        "  Summary: " + p.summary,
        p.draftTemplate ? "  Template draft (improve with session-specific data): " + p.draftTemplate.split("\n")[0] + "..." : "",
      );
    });
    sections.push("Use these patterns as starting points. Read the actual config file, then produce a draftText that references the specific errors/metrics from this session.");
  }
  if (applied.length > 0) {
    sections.push(
      "",
      "## Already applied (skip these -- do NOT re-recommend)",
      applied.map(function (p) { return "- " + p.title; }).join("\n"),
    );
  }

  sections.push(
    "",
    "## Available config paths to read/write",
    configPaths.map(function (p) { return "- " + p; }).join("\n"),
  );

  return sections.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Agent
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Run the coach agent.
 *
 * @param {object} payload - session stats from the UI
 * @param {object} opts
 * @param {AbortSignal} [opts.signal] - cancellation signal
 * @param {function} [opts.onStep] - called with {type, label, data} as agent works
 * @param {function} [opts.readConfigFile] - (path) => string|null -- reads a file from disk
 * @returns {Promise<{ recommendations: object[], model: string, usage: object, steps: object[] }>}
 */
export async function runCoachAgent(payload, opts) {
  var signal = opts && opts.signal;
  var onStep = opts && opts.onStep;
  var readConfigFile = opts && opts.readConfigFile;

  var token = await getGhToken();

  var client = new OpenAI({
    apiKey: token,
    baseURL: GITHUB_MODELS_BASE_URL,
    defaultHeaders: { "X-GitHub-Api-Version": "2022-11-28" },
  });

  var format = payload.format || "claude-code";
  var configPaths = getConfigPathsForFormat(format);
  var agentTools = buildAgentTools(configPaths);

  var messages = [
    { role: "system", content: buildSystemPrompt(format) },
    { role: "user", content: buildCoachPrompt(payload) },
  ];

  var recommendations = [];
  var totalUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  var steps = [];
  var usedModel = COACH_MODEL;

  function emit(step) {
    steps.push(step);
    if (onStep) onStep(step);
  }

  emit({ type: "thinking", label: "Analyzing session..." });

  for (var round = 0; round < MAX_AGENT_ROUNDS; round++) {
    if (signal && signal.aborted) throw Object.assign(new Error("Aborted"), { name: "AbortError" });

    var completion = await client.chat.completions.create({
      model: COACH_MODEL,
      messages: messages,
      tools: agentTools,
      tool_choice: "auto",
      temperature: 0.2,
      max_tokens: MAX_TOKENS,
    }, { signal });

    usedModel = completion.model || COACH_MODEL;
    if (completion.usage) {
      totalUsage.prompt_tokens += completion.usage.prompt_tokens || 0;
      totalUsage.completion_tokens += completion.usage.completion_tokens || 0;
      totalUsage.total_tokens += completion.usage.total_tokens || 0;
    }

    var assistantMsg = completion.choices[0]?.message;
    if (!assistantMsg) break;
    messages.push(assistantMsg);

    var toolCalls = assistantMsg.tool_calls || [];
    if (toolCalls.length === 0) break; // Model stopped calling tools

    // Execute all tool calls in this round
    var toolResults = [];
    for (var i = 0; i < toolCalls.length; i++) {
      var tc = toolCalls[i];
      var fnName = tc.function?.name;
      var fnArgs;
      try { fnArgs = JSON.parse(tc.function?.arguments || "{}"); } catch (e) { fnArgs = {}; }

      if (fnName === "read_config") {
        var filePath = fnArgs.path || "";
        emit({ type: "read_config", label: "Reading " + filePath + "...", path: filePath });
        var content = readConfigFile ? readConfigFile(filePath) : null;
        var result = content != null
          ? "Content of " + filePath + ":\n" + content.substring(0, 3000)
          : "File not found: " + filePath + "\n(This file does not exist yet -- you can create it with recommend())";
        toolResults.push({ tool_call_id: tc.id, role: "tool", content: result });

      } else if (fnName === "recommend") {
        var rec = normalizeRecommendation(fnArgs, configPaths);
        recommendations.push(rec);
        emit({ type: "recommend", label: "Recommendation: " + rec.title, rec: rec });
        toolResults.push({ tool_call_id: tc.id, role: "tool", content: "Recommendation recorded." });
      } else {
        toolResults.push({ tool_call_id: tc.id, role: "tool", content: "Unknown tool: " + fnName });
      }
    }

    messages.push(...toolResults);

    // Stop once we have enough recommendations
    if (recommendations.length >= 4) break;
  }

  if (recommendations.length === 0) {
    throw new Error("Agent did not produce any recommendations. Try again.");
  }

  emit({ type: "done", label: recommendations.length + " recommendation" + (recommendations.length !== 1 ? "s" : "") + " ready" });

  return {
    recommendations: recommendations,
    model: usedModel,
    usage: totalUsage,
    steps: steps,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Normalization
// ─────────────────────────────────────────────────────────────────────────────

function normalizeRecommendation(args, allowedPaths) {
  var allowed = allowedPaths || KNOWN_CONFIG_PATHS;
  var targetPath = args.targetPath && args.targetPath !== "null" && allowed.includes(args.targetPath)
    ? args.targetPath
    : null;
  return {
    title: String(args.title || "Recommendation"),
    priority: args.priority === "high" ? "high" : "medium",
    summary: String(args.summary || ""),
    fix: String(args.fix || ""),
    targetPath: targetPath,
    draft: String(args.draftText || ""),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Output parsing (kept for backwards compat / tests)
// ─────────────────────────────────────────────────────────────────────────────

export function parseRecommendations(raw) {
  if (!raw) throw new Error("Empty response from AI");
  var cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  var parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    var arrayMatch = cleaned.match(/\[[\s\S]*\]/);
    if (!arrayMatch) throw new Error("AI response was not valid JSON: " + cleaned.substring(0, 300));
    try { parsed = JSON.parse(arrayMatch[0]); }
    catch (e2) { throw new Error("Could not parse AI JSON: " + arrayMatch[0].substring(0, 300)); }
  }
  if (parsed && !Array.isArray(parsed)) {
    var keys = Object.keys(parsed);
    for (var i = 0; i < keys.length; i++) {
      if (Array.isArray(parsed[keys[i]])) { parsed = parsed[keys[i]]; break; }
    }
  }
  if (!Array.isArray(parsed)) {
    throw new Error("AI returned unexpected shape: " + JSON.stringify(parsed).substring(0, 200));
  }
  return parsed.map(function (item, idx) {
    if (!item || typeof item !== "object") {
      return { title: "Recommendation " + (idx + 1), priority: "medium", summary: String(item), fix: "", targetPath: null, draft: "" };
    }
    return {
      title: String(item.title || "Recommendation " + (idx + 1)),
      priority: item.priority === "high" ? "high" : "medium",
      summary: String(item.summary || ""),
      fix: String(item.fix || ""),
      targetPath: null,
      draft: String(item.draft || ""),
    };
  });
}
