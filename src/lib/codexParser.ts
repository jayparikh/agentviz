/**
 * Parse Codex rollout JSONL sessions from ~/.codex/sessions/YYYY/MM/DD.
 *
 * Codex records have a top-level record type (`session_meta`, `event_msg`,
 * `response_item`, `turn_context`) and a nested `payload`. `response_item`
 * records are the source of truth for messages and tool calls. `event_msg`
 * records supply turn lifecycle, token counts, and some tool completion events.
 */

import { computeCacheHitRate } from "./cacheMetrics";
import { truncateText as truncate } from "./formatTime.js";
import { getSessionTotal } from "./session";
import type { NormalizedEvent, ParsedSession, SessionMetadata, SessionTurn, TokenUsage } from "./sessionTypes";
import type { TrackType } from "./theme";

const MAX_TEXT_LENGTH = 4000;
const MAX_DETECT_LINES = 8;

type RawRecord = {
  type?: string;
  timestamp?: string;
  payload?: Record<string, any>;
  [key: string]: unknown;
};

type CodexTurnContext = {
  turnId: string;
  model?: string | null;
  effort?: string | null;
  cwd?: string | null;
  summary?: string | null;
};

type CodexTurnLifecycle = {
  id: string;
  startTime: number;
  endTime: number | null;
  userMessage: string | null;
};

type ParseState = {
  currentTurnId: string | null;
  currentModel: string | null;
  turnContexts: Record<string, CodexTurnContext>;
  turns: Record<string, CodexTurnLifecycle>;
};

type ParsedRecords = {
  records: RawRecord[];
  malformedLines: number;
};

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function parseTimestamp(timestamp: string | null | undefined): number | null {
  if (!timestamp) return null;
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return null;
  return date.getTime() / 1000;
}

function parseRecords(text: string): ParsedRecords {
  const records: RawRecord[] = [];
  let malformedLines = 0;
  const lines = text.split(/\r?\n/);

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

function parseFirstRecords(text: string, limit: number): RawRecord[] {
  const records: RawRecord[] = [];
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length && records.length < limit; index += 1) {
    const line = lines[index].trim();
    if (!line) continue;
    try {
      records.push(JSON.parse(line));
    } catch {
      continue;
    }
  }
  return records;
}

function hasCodexSessionMeta(record: RawRecord): boolean {
  if (record.type !== "session_meta" || !isRecord(record.payload)) return false;
  const payload = record.payload;
  return typeof payload.originator === "string" && payload.originator.startsWith("codex-")
    || typeof payload.thread_source === "string"
    || typeof payload.model_provider === "string" && typeof payload.source === "string";
}

function hasCodexTurnContext(record: RawRecord): boolean {
  if (record.type !== "turn_context" || !isRecord(record.payload)) return false;
  const payload = record.payload;
  return typeof payload.turn_id === "string"
    && (typeof payload.model === "string" || typeof payload.approval_policy === "string" || typeof payload.sandbox_policy === "string");
}

function hasCodexResponseItem(record: RawRecord): boolean {
  if (record.type !== "response_item" || !isRecord(record.payload)) return false;
  const payloadType = record.payload.type;
  return payloadType === "message"
    || payloadType === "reasoning"
    || payloadType === "function_call"
    || payloadType === "function_call_output"
    || payloadType === "custom_tool_call"
    || payloadType === "custom_tool_call_output"
    || payloadType === "web_search_call";
}

export function detectCodexJSONL(text: string): boolean {
  const records = parseFirstRecords(text, MAX_DETECT_LINES);
  if (records.some(hasCodexSessionMeta)) return true;

  let signals = 0;
  for (let index = 0; index < records.length; index += 1) {
    if (hasCodexTurnContext(records[index])) signals += 1;
    if (hasCodexResponseItem(records[index])) signals += 1;
  }
  return signals >= 2;
}

