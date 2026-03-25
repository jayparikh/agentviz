/**
 * AI Coach Agent
 *
 * Analyzes an AgentViz session using the @github/copilot-sdk -- the same
 * engine that powers Copilot CLI. The agent reads real config files from disk
 * before proposing changes, and commits each recommendation via a structured
 * `recommend` tool call.
 *
 * Auth: Uses the developer's logged-in Copilot credentials automatically.
 * No additional setup needed -- reuses the same session the developer uses.
 *
 * Agent loop:
 *   1. Spawn Copilot CLI in server mode via JSON-RPC (SDK handles lifecycle)
 *   2. Send session stats + system prompt + tool definitions
 *   3. Model calls read_config(path) to inspect real files
 *   4. Model calls recommend(...) for each concrete fix
 *   5. Session idles when done
 */

import { CopilotClient, defineTool, approveAll } from "@github/copilot-sdk";

// Format-specific config paths the agent may read and target
var CONFIG_PATHS_CLAUDE = [
  ".claude/commands",
  ".claude/agents",
  ".mcp.json",
  ".claude/settings.json",
  "CLAUDE.md",
  "AGENTS.md",
];

var CONFIG_PATHS_COPILOT = [
  ".github/prompts",
  ".github/extensions",
  ".github/instructions",
  ".mcp.json",
  ".github/copilot-instructions.md",
];

export function getConfigPathsForFormat(format) {
  if (format === "copilot-cli") return CONFIG_PATHS_COPILOT;
  return CONFIG_PATHS_CLAUDE; // claude-code default
}

// Kept for backwards compat / tests
export var KNOWN_CONFIG_PATHS = CONFIG_PATHS_CLAUDE.concat(CONFIG_PATHS_COPILOT.filter(function (p) {
  return !CONFIG_PATHS_CLAUDE.includes(p);
}));

// ─────────────────────────────────────────────────────────────────────────────
// Tool definitions (built per-request so paths match session format)
// ─────────────────────────────────────────────────────────────────────────────

