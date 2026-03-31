/**
 * Skill extractor: analyze parsed sessions for skill/capability usage.
 *
 * Maps the Agent Skills lifecycle (Discovery -> Instructions Loading -> Resource Access)
 * across three source categories:
 *   - project:   .github/skills/, .claude/skills/, .agents/skills/, repo instructions
 *   - personal:  ~/.copilot/skills/, ~/.claude/skills/, user instructions
 *   - extension: VS Code extension-contributed tools, MCP servers, agent plugins
 *
 * Also extracts related customization signals:
 *   - Custom instructions (copilot-instructions.md, .instructions.md)
 *   - Custom agents (.agent.md)
 *   - MCP servers
 *   - Slash-command skill invocations (/skill-name)
 */

import type { NormalizedEvent, SessionTurn, SessionMetadata } from "./sessionTypes";

// ── Types ────────────────────────────────────────────────────────────────────

export type SkillSource = "project" | "personal" | "extension" | "built-in" | "mcp" | "unknown";

export type SkillLifecycleStage =
  | "discovered"        // Skill was available but not invoked
  | "loaded"            // Skill instructions were loaded into context
  | "invoked"           // Skill was explicitly invoked (slash command, tool call)
  | "resource-accessed" // Skill resources were accessed (scripts, files within skill dir)
  | "completed"         // Skill finished (tool call completed)
  | "errored";          // Skill invocation failed

export type SkillCategory =
  | "skill"             // Agent Skill (.github/skills/**/SKILL.md)
  | "instruction"       // Custom instruction file (.github/copilot-instructions.md etc.)
  | "agent"             // Custom agent (.agent.md)
  | "tool"              // Tool (built-in, extension, MCP)
  | "mcp-server"        // MCP server
  | "prompt"            // Prompt file (.prompt.md)
  | "plugin";           // Agent plugin

export interface SkillEvent {
  /** Event index in the session events array */
  eventIndex: number;
  /** Turn index */
  turnIndex: number;
  /** Lifecycle stage at this point */
  stage: SkillLifecycleStage;
  /** Timestamp (seconds from session start) */
  time: number;
  /** Duration in seconds (for tool calls) */
  duration: number;
  /** Whether this event was an error */
  isError: boolean;
  /** Summary text */
  text: string;
}

export interface ExtractedSkill {
  /** Unique id for deduplication */
  id: string;
  /** Display name */
  name: string;
  /** Category of capability */
  category: SkillCategory;
  /** Source location */
  source: SkillSource;
  /** Human-readable source label */
  sourceLabel: string;
  /** File path if known */
  filePath?: string;
  /** Description if available */
  description?: string;
  /** Highest lifecycle stage reached */
  maxStage: SkillLifecycleStage;
  /** All events for this skill in chronological order */
  events: SkillEvent[];
  /** Total invocations */
  invocationCount: number;
  /** Total errors */
  errorCount: number;
  /** Whether this was automatically loaded vs explicitly invoked */
  autoLoaded: boolean;
}

export interface SkillSummary {
  /** All extracted skills */
  skills: ExtractedSkill[];
  /** Skills by source */
  bySource: Record<SkillSource, ExtractedSkill[]>;
  /** Skills by category */
  byCategory: Record<SkillCategory, ExtractedSkill[]>;
  /** Skills by lifecycle stage (highest reached) */
  byStage: Record<SkillLifecycleStage, ExtractedSkill[]>;
  /** Total distinct skills */
  totalSkills: number;
  /** Total skill invocations */
  totalInvocations: number;
  /** Session format */
  format: string;
}

// ── Stage ordering for max-stage computation ─────────────────────────────────

var STAGE_ORDER: SkillLifecycleStage[] = [
  "discovered",
  "loaded",
  "invoked",
  "resource-accessed",
  "completed",
  "errored",
];

function stageRank(stage: SkillLifecycleStage): number {
  // errored is alongside completed, not "higher"
  if (stage === "errored") return STAGE_ORDER.indexOf("completed");
  var idx = STAGE_ORDER.indexOf(stage);
  return idx >= 0 ? idx : 0;
}

