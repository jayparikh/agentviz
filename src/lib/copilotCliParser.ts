/**
 * Parse Copilot CLI JSONL session traces into normalized events.
 *
 * Persisted event types (non-ephemeral):
 *   session.start, session.resume, session.shutdown, session.error,
 *   session.context_changed, session.model_change, session.mode_changed,
 *   session.compaction_start, session.compaction_complete, session.truncation,
 *   session.task_complete, session.info, session.warning,
 *   session.plan_changed, session.snapshot_rewind, session.handoff,
 *   user.message,
 *   assistant.turn_start, assistant.message, assistant.turn_end,
 *   assistant.reasoning,
 *   tool.execution_start, tool.execution_complete, tool.user_requested,
 *   subagent.started, subagent.completed, subagent.failed,
 *   subagent.selected, subagent.deselected,
 *   hook.start, hook.end,
 *   system.message, system.notification,
 *   skill.invoked
 *
 * Returns: { events, turns, metadata } matching the same shape as
 * parseClaudeCodeJSONL so all downstream views work unchanged.
 */

import type { NormalizedEvent, ParsedSession, SessionMetadata, SessionTurn } from "./sessionTypes";
import type { TrackType } from "./theme";

const MAX_TEXT_LENGTH = 4000;

type RawRecord = {
  type?: string;
  timestamp?: string;
  data?: Record<string, any>;
  id?: string;
  parentId?: string | null;
  [key: string]: unknown;
};

type ToolPairs = {
  completes: Record<string, RawRecord>;
};

function truncate(value: string | null | undefined, max: number): string {
  if (!value) return "";
  return value.length > max ? value.substring(0, max) + "..." : value;
}

function parseTimestamp(timestamp: string | null | undefined): number | null {
  if (!timestamp) return null;
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return null;
  return date.getTime() / 1000;
}

function parseRawRecords(text: string): { records: RawRecord[]; malformedLines: number } {
  const lines = text.split("\n");
  const records: RawRecord[] = [];
  let malformedLines = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) continue;

    try {
      records.push(JSON.parse(line));
    } catch {
      malformedLines += 1;
    }
  }

  return { records, malformedLines };
}

function buildToolPairs(records: RawRecord[]): ToolPairs {
  const completes: Record<string, RawRecord> = {};

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (record.type === "tool.execution_complete" && record.data && record.data.toolCallId) {
      completes[record.data.toolCallId] = record;
    }
  }

  return { completes };
}

function makeEvent(
  t: number,
  agent: string,
  track: TrackType,
  text: string,
  duration: number,
  intensity: number,
  raw: RawRecord,
  extra?: Partial<NormalizedEvent>,
): NormalizedEvent {
  const event: NormalizedEvent = {
    t,
    agent,
    track,
    text: truncate(text, MAX_TEXT_LENGTH),
    duration,
    intensity,
    raw,
    turnIndex: 0,
    isError: false,
  };

  if (extra) Object.assign(event, extra);
  return event;
}