function numberValue(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, value);
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.max(0, parsed);
  }
  return 0;
}

function flattenContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map(function (part) {
      if (typeof part === "string") return part;
      if (!isRecord(part)) return "";
      if (typeof part.text === "string") return part.text;
      if (typeof part.content === "string") return part.content;
      if (typeof part.output_text === "string") return part.output_text;
      return "";
    }).filter(Boolean).join("\n");
  }
  if (isRecord(content)) {
    if (typeof content.text === "string") return content.text;
    if (typeof content.content === "string") return content.content;
  }
  return "";
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function formatToolInput(input: unknown): string {
  const parsed = parseMaybeJson(input);
  if (typeof parsed === "string") return truncate(parsed, 120);
  if (!isRecord(parsed)) return parsed == null ? "" : truncate(String(parsed), 120);
  if (typeof parsed.command === "string") return truncate(parsed.command, 120);
  if (typeof parsed.query === "string") return truncate(parsed.query, 120);
  if (typeof parsed.path === "string") return parsed.path;
  const keys = Object.keys(parsed);
  if (keys.length === 0) return "";
  return keys.slice(0, 3).map(function (key) {
    const value = parsed[key];
    if (typeof value === "string") return key + "=" + truncate(value, 40);
    return key;
  }).join(", ") + (keys.length > 3 ? ", +" + (keys.length - 3) + " more" : "");
}

function detectError(payload: Record<string, any>, text: string): boolean {
  if (payload.success === false) return true;
  if (payload.status === "failed" || payload.status === "error") return true;
  if (payload.error || payload.stderr) return true;
  return /\b(error|failed|exception|traceback|fatal|panic)\b/i.test(text)
    || /exit (code|status) [1-9]/i.test(text);
}

function sanitizeRaw(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeRaw);
  if (!isRecord(value)) return value;
  const out: Record<string, unknown> = {};
  Object.keys(value).forEach(function (key) {
    if (key === "encrypted_content") {
      out[key] = "[elided]";
    } else if (key === "base_instructions") {
      out[key] = "[elided]";
    } else {
      out[key] = sanitizeRaw(value[key]);
    }
  });
  return out;
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
    raw: sanitizeRaw(raw),
    turnIndex: 0,
    isError: false,
  };
  if (extra) Object.assign(event, extra);
  return event;
}

function getEventTime(record: RawRecord, fallback: number): number {
  const timestamp = parseTimestamp(record.timestamp);
  return timestamp == null ? fallback : timestamp;
}

function ensureTurn(state: ParseState, turnId: string, startTime: number): CodexTurnLifecycle {
  if (!state.turns[turnId]) {
    state.turns[turnId] = { id: turnId, startTime, endTime: null, userMessage: null };
  }
  return state.turns[turnId];
}

function getCurrentTurnId(state: ParseState): string | null {
  return state.currentTurnId;
}

function getCurrentModel(state: ParseState): string | null {
  const turnId = getCurrentTurnId(state);
  if (turnId && state.turnContexts[turnId] && state.turnContexts[turnId].model) {
    return state.turnContexts[turnId].model || null;
  }
  return state.currentModel;
}

function pushMessageEvent(events: NormalizedEvent[], record: RawRecord, state: ParseState, t: number): void {
  const payload = record.payload || {};
  const role = payload.role;
  if (role === "developer") return;
  const text = flattenContent(payload.content).trim();
  if (!text) return;

  const turnId = getCurrentTurnId(state);
  if (role === "user") {
    if (turnId) ensureTurn(state, turnId, t).userMessage = text;
    events.push(makeEvent(t, "user", "output", text, 0.5, 0.8, record, {
      codexTurnId: turnId,
      model: getCurrentModel(state),
    }));
    return;
  }

  if (role === "assistant") {
    events.push(makeEvent(t, "assistant", "output", text, 0.7, 0.7, record, {
      codexTurnId: turnId,
      model: getCurrentModel(state),
    }));
  }
}