function buildAgentTools(configPaths, handlers) {
  var pathList = configPaths.join(", ");
  return [
    defineTool("read_config", {
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
      skipPermission: true,
      handler: handlers.read_config,
    }),
    defineTool("recommend", {
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
      skipPermission: true,
      handler: handlers.recommend,
    }),
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
  "Config files and WHEN to use each one:",
  "  CLAUDE.md -- persistent rules: autonomy grants, safety boundaries, coding standards.",
  "    Use when: the problem recurs across many sessions (agent keeps asking for permission, uses wrong patterns).",
  "    Do NOT use for task-specific guidance or one-off workflows.",
  "  .claude/agents/<name>.md -- sub-agent that the main agent can delegate specialized work to.",
  "    Use when: the session shows a repeated multi-step workflow (research+implement, write+review, build+test).",
  "    Example: if agent always does web_search -> read -> summarize, create a 'researcher' sub-agent.",
  "  .claude/commands/<name>.md -- slash command the human can invoke to kick off a workflow.",
  "    Use when: human sent a similar instruction multiple times across turns (e.g., 'review this', 'ship it').",
  "    Example: if human asked 'run tests and summarize failures' 3 times, create /test-summary command.",
  "  .mcp.json -- adds new tools (MCP servers) the agent can call.",
  "    Use when: there are errors about a MISSING capability (web_fetch, file search, database access).",
  "    Do NOT add MCP servers for capabilities that already work or just need permission grants.",
  "  .claude/settings.json -- allowedTools/disallowedTools permission lists.",
  "    Use when: there are 'permission denied' or tool-blocked errors.",
  "",
  "Diagnosis guide -- map session observations to the RIGHT config target:",
  "  'permission denied' / tool blocked -> .claude/settings.json allowedTools",
  "  High idle time / agent keeps asking permission -> CLAUDE.md autonomy grants",
  "  Agent uses wrong tool repeatedly, misunderstands codebase -> CLAUDE.md persistent rules",
  "  Human sends same instruction pattern across multiple turns -> .claude/commands/<name>.md",
  "  Repeated multi-step workflow (research, implement, verify) -> .claude/agents/<name>.md",
  "  Missing tool capability (web_fetch fails, no search) -> .mcp.json new server",
  "  apply_patch too large, agent needs smaller steps -> CLAUDE.md step-size guidance",
].join("\n");

var COPILOT_CLI_GUIDANCE = [
  "Agent type: GITHUB COPILOT CLI",
  "",
  "Config files and WHEN to use each one (in priority order -- prefer scoped over global):",
  "  .github/prompts/<name>.prompt.md -- reusable slash command the human invokes for a specific workflow.",
  "    Use when: human sent a similar instruction multiple times across turns in this session.",
  "    Example: if human asked 'run lint and fix errors' 3 times, create a /fix-lint prompt.",
  "  .github/extensions/<name>.yml -- skill extension that adds new tool capabilities.",
  "    Use when: agent failed because it lacked a specific tool capability.",
  "  .github/instructions/<topic>.instructions.md -- modular focused instructions file.",
  "    Use when: copilot-instructions.md is getting long OR a concern (testing, API style) deserves its own file.",
  "    KEEP IT SHORT (under 20 lines). Lengthy instructions dilute effectiveness.",
  "    Add frontmatter to scope it: applyTo: '**/*.test.ts'",
  "  .github/copilot-instructions.md -- persistent repo-wide rules.",
  "    Use when: the problem recurs across sessions (agent misunderstands project, uses wrong patterns).",
  "    KEEP IT CONCISE. Good: build commands, test commands, commit format, architecture decisions.",
  "    BAD: general best practices, verbose explanations, anything the model already knows.",
  "  .mcp.json -- adds new MCP server tools. NOT for built-in Copilot CLI tools.",
  "",
  "Diagnosis guide -- map session observations to the RIGHT config target:",
  "  web_fetch errors: web_fetch is BUILT-IN -- do NOT add mcp-server-fetch.",
  "    If a specific domain consistently fails: add a fallback rule to copilot-instructions.md.",
  "    Example section to add: '## Fallback Rules\\n- If web_fetch on X fails, use training knowledge and continue.'",
  "  High idle time / agent awaiting approval -> add autonomy grants to copilot-instructions.md.",
  "    Use REAL --allow-tool syntax as examples in the draft:",
  "    '## Autonomy Grants\\n- shell(git:*) -- all git commands without asking\\n- shell(npm run:*) -- all npm scripts\\n- write -- file writes without asking'",
  "  Many interventions on complex tasks -> add plan-first guidance:",
  "    'For tasks touching more than 3 files, use /plan to create a plan before coding.'",
  "  Human corrected the same thing multiple times -> add a SPECIFIC rule (not generic advice).",
  "    Bad: 'Follow JavaScript best practices.' Good: 'Never use var. Always use const/let.'",
  "  Human invoked the same multi-step task multiple times -> create .github/prompts/<name>.prompt.md.",
  "  Agent used a complex/slow model for simple tasks -> note: Copilot CLI supports model switching.",
  "    Models: Claude Opus 4.5 (complex reasoning), Claude Sonnet 4.5 (routine tasks), GPT-5.2 Codex (code gen).",
  "    Recommend adding model guidance to copilot-instructions.md if sessions show wrong model choices.",
  "  Agent lacked a tool -> .github/extensions/<name>.yml.",
  "  Instructions file is long and unfocused -> split into .github/instructions/<topic>.instructions.md files.",
  "",
  "PROMPT FILE FORMAT (.github/prompts/<name>.prompt.md):",
  "---",
  "mode: agent",
  "description: <one line description>",
  "---",
  "",
  "<Task description with numbered steps>",
  "1. Step one",
  "2. Step two",
  "Output: <what to produce>",
  "",
  "MODULAR INSTRUCTIONS FORMAT (.github/instructions/<topic>.instructions.md):",
  "---",
  "applyTo: '**/*.test.ts'",
  "---",
  "",
  "<Focused rules. Keep under 20 lines.>",
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
    "- Do NOT use web_fetch. Your analysis is based entirely on session stats, errors, and local config files.",
    "- Do NOT fetch external documentation, changelogs, or research papers.",
    "- Do NOT default to copilot-instructions.md or CLAUDE.md when a prompt or skill/agent is the better fit.",
    "  Rule: if the human repeated the same instruction multiple times -> create a prompt file.",
    "  Rule: if a repeated multi-step workflow exists -> create a sub-agent or prompt.",
    "  Rule: if agent lacked a specific tool capability -> create a skill/extension or MCP server.",
    "  Rule: only use the global instructions file for persistent cross-session rules.",
    "",
    formatGuidance,
    "",
    MCP_JSON_SCHEMA,
    "",
    "WORKFLOW:",
    "1. Read the session stats and errors carefully.",
    "2. Look for patterns in the human follow-up messages -- repeated instructions suggest a prompt file.",
    "3. Call read_config() for each relevant config file to understand the current state.",
    "4. For each observed problem, pick the RIGHT config target (see format guidance above).",
    "   - Repeated human instructions -> create .github/prompts/<name>.prompt.md or .claude/commands/",
    "   - Missing tool capability -> .github/extensions/ or .mcp.json",
    "   - Agent asking for permission -> global instructions autonomy grants",
    "   - Persistent wrong behavior -> global instructions rules",
    "5. Call recommend() with a draftText that references SPECIFIC errors/metrics/tool names from THIS session.",
    "   Do NOT write generic advice -- if the session shows 8 interventions about file editing, write:",
    "   'You may create/edit/delete files in src/ without asking for confirmation.'",
    "6. For .mcp.json: read it first, then output the FULL merged JSON with new servers added.",
    "7. For markdown: output ONLY the new section to append (be specific, not generic).",
    "8. For prompt files: output the complete .prompt.md content following the format in the guidance.",
    "9. Stop after calling recommend() for each distinct problem. Do not over-recommend.",
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
 * @returns {Promise<{ recommendations: object[], model: string, usage: object|null, steps: object[] }>}
 */
export async function runCoachAgent(payload, opts) {
  var signal = opts && opts.signal;
  var onStep = opts && opts.onStep;
  var readConfigFile = opts && opts.readConfigFile;

  var format = payload.format || "claude-code";
  var configPaths = getConfigPathsForFormat(format);
  var recommendations = [];
  var steps = [];

  function emit(step) {
    steps.push(step);
    if (onStep) onStep(step);
  }

  // Tool handlers -- closures that capture emit + readConfigFile + recommendations
  var tools = buildAgentTools(configPaths, {
    read_config: async function ({ path: filePath }) {
      emit({ type: "read_config", label: "Reading " + filePath + "...", path: filePath });
      var content = readConfigFile ? readConfigFile(filePath) : null;
      return content != null
        ? "Content of " + filePath + ":\n" + content.substring(0, 3000)
        : "File not found: " + filePath + "\n(This file does not exist yet -- create it via recommend())";
    },
    recommend: async function (args) {
      var rec = normalizeRecommendation(args, configPaths);
      recommendations.push(rec);
      emit({ type: "recommend", label: "Recommendation: " + rec.title, rec: rec });
      return "Recommendation recorded.";
    },
  });

  var client = new CopilotClient();
  var session;

  try {
    await client.start();
    emit({ type: "start", label: "Copilot agent started" });

    session = await client.createSession({
      tools: tools,
      onPermissionRequest: approveAll,
      systemMessage: {
        mode: "replace",
        content: buildSystemPrompt(format),
      },
    });

    // Wire cancellation: abort the session message when signal fires
    if (signal) {
      signal.addEventListener("abort", function () {
        session && session.abort().catch(function () {});
      }, { once: true });
    }

    // Emit steps for any built-in tool the agent uses (should be rare/none)
    session.on("tool.execution_start", function (event) {
      var toolName = (event && event.data && event.data.toolName) || "tool";
      if (toolName !== "read_config" && toolName !== "recommend") {
        emit({ type: "tool", label: "Agent: " + toolName });
      }
    });

    emit({ type: "analyze", label: "Analyzing session data..." });

    // Use session.send() + listen for session.idle directly -- no timeout
    await new Promise(function (resolve, reject) {
      var done = false;
      var unsubscribe = session.on(function (event) {
        if (done) return;
        if (event.type === "session.idle") {
          done = true;
          unsubscribe();
          resolve();
        } else if (event.type === "session.error") {
          done = true;
          unsubscribe();
          reject(new Error(event.data && event.data.message ? event.data.message : "Session error"));
        }
      });
      session.send({ prompt: buildCoachPrompt(payload) }).catch(function (err) {
        if (!done) { done = true; unsubscribe(); reject(err); }
      });
    });
    await session.disconnect();

    if (signal && signal.aborted) {
      throw Object.assign(new Error("Aborted"), { name: "AbortError" });
    }

    if (recommendations.length === 0) {
      throw new Error("Agent did not produce any recommendations. Try again.");
    }

    emit({ type: "done", label: recommendations.length + " recommendation" + (recommendations.length !== 1 ? "s" : "") + " ready" });

    return {
      recommendations: recommendations,
      model: "copilot-sdk",
      usage: null,
      steps: steps,
    };
  } finally {
    if (session) await session.disconnect().catch(function () {});
    await client.stop().catch(function () {});
  }
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
