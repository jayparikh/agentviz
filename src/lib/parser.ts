/**
 * Parse Claude Code JSONL session files into normalized events.
 *
 * Sessions live at: ~/.claude/projects/<project>/<session-id>.jsonl
 *
 * Returns: { events, turns, metadata } or null
 *
 * Event shape:
 *   { t, agent, track, text, duration, intensity,
 *     toolName?, toolInput?, raw, turnIndex, isError,
 *     model?, tokenUsage? }
 *
 * Turn shape:
 *   { index, startTime, endTime, eventIndices, userMessage,
 *     toolCount, hasError }
 *
 * Metadata shape:
 *   { totalEvents, totalTurns, totalToolCalls, errorCount,
 *     duration, models, primaryModel, tokenUsage }
 */

import type { NormalizedEvent, ParseIssues, ParsedSession, SessionMetadata, SessionTurn, TokenUsage } from "./sessionTypes";

type RawRecord = Record<string, any>;
import { truncateText as truncate } from "./formatTime.js";

type MessageBlock = Record<string, any>;

function extractContent(content: unknown): string {
  if (!content) return "";
  if (typeof content === "string") return content;

  if (Array.isArray(content)) {
    return content
      .map(function (item) {
        if (typeof item === "string") return item;
        if (!item || typeof item !== "object") return "";
        if (item.type === "text") return typeof item.text === "string" ? item.text : "";
        if (item.type === "tool_use") return "[tool: " + (item.name || "unknown") + "]";
        if (item.type === "tool_result") return "[result]";
        return "";
      })
      .filter(Boolean)
      .join(" ");
  }

  if (typeof content === "object" && content !== null && typeof (content as RawRecord).text === "string") {
    return (content as RawRecord).text;
  }

  return JSON.stringify(content).substring(0, 200);
}

function formatToolInput(input: unknown): string {
  if (!input) return "";
  if (typeof input === "string") return truncate(input, 100);
  if (typeof input !== "object") return truncate(String(input), 100);

  const keys = Object.keys(input as RawRecord);
  if (keys.length === 0) return "";

  const first = keys[0];
  const firstValue = (input as RawRecord)[first];
  const valueText = typeof firstValue === "string" ? firstValue : JSON.stringify(firstValue);
  const extra = keys.length > 1 ? ", +" + (keys.length - 1) + " more" : "";
  return truncate(first + ": " + valueText + extra, 120);
}

function isReasoningText(text: string): boolean {
  if (!text || text.length > 600) return false;

  const lower = text.toLowerCase();
  const signals = [
    "i'll ", "i need to", "let me", "first,", "the approach",
    "i should", "plan:", "step 1", "thinking about", "considering",
    "my strategy", "i want to",
  ];

  return signals.some(function (signal) { return lower.includes(signal); });
}

function extractTimestamp(raw: RawRecord): number | null {
  const timestamp = raw.timestamp || raw.ts || raw.created_at || raw.createdAt;
  if (!timestamp) return null;

  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return null;
  return date.getTime() / 1000;
}

function extractModel(raw: RawRecord): string | null {
  if (typeof raw.model === "string") return raw.model;
  const message = raw.message && typeof raw.message === "object" ? raw.message : null;
  if (message && typeof message.model === "string") return message.model;
  return null;
}

function extractUsage(raw: RawRecord): TokenUsage | null {
  const usage = raw.usage || (raw.message && raw.message.usage) || null;
  if (!usage || typeof usage !== "object") return null;

  const inputTokens = usage.input_tokens || usage.prompt_tokens || 0;
  const outputTokens = usage.output_tokens || usage.completion_tokens || 0;
  const cacheRead = usage.cache_read_input_tokens || usage.cache_read_tokens || 0;
  const cacheWrite = usage.cache_creation_input_tokens || usage.cache_write_tokens || 0;

  if (inputTokens + outputTokens + cacheRead + cacheWrite === 0) return null;

  return {
    inputTokens,
    outputTokens,
    cacheRead,
    cacheWrite,
  };
}