function pushReasoningEvent(events: NormalizedEvent[], record: RawRecord, state: ParseState, t: number): void {
  const payload = record.payload || {};
  const text = flattenContent(payload.summary || payload.content).trim();
  if (!text) return;
  events.push(makeEvent(t, "assistant", "reasoning", text, 0.4, 0.5, record, {
    codexTurnId: getCurrentTurnId(state),
    model: getCurrentModel(state),
  }));
}

function pushToolCallEvent(events: NormalizedEvent[], record: RawRecord, state: ParseState, t: number): void {
  const payload = record.payload || {};
  const payloadType = payload.type;
  const toolName = payloadType === "web_search_call"
    ? "web_search"
    : String(payload.name || payloadType || "tool");
  const toolInput = payloadType === "custom_tool_call"
    ? payload.input
    : payloadType === "web_search_call"
      ? payload.action || {}
      : parseMaybeJson(payload.arguments || {});
  const preview = formatToolInput(toolInput);
  events.push(makeEvent(t, "assistant", "tool_call", toolName + (preview ? ": " + preview : ""), 0.5, 0.8, record, {
    toolName,
    toolInput,
    toolCallId: payload.call_id || null,
    codexTurnId: getCurrentTurnId(state),
    model: getCurrentModel(state),
  }));
}

function getOutputText(payload: Record<string, any>): string {
  if (typeof payload.output === "string") return payload.output;
  if (payload.stdout || payload.stderr) {
    return [payload.stdout, payload.stderr].filter(Boolean).join("\n");
  }
  if (payload.query) return "Web search completed: " + payload.query;
  if (payload.changes) return "Patch applied";
  return flattenContent(payload.output || payload.content || payload.message);
}

function pushToolOutputEvent(events: NormalizedEvent[], record: RawRecord, state: ParseState, t: number): void {
  const payload = record.payload || {};
  const text = getOutputText(payload);
  const isError = detectError(payload, text);
  events.push(makeEvent(t, "assistant", "context", "Result: " + truncate(text || "completed", 300), 0.3, isError ? 1.0 : 0.5, record, {
    isError,
    toolCallId: payload.call_id || null,
    codexTurnId: getCurrentTurnId(state),
    model: getCurrentModel(state),
  }));
}

function getWebSearchQuery(payload: Record<string, any>): string {
  if (typeof payload.query === "string") return payload.query;
  if (isRecord(payload.action) && typeof payload.action.query === "string") return payload.action.query;
  return "";
}

function assignWebSearchCallId(events: NormalizedEvent[], payload: Record<string, any>): void {
  if (!payload.call_id) return;
  const query = getWebSearchQuery(payload);
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.track !== "tool_call" || event.toolName !== "web_search") continue;
    if (event.toolCallId) return;
    const raw = event.raw as Record<string, any> | null | undefined;
    const rawPayload = raw && isRecord(raw.payload) ? raw.payload : {};
    if (query && getWebSearchQuery(rawPayload) !== query) continue;
    event.toolCallId = payload.call_id;
    return;
  }
}

function updateTurnContext(record: RawRecord, state: ParseState): void {
  const payload = record.payload || {};
  const turnId = typeof payload.turn_id === "string" ? payload.turn_id : null;
  if (!turnId) return;
  state.currentTurnId = turnId;
  state.currentModel = typeof payload.model === "string" ? payload.model : state.currentModel;
  state.turnContexts[turnId] = {
    turnId,
    model: typeof payload.model === "string" ? payload.model : null,
    effort: typeof payload.effort === "string" ? payload.effort : null,
    cwd: typeof payload.cwd === "string" ? payload.cwd : null,
    summary: typeof payload.summary === "string" ? payload.summary : null,
  };
}

