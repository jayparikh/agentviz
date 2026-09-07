import type { NormalizedEvent, ParsedSession, SessionTurn } from "./sessionTypes";

export type RawRecord = Record<string, any>;
export interface NormalizationWork {
  records: number;
  events: number;
  turns: number;
}
export interface LiveNormalizer {
  work: NormalizationWork;
  append(records: RawRecord[], malformedLines: number): ParsedSession | null;
}

// Sparse indexed maxima support replacements/decreases without rescanning history.
// The fixed 32-level address space also avoids periodic history-wide tree rebuilds.
export class NumericIndex {
  private nodes = new Map<number, number>();
  set(index: number, value: number): void {
    let key = 2 ** 32 + index;
    if (value === -Infinity) this.nodes.delete(key);
    else this.nodes.set(key, value);
    while (key > 1) {
      key = Math.floor(key / 2);
      const maximum = Math.max(this.nodes.get(key * 2) ?? -Infinity, this.nodes.get(key * 2 + 1) ?? -Infinity);
      if (maximum === -Infinity) this.nodes.delete(key);
      else this.nodes.set(key, maximum);
    }
  }
  get max(): number { return this.nodes.get(1) ?? -Infinity; }
}

export class EventIndex {
  events: NormalizedEvent[] = [];
  work: NormalizationWork = { records: 0, events: 0, turns: 0 };
  private ends = new NumericIndex();
  private modelPositions = new Map<string, { count: number; positions: NumericIndex }>();
  toolCount = 0;
  errorCount = 0;
  usage = { inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheWrite: 0 };

  begin(records: number): void { this.work = { records, events: 0, turns: 0 }; }

  private account(event: NormalizedEvent, index: number, sign: number): void {
    if (event.model) {
      let model = this.modelPositions.get(event.model);
      if (!model) {
        model = { count: 0, positions: new NumericIndex() };
        this.modelPositions.set(event.model, model);
      }
      model.count += sign;
      model.positions.set(index, sign > 0 ? -index : -Infinity);
    }
    if (event.track === "tool_call") this.toolCount += sign;
    if (event.isError) this.errorCount += sign;
    for (const key of ["inputTokens", "outputTokens", "cacheRead", "cacheWrite"] as const) {
      this.usage[key] += sign * (event.tokenUsage?.[key] || 0);
    }
  }

  set(index: number, event: NormalizedEvent): void {
    this.work.events++;
    const previous = this.events[index];
    if (previous) this.account(previous, index, -1);
    this.events[index] = event;
    this.account(event, index, 1);
    this.ends.set(index, event.t + event.duration);
  }

  truncate(length: number): void {
    for (let i = length; i < this.events.length; i++) {
      this.work.events++;
      this.account(this.events[i], i, -1);
      this.ends.set(i, -Infinity);
    }
    this.events.length = length;
  }

  get duration(): number { return Math.max(0, this.ends.max); }
  get models(): Record<string, number> {
    return Object.fromEntries([...this.modelPositions.entries()]
      .filter(([, value]) => value.count > 0)
      .sort((a, b) => b[1].positions.max - a[1].positions.max)
      .map(([name, value]) => [name, value.count]));
  }
  summary(turns: SessionTurn[]) {
    const models = this.models;
    return {
      totalEvents: this.events.length, totalTurns: turns.length,
      totalToolCalls: this.toolCount, errorCount: this.errorCount,
      duration: this.duration, models,
      primaryModel: Object.keys(models).sort((a, b) => models[b] - models[a])[0] || null,
    };
  }
}

export function lowerBound<T>(items: T[], value: number, key: (item: T) => number): number {
  let low = 0;
  let high = items.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (key(items[middle]) < value) low = middle + 1;
    else high = middle;
  }
  return low;
}

export function upperBound<T>(items: T[], value: number, key: (item: T) => number): number {
  let low = 0;
  let high = items.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (key(items[middle]) <= value) low = middle + 1;
    else high = middle;
  }
  return low;
}