function createParseIssues(): ParseIssues {
  return {
    malformedLines: 0,
    invalidEvents: 0,
  };
}

function buildWarnings(issues: ParseIssues | null | undefined): string[] {
  const warnings: string[] = [];
  if (!issues) return warnings;

  if (issues.malformedLines > 0) {
    warnings.push(issues.malformedLines + " malformed line" + (issues.malformedLines !== 1 ? "s were" : " was") + " skipped");
  }

  if (issues.invalidEvents > 0) {
    warnings.push(issues.invalidEvents + " invalid derived event" + (issues.invalidEvents !== 1 ? "s were" : " was") + " skipped");
  }

  return warnings;
}

function isValidEvent(event: Partial<NormalizedEvent> | null | undefined): event is NormalizedEvent {
  return Boolean(
    event
      && typeof event.t === "number"
      && !Number.isNaN(event.t)
      && typeof event.agent === "string"
      && typeof event.track === "string"
      && typeof event.text === "string"
      && typeof event.duration === "number"
      && !Number.isNaN(event.duration)
      && typeof event.intensity === "number"
      && !Number.isNaN(event.intensity)
      && typeof event.isError === "boolean",
  );
}

// Keep this list intentionally broad enough to catch common terminal and tool
// failures across bash, Python, Node, and system commands without relying on a
// single vendor-specific payload shape.
const ERROR_PATTERNS = [
  /\berror\b/i,
  /\bfailed\b/i,
  /\bexception\b/i,
  /\btraceback\b/i,
  /\bpanic\b/i,
  /\bfatal\b/i,
  /exit code [1-9]/,
  /exit status [1-9]/,
  /command not found/,
  /permission denied/i,
  /no such file/i,
  /cannot find/i,
];

function detectError(block: MessageBlock, text: string): boolean {
  if (block.is_error === true) return true;
  if (block.error) return true;
  if (!text) return false;
  return ERROR_PATTERNS.some(function (pattern) { return pattern.test(text); });
}

