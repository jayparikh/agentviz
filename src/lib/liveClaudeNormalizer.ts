import { claudeLive as helpers } from "./parser";
import { computeCacheHitRate } from "./cacheMetrics";
import { EventIndex, ToolResultIndex, buildUserTurns, type LiveNormalizer, type RawRecord } from "./liveNormalization";
import type { NormalizedEvent, ParsedSession, SessionTurn, TokenUsage } from "./sessionTypes";

export class LiveClaudeNormalizer implements LiveNormalizer {
  private index = new EventIndex();
  private pairs = new ToolResultIndex(this.index);
  private originals: NormalizedEvent[] = [];
  private turns: SessionTurn[] = [];
  private recordCount = 0;
  private timestampCount = 0;
  private syntheticTime = 0;
  private minimum = Infinity;
  private realMinimum = Infinity;
  private origin = Infinity;
  private realTimestamps = false;
  private usage = new Map<string, TokenUsage>();
  private firstUsageEvent = new Map<string, number>();
  private attached = new Set<string>();
  private identity: string | undefined;
  private issues = { malformedLines: 0, invalidEvents: 0 };
  get work() { return this.index.work; }

  append(records: RawRecord[], malformedLines: number): ParsedSession | null {
    const index = this.index;
    index.begin(records.length);
    const start = this.originals.length;
    const usageChanged = new Set<number>();
    for (const record of records) {
      this.recordCount++;
      if (helpers.extractTimestamp(record) !== null) this.timestampCount++;
      if (!this.identity && typeof record.sessionId === "string" && record.sessionId) this.identity = record.sessionId;
      const key = helpers.getUsageDedupKey(record);
      const usage = helpers.extractUsage(record);
      if (key && usage) this.usage.set(key, helpers.mergeTokenUsage(this.usage.get(key), usage));
      const events = helpers.extractEventsFromRecord(record, this.syntheticTime, this.issues, this.usage, this.attached);
      this.syntheticTime += Math.max(1, events.length);
      if (key && events.length && !this.firstUsageEvent.has(key)) this.firstUsageEvent.set(key, this.originals.length);
      if (key && this.usage.has(key) && this.firstUsageEvent.has(key)) {
        const first = this.firstUsageEvent.get(key)!;
        const event = first < this.originals.length ? this.originals[first] : events[0];
        event.tokenUsage = this.usage.get(key);
        if (first < this.originals.length) {
          // Usage may arrive after an earlier content record with the same id.
          for (const next of events) delete next.tokenUsage;
          usageChanged.add(first);
        }
        this.attached.add(key);
      }
      for (const event of events) {
        this.minimum = Math.min(this.minimum, event.t);
        if (event.t > 1e9) this.realMinimum = Math.min(this.realMinimum, event.t);
        this.originals.push(event);
      }
    }
    this.issues.malformedLines = malformedLines;
    if (!this.originals.length) return null;
    const real = this.timestampCount > this.recordCount * 0.5;
    const origin = real && this.realMinimum !== Infinity ? this.realMinimum : this.minimum;
    const rebase = origin !== this.origin || real !== this.realTimestamps;
    this.origin = origin;
    this.realTimestamps = real;
    const changedFrom = rebase ? 0 : Math.max(0, start - 1);
    for (let i = changedFrom; i < this.originals.length; i++) {
      const original = this.originals[i];
      const event = { ...original, t: Math.max(0, original.t - origin) };
      if (real && i + 1 < this.originals.length) {
        const gap = Math.max(0, this.originals[i + 1].t - origin) - event.t;
        if (gap >= 0.1 && gap < 300) event.duration = gap;
      }
      if (i < start) event.turnIndex = index.events[i]?.turnIndex;
      index.set(i, event);
    }
    for (const i of usageChanged) {
      if (i < changedFrom) index.set(i, { ...index.events[i], tokenUsage: this.originals[i].tokenUsage });
    }
    if (rebase) {
      this.turns = [];
      buildUserTurns(index, this.turns, 0, false);
    } else {
      if (start > 0) {
        const previous = index.events[start - 1];
        this.turns[previous.turnIndex!].endTime = previous.t + previous.duration;
        index.work.turns++;
      }
      buildUserTurns(index, this.turns, start, false);
    }
    // Re-normalizing a boundary event clears its paired output as well.
    for (let i = changedFrom; i < index.events.length; i++) this.pairs.add(i);
    const usage = index.usage;
    const metadata = {
      ...index.summary(this.turns),
      tokenUsage: usage.inputTokens + usage.outputTokens + usage.cacheRead + usage.cacheWrite > 0
        ? { ...usage, cacheHitRate: computeCacheHitRate(usage.inputTokens, usage.cacheWrite, usage.cacheRead) } : null,
      warnings: helpers.buildWarnings(this.issues),
      parseIssues: { ...this.issues }, format: "claude-code" as const,
      ...(this.identity ? { sessionId: this.identity } : {}),
    };
    return { events: index.events, turns: this.turns, metadata };
  }
}