function higherStage(a: SkillLifecycleStage, b: SkillLifecycleStage): SkillLifecycleStage {
  return stageRank(a) >= stageRank(b) ? a : b;
}

// ── Source detection helpers ─────────────────────────────────────────────────

var PROJECT_SKILL_PATTERNS = [
  /\.github[/\\]skills[/\\]/i,
  /\.claude[/\\]skills[/\\]/i,
  /\.agents[/\\]skills[/\\]/i,
];

var PERSONAL_SKILL_PATTERNS = [
  /[/\\]\.copilot[/\\]skills[/\\]/i,
  /[/\\]\.claude[/\\]skills[/\\]/i,
  /[/\\]\.agents[/\\]skills[/\\]/i,
  /~[/\\]\.copilot[/\\]/i,
  /Users[/\\][^/\\]+[/\\]\.copilot[/\\]/i,
  /home[/\\][^/\\]+[/\\]\.copilot[/\\]/i,
];

var PROJECT_INSTRUCTION_PATTERNS = [
  /\.github[/\\]copilot-instructions\.md/i,
  /\.github[/\\]instructions[/\\]/i,
  /AGENTS\.md/i,
  /CLAUDE\.md/i,
  /GEMINI\.md/i,
];

var AGENT_FILE_PATTERNS = [
  /\.agent\.md$/i,
  /\.github[/\\]agents[/\\]/i,
  /\.claude[/\\]agents[/\\]/i,
];

var PROMPT_FILE_PATTERNS = [
  /\.prompt\.md$/i,
  /\.github[/\\]prompts[/\\]/i,
];

function classifyFilePath(filePath: string): { category: SkillCategory; source: SkillSource } | null {
  if (!filePath) return null;

  for (var i = 0; i < PROJECT_SKILL_PATTERNS.length; i++) {
    if (PROJECT_SKILL_PATTERNS[i].test(filePath)) return { category: "skill", source: "project" };
  }
  for (var i = 0; i < PERSONAL_SKILL_PATTERNS.length; i++) {
    if (PERSONAL_SKILL_PATTERNS[i].test(filePath)) return { category: "skill", source: "personal" };
  }
  for (var i = 0; i < AGENT_FILE_PATTERNS.length; i++) {
    if (AGENT_FILE_PATTERNS[i].test(filePath)) return { category: "agent", source: "project" };
  }
  for (var i = 0; i < PROMPT_FILE_PATTERNS.length; i++) {
    if (PROMPT_FILE_PATTERNS[i].test(filePath)) return { category: "prompt", source: "project" };
  }
  for (var i = 0; i < PROJECT_INSTRUCTION_PATTERNS.length; i++) {
    if (PROJECT_INSTRUCTION_PATTERNS[i].test(filePath)) return { category: "instruction", source: "project" };
  }
  return null;
}

function sourceLabel(source: SkillSource): string {
  switch (source) {
    case "project": return "Project";
    case "personal": return "Personal";
    case "extension": return "Extension";
    case "built-in": return "Built-in";
    case "mcp": return "MCP Server";
    default: return "Unknown";
  }
}

// ── Built-in tool set (VS Code Copilot) ──────────────────────────────────────

var BUILTIN_TOOLS = new Set([
  // VS Code Copilot built-in tools
  "createDirectory", "createFile", "createNewWorkspace", "fetchWebPage",
  "findFiles", "findTextInFiles", "getChangedFiles", "getErrors",
  "githubRepo", "listDirectory", "multiReplaceString", "readFile",
  "replaceString", "searchCodebase", "run_in_terminal", "get_terminal_output",
  "manage_todo_list", "runSubagent", "terminal_last_command",
  "vscode_fetchWebPage_internal", "file_edit",
  // Copilot CLI built-in tools
  "view", "edit", "create", "glob", "grep", "rg", "show_file",
  "bash", "powershell", "list_powershell", "read_powershell", "stop_powershell",
  "web_search", "web_fetch", "apply_patch", "ask_user",
  "report_intent", "task", "task_complete", "update_todo",
  "store_memory", "read_agent", "skill", "sql",
]);