function extractEventsFromRecord(raw: RawRecord, syntheticTime: number, issues: ParseIssues): NormalizedEvent[] {
  const events: NormalizedEvent[] = [];
  const timestamp = extractTimestamp(raw);
  const tSeconds = timestamp !== null ? timestamp : syntheticTime;
  const model = extractModel(raw);
  const usage = extractUsage(raw);

  function pushEvent(event: Partial<NormalizedEvent>): void {
    if (!isValidEvent(event)) {
      issues.invalidEvents += 1;
      return;
    }

    if (model && !event.model) event.model = model;
    if (usage && !event.tokenUsage) event.tokenUsage = usage;
    events.push(event);
  }

  if (raw.type === "human" || raw.type === "user") {
    const content = extractContent(raw.message && raw.message.content != null ? raw.message.content : raw.message || raw.content || raw);
    if (content) {
      pushEvent({
        t: tSeconds,
        agent: "user",
        track: "output",
        text: truncate(content, 300),
        duration: 1,
        intensity: 0.6,
        raw,
        isError: false,
      });
    }
  }

  if (raw.type === "assistant" || raw.role === "assistant") {
    const message = raw.message && typeof raw.message === "object" ? raw.message : raw;
    const content = message.content || raw.content;

    if (Array.isArray(content)) {
      let offset = 0;

      for (let index = 0; index < content.length; index += 1) {
        const block = content[index] as MessageBlock;

        if (block.type === "text" && block.text) {
          pushEvent({
            t: tSeconds + offset,
            agent: "assistant",
            track: isReasoningText(block.text) ? "reasoning" : "output",
            text: truncate(block.text, 300),
            duration: Math.max(1, Math.ceil(block.text.length / 500)),
            intensity: 0.7,
            raw: block,
            isError: false,
          });
          offset += 0.2;
        }

        if (block.type === "tool_use") {
          pushEvent({
            t: tSeconds + offset,
            agent: "assistant",
            track: "tool_call",
            text: String(block.name || "tool") + "(" + formatToolInput(block.input) + ")",
            toolName: typeof block.name === "string" ? block.name : undefined,
            toolInput: block.input,
            duration: 2,
            intensity: 0.9,
            raw: block,
            isError: false,
          });
          offset += 0.3;
        }

        if (block.type === "tool_result") {
          const resultText = extractContent(block.content || block.output);
          const hasError = detectError(block, resultText);
          pushEvent({
            t: tSeconds + offset,
            agent: "assistant",
            track: "context",
            text: "Result: " + truncate(resultText, 200),
            duration: 1,
            intensity: hasError ? 1.0 : 0.5,
            raw: block,
            isError: hasError,
          });
          offset += 0.2;
        }

        if (block.type === "thinking" || block.type === "reasoning") {
          const blockText = typeof block.thinking === "string"
            ? block.thinking
            : typeof block.text === "string"
              ? block.text
              : typeof block.content === "string"
                ? block.content
                : "";

          pushEvent({
            t: tSeconds + offset,
            agent: "assistant",
            track: "reasoning",
            text: truncate(blockText, 300),
            duration: 2,
            intensity: 0.8,
            raw: block,
            isError: false,
          });
          offset += 0.2;
        }
      }
    } else if (typeof content === "string" && content.length > 0) {
      pushEvent({
        t: tSeconds,
        agent: "assistant",
        track: "output",
        text: truncate(content, 300),
        duration: 2,
        intensity: 0.7,
        raw,
        isError: false,
      });
    }
  }

  if (raw.role === "user" && !raw.type) {
    const userContent = extractContent(raw.content);
    if (userContent) {
      pushEvent({
        t: tSeconds,
        agent: "user",
        track: "output",
        text: truncate(userContent, 300),
        duration: 1,
        intensity: 0.6,
        raw,
        isError: false,
      });
    }
  }

  if (raw.type === "tool_use") {
    const toolName = raw.name || raw.tool_name || "unknown_tool";
    pushEvent({
      t: tSeconds,
      agent: "assistant",
      track: "tool_call",
      text: String(toolName) + "(" + formatToolInput(raw.input || raw.parameters || {}) + ")",
      toolName: String(toolName),
      toolInput: raw.input || raw.parameters,
      duration: 2,
      intensity: 0.9,
      raw,
      isError: false,
    });
  }

  if (raw.type === "tool_result") {
    const resultText = extractContent(raw.content || raw.output);
    const hasError = detectError(raw, resultText);
    pushEvent({
      t: tSeconds,
      agent: "assistant",
      track: "context",
      text: "Result: " + truncate(resultText, 200),
      duration: 1,
      intensity: hasError ? 1.0 : 0.5,
      raw,
      isError: hasError,
    });
  }

  if (raw.type === "system" || raw.type === "summary") {
    const content = extractContent(raw.message || raw.content || raw.summary);
    if (content) {
      pushEvent({
        t: tSeconds,
        agent: "system",
        track: "context",
        text: truncate(content, 200),
        duration: 1,
        intensity: 0.4,
        raw,
        isError: false,
      });
    }
  }

  return events;
}

function computeDurations(events: NormalizedEvent[]): void {
  for (let index = 0; index < events.length; index += 1) {
    if (index < events.length - 1) {
      const gap = events[index + 1].t - events[index].t;
      if (gap >= 0.1 && gap < 300) {
        events[index].duration = gap;
      }
    }
  }
}

