/**
 * Parse ATIF (Agent Trajectory Interchange Format) v1.6 trajectories
 * produced by the Harbor framework into normalized AGENTVIZ events.
 *
 * Spec: https://github.com/harbor-framework/harbor (schema_version "ATIF-v1.6").
 *
 * Each ATIF Step can fan out to multiple NormalizedEvents:
 *   - one event for the step's `message` (if non-empty)
 *   - one event for `reasoning_content` (if present)
 *   - one event per entry in `tool_calls[]`
 *   - one event per entry in `observation.results[]`
 *
 * The parser is deliberately lenient about unknown fields (forward-compat
 * with future ATIF versions) and emits human-readable warnings into
 * `metadata.warnings` for non-fatal anomalies. It returns null only on
 * hard parse failures (invalid JSON, missing `agent`, missing `steps`).
 *
 * Note on errors: ATIF has no `is_error` flag on observation results, so
 * isError is heuristic -- it matches /^Error/i and /exited with exit code [1-9]/
 * on result content. False negatives are expected.
 */

import type { NormalizedEvent, ParsedSession, SessionMetadata, SessionTurn, TokenUsage } from "./sessionTypes";
import { computeCacheHitRate } from "./cacheMetrics";
import { getSessionTotal } from "./session";
import { truncateText as truncate } from "./formatTime.js";
import type { TrackType } from "./theme";

const MAX_TEXT_LENGTH = 4000;
const SUPPORTED_SCHEMA_VERSION = "ATIF-v1.6";
const ISO_8601_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/;
const ERROR_RE = /^Error/i;
const EXIT_CODE_RE = /exited with exit code [1-9]/;

type AtifContentPart = {
  type?: string;
  text?: string;
  path?: string;
  url?: string;
  [key: string]: unknown;
};

type AtifMessage = string | AtifContentPart[] | null | undefined;

type AtifToolCall = {
  tool_call_id?: string;
  function_name?: string;
  arguments?: unknown;
  [key: string]: unknown;
};

type AtifSubagentTrajectoryRef = {
  session_id?: string;
  trajectory_path?: string;
  extra?: Record<string, unknown>;
};

type AtifObservationResult = {
  source_call_id?: string;
  content?: AtifMessage;
  // Per ATIF v1.6 spec, lives on observation_result (not step) and is a list.
  subagent_trajectory_ref?: AtifSubagentTrajectoryRef[];
  [key: string]: unknown;
};

type AtifMetricsExtra = {
  reasoning_tokens?: number;
  model_call_duration_ms?: number;
  [key: string]: unknown;
};

type AtifMetrics = {
  prompt_tokens?: number;
  completion_tokens?: number;
  cached_tokens?: number;
  cost_usd?: number;
  extra?: AtifMetricsExtra;
  [key: string]: unknown;
};

type AtifStep = {
  step_id?: number;
  timestamp?: string;
  source?: string;
  message?: AtifMessage;
  model_name?: string;
  reasoning_effort?: string | number;
  reasoning_content?: string;
  tool_calls?: AtifToolCall[];
  observation?: { results?: AtifObservationResult[] } | null;
  metrics?: AtifMetrics;
  is_copied_context?: boolean;
  extra?: { turn?: number; ttft_ms?: number; num_tools_called?: number; [key: string]: unknown };
  [key: string]: unknown;
};

type AtifAgent = {
  name?: string;
  version?: string;
  model_name?: string;
  tool_definitions?: Array<Record<string, unknown>>;
  extra?: Record<string, unknown>;
  [key: string]: unknown;
};

type AtifFinalMetrics = {
  total_prompt_tokens?: number;
  total_completion_tokens?: number;
  total_cached_tokens?: number;
  total_cost_usd?: number;
  total_steps?: number;
  extra?: Record<string, unknown>;
  [key: string]: unknown;
};