function handleEventMessage(record: RawRecord, state: ParseState, events: NormalizedEvent[], t: number): void {
  const payload = record.payload || {};
  const payloadType = payload.type;

  if (payloadType === "task_started") {
    const turnId = typeof payload.turn_id === "string" ? payload.turn_id : "turn-" + Object.keys(state.turns).length;
    state.currentTurnId = turnId;
    ensureTurn(state, turnId, parseTimestamp(payload.started_at) || t);
    return;
  }

  if (payloadType === "task_complete") {
    const turnId = typeof payload.turn_id === "string" ? payload.turn_id : state.currentTurnId;
    if (turnId) {
      const turn = ensureTurn(state, turnId, t);
      turn.endTime = parseTimestamp(payload.completed_at) || (t + numberValue(payload.duration_ms) / 1000);
    }
    return;
  }

  if (payloadType === "patch_apply_end" || payloadType === "web_search_end") {
    if (payloadType === "web_search_end") assignWebSearchCallId(events, payload);
    pushToolOutputEvent(events, record, state, t);
  }
}

function buildEvents(records: RawRecord[], state: ParseState): NormalizedEvent[] {
  const events: NormalizedEvent[] = [];
  let syntheticTime = 0;

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const t = getEventTime(record, syntheticTime);
    syntheticTime += 1;

    if (record.type === "turn_context") {
      updateTurnContext(record, state);
      continue;
    }

    if (record.type === "event_msg") {
      handleEventMessage(record, state, events, t);
      continue;
    }

    if (record.type !== "response_item" || !isRecord(record.payload)) continue;
    const payloadType = record.payload.type;

    if (payloadType === "message") pushMessageEvent(events, record, state, t);
    else if (payloadType === "reasoning") pushReasoningEvent(events, record, state, t);
    else if (payloadType === "function_call" || payloadType === "custom_tool_call" || payloadType === "web_search_call") pushToolCallEvent(events, record, state, t);
    else if (payloadType === "function_call_output" || payloadType === "custom_tool_call_output") pushToolOutputEvent(events, record, state, t);
  }

  events.sort(function (left, right) { return left.t - right.t; });
  return events;
}

function normalizeEventTimes(events: NormalizedEvent[]): void {
  if (events.length === 0) return;
  let minTime = events[0].t;
  for (let index = 1; index < events.length; index += 1) {
    if (events[index].t < minTime) minTime = events[index].t;
  }
  for (let index = 0; index < events.length; index += 1) {
    events[index].t = Math.max(0, events[index].t - minTime);
  }
}

function normalizeTurnTimes(state: ParseState, minEventTime: number): void {
  Object.keys(state.turns).forEach(function (turnId) {
    const turn = state.turns[turnId];
    turn.startTime = Math.max(0, turn.startTime - minEventTime);
    if (turn.endTime != null) turn.endTime = Math.max(turn.startTime, turn.endTime - minEventTime);
  });
}