function buildNormalizedEvents(records: RawRecord[], sessionStartSec: number, toolPairs: ToolPairs): NormalizedEvent[] {
  const events: NormalizedEvent[] = [];
  const seenToolStarts: Record<string, boolean> = {};

  // Build a map of task tool calls to their agent metadata
  const taskToolMap: Record<string, { agentType: string; description: string }> = {};
  const subagentStartTimes: Record<string, number> = {};
  // Lifecycle metadata from subagent.started events (preferred for display names)
  const subagentLifecycle: Record<string, { agentName?: string; agentDisplayName?: string }> = {};

  // First pass: build taskToolMap from task tool execution_start events,
  // collect subagent.started timestamps and lifecycle metadata
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const data = record.data || {};

    if (record.type === "tool.execution_start" && data.toolName === "task") {
      const args = data.arguments || {};
      taskToolMap[data.toolCallId] = {
        agentType: args.agent_type || "task",
        description: args.description || args.name || "",
      };
    }

    if (record.type === "subagent.started") {
      if (data.toolCallId) {
        const timestamp = parseTimestamp(record.timestamp);
        if (timestamp !== null) subagentStartTimes[data.toolCallId] = timestamp;
      }
      // Lifecycle events carry the authoritative display name
      subagentLifecycle[data.toolCallId || ""] = {
        agentName: data.agentName || data.agentType,
        agentDisplayName: data.agentDisplayName || data.agentName,
      };
    }
  }

  // Resolve agent identity for a given toolCallId.
  // Priority: lifecycle metadata (subagent.started) > task tool args > fallback
  function resolveAgent(toolCallId: string | undefined, eventData: Record<string, any>): {
    agentName: string | null;
    agentDisplayName: string | null;
  } {
    const lifecycle = toolCallId ? subagentLifecycle[toolCallId] : null;
    const task = toolCallId ? taskToolMap[toolCallId] : null;
    return {
      agentName: (lifecycle && lifecycle.agentName) || (task && task.agentType) || eventData.agentName || null,
      agentDisplayName: (lifecycle && lifecycle.agentDisplayName) || (eventData.agentDisplayName || eventData.agentName) || (task && task.description) || null,
    };
  }

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const timestamp = parseTimestamp(record.timestamp);
    if (timestamp === null) continue;

    let t = timestamp - sessionStartSec;
    if (t < 0) t = 0;

    const type = record.type;
    const data = record.data || {};

    if (type === "user.message") {
      events.push(makeEvent(t, "user", "output", data.content || "", 0.5, 0.9, record));
      continue;
    }

    if (type === "assistant.message") {
      emitAssistantMessage(events, t, data, record, toolPairs, data.parentToolCallId || null, resolveAgent(data.parentToolCallId, data));
      continue;
    }

    if (type === "assistant.reasoning") {
      if (data.content && data.content.trim()) {
        const agent = data.parentToolCallId ? resolveAgent(data.parentToolCallId, data) : { agentName: null, agentDisplayName: null };
        events.push(makeEvent(t, "assistant", "reasoning", data.content, 0.3, 0.5, record, {
          parentToolCallId: data.parentToolCallId || null,
          agentName: agent.agentName,
          agentDisplayName: agent.agentDisplayName,
        }));
      }
      continue;
    }

    if (type === "tool.execution_start") {
      if (seenToolStarts[data.toolCallId]) continue;
      seenToolStarts[data.toolCallId] = true;
      emitToolCall(events, t, timestamp, data, record, toolPairs, taskToolMap, subagentLifecycle);
      continue;
    }

    if (type === "subagent.started") {
      const agent = resolveAgent(data.toolCallId, data);
      const label = agent.agentDisplayName || "Sub-agent";
      events.push(makeEvent(t, "system", "agent", label + " started", 0.3, 0.5, record, {
        toolCallId: data.toolCallId || null,
        agentName: agent.agentName || "task",
        agentDisplayName: label,
      }));
      continue;
    }

    if (type === "subagent.completed") {
      const agent = resolveAgent(data.toolCallId, data);
      const label = agent.agentDisplayName || "Sub-agent";
      const startTime = data.toolCallId ? subagentStartTimes[data.toolCallId] : undefined;
      const duration = startTime ? Math.max(timestamp - startTime, 0.1) : 0.5;
      events.push(makeEvent(t, "system", "agent", label + " completed", duration, 0.4, record, {
        toolCallId: data.toolCallId || null,
        agentName: agent.agentName || "task",
        agentDisplayName: label,
      }));
      continue;
    }

    if (type === "subagent.failed") {
      const agent = resolveAgent(data.toolCallId, data);
      const label = agent.agentDisplayName || "Sub-agent";
      const startTime = data.toolCallId ? subagentStartTimes[data.toolCallId] : undefined;
      const duration = startTime ? Math.max(timestamp - startTime, 0.1) : 0.5;
      let message = label + " failed";
      if (data.error) message += ": " + truncate(data.error, 200);
      events.push(makeEvent(t, "system", "agent", message, duration, 0.8, record, {
        isError: true,
        toolCallId: data.toolCallId || null,
        agentName: agent.agentName || "task",
        agentDisplayName: label,
      }));
      continue;
    }

    if (type === "system.message") {
      if (data.content) {
        events.push(makeEvent(t, "system", "context", data.content, 0.3, 0.3, record));
      }
      continue;
    }

    if (type === "system.notification") {
      if (data.content) {
        events.push(makeEvent(t, "system", "context", data.content, 0.2, 0.2, record));
      }
      continue;
    }

    if (type === "session.error") {
      const message = data.message || data.errorType || "Session error";
      events.push(makeEvent(t, "system", "context", message, 0.5, 1.0, record, { isError: true }));
      continue;
    }

    if (type === "session.model_change") {
      const message = "Model: " + (data.previousModel || "?") + " \u2192 " + (data.newModel || "?");
      events.push(makeEvent(t, "system", "context", message, 0.2, 0.3, record));
      continue;
    }

    if (type === "session.mode_changed") {
      const message = "Mode: " + (data.previousMode || "?") + " \u2192 " + (data.newMode || "?");
      events.push(makeEvent(t, "system", "context", message, 0.2, 0.3, record));
      continue;
    }

    if (type === "session.compaction_complete") {
      let message = "Context compacted";
      if (data.tokensRemoved) message += " (" + data.tokensRemoved.toLocaleString() + " tokens removed)";
      events.push(makeEvent(t, "system", "context", message, 0.3, 0.4, record));
      continue;
    }

    if (type === "session.truncation") {
      let message = "Context truncated";
      if (data.tokensRemoved) message += " (" + data.tokensRemoved.toLocaleString() + " tokens removed)";
      events.push(makeEvent(t, "system", "context", message, 0.3, 0.4, record));
      continue;
    }

    if (type === "session.task_complete") {
      events.push(makeEvent(t, "system", "output", data.summary || "Task completed", 0.3, 0.5, record));
      continue;
    }

    if (type === "session.info") {
      events.push(makeEvent(t, "system", "context", data.message || "Info", 0.2, 0.2, record));
      continue;
    }

    if (type === "session.warning") {
      events.push(makeEvent(t, "system", "context", data.message || "Warning", 0.2, 0.4, record));
      continue;
    }
  }

  events.sort(function (left, right) {
    return left.t - right.t || 0;
  });

  return events;
}