// Rebuild only the invalidated suffix. Timestamp rebases, out-of-order insertion,
// and structural patches legitimately affect that suffix, unlike ordinary appends.
export function buildUserTurns(index: EventIndex, turns: SessionTurn[], start: number, maximumEnd: boolean): void {
  const events = index.events;
  let current = start > 0 ? turns[events[start - 1].turnIndex!] : undefined;
  if (current) turns.length = current.index + 1;
  else turns.length = 0;
  for (let i = start; i < events.length; i++) {
    const event = events[i];
    index.work.turns++;
    if (!current || event.agent === "user") {
      current = {
        index: turns.length, startTime: event.t, endTime: event.t + event.duration,
        eventIndices: [], userMessage: event.agent === "user" ? event.text : "(system)",
        toolCount: 0, hasError: false,
      };
      turns.push(current);
    }
    event.turnIndex = current.index;
    current.eventIndices.push(i);
    current.endTime = maximumEnd ? Math.max(current.endTime, event.t + event.duration) : event.t + event.duration;
    if (event.track === "tool_call") current.toolCount = (current.toolCount || 0) + 1;
    if (event.isError) current.hasError = true;
  }
}

function resultId(event: NormalizedEvent): string | undefined {
  const raw = event.raw as RawRecord | undefined;
  const candidates = raw
    ? [event.toolCallId, raw.tool_use_id, raw.toolCallId, raw.tool_call_id, raw.source_call_id, raw.call_id, raw.payload?.call_id]
    : [event.toolCallId];
  return candidates.find(id => typeof id === "string" && id.length > 0);
}

export class ToolResultIndex {
  private results = new Map<string, { positions: NumericIndex; text: Map<number, string> }>();
  private resultKeys = new Map<number, string>();
  private calls = new Map<string, Set<number>>();
  private candidates = new Map<number, { ids: string[]; original: NormalizedEvent }>();
  constructor(private index: EventIndex) {}
  remove(position: number): void {
    const candidate = this.candidates.get(position);
    if (candidate) {
      for (const id of candidate.ids) this.calls.get(id)?.delete(position);
      this.candidates.delete(position);
    }
    const id = this.resultKeys.get(position);
    if (id) {
      const result = this.results.get(id)!;
      result.positions.set(position, -Infinity);
      result.text.delete(position);
      this.resultKeys.delete(position);
      for (const call of this.calls.get(id) || []) this.pair(call);
    }
  }
  add(position: number): void {
    const event = this.index.events[position];
    this.index.work.events++;
    if (event.track === "context" && event.text) {
      const id = resultId(event);
      if (id) {
        if (!this.results.has(id)) this.results.set(id, { positions: new NumericIndex(), text: new Map() });
        const result = this.results.get(id)!;
        result.positions.set(position, position);
        result.text.set(position, event.text);
        this.resultKeys.set(position, id);
        for (const call of this.calls.get(id) || []) this.pair(call);
      }
    }
    if (event.track === "tool_call" && (!event.toolOutput || this.candidates.has(position))) {
      const raw = event.raw as RawRecord | undefined;
      const ids = [event.toolCallId, raw?.id, raw?.toolCallId, raw?.tool_call_id]
        .filter((id): id is string => typeof id === "string");
      this.candidates.set(position, { ids, original: this.candidates.get(position)?.original || event });
      for (const id of ids) {
        if (!this.calls.has(id)) this.calls.set(id, new Set());
        this.calls.get(id)!.add(position);
      }
      this.pair(position);
    }
  }
  private pair(position: number): void {
    const candidate = this.candidates.get(position);
    if (!candidate) return;
    let output = candidate.original.toolOutput;
    for (const id of candidate.ids) {
      const result = this.results.get(id);
      if (result && result.positions.max !== -Infinity) {
        output = result.text.get(result.positions.max);
        if (output) break;
      }
    }
    const event = this.index.events[position];
    if (event.toolOutput !== output) {
      const paired = { ...event, toolOutput: output };
      if (output === undefined && !("toolOutput" in candidate.original)) delete paired.toolOutput;
      this.index.set(position, paired);
    }
  }
}