/** Detect MCP tools by naming convention: "serverName-toolName" */
var MCP_TOOL_PATTERN = /^([a-z][a-z0-9]*(?:-[a-z][a-z0-9]*)*)-(\w+)$/;

function isMcpToolName(name: string): boolean {
  // MCP tools use "serverName-toolName" convention (at least one hyphen)
  // Exclude known built-in hyphenated names
  if (BUILTIN_TOOLS.has(name)) return false;
  var m = name.match(MCP_TOOL_PATTERN);
  if (!m) return false;
  // The prefix should look like a server name (not a single common word)
  var prefix = m[1];
  // Single-word prefixes are ambiguous; require at least a recognizable pattern
  return prefix.includes("-") || prefix.length >= 4;
}

function extractMcpServerName(name: string): string | null {
  var m = name.match(MCP_TOOL_PATTERN);
  if (!m) return null;
  return m[1];
}

function isBuiltinTool(name: string): boolean {
  return BUILTIN_TOOLS.has(name) || BUILTIN_TOOLS.has("copilot_" + name);
}

// ── Slash command / skill invocation detection ───────────────────────────────

var SLASH_COMMAND_RE = /^\/([a-zA-Z][\w-]*)/;

function detectSlashSkill(userMessage: string): string | null {
  var match = userMessage.match(SLASH_COMMAND_RE);
  if (!match) return null;
  var cmd = match[1];
  // Filter out common non-skill commands
  var builtinCommands = new Set(["help", "clear", "new", "init", "explain", "fix", "tests", "doc"]);
  if (builtinCommands.has(cmd)) return null;
  return cmd;
}

/** Clean up raw event text for display in the skills panel. */
function cleanEventText(text: string): string {
  if (!text) return "";
  // Decode URI-encoded paths: file:///c%3A/src/foo -> c:/src/foo
  var cleaned = text.replace(/\[([^\]]*)\]\(file:\/\/\/([^)]+)\)/g, function (_m, label, uri) {
    var decoded = decodeURIComponent(uri);
    var name = decoded.split(/[\/\\]/).pop() || decoded;
    return label || name;
  });
  // Strip leftover file:/// URIs not in markdown link syntax
  cleaned = cleaned.replace(/file:\/\/\/[^\s)]+/g, function (uri) {
    var decoded = decodeURIComponent(uri.replace(/^file:\/\/\//, ""));
    var name = decoded.split(/[\/\\]/).pop() || decoded;
    return name;
  });
  return cleaned;
}

// ── Main extraction ──────────────────────────────────────────────────────────

