import { computeCacheHitRate } from "./cacheMetrics";
import type { NormalizedEvent, ParsedSession, SessionMetadata, SessionTurn, TokenUsage } from "./sessionTypes";

const MAX_DISPLAY_TEXT_LENGTH = 4000;

type AnyRecord = Record<string, any>;

type PromptCall = AnyRecord & {
  request?: AnyRecord;
  response?: AnyRecord;
};

function isRecord(value: unknown): value is AnyRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function parseJSON(text: string): unknown {
  try {
    return JSON.parse(text.trim());
  } catch {
    return null;
  }
}

function getCalls(value: unknown): PromptCall[] | null {
  if (Array.isArray(value)) return value.filter(isRecord) as PromptCall[];
  if (isRecord(value)) {
    if (Array.isArray(value.prompts)) return value.prompts.filter(isRecord) as PromptCall[];
    if (Array.isArray(value.calls)) return value.calls.filter(isRecord) as PromptCall[];
  }
  return null;
}

function isPromptCall(call: PromptCall): boolean {
  return isRecord(call.request)
    && Array.isArray(call.request.messages)
    && isRecord(call.response)
    && isRecord(call.response.usage);
}

export function detectCopilotPrompts(text: string): boolean {
  const parsed = parseJSON(text);
  const calls = getCalls(parsed);
  if (!calls || calls.length === 0) return false;
  return calls.some(isPromptCall);
}

function firstNumber(...values: unknown[]): number {
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, value);
    if (typeof value === "string" && value.trim() !== "") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return Math.max(0, parsed);
    }
  }
  return 0;
}

function normalizeContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map(function (part) {
      if (typeof part === "string") return part;
      if (!isRecord(part)) return "";
      if (typeof part.text === "string") return part.text;
      if (typeof part.content === "string") return part.content;
      if (typeof part.value === "string") return part.value;
      if (typeof part.name === "string") return part.name;
      return "";
    }).filter(Boolean).join("\n");
  }
  if (isRecord(content)) {
    if (typeof content.text === "string") return content.text;
    if (typeof content.content === "string") return content.content;
    if (typeof content.value === "string") return content.value;
  }
  return "";
}

function truncateForDisplay(text: string): string {
  if (text.length <= MAX_DISPLAY_TEXT_LENGTH) return text;
  const visibleLength = Math.max(MAX_DISPLAY_TEXT_LENGTH - 1, 0);
  if (visibleLength === 0) return "…";
  return text.slice(0, visibleLength) + "…";
}

function estimateTextTokens(text: string): number {
  if (!text) return 0;
  // Copilot prompt exports do not include per-message token counts. This is a rough
  // heuristic: the 4 chars/token estimate only sizes the context-composition visualization.
  // Billing totals always come from response.usage, and actual per-message counts
  // vary by tokenizer and content type.
  return Math.max(1, Math.ceil(text.length / 4));
}

function estimateJSONTokens(value: unknown): number {
  try {
    return estimateTextTokens(JSON.stringify(value || ""));
  } catch {
    return 0;
  }
}

function getToolName(tool: unknown): string {
  if (!isRecord(tool)) return "tool";
  if (typeof tool.name === "string" && tool.name) return tool.name;
  if (isRecord(tool.function) && typeof tool.function.name === "string" && tool.function.name) return tool.function.name;
  if (typeof tool.id === "string" && tool.id) return tool.id;
  if (typeof tool.type === "string" && tool.type) return tool.type;
  return "tool";
}

function getTools(request: AnyRecord): unknown[] {
  if (Array.isArray(request.tools)) return request.tools;
  if (Array.isArray(request.tool_definitions)) return request.tool_definitions;
  if (Array.isArray(request.toolDefinitions)) return request.toolDefinitions;
  return [];
}

function getModel(call: PromptCall): string | null {
  const request = call.request || {};
  const response = call.response || {};
  const model = response.model || request.model || request.modelId || call.model || call.modelId;
  return typeof model === "string" && model.trim() ? model : null;
}