function buildTurns(events: NormalizedEvent[], state: ParseState): SessionTurn[] {
  const turns: SessionTurn[] = Object.keys(state.turns).map(function (turnId) {
    const lifecycle = state.turns[turnId];
    const context = state.turnContexts[turnId];
    return {
      index: 0,
      startTime: lifecycle.startTime,
      endTime: lifecycle.endTime == null ? lifecycle.startTime : lifecycle.endTime,
      eventIndices: [],
      userMessage: lifecycle.userMessage || (context && context.summary) || "(continuation)",
      toolCount: 0,
      hasError: false,
      turnId,
      model: context && context.model || null,
      effort: context && context.effort || null,
    };
  }).sort(function (left, right) { return left.startTime - right.startTime; });

  if (turns.length === 0) {
    let currentTurn: SessionTurn | null = null;
    for (let eventIndex = 0; eventIndex < events.length; eventIndex += 1) {
      const event = events[eventIndex];
      if (!currentTurn || event.agent === "user") {
        if (currentTurn) turns.push(currentTurn);
        currentTurn = {
          index: turns.length,
          startTime: event.t,
          endTime: event.t + event.duration,
          eventIndices: [eventIndex],
          userMessage: event.agent === "user" ? event.text : "(system)",
          toolCount: event.track === "tool_call" ? 1 : 0,
          hasError: event.isError,
        };
      } else {
        currentTurn.eventIndices.push(eventIndex);
        currentTurn.endTime = Math.max(currentTurn.endTime, event.t + event.duration);
        if (event.track === "tool_call") currentTurn.toolCount = (currentTurn.toolCount || 0) + 1;
        if (event.isError) currentTurn.hasError = true;
      }
      event.turnIndex = currentTurn.index;
    }
    if (currentTurn) turns.push(currentTurn);
    return turns;
  }

  for (let index = 0; index < turns.length; index += 1) turns[index].index = index;
  const turnById: Record<string, SessionTurn> = {};
  turns.forEach(function (turn) { if (turn.turnId) turnById[String(turn.turnId)] = turn; });

  for (let eventIndex = 0; eventIndex < events.length; eventIndex += 1) {
    const event = events[eventIndex];
    const turnId = typeof event.codexTurnId === "string" ? event.codexTurnId : null;
    let turn = turnId ? turnById[turnId] : null;
    if (!turn) {
      for (let turnIndex = turns.length - 1; turnIndex >= 0; turnIndex -= 1) {
        if (event.t >= turns[turnIndex].startTime) {
          turn = turns[turnIndex];
          break;
        }
      }
    }
    if (!turn) turn = turns[0];
    event.turnIndex = turn.index;
    turn.eventIndices.push(eventIndex);
    turn.endTime = Math.max(turn.endTime, event.t + event.duration);
    if (event.agent === "user" && (!turn.userMessage || turn.userMessage === "(continuation)")) turn.userMessage = event.text;
    if (event.track === "tool_call") turn.toolCount = (turn.toolCount || 0) + 1;
    if (event.isError) turn.hasError = true;
  }

  const activeTurns = turns.filter(function (turn) { return turn.eventIndices.length > 0; });
  for (let index = 0; index < activeTurns.length; index += 1) {
    const turn = activeTurns[index];
    turn.index = index;
    turn.eventIndices.forEach(function (eventIndex) {
      events[eventIndex].turnIndex = index;
    });
  }
  return activeTurns;
}

function getSessionMeta(records: RawRecord[]): Record<string, any> {
  const meta = records.find(function (record) { return record.type === "session_meta" && isRecord(record.payload); });
  return meta && meta.payload || {};
}

function getSubagentName(meta: Record<string, any>): string | null {
  if (typeof meta.agent_nickname === "string") return meta.agent_nickname;
  if (typeof meta.agent_role === "string") return meta.agent_role;
  if (!isRecord(meta.source)) return null;
  if (typeof meta.source.subagent === "string") return meta.source.subagent;
  if (!isRecord(meta.source.subagent)) return null;
  const subagent = meta.source.subagent;
  if (typeof subagent.name === "string") return subagent.name;
  if (typeof subagent.other === "string") return subagent.other;
  if (isRecord(subagent.thread_spawn)) {
    const spawn = subagent.thread_spawn;
    if (typeof spawn.agent_nickname === "string") return spawn.agent_nickname;
    if (typeof spawn.agent_role === "string") return spawn.agent_role;
    if (typeof spawn.name === "string") return spawn.name;
  }
  const keys = Object.keys(subagent);
  return keys.length === 1 && keys[0] !== "thread_spawn" ? keys[0] : null;
}