export function extractSkills(
  events: NormalizedEvent[],
  turns: SessionTurn[],
  metadata: SessionMetadata,
): SkillSummary {
  var skillMap: Record<string, ExtractedSkill> = {};
  var format = metadata.format || "unknown";

  function getOrCreate(id: string, defaults: Partial<ExtractedSkill>): ExtractedSkill {
    if (!skillMap[id]) {
      skillMap[id] = {
        id: id,
        name: defaults.name || id,
        category: defaults.category || "tool",
        source: defaults.source || "unknown",
        sourceLabel: defaults.sourceLabel || sourceLabel(defaults.source || "unknown"),
        filePath: defaults.filePath,
        description: defaults.description,
        maxStage: "discovered",
        events: [],
        invocationCount: 0,
        errorCount: 0,
        autoLoaded: defaults.autoLoaded !== undefined ? defaults.autoLoaded : false,
      };
    }
    return skillMap[id];
  }

  function addEvent(skill: ExtractedSkill, ev: SkillEvent): void {
    skill.events.push(ev);
    skill.maxStage = higherStage(skill.maxStage, ev.stage);
    // Count invocations: for tools, count completed/errored (since we synthesize invoked before completed).
    // For non-tools (agents, skills, instructions), count invoked stage.
    if (ev.stage === "completed" || ev.stage === "errored") {
      skill.invocationCount++;
    } else if (ev.stage === "invoked" && skill.category !== "tool") {
      skill.invocationCount++;
    }
    if (ev.isError) skill.errorCount++;
  }

  // ── Pass 1: Extract from raw event data ──

  for (var ei = 0; ei < events.length; ei++) {
    var ev = events[ei];

    // --- Custom instructions (from variableData in raw) ---
    if (ev.raw && typeof ev.raw === "object") {
      var rawObj = ev.raw as Record<string, any>;

      // VS Code: variableData.variables with kind === "promptFile"
      var varData = rawObj.variableData || rawObj.message && (rawObj.message as any).variableData;
      if (varData && Array.isArray(varData.variables)) {
        for (var vi = 0; vi < varData.variables.length; vi++) {
          var v = varData.variables[vi];
          if (!v) continue;

          if (v.kind === "promptFile" || (v.id && typeof v.id === "string" && v.id.includes("prompt.instructions"))) {
            var instrName = v.name || "instructions";
            var instrPath = "";
            if (v.value && typeof v.value === "object") {
              instrPath = (v.value as any).path || (v.value as any).fsPath || "";
            }

            var classification = classifyFilePath(instrPath || instrName);
            var instrId = "instruction:" + (instrPath || instrName);
            var skill = getOrCreate(instrId, {
              name: instrName.replace(/^prompt:/, ""),
              category: classification ? classification.category : "instruction",
              source: classification ? classification.source : "project",
              filePath: instrPath,
              autoLoaded: v.automaticallyAdded === true,
              description: v.originLabel || undefined,
            });
            // Synthesize discovered before loaded
            if (skill.events.length === 0) {
              addEvent(skill, {
                eventIndex: ei,
                turnIndex: ev.turnIndex || 0,
                stage: "discovered",
                time: ev.t,
                duration: 0,
                isError: false,
                text: "Available in " + sourceLabel(classification ? classification.source : "project"),
              });
            }
            addEvent(skill, {
              eventIndex: ei,
              turnIndex: ev.turnIndex || 0,
              stage: "loaded",
              time: ev.t,
              duration: 0,
              isError: false,
              text: v.automaticallyAdded ? "Auto-loaded" : "Attached by user",
            });
          }
        }
      }

      // VS Code: session mode (custom agent)
      var mode = rawObj.mode || (rawObj.inputState && (rawObj.inputState as any).mode);
      if (mode && typeof mode === "object" && (mode as any).id) {
        var modeId = (mode as any).id as string;
        if (modeId !== "agent" && modeId !== "ask" && modeId !== "edit") {
          // Custom agent selected
          var agentId = "agent:" + modeId;
          var agentName = modeId.split(/[/\\]/).pop() || modeId;
          agentName = agentName.replace(/\.agent\.md$/, "");
          var agentClassification = classifyFilePath(modeId);
          var agentSkill = getOrCreate(agentId, {
            name: agentName,
            category: "agent",
            source: agentClassification ? agentClassification.source : "project",
            filePath: modeId.startsWith("file:") ? decodeURIComponent(modeId.replace(/^file:\/\/\//, "")) : undefined,
          });
          // Synthesize discovered before invoked
          if (agentSkill.events.length === 0) {
            addEvent(agentSkill, {
              eventIndex: ei,
              turnIndex: ev.turnIndex || 0,
              stage: "discovered",
              time: ev.t,
              duration: 0,
              isError: false,
              text: "Custom agent available",
            });
          }
          addEvent(agentSkill, {
            eventIndex: ei,
            turnIndex: ev.turnIndex || 0,
            stage: "invoked",
            time: ev.t,
            duration: 0,
            isError: false,
            text: "Agent mode: " + agentName,
          });
        }
      }
    }

    // --- Tool calls ---
    if (ev.track === "tool_call" && ev.toolName) {
      var toolName = ev.toolName;
      var toolSource: SkillSource = "built-in";
      var toolCategory: SkillCategory = "tool";
      var toolSourceLabel: string | null = null;

      // Classify tool source from raw metadata (VS Code chat sessions)
      if (ev.raw && typeof ev.raw === "object") {
        var rawTool = ev.raw as Record<string, any>;
        var src = rawTool.source;
        if (src && typeof src === "object") {
          var srcType = (src as any).type;
          var srcLabel = (src as any).label;
          if (srcType === "mcp" || (srcLabel && /mcp/i.test(srcLabel))) {
            toolSource = "mcp";
            toolSourceLabel = srcLabel || null;
          } else if (srcType === "extension" || (srcLabel && srcLabel !== "Built-In")) {
            toolSource = "extension";
            toolSourceLabel = srcLabel || null;
          }
        }
      }

      if (toolSource === "built-in" && !isBuiltinTool(toolName)) {
        // Detect MCP tools by naming convention (serverName-toolName)
        if (isMcpToolName(toolName)) {
          toolSource = "mcp";
          toolSourceLabel = extractMcpServerName(toolName);
        }
        // If still unrecognized, leave as built-in rather than guessing
      }

      var toolId = "tool:" + toolName;
      var mcpServer = toolSource === "mcp" ? (toolSourceLabel || extractMcpServerName(toolName)) : null;
      var toolSkill = getOrCreate(toolId, {
        name: toolName,
        category: toolCategory,
        source: toolSource,
        sourceLabel: mcpServer ? "MCP: " + mcpServer : (toolSourceLabel ? toolSourceLabel : undefined),
        description: mcpServer ? "MCP: " + mcpServer : toolName,
      });

      // Synthesize intermediate lifecycle stages on first invocation
      var isFirstCall = toolSkill.events.length === 0;
      if (isFirstCall) {
        // Stage 1: Discovered -- the tool was available in the agent's toolset
        addEvent(toolSkill, {
          eventIndex: ei,
          turnIndex: ev.turnIndex || 0,
          stage: "discovered",
          time: ev.t,
          duration: 0,
          isError: false,
          text: "Available in " + sourceLabel(toolSource) + " toolset",
        });
      }

      // Stage 2: Invoked -- the agent chose to call this tool
      addEvent(toolSkill, {
        eventIndex: ei,
        turnIndex: ev.turnIndex || 0,
        stage: "invoked",
        time: ev.t,
        duration: 0,
        isError: false,
        text: cleanEventText(ev.text),
      });

      // Stage 3: Completed or Errored -- the tool call finished
      var toolStage: SkillLifecycleStage = ev.isError ? "errored" : "completed";
      addEvent(toolSkill, {
        eventIndex: ei,
        turnIndex: ev.turnIndex || 0,
        stage: toolStage,
        time: ev.t,
        duration: ev.duration,
        isError: ev.isError,
        text: ev.isError ? "Failed: " + cleanEventText(ev.text) : "Completed: " + cleanEventText(ev.text),
      });
    }

    // --- MCP server starts ---
    if (ev.raw && typeof ev.raw === "object") {
      var rawMcp = ev.raw as Record<string, any>;
      if (rawMcp.kind === "mcpServersStarting" && Array.isArray(rawMcp.didStartServerIds)) {
        for (var mi = 0; mi < rawMcp.didStartServerIds.length; mi++) {
          var serverId = rawMcp.didStartServerIds[mi];
          var mcpId = "mcp:" + serverId;
          var mcpSkill = getOrCreate(mcpId, {
            name: serverId,
            category: "mcp-server",
            source: "mcp",
            description: "MCP Server: " + serverId,
          });
          // Synthesize discovered before loaded
          if (mcpSkill.events.length === 0) {
            addEvent(mcpSkill, {
              eventIndex: ei,
              turnIndex: ev.turnIndex || 0,
              stage: "discovered",
              time: ev.t,
              duration: 0,
              isError: false,
              text: "MCP server configured",
            });
          }
          addEvent(mcpSkill, {
            eventIndex: ei,
            turnIndex: ev.turnIndex || 0,
            stage: "loaded",
            time: ev.t,
            duration: 0,
            isError: false,
            text: "MCP server started",
          });
        }
      }
    }

    // --- Context events referencing skill/instruction files ---
    if (ev.track === "context" && ev.text) {
      var contextClassification = classifyFilePath(ev.text);
      if (contextClassification) {
        var ctxId = contextClassification.category + ":" + ev.text;
        var ctxSkill = getOrCreate(ctxId, {
          name: ev.text.split(/[/\\]/).pop() || ev.text,
          category: contextClassification.category,
          source: contextClassification.source,
          filePath: ev.text,
        });
        addEvent(ctxSkill, {
          eventIndex: ei,
          turnIndex: ev.turnIndex || 0,
          stage: "resource-accessed",
          time: ev.t,
          duration: 0,
          isError: false,
          text: "Referenced in context",
        });
      }
    }
  }

  // ── Pass 2: Detect slash-command skill invocations from turns ──

  for (var ti = 0; ti < turns.length; ti++) {
    var turn = turns[ti];
    var userMsg = turn.userMessage || "";
    var slashSkill = detectSlashSkill(userMsg);
    if (slashSkill) {
      var slashId = "skill:/" + slashSkill;
      var slashEntry = getOrCreate(slashId, {
        name: "/" + slashSkill,
        category: "skill",
        source: "unknown", // Could be project or personal
        description: "Invoked via slash command",
      });
      // Find the user event for this turn
      var userEventIdx = turn.eventIndices.length > 0 ? turn.eventIndices[0] : 0;
      var userEv = events[userEventIdx];
      // Synthesize discovered before invoked
      if (slashEntry.events.length === 0) {
        addEvent(slashEntry, {
          eventIndex: userEventIdx,
          turnIndex: ti,
          stage: "discovered",
          time: userEv ? userEv.t : 0,
          duration: 0,
          isError: false,
          text: "Skill available",
        });
      }
      addEvent(slashEntry, {
        eventIndex: userEventIdx,
        turnIndex: ti,
        stage: "invoked",
        time: userEv ? userEv.t : 0,
        duration: 0,
        isError: false,
        text: "Slash command: /" + slashSkill,
      });
    }
  }

  // ── Build summary ──

  var skills = Object.values(skillMap);
  skills.sort(function (a, b) {
    // Sort: highest stage first, then by invocation count, then alpha
    var stageDiff = stageRank(b.maxStage) - stageRank(a.maxStage);
    if (stageDiff !== 0) return stageDiff;
    var countDiff = b.invocationCount - a.invocationCount;
    if (countDiff !== 0) return countDiff;
    return a.name.localeCompare(b.name);
  });

  var bySource: Record<SkillSource, ExtractedSkill[]> = {
    "project": [], "personal": [], "extension": [], "built-in": [], "mcp": [], "unknown": [],
  };
  var byCategory: Record<SkillCategory, ExtractedSkill[]> = {
    "skill": [], "instruction": [], "agent": [], "tool": [], "mcp-server": [], "prompt": [], "plugin": [],
  };
  var byStage: Record<SkillLifecycleStage, ExtractedSkill[]> = {
    "discovered": [], "loaded": [], "invoked": [], "resource-accessed": [], "completed": [], "errored": [],
  };

  var totalInvocations = 0;
  for (var si = 0; si < skills.length; si++) {
    var s = skills[si];
    bySource[s.source].push(s);
    byCategory[s.category].push(s);
    byStage[s.maxStage].push(s);
    totalInvocations += s.invocationCount;
  }

  return {
    skills: skills,
    bySource: bySource,
    byCategory: byCategory,
    byStage: byStage,
    totalSkills: skills.length,
    totalInvocations: totalInvocations,
    format: format,
  };
}
