/**
 * Parse VS Code Copilot Chat JSON session files into normalized events.
 *
 * Data locations:
 *   Windows: %APPDATA%\Code\User\workspaceStorage\{ws}\chatSessions\{id}.json
 *   macOS:   ~/Library/Application Support/Code/User/workspaceStorage/...
 *   Linux:   ~/.config/Code/User/workspaceStorage/...
 *
 * Format: JSON with { version, sessionId, requests[] }
 * Also handles JSONL wrapper: {"kind":0,"v":{...session...}}
 *
 * Returns: { events, turns, metadata } or null
 */

import type { NormalizedEvent, ParsedSession, SessionMetadata, SessionTurn } from "./sessionTypes";
import type { TrackType } from "./theme";

type ResponsePart = Record<string, any>;
type VSCodeRequest = Record<string, any>;
type VSCodeSession = Record<string, any>;

const MAX_TEXT_LENGTH = 4000;

function truncate(value: string | null | undefined, max: number): string {
  if (!value) return "";
  return value.length > max ? value.substring(0, max) + "..." : value;
}

// ── Format detection ─────────────────────────────────────────────────────────

function unwrapJsonl(text: string): VSCodeSession | null {
  // Handle {"kind":0,"v":{...session...}} wrapper format
  const trimmed = text.trim();
  try {
    const wrapper = JSON.parse(trimmed);
    if (wrapper && typeof wrapper === "object" && wrapper.kind === 0 && wrapper.v) {
      return wrapper.v;
    }
  } catch {
    // not the wrapper format
  }
  return null;
}

function isVSCodeSession(obj: unknown): boolean {
  if (!obj || typeof obj !== "object") return false;
  const o = obj as Record<string, unknown>;
  return (
    typeof o.version === "number" &&
    Array.isArray(o.requests) &&
    typeof o.sessionId === "string"
  );
}

