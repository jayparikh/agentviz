/**
 * AI Coach Agent
 *
 * Analyzes an AGENTVIZ session using the @github/copilot-sdk -- the same
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
  ".claude/skills",
  ".mcp.json",
  ".claude/settings.json",
  "CLAUDE.md",
  "AGENTS.md",
];

var CONFIG_PATHS_COPILOT = [
  ".github/prompts",
  ".github/skills",
  ".github/agents",
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
            description: "Relative path to the config file. Use one of: " + pathList + ". Also accepts any .github/skills/<name>/SKILL.md path to read an existing skill.",
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
            description: "Config file to write to. Use a path from: " + pathList + ". For new skills use '.github/skills/<name>/SKILL.md'. For new prompts use '.github/prompts/<name>.prompt.md'. Use null for advice-only (no file change).",
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
  "== DECISION TREE: choose the artifact type BEFORE picking a path ==",
  "",
  "Step 1. Did the human send the same instruction 2+ times this session?",
  "  YES -> PROMPT FILE: .github/prompts/<name>.prompt.md",
  "         Triggered manually by the human. Good for: 'run tests and summarize',",
  "         'review this PR', 'generate changelog', 'fix lint errors'.",
  "  NO  -> continue to step 2.",
  "",
  "Step 2. Is there a recurring multi-step specialized workflow",
  "        (debug CI, deploy, release notes, security audit, migration)?",
  "  YES -> SKILL: .github/skills/<name>/SKILL.md",
  "         Copilot auto-loads the SKILL.md when the task matches its description.",
  "         Skills = detailed instructions + optional scripts that only load when relevant.",
  "         Use skills for deep specialization; use custom instructions for broad always-on rules.",
  "         Good for: 'debug GitHub Actions failures', 'run deploy procedure',",
  "         'draft release notes from git log', 'run migration checklist'.",
  "  NO  -> continue to step 3.",
  "",
  "Step 3. Does the task need a specialist persona with its own tool restrictions",
  "        (read-only auditor, security reviewer, React component specialist)?",
  "  YES -> CUSTOM AGENT: .github/agents/<name>.md",
  "         Selected by name. Has own system prompt + tool allowlist.",
  "  NO  -> continue to step 4.",
  "",
  "Step 4. Does the agent need an EXTERNAL tool or API it currently lacks?",
  "  YES -> MCP SERVER: .mcp.json (only if not a built-in Copilot CLI tool)",
  "         web_fetch is built-in -- do NOT add mcp-server-fetch.",
  "  NO  -> continue to step 5.",
  "",
  "Step 5. Is this a persistent problem that recurs every session?",
  "  YES -> Ask one more question: Is this relevant to EVERY interaction in this repo,",
  "         or only when working on a specific domain, framework, or workflow?",
  "         EVERY interaction -> CUSTOM INSTRUCTIONS: .github/copilot-instructions.md",
  "           ONLY for: autonomy grants, build/test commands, commit format.",
  "           KEEP IT SHORT. Do NOT add domain knowledge, tool guides, or procedures here.",
  "         Specific domain/framework/workflow -> SKILL: .github/skills/<name>/SKILL.md",
  "           Examples: 'knowledge of MAF/Foundry ecosystem' -> skill",
  "                     'how to debug CI failures' -> skill",
  "                     'how to process claims' -> skill",
  "           Instructions that say 'when working on X, do Y' are ALWAYS better as a skill.",
  "  NO  -> this may not need a config change.",
  "",
  "== ARTIFACT FORMATS ==",
  "",
  "SKILL (.github/skills/<name>/SKILL.md):",
  "  -- Each skill lives in its OWN subdirectory: .github/skills/<name>/SKILL.md",
  "  -- The file MUST be named SKILL.md (exactly).",
  "  -- Copilot picks it up automatically when the task matches the description.",
  "  -- Can also be invoked explicitly by name: '/<name>' in the CLI.",
  "  -- The directory can include helper scripts the SKILL.md references.",
  "Example:",
  "---",
  "name: debug-ci-failures",
  "description: Guide for debugging failing GitHub Actions workflows. Use this when asked to debug failing CI or Actions workflows.",
  "---",
  "",
  "To debug failing GitHub Actions workflows:",
  "1. Use list_workflow_runs to find recent failing runs",
  "2. Use summarize_job_log_failures to get an AI summary without filling context with raw logs",
  "3. If more detail is needed, use get_job_logs for the full failure output",
  "4. Reproduce the failure locally, fix it, verify it passes, then commit",
  "",
  "PROMPT FILE (.github/prompts/<name>.prompt.md):",
  "---",
  "mode: agent",
  "description: <one line>",
  "---",
  "",
  "<Task with numbered steps. Output: what to produce>",
  "",
  "CUSTOM AGENT (.github/agents/<name>.md):",
  "---",
  "name: <agent-name>",
  "description: <When to use this agent>",
  "tools: [read_file, search_code]",
  "---",
  "",
  "<System prompt for this specialist agent>",
  "",
  "MODULAR INSTRUCTIONS (.github/instructions/<topic>.instructions.md):",
  "---",
  "applyTo: '**/*.test.ts'",
  "---",
  "",
  "<Focused rules for this topic. Under 20 lines.>",
  "",
  "== COPILOT CLI SPECIFIC DIAGNOSIS ==",
  "",
  "High idle time / agent awaiting approval:",
  "  -> Add autonomy grants (use real syntax): '## Autonomy Grants",
  "     - shell(git:*) -- all git without asking",
  "     - shell(npm run:*) -- all npm scripts",
  "     - write -- file writes without asking'",
  "",
  "Many interventions on complex multi-file tasks:",
  "  -> Add to instructions: 'For tasks touching more than 3 files, use /plan before coding.'",
  "",
  "Human corrected same mistake repeatedly:",
  "  -> Add specific rule to instructions.",
  "     BAD: 'Follow JavaScript best practices.'",
  "     GOOD: 'Never use var. Always use const/let. Never mutate function parameters.'",
  "",
  "web_fetch fails on specific domain:",
  "  -> Add fallback rule to instructions.",
  "     'If web_fetch on docs.github.com fails, read local .github/ files instead.'",
  "",
  "== PROMPTING STYLE COACHING (targetPath: null) ==",
  "",
  "After config recommendations, analyze the human follow-up messages for missed CLI features.",
  "These generate advice-only recs (targetPath: null). Only flag patterns you actually see.",
  "",
  "Human said 'continue', 'proceed', 'keep going', 'go ahead' 2+ times:",
  "  -> Recommend: use autopilot mode (Shift+Tab to switch) for well-defined tasks.",
  "     draftText example: 'In autopilot mode, give a single detailed instruction and let",
  "     Copilot run to completion: [Shift+Tab] then type the full task description.'",
  "",
  "Task was tangential / could run asynchronously (docs update, adding tests to a separate",
  "module, refactoring unrelated code, updating a README):",
  "  -> Recommend: /delegate to offload to cloud Copilot coding agent.",
  "     draftText example: '/delegate Add JSDoc comments to all public functions in src/api/'",
  "     The agent creates a PR; developer continues working locally.",
  "",
  "Session mixed 2+ clearly unrelated concerns (bug fix + new feature, or refactor + docs):",
  "  -> Recommend: /new or /clear between distinct tasks.",
  "     draftText: 'Start a fresh session for each distinct task.',",
  "     'Use /new before switching topics -- focused sessions produce better results.'",
  "",
  "Complex multi-file change was started without any planning turn (agent immediately wrote",
  "code, had to backtrack, many corrections followed):",
  "  -> Recommend: /plan first on complex tasks.",
  "     draftText: '/plan <task description> -- Copilot asks clarifying questions, creates",
  "     a checklist plan in plan.md, waits for approval before writing code.'",
  "     Best for: new features, refactoring with many touch points, multi-file changes.",
  "",
  "Human sent the same exploration/research question multiple times across turns:",
  "  -> Recommend: use the explore-first pattern.",
  "     draftText: 'Read the <files> but do not write code yet -- then summarize the approach.'",
  "     This gives the agent context before acting, reducing mid-task corrections.",
  "",
  "Session had many errors running tests or builds and agent kept retrying differently:",
  "  -> Recommend: /fleet for parallelizing subtasks.",
  "     draftText: '/fleet Run the full test suite in parallel and collect all failures'",
].join("\n");