function emitAssistantMessage(
  events: NormalizedEvent[],
  t: number,
  data: Record<string, any>,
  record: RawRecord,
  toolPairs: ToolPairs,
  parentToolCallId: string | null,
  agent: { agentName: string | null; agentDisplayName: string | null },
): void {
  const model = getModelFromMessage(data, toolPairs);
  // Always preserve parentToolCallId for linkage, even when agent identity is unresolved
  const agentExtra: Partial<NormalizedEvent> = {};
  if (parentToolCallId) agentExtra.parentToolCallId = parentToolCallId;
  if (agent.agentName) agentExtra.agentName = agent.agentName;
  if (agent.agentDisplayName) agentExtra.agentDisplayName = agent.agentDisplayName;

  if (data.reasoningText && data.reasoningText.trim()) {
    events.push(makeEvent(t, "assistant", "reasoning", data.reasoningText, 0.3, 0.5, record, Object.assign({
      model,
      tokenUsage: data.outputTokens ? { outputTokens: data.outputTokens } : null,
    }, agentExtra)));
  }

  const content = typeof data.content === "string" ? data.content.trim() : "";
  if (content) {
    events.push(makeEvent(t + 0.01, "assistant", "output", content, 0.5, 0.7, record, Object.assign({ model }, agentExtra)));
  }

  if (!content && (!data.reasoningText || !data.reasoningText.trim()) && Array.isArray(data.toolRequests) && data.toolRequests.length > 0) {
    const toolNames = data.toolRequests.map(function (request: Record<string, any>) { return request.name; }).join(", ");
    events.push(makeEvent(t, "assistant", "reasoning", "Invoking: " + toolNames, 0.2, 0.3, record, Object.assign({ model }, agentExtra)));
  }
}