function getLastTokenUsage(records: RawRecord[], warnings: string[]): TokenUsage | null {
  let lastUsage: Record<string, any> | null = null;
  for (let index = 0; index < records.length; index += 1) {
    const payload = records[index].payload;
    if (records[index].type !== "event_msg" || !isRecord(payload) || payload.type !== "token_count") continue;
    const info = isRecord(payload.info) ? payload.info : {};
    if (isRecord(info.total_token_usage)) lastUsage = info.total_token_usage;
  }

  if (!lastUsage) return null;
  const inputTokens = numberValue(lastUsage.input_tokens);
  const cacheRead = numberValue(lastUsage.cached_input_tokens);
  // Codex reports reasoning_output_tokens as a subset of output_tokens, not an
  // addition to it: its TokenUsage.blended_total sums only output_tokens, and the
  // CLI prints "output=N (reasoning M)". Adding the two double-counts reasoning.
  const outputTokens = numberValue(lastUsage.output_tokens);
  const usage = {
    inputTokens,
    outputTokens,
    cacheRead,
    cacheWrite: 0,
    cacheHitRate: computeCacheHitRate(inputTokens, 0, cacheRead),
  };
  if (usage.inputTokens + usage.outputTokens + usage.cacheRead === 0) return null;
  warnings.push("Codex token usage is based on cumulative token_count totals");
  return usage;
}

function buildMetadata(records: RawRecord[], events: NormalizedEvent[], turns: SessionTurn[], state: ParseState, malformedLines: number, warnings: string[]): SessionMetadata {
  const meta = getSessionMeta(records);
  const tokenUsage = getLastTokenUsage(records, warnings);
  const models: Record<string, number> = {};
  Object.keys(state.turnContexts).forEach(function (turnId) {
    const model = state.turnContexts[turnId].model;
    if (model) models[model] = (models[model] || 0) + 1;
  });
  events.forEach(function (event) {
    if (event.model) models[event.model] = (models[event.model] || 0) + 1;
  });
  const modelEntries = Object.entries(models).sort(function (left, right) { return right[1] - left[1]; });

  if (malformedLines > 0) warnings.push(malformedLines + " malformed line(s) skipped");

  return {
    totalEvents: events.length,
    totalTurns: turns.length,
    totalToolCalls: events.filter(function (event) { return event.track === "tool_call"; }).length,
    errorCount: events.filter(function (event) { return event.isError; }).length,
    duration: getSessionTotal(events),
    models,
    primaryModel: modelEntries.length > 0 ? modelEntries[0][0] : null,
    tokenUsage,
    warnings,
    parseIssues: { malformedLines, invalidEvents: 0 },
    format: "codex",
    sessionId: typeof meta.id === "string" ? meta.id : null,
    cwd: typeof meta.cwd === "string" ? meta.cwd : null,
    originator: typeof meta.originator === "string" ? meta.originator : null,
    cliVersion: typeof meta.cli_version === "string" ? meta.cli_version : null,
    modelProvider: typeof meta.model_provider === "string" ? meta.model_provider : null,
    threadSource: typeof meta.thread_source === "string" ? meta.thread_source : null,
    parentThreadId: typeof meta.parent_thread_id === "string" ? meta.parent_thread_id : null,
    subagentName: getSubagentName(meta),
  };
}

export function parseCodexRecords(records: RawRecord[], malformedLines = 0): ParsedSession | null {
  if (records.length === 0) return null;
  const warnings: string[] = [];
  const state: ParseState = { currentTurnId: null, currentModel: null, turnContexts: {}, turns: {} };
  const events = buildEvents(records, state);
  if (events.length === 0) return null;

  const minEventTime = events.reduce(function (min, event) { return Math.min(min, event.t); }, events[0].t);
  normalizeEventTimes(events);
  normalizeTurnTimes(state, minEventTime);
  const turns = buildTurns(events, state);
  const metadata = buildMetadata(records, events, turns, state, malformedLines, warnings);

  return { events, turns, metadata };
}

export function parseCodexJSONL(text: string): ParsedSession | null {
  const parsed = parseRecords(text);
  return parseCodexRecords(parsed.records, parsed.malformedLines);
}