type AtifTrajectory = {
  schema_version?: string;
  session_id?: string;
  agent?: AtifAgent;
  steps?: AtifStep[];
  final_metrics?: AtifFinalMetrics;
  notes?: string;
  continued_trajectory_ref?: string;
  [key: string]: unknown;
};

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export function detectAtif(text: string): boolean {
  const parsed = tryParseJson(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
  const obj = parsed as Record<string, unknown>;
  return typeof obj.schema_version === "string" && (obj.schema_version as string).startsWith("ATIF-");
}

function parseTimestamp(timestamp: string | null | undefined): number | null {
  if (!timestamp) return null;
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return null;
  return date.getTime() / 1000;
}

function isValidIso8601(timestamp: string): boolean {
  if (!ISO_8601_RE.test(timestamp)) return false;
  const date = new Date(timestamp);
  return !Number.isNaN(date.getTime());
}

function flattenMessage(message: AtifMessage): string {
  if (message == null) return "";
  if (typeof message === "string") return message;
  if (!Array.isArray(message)) return "";

  const parts: string[] = [];
  for (let index = 0; index < message.length; index += 1) {
    const part = message[index];
    if (!part || typeof part !== "object") continue;
    const type = typeof part.type === "string" ? part.type.toLowerCase() : "";
    if (type === "image" || type === "image_url" || part.path || part.url) {
      const ref = (part.path as string | undefined) || (part.url as string | undefined) || "";
      parts.push("[image: " + ref + "]");
    } else if (typeof part.text === "string") {
      parts.push(part.text);
    }
  }
  return parts.join("\n");
}

function mapSourceToAgent(source: string | undefined): string {
  if (source === "agent") return "assistant";
  if (source === "user") return "user";
  if (source === "system") return "system";
  return "system";
}

function trackForMessage(source: string | undefined): TrackType {
  return source === "system" ? "context" : "output";
}

function compareSemverLike(actual: string, supported: string): number {
  // Strip the "ATIF-v" prefix; remainder is dotted numbers with optional suffix.
  const stripPrefix = (value: string) => value.replace(/^ATIF-v/i, "");
  const a = stripPrefix(actual).split(/[.\-+]/).map(function (segment) {
    const n = parseInt(segment, 10);
    return Number.isNaN(n) ? 0 : n;
  });
  const b = stripPrefix(supported).split(/[.\-+]/).map(function (segment) {
    const n = parseInt(segment, 10);
    return Number.isNaN(n) ? 0 : n;
  });
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const diff = (a[index] || 0) - (b[index] || 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

function buildStepTimestamps(steps: AtifStep[], warnings: string[]): number[] {
  const stepTimes: Array<number | null> = steps.map(function (step) {
    if (step.timestamp == null) return null;
    if (typeof step.timestamp !== "string" || !isValidIso8601(step.timestamp)) {
      warnings.push("Step " + (step.step_id ?? "?") + " has malformed timestamp: " + step.timestamp);
      return null;
    }
    return parseTimestamp(step.timestamp);
  });

  // Forward fill missing timestamps by interpolating from neighbours.
  let lastKnown = 0;
  let hasAnyKnown = false;
  for (let index = 0; index < stepTimes.length; index += 1) {
    if (stepTimes[index] != null) {
      lastKnown = stepTimes[index] as number;
      hasAnyKnown = true;
      break;
    }
  }
  if (!hasAnyKnown) {
    return stepTimes.map(function (_, index) {
      return index;
    });
  }

  const resolved: number[] = new Array(stepTimes.length);
  let cursor = lastKnown;
  for (let index = 0; index < stepTimes.length; index += 1) {
    const value = stepTimes[index];
    if (value != null) {
      cursor = value;
      resolved[index] = value;
      continue;
    }
    // Look ahead for the next known timestamp and split the difference.
    let nextIndex = index + 1;
    while (nextIndex < stepTimes.length && stepTimes[nextIndex] == null) nextIndex += 1;
    if (nextIndex < stepTimes.length) {
      const next = stepTimes[nextIndex] as number;
      const gap = nextIndex - index + 1;
      const delta = (next - cursor) / gap;
      resolved[index] = cursor + delta;
      cursor = resolved[index];
    } else {
      resolved[index] = cursor;
    }
  }
  return resolved;
}

function makeEvent(
  t: number,
  agent: string,
  track: TrackType,
  text: string,
  duration: number,
  intensity: number,
  raw: Record<string, unknown>,
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

// Per ATIF v1.6, ToolCall and ObservationResult are strict (`extra: forbid`)
// and define no per-tool duration field. This helper opportunistically picks
// up `duration_ms` / `latency_ms` / `elapsed_ms` (top level, under `metrics`,
// or under `extra`) for non-conforming exporters that include them anyway,
// so bars still light up when the data is present. Returns seconds (0 if
// absent).
function readDurationSec(source: Record<string, unknown> | undefined | null): number {
  if (!source) return 0;
  const candidates = ["duration_ms", "latency_ms", "elapsed_ms"];
  const containers: Array<Record<string, unknown> | undefined> = [
    source,
    source.metrics as Record<string, unknown> | undefined,
    source.extra as Record<string, unknown> | undefined,
  ];
  for (const container of containers) {
    if (!container) continue;
    for (const key of candidates) {
      const value = container[key];
      if (typeof value === "number" && isFinite(value) && value > 0) {
        return value / 1000;
      }
    }
  }
  return 0;
}

function buildTokenUsageForStep(metrics: AtifMetrics | undefined): TokenUsage | null {
  if (!metrics) return null;
  const inputTokens = metrics.prompt_tokens || 0;
  const outputTokens = metrics.completion_tokens || 0;
  const cacheRead = metrics.cached_tokens || 0;
  if (inputTokens + outputTokens + cacheRead === 0) return null;
  return {
    inputTokens,
    outputTokens,
    cacheRead,
    cacheHitRate: computeCacheHitRate(inputTokens, 0, cacheRead),
  };
}

function isCopiedContext(step: AtifStep): boolean {
  return step.is_copied_context === true;
}

export function parseAtifJSON(text: string): ParsedSession | null {
  const parsed = tryParseJson(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const trajectory = parsed as AtifTrajectory;

  if (!trajectory.agent || typeof trajectory.agent !== "object") return null;
  if (!Array.isArray(trajectory.steps)) return null;

  const warnings: string[] = [];

  if (typeof trajectory.schema_version === "string"
    && trajectory.schema_version.startsWith("ATIF-")
    && compareSemverLike(trajectory.schema_version, SUPPORTED_SCHEMA_VERSION) > 0
  ) {
    warnings.push(
      "Schema version " + trajectory.schema_version + " is newer than supported " + SUPPORTED_SCHEMA_VERSION + "; parsing best-effort.",
    );
  }

  const steps = trajectory.steps;
  if (steps.length === 0) return null;

  // Validate step_id sequencing.
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    const expected = index + 1;
    if (typeof step.step_id === "number" && step.step_id !== expected) {
      warnings.push("Non-sequential step_id at position " + index + " (expected " + expected + ", got " + step.step_id + ")");
    }
  }

  const stepTimesAbsolute = buildStepTimestamps(steps, warnings);
  const sessionStartSec = stepTimesAbsolute.length > 0 ? stepTimesAbsolute[0] : 0;

  const events: NormalizedEvent[] = [];
  const turns: SessionTurn[] = [];
  let currentTurn: SessionTurn | null = null;
  let primaryFallbackModel = trajectory.agent.model_name;

  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    const stepRel = stepTimesAbsolute[index] - sessionStartSec;
    const nextStepRel = index + 1 < steps.length
      ? stepTimesAbsolute[index + 1] - sessionStartSec
      : stepRel + (step.metrics && step.metrics.extra && typeof step.metrics.extra.model_call_duration_ms === "number"
        ? (step.metrics.extra.model_call_duration_ms as number) / 1000
        : 0);
    const stepDurationSec = Math.max(0, nextStepRel - stepRel);
    const agentName = mapSourceToAgent(step.source);
    const copiedContext = isCopiedContext(step);
    const stepModel = step.model_name || primaryFallbackModel || null;

    // Validate observation back-references against this step's tool_calls.
    if (step.observation && Array.isArray(step.observation.results) && Array.isArray(step.tool_calls)) {
      const toolCallIds: Record<string, true> = {};
      for (let toolIndex = 0; toolIndex < step.tool_calls.length; toolIndex += 1) {
        const id = step.tool_calls[toolIndex].tool_call_id;
        if (typeof id === "string") toolCallIds[id] = true;
      }
      for (let resultIndex = 0; resultIndex < step.observation.results.length; resultIndex += 1) {
        const result = step.observation.results[resultIndex];
        if (typeof result.source_call_id === "string" && !toolCallIds[result.source_call_id]) {
          warnings.push(
            "Step " + (step.step_id ?? index + 1) + " observation references unknown tool_call_id "
            + result.source_call_id,
          );
        }
      }
    }

    // ATIF steps map 1:1 to turns: each agent step is its own iteration of
    // the agent loop, semantically distinct from a single conversational turn.
    // We use the step's position (index) so each turn id is unique. Note that
    // step.extra.turn is a per-source iteration counter (resets across user
    // vs agent), so it can collide and is intentionally not used here.
    const stepTurnIndex = index;

    if (currentTurn) turns.push(currentTurn);
    const userText = step.source === "user" ? flattenMessage(step.message) : "";
    const turnLabel = step.source === "user"
      ? (userText || "(continuation)")
      : agentName;
    currentTurn = {
      index: stepTurnIndex,
      startTime: stepRel,
      endTime: stepRel,
      eventIndices: [],
      userMessage: turnLabel,
      toolCount: 0,
      hasError: false,
    };
    const stepRawSummary: Record<string, unknown> = {
      step_id: step.step_id,
      source: step.source,
      timestamp: step.timestamp,
      isCopiedContext: copiedContext,
      reasoningEffort: step.reasoning_effort,
      stepCostUsd: step.metrics && typeof step.metrics.cost_usd === "number" ? step.metrics.cost_usd : null,
    };

    const stepTokenUsage = buildTokenUsageForStep(step.metrics);
    const ttftMs = step.extra && typeof step.extra.ttft_ms === "number" ? (step.extra.ttft_ms as number) : 0;
    // Cap message duration to the step's actual wall-clock duration. ATIF
    // ttft_ms can exceed the gap between steps (e.g., when a step represents
    // batched/streamed output), and an over-long message bar would visually
    // bleed into the next step on the same lane.
    const rawMessageDurationSec = ttftMs > 0 ? ttftMs / 1000 : 0;
    const messageDurationSec = stepDurationSec > 0
      ? Math.min(rawMessageDurationSec, stepDurationSec)
      : rawMessageDurationSec;

    const toolCalls = Array.isArray(step.tool_calls) ? step.tool_calls : [];
    const observationResults = step.observation && Array.isArray(step.observation.results)
      ? step.observation.results
      : [];

    // 1. Message event.
    const messageText = flattenMessage(step.message);
    if (messageText.length > 0) {
      const event = makeEvent(
        stepRel,
        agentName,
        trackForMessage(step.source),
        messageText,
        messageDurationSec,
        0.6,
        Object.assign({}, stepRawSummary, { kind: "message" }),
        {
          turnIndex: stepTurnIndex,
          model: stepModel,
          tokenUsage: stepTokenUsage,
        },
      );
      events.push(event);
    }

    // 2. Reasoning event.
    if (typeof step.reasoning_content === "string" && step.reasoning_content.length > 0) {
      const event = makeEvent(
        stepRel,
        agentName,
        "reasoning",
        step.reasoning_content,
        0,
        0.4,
        Object.assign({}, stepRawSummary, { kind: "reasoning" }),
        {
          turnIndex: stepTurnIndex,
          model: stepModel,
        },
      );
      events.push(event);
    }

    // 3. Tool call events.
    // Build a quick lookup so each tool_call event can carry its observation
    // result text on `toolOutput`, mirroring how other inspectors render
    // tool_input. Without this, views that pair input/output on the same node
    // (e.g. GraphView) have nothing to show as the actual tool result.
    const observationBySourceId = new Map<string, string>();
    for (let resultIndex = 0; resultIndex < observationResults.length; resultIndex += 1) {
      const result = observationResults[resultIndex];
      if (typeof result.source_call_id === "string") {
        observationBySourceId.set(result.source_call_id, flattenMessage(result.content as AtifMessage));
      }
    }
    for (let toolIndex = 0; toolIndex < toolCalls.length; toolIndex += 1) {
      const toolCall = toolCalls[toolIndex];
      let argsString = "";
      if (toolCall.arguments != null) {
        if (typeof toolCall.arguments === "string") {
          argsString = toolCall.arguments;
        } else {
          try {
            argsString = JSON.stringify(toolCall.arguments);
          } catch (err) {
            argsString = "[unserializable arguments]";
          }
        }
      }
      const text = (toolCall.function_name || "tool") + (argsString ? ": " + argsString : "");
      const toolOutput = typeof toolCall.tool_call_id === "string"
        ? observationBySourceId.get(toolCall.tool_call_id)
        : undefined;
      const event = makeEvent(
        stepRel,
        agentName,
        "tool_call",
        text,
        readDurationSec(toolCall),
        0.7,
        Object.assign({}, stepRawSummary, { kind: "tool_call", toolCall }),
        {
          turnIndex: stepTurnIndex,
          model: stepModel,
          toolName: toolCall.function_name,
          toolInput: toolCall.arguments,
          toolCallId: typeof toolCall.tool_call_id === "string" ? toolCall.tool_call_id : null,
          toolOutput: toolOutput != null ? toolOutput : null,
        },
      );
      events.push(event);
    }

    // 4. Observation events.
    for (let resultIndex = 0; resultIndex < observationResults.length; resultIndex += 1) {
      const result = observationResults[resultIndex];
      const content = flattenMessage(result.content as AtifMessage);
      const isError = ERROR_RE.test(content) || EXIT_CODE_RE.test(content);
      const subagentRefs = Array.isArray(result.subagent_trajectory_ref)
        ? result.subagent_trajectory_ref
        : null;
      const event = makeEvent(
        stepRel,
        agentName,
        "context",
        content,
        readDurationSec(result),
        0.5,
        Object.assign({}, stepRawSummary, {
          kind: "observation",
          result,
          subagentTrajectoryRefs: subagentRefs,
        }),
        {
          turnIndex: stepTurnIndex,
          model: stepModel,
          parentToolCallId: typeof result.source_call_id === "string" ? result.source_call_id : null,
          isError,
        },
      );
      events.push(event);
    }
  }

  if (currentTurn) turns.push(currentTurn);

  // Assign events to turns and update turn aggregates.
  if (turns.length === 0) {
    // No user step found: synthesise a single catch-all turn.
    turns.push({
      index: 0,
      startTime: events.length > 0 ? events[0].t : 0,
      endTime: 0,
      eventIndices: [],
      userMessage: "(no user message)",
      toolCount: 0,
      hasError: false,
    });
  }

  for (let eventIndex = 0; eventIndex < events.length; eventIndex += 1) {
    const event = events[eventIndex];
    let assignedTurn: SessionTurn | null = null;
    const explicitTurnIndex = typeof event.turnIndex === "number" ? event.turnIndex : -1;
    if (explicitTurnIndex >= 0 && explicitTurnIndex < turns.length) {
      assignedTurn = turns[explicitTurnIndex];
    } else {
      for (let turnIndex = turns.length - 1; turnIndex >= 0; turnIndex -= 1) {
        if (event.t >= turns[turnIndex].startTime) {
          assignedTurn = turns[turnIndex];
          break;
        }
      }
    }
    if (!assignedTurn) assignedTurn = turns[0];

    event.turnIndex = assignedTurn.index;
    assignedTurn.eventIndices.push(eventIndex);
    const rawRecord = event.raw as Record<string, unknown> | undefined;
    const eventCopied = Boolean(rawRecord && rawRecord.isCopiedContext);
    if (event.track === "tool_call" && !eventCopied) {
      assignedTurn.toolCount = (assignedTurn.toolCount || 0) + 1;
    }
    if (event.isError) assignedTurn.hasError = true;
    if (assignedTurn.endTime < event.t + event.duration) {
      assignedTurn.endTime = event.t + event.duration;
    }
  }

  // Aggregate models and totals from events.
  const models: Record<string, number> = {};
  let totalToolCalls = 0;
  let errorCount = 0;
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    const rawRecord = event.raw as Record<string, unknown> | undefined;
    const copied = Boolean(rawRecord && rawRecord.isCopiedContext);
    if (event.track === "tool_call" && !copied) totalToolCalls += 1;
    if (event.isError) errorCount += 1;
    if (event.model) models[event.model] = (models[event.model] || 0) + 1;
  }

  // Token usage prefers final_metrics field by field, falling back to per-step metrics for omitted totals.
  const finalMetrics = trajectory.final_metrics;
  let stepInput = 0;
  let stepOutput = 0;
  let stepCacheRead = 0;
  for (let index = 0; index < steps.length; index += 1) {
    const metrics = steps[index].metrics;
    if (!metrics) continue;
    stepInput += metrics.prompt_tokens || 0;
    stepOutput += metrics.completion_tokens || 0;
    stepCacheRead += metrics.cached_tokens || 0;
  }

  let totalInput = 0;
  let totalOutput = 0;
  let totalCacheRead = 0;
  let totalCostUsd = 0;
  let anyCost = false;
  if (finalMetrics) {
    totalInput = typeof finalMetrics.total_prompt_tokens === "number" ? finalMetrics.total_prompt_tokens : stepInput;
    totalOutput = typeof finalMetrics.total_completion_tokens === "number" ? finalMetrics.total_completion_tokens : stepOutput;
    totalCacheRead = typeof finalMetrics.total_cached_tokens === "number" ? finalMetrics.total_cached_tokens : stepCacheRead;
    if (typeof finalMetrics.total_cost_usd === "number") {
      totalCostUsd = finalMetrics.total_cost_usd;
      anyCost = true;
    }
  } else {
    totalInput = stepInput;
    totalOutput = stepOutput;
    totalCacheRead = stepCacheRead;
  }
  if (!anyCost) {
    for (let index = 0; index < steps.length; index += 1) {
      const metrics = steps[index].metrics;
      if (metrics && typeof metrics.cost_usd === "number") {
        totalCostUsd += metrics.cost_usd;
        anyCost = true;
      }
    }
  }

  // Per-model token breakdown, mirroring copilotCliParser.metadata.modelTokenUsage.
  // StatsView reads this to compute per-model estimated cost.
  const modelTokenUsage: Record<string, { inputTokens: number; outputTokens: number; cacheRead: number; cacheWrite: number; cacheHitRate?: number }> = {};
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    const metrics = step.metrics;
    if (!metrics) continue;
    const model = step.model_name || trajectory.agent.model_name;
    if (!model) continue;
    const input = metrics.prompt_tokens || 0;
    const output = metrics.completion_tokens || 0;
    const cacheRead = metrics.cached_tokens || 0;
    if (input + output + cacheRead === 0) continue;
    if (!modelTokenUsage[model]) {
      modelTokenUsage[model] = { inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheWrite: 0 };
    }
    modelTokenUsage[model].inputTokens += input;
    modelTokenUsage[model].outputTokens += output;
    modelTokenUsage[model].cacheRead += cacheRead;
  }
  for (const model of Object.keys(modelTokenUsage)) {
    const usage = modelTokenUsage[model];
    usage.cacheHitRate = computeCacheHitRate(usage.inputTokens, usage.cacheWrite, usage.cacheRead);
  }
  const hasModelTokenUsage = Object.keys(modelTokenUsage).length > 0;

  const tokenUsage: TokenUsage | null = (totalInput + totalOutput + totalCacheRead) > 0
    ? {
      inputTokens: totalInput,
      outputTokens: totalOutput,
      cacheRead: totalCacheRead,
      cacheWrite: 0,
      cacheHitRate: computeCacheHitRate(totalInput, 0, totalCacheRead),
    }
    : null;

  const duration = getSessionTotal(events);

  const primaryModel = trajectory.agent.model_name || (Object.keys(models)[0] ?? null);

  const metadata: SessionMetadata = {
    totalEvents: events.length,
    totalTurns: turns.length,
    totalToolCalls,
    errorCount,
    duration,
    models,
    primaryModel: primaryModel || null,
    tokenUsage,
    warnings,
    parseIssues: { malformedLines: 0, invalidEvents: 0 },
    format: "atif",
    sessionId: trajectory.session_id || null,
    schemaVersion: trajectory.schema_version || null,
    agent: trajectory.agent,
    continuationRef: trajectory.continued_trajectory_ref || null,
  };

  if (hasModelTokenUsage) {
    metadata.modelTokenUsage = modelTokenUsage;
  }

  if (anyCost) {
    metadata.totalCost = totalCostUsd;
  }

  if (typeof trajectory.notes === "string" && trajectory.notes.length > 0) {
    metadata.customTitle = trajectory.notes;
  }

  return { events, turns, metadata };
}