function emitToolCall(
  events: NormalizedEvent[],
  t: number,
  timestamp: number,
  data: Record<string, any>,
  record: RawRecord,
  toolPairs: ToolPairs,
  taskToolMap?: Record<string, { agentType: string; description: string }>,
  lifecycleMap?: Record<string, { agentName?: string; agentDisplayName?: string }>,
): void {
  const complete = toolPairs.completes[data.toolCallId];
  const endTimestamp = complete ? parseTimestamp(complete.timestamp) : null;
  const duration = endTimestamp ? Math.max(endTimestamp - timestamp, 0.1) : 0.5;
  const isError = complete ? Boolean(complete.data && complete.data.success === false) : false;

  let resultText = "";
  if (complete && complete.data && complete.data.result) {
    resultText = complete.data.result.content || complete.data.result.detailedContent || "";
  }

  let displayText = data.toolName;
  if (data.arguments) {
    const preview = buildArgPreview(data.arguments);
    if (preview) displayText += ": " + preview;
  }

  if (isError) {
    const errorContent = (complete && complete.data && complete.data.error) || resultText;
    if (errorContent) displayText += "\n" + truncate(errorContent, 200);
  }

  // Resolve agent metadata:
  // - Self agent: this tool IS a task tool (toolCallId in taskToolMap)
  // - Parent agent: this tool is a child of a subagent (parentToolCallId in taskToolMap)
  const selfTask = taskToolMap ? taskToolMap[data.toolCallId] : null;
  const parentTask = data.parentToolCallId && taskToolMap ? taskToolMap[data.parentToolCallId] : null;
  const selfLifecycle = lifecycleMap ? lifecycleMap[data.toolCallId] : null;
  const parentLifecycle = data.parentToolCallId && lifecycleMap ? lifecycleMap[data.parentToolCallId] : null;

  let agentName: string | null = null;
  let agentDisplayName: string | null = null;

  if (selfTask) {
    // This is a task tool call -- use lifecycle name if available, else task agentType
    agentName = (selfLifecycle && selfLifecycle.agentName) || selfTask.agentType;
    agentDisplayName = (selfLifecycle && selfLifecycle.agentDisplayName) || selfTask.description || null;
  } else if (parentTask || parentLifecycle) {
    // This tool is a child of a subagent (resolve from either source)
    agentName = (parentLifecycle && parentLifecycle.agentName) || (parentTask && parentTask.agentType) || null;
    agentDisplayName = (parentLifecycle && parentLifecycle.agentDisplayName) || (parentTask && parentTask.description) || null;
  }

  events.push(makeEvent(t, "assistant", "tool_call", displayText, duration, isError ? 0.9 : 0.6, record, {
    toolName: data.toolName,
    toolInput: data.arguments,
    toolCallId: data.toolCallId || null,
    isError,
    model: complete && complete.data ? complete.data.model || null : null,
    parentToolCallId: data.parentToolCallId || null,
    agentName,
    agentDisplayName,
  }));
}

function getModelFromMessage(messageData: Record<string, any>, toolPairs: ToolPairs): string | null {
  if (Array.isArray(messageData.toolRequests)) {
    for (let index = 0; index < messageData.toolRequests.length; index += 1) {
      const complete = toolPairs.completes[messageData.toolRequests[index].toolCallId];
      if (complete && complete.data && complete.data.model) return complete.data.model;
    }
  }
  return null;
}

function buildArgPreview(args: Record<string, any> | null | undefined): string {
  if (!args) return "";

  if (args.command) return truncate(args.command, 120);
  if (args.pattern) return "'" + truncate(args.pattern, 60) + "'" + (args.path ? " in " + args.path : "");
  if (args.path) return args.path;
  if (args.query) return truncate(args.query, 120);
  if (args.prompt) return truncate(args.prompt, 120);
  if (args.intent) return args.intent;
  if (args.description) return truncate(args.description, 120);
  if (args.url) return truncate(args.url, 120);
  if (args.issue_number) return "#" + args.issue_number;
  if (args.pullNumber) return "PR #" + args.pullNumber;
  if (args.owner && args.repo) return args.owner + "/" + args.repo;

  const keys = Object.keys(args);
  if (keys.length === 0) return "";
  if (keys.length <= 3) {
    return keys.map(function (key) {
      const value = args[key];
      if (typeof value === "string") return key + "=" + truncate(value, 40);
      return key;
    }).join(", ");
  }

  return keys.length + " args";
}