function buildSystemPrompt(format) {
  var formatGuidance = format === "copilot-cli" ? COPILOT_CLI_GUIDANCE : CLAUDE_CODE_GUIDANCE;
  return [
    "You are an AI agent workflow coach. Your job is to:",
    "  1. Recommend changes to AI agent configuration files that fix observed problems.",
    "  2. Suggest better Copilot CLI prompting techniques the developer missed.",
    "",
    "CRITICAL SCOPE RULES -- you will be penalized for violating these:",
    "- You are NOT advising on the project the agent was working on.",
    "- You are NOT recommending features the developer should implement.",
    "- You are NOT giving general best practices or task management tips.",
    "- Config file recs MUST cite a specific error text, metric, or user message from the session.",
    "- Prompting recs MUST cite a specific pattern in the human's messages (quoted text is best).",
    "- If you cannot connect a recommendation to a specific session observation, do NOT make it.",
    "- Prefer fewer, higher-quality recommendations over many generic ones.",
    "- Do NOT use web_fetch. Your analysis is based entirely on session stats, errors, and local config files.",
    "- Do NOT default to copilot-instructions.md when a skill, prompt file, or agent is the better fit.",
    "  Use the DECISION TREE in the format guidance to pick the right artifact every time.",
    "  COMMON MISTAKE: treating domain/framework knowledge as instructions.",
    "    BAD:  Add a '## Project Context' section about MAF/Foundry to copilot-instructions.md",
    "    GOOD: Create .github/skills/coreai-ecosystem/SKILL.md -- Copilot loads it when relevant",
    "    BAD:  Add 'when debugging CI, do these steps' to copilot-instructions.md",
    "    GOOD: Create .github/skills/debug-ci/SKILL.md",
    "  Instructions are for: autonomy grants, build commands, coding conventions. Nothing else.",
    "",
    formatGuidance,
    "",
    MCP_JSON_SCHEMA,
    "",
    "WORKFLOW:",
    "1. Read session stats, errors, and human follow-up messages carefully.",
    "2. Use the DECISION TREE (in format guidance) to pick the right artifact for each problem.",
    "   Walk steps 1-5 explicitly. For step 5, ask: 'every session?' vs 'specific domain?' -> skill.",
    "3. Call read_config() for each relevant config file BEFORE proposing changes.",
    "4. For each config problem, call recommend() with:",
    "   - A draftText referencing SPECIFIC errors/metrics/messages from THIS session.",
    "   - The targetPath from the decision tree.",
    "   - For NEW skills: targetPath = '.github/skills/<name>/SKILL.md' (exact path, not just directory).",
    "   - NEVER put domain knowledge, tool guides, or ecosystem context into instructions.",
    "     That always belongs in a skill (.github/skills/<topic>/SKILL.md).",
    "5. Scan human follow-up messages for missed prompting opportunities (Copilot CLI only).",
    "   Patterns: 'continue/proceed' -> autopilot; tangential tasks -> /delegate;",
    "   no planning on complex changes -> /plan; mixed topics -> /new.",
    "   Call recommend() for each with targetPath: null and a concrete example prompt.",
    "6. For .mcp.json: read it first, output the FULL merged JSON.",
    "7. For skills: output complete SKILL.md with correct frontmatter and numbered steps.",
    "8. For prompt files: output complete .prompt.md content.",
    "9. Stop after 2-4 total recommendations. Quality over quantity.",
  ].join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Prompt builder
// ─────────────────────────────────────────────────────────────────────────────

export function buildCoachPrompt(payload) {
  var {
    format, primaryModel, totalEvents, totalTurns, errorCount, totalToolCalls,
    productiveRuntime, humanResponseTime, idleTime, interventions, autonomyEfficiency,
    topTools, errorSamples, userFollowUps, existingSkills, existingMcpServers,
  } = payload;

  var agentType = format === "copilot-cli" ? "GitHub Copilot CLI" : "Claude Code";
  var configPaths = getConfigPathsForFormat(format);
  var toolList = (topTools || []).slice(0, 10).map(function (t) { return t.name + " x" + t.count; }).join(", ");
  var errors = (errorSamples || []).slice(0, 6).map(function (e, i) { return (i + 1) + ". " + e; }).join("\n");
  var followUps = (userFollowUps || []).slice(0, 8).map(function (m) { return "- \"" + m + "\""; }).join("\n");

  var sections = [
    "Analyze this " + agentType + " session. Call read_config() to inspect relevant files, then recommend() for each fix.",
    "",
    "## Session stats",
    "- Model: " + (primaryModel || "unknown"),
    "- Events: " + (totalEvents || 0) + ", Turns: " + (totalTurns || 0) + ", Tool calls: " + (totalToolCalls || 0),
    "- Errors: " + (errorCount || 0),
    "- Productive runtime: " + (productiveRuntime || "0s"),
    "- Human response time: " + (humanResponseTime || "0s") + " (time agent waited for human -- high = agent asked for approval too often)",
    "- Idle time: " + (idleTime || "0s"),
    "- Interventions needed: " + (interventions || 0),
    "- Autonomy efficiency: " + (autonomyEfficiency || "0%"),
    "- Top tools used: " + (toolList || "none"),
  ];

  if (errors) {
    sections.push("", "## Errors observed (diagnose these first)", errors);
  }
  if (followUps) {
    sections.push(
      "",
      "## Human messages verbatim (scan for: 'continue/proceed' -> autopilot; tangential tasks -> /delegate; no plan before complex change -> /plan; topic switches -> /new)",
      followUps,
    );
  }

  sections.push(
    "",
    "## Available config paths to read/write",
    configPaths.map(function (p) { return "- " + p; }).join("\n"),
  );

  if (existingSkills && existingSkills.length > 0) {
    sections.push(
      "",
      "## Existing skills (DO NOT duplicate these)",
      existingSkills.map(function (s) { return "- " + s; }).join("\n"),
    );
  }

  if (existingMcpServers && existingMcpServers.length > 0) {
    sections.push(
      "",
      "## Existing MCP servers already configured",
      existingMcpServers.map(function (s) { return "- " + s; }).join("\n"),
    );
  }

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
export async function runCoachAgent(payload, opts, _attempt) {
  var signal = opts && opts.signal;
  var onStep = opts && opts.onStep;
  var readConfigFile = opts && opts.readConfigFile;
  var model = opts && opts.model;
  var attempt = _attempt || 1;

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
    emit({ type: "start", label: attempt > 1 ? "Copilot agent started (retry " + attempt + ")" : "Copilot agent started" });

    var sessionOpts = {
      tools: tools,
      onPermissionRequest: approveAll,
      systemMessage: {
        mode: "replace",
        content: buildSystemPrompt(format),
      },
    };
    if (model) sessionOpts.model = model;

    session = await client.createSession(sessionOpts);

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

    // Use session.send() + listen for session.idle directly -- no SDK timeout applied
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
  } catch (err) {
    if (err && err.name !== "AbortError" && attempt < 3 && /Timeout|timeout/.test(err.message)) {
      // CLI subprocess timed out waiting for model response -- retry automatically
      emit({ type: "retry", label: "Model timed out, retrying..." });
      await client.stop().catch(function () {});
      return runCoachAgent(payload, opts, attempt + 1);
    }
    throw err;
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
  var raw = args.targetPath && args.targetPath !== "null" ? args.targetPath : null;
  var targetPath = null;
  if (raw) {
    // Exact match against known paths
    if (allowed.includes(raw)) {
      targetPath = raw;
    // Skill subdirectory: .github/skills/<name>/SKILL.md or .github/prompts/<name>.prompt.md
    } else if (/^\.github\/skills\/[^/]+\/SKILL\.md$/.test(raw) ||
               /^\.github\/prompts\/[^/]+\.prompt\.md$/.test(raw) ||
               /^\.claude\/skills\/[^/]+\/SKILL\.md$/.test(raw) ||
               /^\.github\/agents\/[^/]+\.md$/.test(raw) ||
               /^\.claude\/agents\/[^/]+\.md$/.test(raw)) {
      targetPath = raw;
    }
  }
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