function buildTurns(events: NormalizedEvent[]): SessionTurn[] {
  const turns: SessionTurn[] = [];
  let currentTurn: SessionTurn | null = null;

  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];

    if (event.agent === "user") {
      if (currentTurn) turns.push(currentTurn);

      currentTurn = {
        index: turns.length,
        startTime: event.t,
        endTime: event.t + event.duration,
        eventIndices: [index],
        userMessage: event.text,
        toolCount: 0,
        hasError: event.isError || false,
      };
    } else if (currentTurn) {
      currentTurn.eventIndices.push(index);
      currentTurn.endTime = event.t + event.duration;
      if (event.track === "tool_call") currentTurn.toolCount = (currentTurn.toolCount || 0) + 1;
      if (event.isError) currentTurn.hasError = true;
    } else {
      currentTurn = {
        index: 0,
        startTime: event.t,
        endTime: event.t + event.duration,
        eventIndices: [index],
        userMessage: "(system)",
        toolCount: event.track === "tool_call" ? 1 : 0,
        hasError: event.isError || false,
      };
    }

    event.turnIndex = currentTurn.index;
  }

  if (currentTurn) turns.push(currentTurn);
  return turns;
}

function buildMetadata(events: NormalizedEvent[], turns: SessionTurn[], issues: ParseIssues): SessionMetadata {
  const models: Record<string, number> = {};
  let totalInput = 0;
  let totalOutput = 0;
  let errorCount = 0;
  let toolCalls = 0;

  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (event.model) models[event.model] = (models[event.model] || 0) + 1;
    if (event.tokenUsage) {
      totalInput += event.tokenUsage.inputTokens || 0;
      totalOutput += event.tokenUsage.outputTokens || 0;
    }
    if (event.isError) errorCount += 1;
    if (event.track === "tool_call") toolCalls += 1;
  }

  const duration = events.length > 0
    ? events[events.length - 1].t + events[events.length - 1].duration - events[0].t
    : 0;

  const modelEntries = Object.entries(models).sort(function (left, right) {
    return right[1] - left[1];
  });

  return {
    totalEvents: events.length,
    totalTurns: turns.length,
    totalToolCalls: toolCalls,
    errorCount,
    duration,
    models,
    primaryModel: modelEntries.length > 0 ? modelEntries[0][0] : null,
    tokenUsage: totalInput + totalOutput > 0
      ? { inputTokens: totalInput, outputTokens: totalOutput }
      : null,
    warnings: buildWarnings(issues),
    parseIssues: issues,
    format: "claude-code",
  };
}

export function parseClaudeCodeJSONL(text: string): ParsedSession | null {
  const lines = text.trim().split("\n").filter(Boolean);
  const rawRecords: RawRecord[] = [];
  const issues = createParseIssues();

  for (let index = 0; index < lines.length; index += 1) {
    try {
      rawRecords.push(JSON.parse(lines[index]));
    } catch {
      issues.malformedLines += 1;
    }
  }

  if (rawRecords.length === 0) return null;

  let timestampCount = 0;
  for (let index = 0; index < rawRecords.length; index += 1) {
    if (extractTimestamp(rawRecords[index]) !== null) timestampCount += 1;
  }
  const hasRealTimestamps = timestampCount > rawRecords.length * 0.5;

  const events: NormalizedEvent[] = [];
  let syntheticTime = 0;

  for (let index = 0; index < rawRecords.length; index += 1) {
    const parsedEvents = extractEventsFromRecord(rawRecords[index], syntheticTime, issues);
    events.push(...parsedEvents);
    syntheticTime += Math.max(1, parsedEvents.length);
  }

  if (events.length === 0) return null;

  let minTime = Infinity;
  if (hasRealTimestamps) {
    for (let index = 0; index < events.length; index += 1) {
      if (events[index].t > 1e9 && events[index].t < minTime) {
        minTime = events[index].t;
      }
    }
  }

  if (minTime === Infinity) {
    minTime = events[0].t;
    for (let index = 1; index < events.length; index += 1) {
      if (events[index].t < minTime) minTime = events[index].t;
    }
  }

  for (let index = 0; index < events.length; index += 1) {
    events[index].t = Math.max(0, events[index].t - minTime);
  }

  if (hasRealTimestamps) computeDurations(events);

  const turns = buildTurns(events);
  const metadata = buildMetadata(events, turns, issues);

  return { events, turns, metadata };
}