function buildTurns(records: RawRecord[], events: NormalizedEvent[], sessionStartSec: number): SessionTurn[] {
  const turns: SessionTurn[] = [];
  let currentTurn: SessionTurn | null = null;
  let lastUserMessage: string | null = null;

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];

    if (record.type === "user.message") {
      lastUserMessage = record.data ? record.data.content || "" : "";
    }

    if (record.type === "assistant.turn_start") {
      if (currentTurn) turns.push(currentTurn);

      const turnStart = parseTimestamp(record.timestamp);
      currentTurn = {
        index: turns.length,
        startTime: turnStart ? turnStart - sessionStartSec : 0,
        endTime: 0,
        eventIndices: [],
        userMessage: lastUserMessage || "(continuation)",
        toolCount: 0,
        hasError: false,
      };
      lastUserMessage = null;
    }

    if (record.type === "assistant.turn_end" && currentTurn) {
      const turnEnd = parseTimestamp(record.timestamp);
      if (turnEnd) currentTurn.endTime = turnEnd - sessionStartSec;
    }
  }

  if (currentTurn) turns.push(currentTurn);

  for (let eventIndex = 0; eventIndex < events.length; eventIndex += 1) {
    const event = events[eventIndex];
    let assignedTurn: SessionTurn | null = null;

    for (let turnIndex = turns.length - 1; turnIndex >= 0; turnIndex -= 1) {
      if (event.t >= turns[turnIndex].startTime) {
        assignedTurn = turns[turnIndex];
        break;
      }
    }

    if (!assignedTurn && turns.length > 0) assignedTurn = turns[0];

    if (assignedTurn) {
      event.turnIndex = assignedTurn.index;
      assignedTurn.eventIndices.push(eventIndex);
      if (event.track === "tool_call") assignedTurn.toolCount = (assignedTurn.toolCount || 0) + 1;
      if (event.isError) assignedTurn.hasError = true;
      if (assignedTurn.endTime < event.t + event.duration) {
        assignedTurn.endTime = event.t + event.duration;
      }
    }
  }

  return turns;
}