function getMessageRole(message: unknown): string {
  if (!isRecord(message)) return "unknown";
  return typeof message.role === "string" ? message.role : "unknown";
}

function getMessageText(message: unknown): string {
  if (!isRecord(message)) return "";
  return normalizeContent(message.content || message.text || message.value);
}

function getLastUserMessage(messages: unknown[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (getMessageRole(message) !== "user") continue;
    const text = getMessageText(message).trim();
    if (text) return text;
  }
  return "LLM call";
}

function getUsage(usage: AnyRecord): TokenUsage | null {
  const promptDetails = isRecord(usage.prompt_tokens_details) ? usage.prompt_tokens_details : {};
  const inputDetails = isRecord(usage.input_tokens_details) ? usage.input_tokens_details : {};
  const outputDetails = isRecord(usage.output_tokens_details) ? usage.output_tokens_details : {};
  const rawInput = firstNumber(
    usage.input_tokens,
    usage.prompt_tokens,
    usage.inputTokens,
    usage.promptTokens,
    usage.total_input_tokens,
  );
  const outputTokens = firstNumber(
    usage.output_tokens,
    usage.completion_tokens,
    usage.outputTokens,
    usage.completionTokens,
    usage.total_output_tokens,
  );
  const cacheRead = firstNumber(
    usage.cache_read_input_tokens,
    usage.cache_read_tokens,
    usage.cached_input_tokens,
    usage.cacheRead,
    promptDetails.cached_tokens,
    inputDetails.cached_tokens,
  );
  const cacheWrite = firstNumber(
    inputDetails.cache_write_tokens,
    promptDetails.cache_write_tokens,
    usage.cache_creation_input_tokens,
    usage.cache_write_input_tokens,
    usage.cache_write_tokens,
    usage.cacheWrite,
    inputDetails.cache_creation_tokens,
    outputDetails.cache_creation_tokens,
  );
  if (rawInput + outputTokens + cacheRead + cacheWrite === 0) return null;
  return {
    inputTokens: rawInput,
    outputTokens,
    cacheRead,
    cacheWrite,
    cacheWriteReported: [
      inputDetails.cache_write_tokens, promptDetails.cache_write_tokens,
      usage.cache_creation_input_tokens, usage.cache_write_input_tokens,
      usage.cache_write_tokens, usage.cacheWrite, inputDetails.cache_creation_tokens,
      outputDetails.cache_creation_tokens,
    ].some(value => value != null),
    cacheHitRate: computeCacheHitRate(rawInput, cacheWrite, cacheRead),
  };
}

function buildContextBreakdown(messages: unknown[], tools: unknown[]): AnyRecord {
  const breakdown = {
    system: 0,
    tools: estimateJSONTokens(tools),
    history: 0,
    toolResults: 0,
    user: 0,
    total: 0,
  };

  const lastUserIndex = messages.reduce(function (lastIndex, message, index) {
    return getMessageRole(message) === "user" ? index : lastIndex;
  }, -1);

  for (let index = 0; index < messages.length; index += 1) {
    const role = getMessageRole(messages[index]);
    const tokens = estimateTextTokens(getMessageText(messages[index]));
    if (role === "system" || role === "developer") breakdown.system += tokens;
    else if (role === "tool") breakdown.toolResults += tokens;
    else if (role === "user" && index === lastUserIndex) breakdown.user += tokens;
    else breakdown.history += tokens;
  }

  breakdown.total = breakdown.system + breakdown.tools + breakdown.history + breakdown.toolResults + breakdown.user;
  return breakdown;
}

