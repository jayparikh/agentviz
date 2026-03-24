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
var COACH_MODEL = "gpt-4o-mini";
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
  "",
  "Common MCP servers for common problems:",
  "- web_fetch errors: command=uvx args=[mcp-server-fetch]  -- adds real HTTP fetch capability",
  "- filesystem access: command=npx args=[-y, @modelcontextprotocol/server-filesystem, /path]",
  "- GitHub API: command=npx args=[-y, @modelcontextprotocol/server-github]",
  "NEVER output {\"servers\": [...urls...]} -- that is not valid .mcp.json format.",
].join("\n");

var CLAUDE_CODE_GUIDANCE = [
  "This is a CLAUDE CODE session. Relevant config files:",
  "- CLAUDE.md: main instructions, autonomy rules, permission grants",
  "- AGENTS.md: sub-agent definitions (if used)",
  "- .mcp.json: MCP server configuration (adds tools/capabilities)",
  "- .claude/settings.json: permission allowlists/blocklists",
  "- .claude/agents/: sub-agent markdown files",
  "",
  "If errors involve web_fetch: add the fetch MCP server to .mcp.json",
  "If idle time is high: add autonomy instructions to CLAUDE.md",
  "If tool calls are blocked: check .claude/settings.json allowedTools",
].join("\n");

var COPILOT_CLI_GUIDANCE = [
  "This is a GITHUB COPILOT CLI session. Relevant config files:",
  "- .github/copilot-instructions.md: main instructions, coding standards, context",
  "- .github/prompts/*.prompt.md: custom slash commands / task templates",
  "- .github/extensions/*.yml: skill extensions that add capabilities",
  "- .mcp.json: MCP server configuration (adds tools/capabilities)",
  "",
  "For Copilot CLI, web_fetch is a built-in tool -- if it's failing, the issue is",
  "usually network access or missing MCP server for the specific resource type.",
  "If idle time is high: add task management guidance to .github/copilot-instructions.md",
  "If the agent lacks domain knowledge: add context sections to copilot-instructions.md",
].join("\n");

function buildSystemPrompt(format) {
  var formatGuidance = format === "copilot-cli" ? COPILOT_CLI_GUIDANCE : CLAUDE_CODE_GUIDANCE;
  return [
    "You are an expert AI agent workflow coach. You analyze session telemetry from",
    "AI coding agents and produce specific, evidence-based recommendations.",
    "",
    formatGuidance,
    "",
    MCP_JSON_SCHEMA,
    "",
    "RULES:",
    "1. Always call read_config() first for relevant files before recommending.",
    "2. Base every recommendation on ACTUAL data from the session (specific errors, metrics).",
    "3. Never invent config keys or fake URLs. Only output valid JSON or valid Markdown.",
    "4. For .mcp.json: merge with existing content -- output the full merged JSON.",
    "5. For markdown files: output only the new section to APPEND (not the full file).",
    "6. Call recommend() 2-4 times. Set targetPath=null only for advice with no file fix.",
  ].join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Prompt builder
// ─────────────────────────────────────────────────────────────────────────────

export function buildCoachPrompt(payload) {
  var {
    format, primaryModel, totalEvents, totalTurns, errorCount, totalToolCalls,
    productiveRuntime, humanResponseTime, idleTime, interventions, autonomyEfficiency,
    topTools, errorSamples, userFollowUps,
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