function buildMetadata(
  records: RawRecord[],
  events: NormalizedEvent[],
  turns: SessionTurn[],
  malformedLines: number,
): SessionMetadata {
  let sessionStart: Record<string, any> | null = null;
  let sessionResume: Record<string, any> | null = null;
  let sessionShutdown: Record<string, any> | null = null;

  for (let index = 0; index < records.length; index += 1) {
    if (records[index].type === "session.start") sessionStart = records[index].data || null;
    if (records[index].type === "session.resume") sessionResume = records[index].data || null;
    if (records[index].type === "session.shutdown") sessionShutdown = records[index].data || null;
  }

  const sessionInfo = sessionStart || sessionResume;
  let totalToolCalls = 0;
  let errorCount = 0;
  const models: Record<string, number> = {};

  for (let index = 0; index < events.length; index += 1) {
    if (events[index].track === "tool_call") totalToolCalls += 1;
    if (events[index].isError) errorCount += 1;
    if (events[index].model) models[events[index].model as string] = (models[events[index].model as string] || 0) + 1;
  }

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCacheReadTokens = 0;
  let totalCacheWriteTokens = 0;
  let totalCost: number | null = null;
  let modelTokenUsage: Record<string, { inputTokens: number; outputTokens: number; cacheRead: number; cacheWrite: number }> | null = null;

  if (sessionShutdown && sessionShutdown.modelMetrics) {
    const modelMetrics = sessionShutdown.modelMetrics;
    totalCost = 0;
    modelTokenUsage = {};
    for (const model of Object.keys(modelMetrics)) {
      const metric = modelMetrics[model];
      if (metric.usage) {
        totalInputTokens += metric.usage.inputTokens || 0;
        totalOutputTokens += metric.usage.outputTokens || 0;
        totalCacheReadTokens += metric.usage.cacheReadTokens || 0;
        totalCacheWriteTokens += metric.usage.cacheWriteTokens || 0;
        modelTokenUsage[model] = {
          inputTokens: metric.usage.inputTokens || 0,
          outputTokens: metric.usage.outputTokens || 0,
          cacheRead: metric.usage.cacheReadTokens || 0,
          cacheWrite: metric.usage.cacheWriteTokens || 0,
        };
      }
      if (metric.requests) {
        totalCost += metric.requests.cost || 0;
      }
      if (!models[model]) models[model] = metric.requests ? metric.requests.count : 0;
    }
  }

  const modelEntries = Object.entries(models).sort(function (left, right) {
    return (right[1] || 0) - (left[1] || 0);
  });
  const primaryModel = modelEntries.length > 0 ? modelEntries[0][0] : null;

  const duration = events.length > 0
    ? events[events.length - 1].t + events[events.length - 1].duration
    : 0;

  const warnings: string[] = [];
  if (malformedLines > 0) warnings.push(malformedLines + " malformed line(s) skipped");
  if (sessionShutdown && sessionShutdown.shutdownType === "error") {
    warnings.push("Session ended with error: " + (sessionShutdown.errorReason || "unknown"));
  }

  const context = sessionInfo && sessionInfo.context ? sessionInfo.context : {};

  return {
    totalEvents: events.length,
    totalTurns: turns.length,
    totalToolCalls,
    errorCount,
    duration,
    models,
    primaryModel,
    tokenUsage: totalInputTokens + totalOutputTokens + totalCacheReadTokens + totalCacheWriteTokens > 0
      ? {
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        cacheRead: totalCacheReadTokens,
        cacheWrite: totalCacheWriteTokens,
      }
      : null,
    warnings,
    parseIssues: { malformedLines, invalidEvents: 0 },
    format: "copilot-cli",
    sessionId: sessionInfo ? sessionInfo.sessionId : null,
    producer: sessionInfo ? sessionInfo.producer : null,
    copilotVersion: sessionInfo ? sessionInfo.copilotVersion : null,
    selectedModel: sessionInfo ? sessionInfo.selectedModel : null,
    repository: context.repository || null,
    branch: context.branch || null,
    cwd: context.cwd || null,
    gitRoot: context.gitRoot || null,
    shutdownType: sessionShutdown ? sessionShutdown.shutdownType : null,
    codeChanges: sessionShutdown ? sessionShutdown.codeChanges : null,
    premiumRequests: sessionShutdown ? sessionShutdown.totalPremiumRequests : null,
    totalApiDurationMs: sessionShutdown ? sessionShutdown.totalApiDurationMs : null,
    totalCost,
    modelTokenUsage,
  };
}

export function detectCopilotCli(text: string): boolean {
  const firstNewline = text.indexOf("\n");
  const firstLine = firstNewline > 0 ? text.substring(0, firstNewline) : text;

  try {
    const parsed = JSON.parse(firstLine.trim()) as RawRecord;
    if (parsed.type === "session.start" || parsed.type === "session.resume") {
      return Boolean(parsed.data && (parsed.data.producer === "copilot-agent" || parsed.data.copilotVersion));
    }
    return false;
  } catch {
    return false;
  }
}

export function parseCopilotCliJSONL(text: string): ParsedSession | null {
  const parsed = parseRawRecords(text);
  const records = parsed.records;
  if (records.length === 0) return null;

  let sessionStartSec: number | null = null;
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (record.type === "session.start" && record.data && record.data.startTime) {
      sessionStartSec = parseTimestamp(record.data.startTime);
      break;
    }
    if (record.type === "session.resume" && record.data && record.data.resumeTime) {
      sessionStartSec = parseTimestamp(record.data.resumeTime);
      break;
    }
  }

  if (sessionStartSec === null) {
    sessionStartSec = parseTimestamp(records[0].timestamp) || 0;
  }

  const toolPairs = buildToolPairs(records);
  const events = buildNormalizedEvents(records, sessionStartSec, toolPairs);
  if (events.length === 0) return null;

  const turns = buildTurns(records, events, sessionStartSec);
  const metadata = buildMetadata(records, events, turns, parsed.malformedLines);

  return { events, turns, metadata };
}