function makeEvent(index: number, call: PromptCall): NormalizedEvent | null {
  if (!call.request || !call.response || !call.response.usage) return null;
  const messages = Array.isArray(call.request.messages) ? call.request.messages : [];
  const tools = getTools(call.request);
  const usage = getUsage(call.response.usage);
  const model = getModel(call);
  const userText = getLastUserMessage(messages);
  const contextBreakdown = buildContextBreakdown(messages, tools);
  return {
    t: index,
    agent: "user",
    track: "output",
    text: truncateForDisplay(userText),
    duration: 1,
    intensity: usage ? Math.min(1, Math.max(0.25, ((usage.inputTokens || 0) + (usage.outputTokens || 0)) / 100000)) : 0.4,
    raw: {
      copilotPrompt: call,
      costPrompt: {
        index,
        messages,
        tools,
        toolNames: tools.map(getToolName),
        contextBreakdown,
      },
    },
    turnIndex: index,
    isError: false,
    model,
    tokenUsage: usage,
    pricingContext: {
      provider: "copilot",
      ...(typeof call.response.service_tier === "string" ? { serviceTier: call.response.service_tier } : {}),
    },
  };
}

function buildMetadata(events: NormalizedEvent[], calls: PromptCall[]): SessionMetadata {
  const models: Record<string, number> = {};
  const modelTokenUsage: Record<string, { inputTokens: number; outputTokens: number; cacheRead: number; cacheWrite: number; cacheHitRate?: number }> = {};
  let totalInput = 0;
  let totalOutput = 0;
  let totalCacheRead = 0;
  let totalCacheWrite = 0;

  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    const model = event.model || "unknown";
    models[model] = (models[model] || 0) + 1;
    if (!event.tokenUsage) continue;
    const usage = event.tokenUsage;
    totalInput += usage.inputTokens || 0;
    totalOutput += usage.outputTokens || 0;
    totalCacheRead += usage.cacheRead || 0;
    totalCacheWrite += usage.cacheWrite || 0;
    if (!modelTokenUsage[model]) modelTokenUsage[model] = { inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheWrite: 0 };
    modelTokenUsage[model].inputTokens += usage.inputTokens || 0;
    modelTokenUsage[model].outputTokens += usage.outputTokens || 0;
    modelTokenUsage[model].cacheRead += usage.cacheRead || 0;
    modelTokenUsage[model].cacheWrite += usage.cacheWrite || 0;
  }

  Object.keys(modelTokenUsage).forEach(function (model) {
    const usage = modelTokenUsage[model];
    usage.cacheHitRate = computeCacheHitRate(usage.inputTokens, usage.cacheWrite, usage.cacheRead);
  });

  const modelEntries = Object.entries(models).sort(function (a, b) { return b[1] - a[1]; });
  const tokenUsage = totalInput + totalOutput + totalCacheRead + totalCacheWrite > 0
    ? {
      inputTokens: totalInput,
      outputTokens: totalOutput,
      cacheRead: totalCacheRead,
      cacheWrite: totalCacheWrite,
      cacheHitRate: computeCacheHitRate(totalInput, totalCacheWrite, totalCacheRead),
    }
    : null;

  return {
    totalEvents: events.length,
    totalTurns: events.length,
    totalToolCalls: 0,
    errorCount: 0,
    duration: events.length > 0 ? events.length : 0,
    models,
    primaryModel: modelEntries.length > 0 ? modelEntries[0][0] : null,
    tokenUsage,
    modelTokenUsage,
    format: "copilot-prompts",
    customTitle: "Copilot prompt cost analysis",
    promptCallCount: calls.length,
  };
}

export function parseCopilotPromptsJSON(text: string): ParsedSession | null {
  const parsed = parseJSON(text);
  const calls = getCalls(parsed);
  if (!calls || calls.length === 0) return null;

  const promptCalls = calls.filter(isPromptCall);
  if (promptCalls.length === 0) return null;

  const events: NormalizedEvent[] = [];
  for (let index = 0; index < promptCalls.length; index += 1) {
    const event = makeEvent(index, promptCalls[index]);
    if (event) events.push(event);
  }
  if (events.length === 0) return null;

  const turns: SessionTurn[] = events.map(function (event, index) {
    return {
      index,
      startTime: event.t,
      endTime: event.t + event.duration,
      eventIndices: [index],
      userMessage: event.text,
      toolCount: 0,
      hasError: false,
    };
  });

  return { events, turns, metadata: buildMetadata(events, promptCalls) };
}