export function detectVSCodeChat(text: string): boolean {
  const trimmed = text.trim();

  // Must start with '{' -- reject JSONL (multiple lines)
  if (!trimmed.startsWith("{")) return false;

  try {
    const parsed = JSON.parse(trimmed);
    if (isVSCodeSession(parsed)) return true;

    // Check JSONL wrapper
    if (parsed && parsed.kind === 0 && isVSCodeSession(parsed.v)) return true;
  } catch {
    // not valid JSON
  }
  return false;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function extractToolName(toolId: string): string {
  if (!toolId) return "unknown_tool";
  // Strip "copilot_" prefix for cleaner display
  if (toolId.startsWith("copilot_")) return toolId.substring(8);
  return toolId;
}

function extractFilePath(uri: Record<string, any> | null | undefined): string {
  if (!uri) return "";
  if (typeof uri.fsPath === "string") return uri.fsPath;
  if (typeof uri.path === "string") return uri.path;
  if (typeof uri.external === "string") return uri.external;
  return "";
}

const ERROR_PATTERNS = [
  /\berror\b/i,
  /\bfailed\b/i,
  /\bexception\b/i,
  /\btraceback\b/i,
  /\bpanic\b/i,
  /\bfatal\b/i,
  /exit code [1-9]/,
  /command not found/,
  /permission denied/i,
];

function isErrorTool(part: ResponsePart): boolean {
  // Terminal exit code
  if (part.toolSpecificData && part.toolSpecificData.kind === "terminal") {
    const state = part.toolSpecificData.terminalCommandState;
    if (state && state.exitCode !== 0 && state.exitCode != null) return true;
  }

  // User-rejected tool call (isConfirmed.type === 2)
  if (part.isConfirmed && part.isConfirmed.type === 2) return true;

  // Pattern match on pastTenseMessage
  const msg = part.pastTenseMessage && part.pastTenseMessage.value;
  if (msg && ERROR_PATTERNS.some(function (p) { return p.test(msg); })) return true;

  // Pattern match on result details
  if (Array.isArray(part.resultDetails)) {
    for (let i = 0; i < part.resultDetails.length; i++) {
      const val = part.resultDetails[i] && part.resultDetails[i].value;
      if (val && ERROR_PATTERNS.some(function (p) { return p.test(val); })) return true;
    }
  }

  return false;
}

function makeEvent(
  t: number,
  agent: string,
  track: TrackType,
  text: string,
  duration: number,
  intensity: number,
  raw: unknown,
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

// ── Event mapping ────────────────────────────────────────────────────────────

function mapResponsePart(
  part: ResponsePart,
  eventTime: number,
  model: string | null,
): NormalizedEvent | null {
  const kind = part.kind;

  // Skip internal bookkeeping
  if (kind === "undoStop" || kind === "prepareToolInvocation") return null;

  // Thinking block
  if (kind === "thinking") {
    const text = part.value || "";
    if (!text.trim()) return null;
    return makeEvent(eventTime, "assistant", "reasoning", text, 0.5, 0.6, part, { model });
  }

  // Tool invocation
  if (kind === "toolInvocationSerialized") {
    const toolName = extractToolName(part.toolId || "");
    const invMsg = (part.invocationMessage && part.invocationMessage.value) || toolName;
    const hasError = isErrorTool(part);

    // Build text: invocation message, or terminal command line
    let text = invMsg;
    if (part.toolSpecificData && part.toolSpecificData.kind === "terminal") {
      const cmd = part.toolSpecificData.commandLine && part.toolSpecificData.commandLine.original;
      if (cmd) text = cmd;
    }

    // Duration from terminal data
    let duration = 1;
    if (part.toolSpecificData && part.toolSpecificData.terminalCommandState) {
      const d = part.toolSpecificData.terminalCommandState.duration;
      if (d && d > 0) duration = d / 1000;
    }

    // Build toolInput from available data
    let toolInput: unknown = undefined;
    if (part.toolSpecificData && part.toolSpecificData.kind === "terminal") {
      toolInput = {
        command: part.toolSpecificData.commandLine && part.toolSpecificData.commandLine.original,
        output: part.toolSpecificData.terminalCommandOutput && part.toolSpecificData.terminalCommandOutput.text,
      };
    } else if (part.resultDetails && part.resultDetails.length > 0) {
      const details = part.resultDetails.map(function (d: any) { return d && d.value; }).filter(Boolean).join("\n");
      if (details) toolInput = { result: details };
    }

    return makeEvent(eventTime, "assistant", "tool_call", text, duration, 0.9, part, {
      toolName,
      toolInput,
      toolCallId: part.toolCallId || null,
      isError: hasError,
      model,
    });
  }

  // Text edit group (file edit)
  if (kind === "textEditGroup") {
    const filePath = extractFilePath(part.uri);
    const fileName = filePath.split(/[/\\]/).pop() || "file";
    const editCount = Array.isArray(part.edits) ? part.edits.filter(function (e: any) { return Array.isArray(e) && e.length > 0; }).length : 0;
    const text = "Edit " + fileName + " (" + editCount + " change" + (editCount !== 1 ? "s" : "") + ")";
    return makeEvent(eventTime, "assistant", "tool_call", text, 0.5, 0.8, part, {
      toolName: "file_edit",
      toolInput: { file: filePath, editCount },
      model,
    });
  }

  // Code block URI reference
  if (kind === "codeblockUri") {
    const filePath = extractFilePath(part.uri || part);
    return makeEvent(eventTime, "assistant", "context", "File: " + filePath, 0.1, 0.3, part, { model });
  }

  // Inline reference
  if (kind === "inlineReference") {
    const name = part.name || extractFilePath(part.inlineReference) || "reference";
    return makeEvent(eventTime, "assistant", "context", name, 0.1, 0.3, part, { model });
  }

  // Elicitation (user confirmation prompt)
  if (kind === "elicitationSerialized") {
    const text = (part.title || "") + (part.message ? ": " + part.message : "");
    return makeEvent(eventTime, "system", "context", text || "User confirmation", 0.2, 0.4, part);
  }

  // Progress task
  if (kind === "progressTaskSerialized") {
    const text = (part.content && part.content.value) || "Progress";
    return makeEvent(eventTime, "system", "context", text, 0.1, 0.3, part);
  }

  // MCP servers starting
  if (kind === "mcpServersStarting") {
    const ids = Array.isArray(part.didStartServerIds) ? part.didStartServerIds.join(", ") : "";
    return makeEvent(eventTime, "system", "context", "MCP servers starting: " + ids, 0.2, 0.3, part);
  }

  // Plain text output (no kind, has .value)
  if (!kind && typeof part.value === "string") {
    const text = part.value.trim();
    if (!text) return null;
    return makeEvent(eventTime, "assistant", "output", text, 0.3, 0.5, part, { model });
  }

  return null;
}

// ── Timeline builder ─────────────────────────────────────────────────────────

function buildTimeline(session: VSCodeSession): {
  events: NormalizedEvent[];
  turns: SessionTurn[];
} {
  const requests: VSCodeRequest[] = session.requests || [];
  if (requests.length === 0) return { events: [], turns: [] };

  const sessionStartMs = session.creationDate || requests[0].timestamp || 0;
  const sessionStartSec = sessionStartMs / 1000;
  const events: NormalizedEvent[] = [];
  const turns: SessionTurn[] = [];

  for (let ri = 0; ri < requests.length; ri++) {
    const req = requests[ri];
    const reqTimestampMs = req.timestamp || sessionStartMs;
    const turnStartSec = reqTimestampMs / 1000 - sessionStartSec;
    const totalElapsedMs = (req.result && req.result.timings && req.result.timings.totalElapsed) || 0;
    const firstProgressMs = (req.result && req.result.timings && req.result.timings.firstProgress) || 0;
    const model = req.modelId || session.selectedModel && session.selectedModel.identifier || null;

    const turnEventStart = events.length;

    // User message event
    const userText = (req.message && req.message.text) || "";
    if (userText) {
      events.push(makeEvent(turnStartSec, "user", "output", userText, 0.5, 0.9, req));
    }

    // Map response parts with estimated timestamps
    const responseParts: ResponsePart[] = req.response || [];
    const mappable = responseParts.filter(function (p) {
      return p.kind !== "undoStop" && p.kind !== "prepareToolInvocation";
    });

    // Count terminal tools with real timestamps for precise placement
    const terminalTimestamps: { index: number; timestampSec: number; durationSec: number }[] = [];
    for (let pi = 0; pi < responseParts.length; pi++) {
      const p = responseParts[pi];
      if (p.kind === "toolInvocationSerialized" && p.toolSpecificData && p.toolSpecificData.kind === "terminal") {
        const state = p.toolSpecificData.terminalCommandState;
        if (state && state.timestamp) {
          terminalTimestamps.push({
            index: pi,
            timestampSec: state.timestamp / 1000 - sessionStartSec,
            durationSec: (state.duration || 0) / 1000,
          });
        }
      }
    }

    // Distribute events across the turn duration
    const turnDurationSec = totalElapsedMs / 1000 || 10;
    let partIndex = 0;

    for (let pi = 0; pi < responseParts.length; pi++) {
      const part = responseParts[pi];
      if (part.kind === "undoStop" || part.kind === "prepareToolInvocation") continue;

      // Calculate time for this event
      let eventTime: number;

      // Check if this part has a precise terminal timestamp
      const termInfo = terminalTimestamps.find(function (t) { return t.index === pi; });
      if (termInfo) {
        eventTime = termInfo.timestampSec;
      } else if (part.kind === "thinking" && partIndex === 0 && firstProgressMs > 0) {
        // First thinking block at firstProgress
        eventTime = turnStartSec + firstProgressMs / 1000;
      } else {
        // Distribute proportionally
        const fraction = mappable.length > 1 ? partIndex / (mappable.length - 1) : 0;
        eventTime = turnStartSec + fraction * turnDurationSec;
      }

      // Minimum event spacing
      if (events.length > 0 && eventTime <= events[events.length - 1].t) {
        eventTime = events[events.length - 1].t + 0.1;
      }

      const mapped = mapResponsePart(part, eventTime, model);
      if (mapped) {
        mapped.turnIndex = ri;
        events.push(mapped);
      }
      partIndex++;
    }

    // Build turn
    const turnEventEnd = events.length;
    const turnEnd = turnStartSec + turnDurationSec;
    let toolCount = 0;
    let hasError = false;
    const eventIndices: number[] = [];

    for (let ei = turnEventStart; ei < turnEventEnd; ei++) {
      eventIndices.push(ei);
      if (events[ei].track === "tool_call") toolCount++;
      if (events[ei].isError) hasError = true;
    }

    turns.push({
      index: ri,
      startTime: turnStartSec,
      endTime: turnEnd,
      eventIndices,
      userMessage: userText || undefined,
      toolCount,
      hasError,
    });
  }

  return { events, turns };
}

// ── Metadata builder ─────────────────────────────────────────────────────────

function buildMetadata(
  events: NormalizedEvent[],
  turns: SessionTurn[],
  session: VSCodeSession,
): SessionMetadata {
  const models: Record<string, number> = {};
  let errorCount = 0;
  let toolCalls = 0;

  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (ev.model) models[ev.model] = (models[ev.model] || 0) + 1;
    if (ev.isError) errorCount++;
    if (ev.track === "tool_call") toolCalls++;
  }

  const duration = events.length > 0
    ? events[events.length - 1].t + events[events.length - 1].duration - events[0].t
    : 0;

  const modelEntries = Object.entries(models).sort(function (a, b) { return b[1] - a[1]; });

  return {
    totalEvents: events.length,
    totalTurns: turns.length,
    totalToolCalls: toolCalls,
    errorCount,
    duration,
    models,
    primaryModel: modelEntries.length > 0 ? modelEntries[0][0] : null,
    tokenUsage: null, // VS Code does not log token counts
    format: "vscode-chat",
    customTitle: session.customTitle || undefined,
    sessionMode: (session.mode && session.mode.id) || undefined,
  };
}

// ── Main parser ──────────────────────────────────────────────────────────────

export function parseVSCodeChatJSON(text: string): ParsedSession | null {
  let session: VSCodeSession | null = null;

  try {
    const parsed = JSON.parse(text.trim());

    // Handle JSONL wrapper
    if (parsed && parsed.kind === 0 && parsed.v) {
      session = parsed.v;
    } else {
      session = parsed;
    }
  } catch {
    // Try unwrap from JSONL wrapper
    session = unwrapJsonl(text);
  }

  if (!session || !isVSCodeSession(session)) return null;

  const { events, turns } = buildTimeline(session);
  if (events.length === 0) return null;

  const metadata = buildMetadata(events, turns, session);

  return { events, turns, metadata };
}
