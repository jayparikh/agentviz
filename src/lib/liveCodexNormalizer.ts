import { codexLive as helpers } from "./codexParser";
import {
  EventIndex, NumericIndex, ToolResultIndex, buildUserTurns, lowerBound, upperBound,
  type LiveNormalizer, type RawRecord,
} from "./liveNormalization";
import type { NormalizedEvent, ParsedSession, SessionTurn } from "./sessionTypes";

type State = Parameters<typeof helpers.updateTurnContext>[1];
type Slot = { event: NormalizedEvent; ordinal: number; position: number };
type Bucket = {
  id: string; ordinal: number; turn: SessionTurn; ends: NumericIndex;
  users: NumericIndex; errors: number; active: boolean;
};

export class LiveCodexNormalizer implements LiveNormalizer {
  private index = new EventIndex();
  private contexts = new EventIndex();
  private contextPositions = new Map<string, number>();
  private state: State = { currentTurnId: null, currentModel: null, turnContexts: {}, turns: {}, turnCount: 0 };
  private slots: Slot[] = [];
  private syntheticTime = 0;
  private origin = Infinity;
  private nextOrdinal = 0;
  private meta: RawRecord | undefined;
  private token: RawRecord | undefined;
  private buckets = new Map<string, Bucket>();
  private boundaries: Bucket[] = [];
  private turns: SessionTurn[] = [];
  private owners: (Bucket | undefined)[] = [];
  private unresolved: number[] = [];
  private byTurnId = new Map<string, Set<number>>();
  private webCalls: Slot[] = [];
  private webByQuery = new Map<string, Slot[]>();
  private webBarrier = -1;
  private pendingTurns = new Set<string>();
  private turnOrder = new Map<string, number>();
  private pairs = new ToolResultIndex(this.index);
  get work() { return this.index.work; }

  private target(event: NormalizedEvent): Bucket {
    const explicit = typeof event.codexTurnId === "string" ? this.buckets.get(event.codexTurnId) : undefined;
    if (explicit) return explicit;
    return this.boundaries[Math.max(0, upperBound(this.boundaries, event.t, boundary => boundary.turn.startTime) - 1)];
  }

  private refresh(bucket: Bucket): void {
    const lifecycle = this.state.turns[bucket.id];
    const context = this.state.turnContexts[bucket.id];
    const start = Math.max(0, lifecycle.startTime - this.origin);
    const end = lifecycle.endTime === null ? start : Math.max(start, lifecycle.endTime - this.origin);
    const turn = bucket.turn;
    turn.startTime = start;
    turn.endTime = Math.max(end, bucket.ends.max);
    turn.userMessage = lifecycle.userMessage || context?.summary || "(continuation)";
    if (turn.userMessage === "(continuation)" && bucket.users.max !== -Infinity) {
      turn.userMessage = this.index.events[-bucket.users.max].text;
    }
    turn.model = context?.model || null;
    turn.effort = context?.effort || null;
    turn.hasError = bucket.errors > 0;
    this.index.work.turns++;
  }
  private remove(position: number): void {
    const bucket = this.owners[position];
    const event = this.index.events[position];
    if (bucket) {
      const list = bucket.turn.eventIndices;
      const offset = lowerBound(list, position, n => n);
      if (list[offset] === position) list.splice(offset, 1);
      bucket.ends.set(position, -Infinity);
      bucket.users.set(position, -Infinity);
      if (event.track === "tool_call") bucket.turn.toolCount!--;
      if (event.isError) bucket.errors--;
    }
    if (typeof event.codexTurnId === "string") this.byTurnId.get(event.codexTurnId)?.delete(position);
    const offset = lowerBound(this.unresolved, position, n => n);
    if (this.unresolved[offset] === position) this.unresolved.splice(offset, 1);
    this.owners[position] = undefined;
  }
  private assign(position: number, dirty: Set<Bucket>): void {
    const event = this.index.events[position];
    const bucket = this.target(event);
    this.owners[position] = bucket;
    const indices = bucket.turn.eventIndices;
    indices.splice(lowerBound(indices, position, n => n), 0, position);
    bucket.ends.set(position, event.t + event.duration);
    if (event.agent === "user") bucket.users.set(position, -position);
    if (event.track === "tool_call") bucket.turn.toolCount!++;
    if (event.isError) bucket.errors++;
    if (typeof event.codexTurnId === "string") {
      if (!this.byTurnId.has(event.codexTurnId)) this.byTurnId.set(event.codexTurnId, new Set());
      this.byTurnId.get(event.codexTurnId)!.add(position);
    }
    if (typeof event.codexTurnId !== "string" || !this.buckets.has(event.codexTurnId)) {
      this.unresolved.splice(lowerBound(this.unresolved, position, n => n), 0, position);
    }
    dirty.add(bucket);
    event.turnIndex = bucket.turn.index;
    this.index.work.turns++;
  }

  append(records: RawRecord[], malformedLines: number): ParsedSession | null {
    const index = this.index;
    index.begin(records.length);
    const additions: Slot[] = [];
    const changedTurns = this.pendingTurns;
    const newBuckets: Bucket[] = [];
    const changedCalls = new Set<Slot>();
    const hadLifecycle = this.buckets.size > 0;
    for (const record of records) {
      const payload = record.payload || {};
      if (!this.meta && record.type === "session_meta" && helpers.isRecord(record.payload)) this.meta = record;
      if (record.type === "event_msg" && payload.type === "token_count" && helpers.isRecord(payload.info?.total_token_usage)) this.token = record;
      const time = helpers.getEventTime(record, this.syntheticTime++);
      const events: NormalizedEvent[] = [];
      if (record.type === "turn_context") {
        helpers.updateTurnContext(record, this.state);
        if (typeof payload.turn_id === "string") {
          const id = payload.turn_id;
          changedTurns.add(id);
          if (!this.contextPositions.has(id)) this.contextPositions.set(id, this.contextPositions.size);
          this.contexts.set(this.contextPositions.get(id)!, {
            t: 0, duration: 0, agent: "system", track: "context", text: "", intensity: 0, isError: false,
            model: this.state.turnContexts[id].model,
          });
          index.work.events++;
        }
      } else if (record.type === "event_msg") {
        if (payload.type === "web_search_end") {
          if (payload.call_id) {
            const query = helpers.getWebSearchQuery(payload);
            const candidates = query ? this.webByQuery.get(query) || [] : this.webCalls;
            const slot = candidates[candidates.length - 1];
            if (slot && slot.ordinal > this.webBarrier) {
              slot.event.toolCallId = payload.call_id;
              this.webBarrier = slot.ordinal;
              changedCalls.add(slot);
            }
          }
          helpers.pushToolOutputEvent(events, record, this.state, time);
        } else {
          helpers.handleEventMessage(record, this.state, events, time);
        }
        const id = typeof payload.turn_id === "string" ? payload.turn_id : this.state.currentTurnId;
        if (id) changedTurns.add(id);
      } else if (record.type === "response_item" && helpers.isRecord(record.payload)) {
        if (payload.type === "message") helpers.pushMessageEvent(events, record, this.state, time);
        else if (payload.type === "reasoning") helpers.pushReasoningEvent(events, record, this.state, time);
        else if (["function_call", "custom_tool_call", "web_search_call"].includes(payload.type)) helpers.pushToolCallEvent(events, record, this.state, time);
        else if (["function_call_output", "custom_tool_call_output"].includes(payload.type)) helpers.pushToolOutputEvent(events, record, this.state, time);
        if (this.state.currentTurnId) changedTurns.add(this.state.currentTurnId);
      }
      for (const event of events) {
        const slot: Slot = { event, ordinal: this.nextOrdinal++, position: -1 };
        additions.push(slot);
        if (event.toolName === "web_search") {
          this.webCalls.push(slot);
          const query = helpers.getWebSearchQuery((event.raw as RawRecord).payload);
          if (!this.webByQuery.has(query)) this.webByQuery.set(query, []);
          this.webByQuery.get(query)!.push(slot);
          if (event.toolCallId) this.webBarrier = slot.ordinal;
        }
      }
      const touched = typeof payload.turn_id === "string" ? payload.turn_id : this.state.currentTurnId;
      if (touched && this.state.turns[touched] && !this.turnOrder.has(touched)) this.turnOrder.set(touched, this.turnOrder.size);
    }
    let insertion = this.slots.length;
    for (const slot of additions) {
      let low = 0;
      let high = this.slots.length;
      while (low < high) {
        const mid = (low + high) >>> 1;
        if (this.slots[mid].event.t <= slot.event.t) low = mid + 1;
        else high = mid;
      }
      this.slots.splice(low, 0, slot);
      insertion = Math.min(insertion, low);
    }
    if (!this.slots.length) return null;
    const origin = this.slots[0].event.t;
    const rebase = origin !== this.origin;
    this.origin = origin;
    if (rebase) {
      insertion = 0;
      for (const id of this.buckets.keys()) changedTurns.add(id);
    }
    const dirty = new Set<Bucket>();
    for (const id of changedTurns) {
      if (!this.state.turns[id]) continue;
      let bucket = this.buckets.get(id);
      if (!bucket) {
        bucket = {
          id, ordinal: this.turnOrder.get(id)!, active: false, ends: new NumericIndex(), users: new NumericIndex(), errors: 0,
          turn: { index: 0, startTime: 0, endTime: 0, eventIndices: [], toolCount: 0, hasError: false, turnId: id },
        };
        this.buckets.set(id, bucket);
        newBuckets.push(bucket);
      }
      this.refresh(bucket);
      dirty.add(bucket);
    }
    for (const bucket of newBuckets) {
      let position = lowerBound(this.boundaries, bucket.turn.startTime, item => item.turn.startTime);
      while (position < this.boundaries.length && this.boundaries[position].turn.startTime === bucket.turn.startTime
        && this.boundaries[position].ordinal < bucket.ordinal) position++;
      this.boundaries.splice(position, 0, bucket);
    }
    if (rebase) this.boundaries.sort((a, b) => a.turn.startTime - b.turn.startTime || a.ordinal - b.ordinal);
    if (!hadLifecycle && this.buckets.size) {
      insertion = 0;
      this.turns = [];
    }
    const previousLength = index.events.length;
    for (let i = previousLength - 1; i >= insertion; i--) {
      if (this.owners[i]) dirty.add(this.owners[i]!);
      this.pairs.remove(i);
      this.remove(i);
    }
    for (let i = insertion; i < this.slots.length; i++) {
      const slot = this.slots[i];
      slot.position = i;
      index.set(i, { ...slot.event, t: Math.max(0, slot.event.t - origin) });
      if (this.buckets.size) this.assign(i, dirty);
    }
    // A late lifecycle can capture earlier unbound events, without examining
    // already-resolved events belonging to unrelated turns.
    if (this.buckets.size && insertion > 0) {
      const reconsider = new Set<number>();
      for (const bucket of newBuckets) {
        for (const position of this.byTurnId.get(bucket.id) || []) if (position < insertion) reconsider.add(position);
        let boundary = lowerBound(this.boundaries, bucket.turn.startTime, item => item.turn.startTime);
        while (this.boundaries[boundary] !== bucket) boundary++;
        const first = boundary === 0 ? 0 : lowerBound(index.events, bucket.turn.startTime, event => event.t);
        const next = this.boundaries[boundary + 1]?.turn.startTime ?? Infinity;
        for (let j = lowerBound(this.unresolved, first, n => n); j < this.unresolved.length; j++) {
          const position = this.unresolved[j];
          if (position >= insertion || index.events[position].t >= next) break;
          reconsider.add(position);
        }
      }
      for (const position of reconsider) {
        if (this.target(index.events[position]) === this.owners[position]) continue;
        if (this.owners[position]) dirty.add(this.owners[position]!);
        this.remove(position);
        this.assign(position, dirty);
      }
    }
    if (this.buckets.size) {
      let renumber = this.turns.length;
      // Remove using the old stable indices before insertions can shift them.
      const inactive = [...dirty].filter(bucket => bucket.active && !bucket.turn.eventIndices.length)
        .sort((a, b) => b.turn.index - a.turn.index);
      for (const bucket of inactive) {
        const position = bucket.turn.index;
        this.turns.splice(position, 1);
        renumber = Math.min(renumber, position);
        bucket.active = false;
      }
      for (const bucket of dirty) {
        this.refresh(bucket);
        const active = bucket.turn.eventIndices.length > 0;
        if (active !== bucket.active) {
          if (active) {
            let position = lowerBound(this.turns, bucket.turn.startTime, turn => turn.startTime);
            while (position < this.turns.length && this.turns[position].startTime === bucket.turn.startTime
              && this.buckets.get(String(this.turns[position].turnId))!.ordinal < bucket.ordinal) position++;
            this.turns.splice(position, 0, bucket.turn);
            renumber = Math.min(renumber, position);
          }
          bucket.active = active;
        }
      }
      if (rebase) {
        this.turns.sort((a, b) => a.startTime - b.startTime || this.buckets.get(String(a.turnId))!.ordinal - this.buckets.get(String(b.turnId))!.ordinal);
        renumber = 0;
      }
      for (let i = renumber; i < this.turns.length; i++) {
        const turn = this.turns[i];
        turn.index = i;
        index.work.turns++;
        for (const position of turn.eventIndices) {
          index.events[position].turnIndex = i;
          index.work.events++;
        }
      }
      // Existing active turns do not need their old event indices revisited.
      for (let i = insertion; i < index.events.length; i++) index.events[i].turnIndex = this.owners[i]!.turn.index;
    } else {
      let from = insertion;
      if (insertion < previousLength) {
        let turn: SessionTurn | undefined;
        for (let i = this.turns.length - 1; i >= 0; i--) {
          index.work.turns++;
          if (this.turns[i].eventIndices[0] <= insertion) { turn = this.turns[i]; break; }
        }
        from = turn?.eventIndices[0] || 0;
        this.turns.length = turn?.index || 0;
        // The affected turn is rebuilt from its first event, not appended twice.
        if (from > 0) index.events[from - 1].turnIndex = this.turns.length - 1;
      }
      buildUserTurns(index, this.turns, from, true);
    }
    for (const slot of changedCalls) {
      if (slot.position < insertion) index.set(slot.position, { ...index.events[slot.position], toolCallId: slot.event.toolCallId });
    }
    const pairStart = insertion;
    for (let i = pairStart; i < index.events.length; i++) this.pairs.add(i);
    for (const slot of changedCalls) if (slot.position < pairStart) this.pairs.add(slot.position);
    const models = this.contexts.models;
    for (const [model, count] of Object.entries(index.models)) models[model] = (models[model] || 0) + count;
    const metadataRecords = [this.meta, this.token].filter((record): record is RawRecord => Boolean(record));
    const metadata = helpers.buildMetadata(metadataRecords, [], [], { ...this.state, turnContexts: {} }, malformedLines, [], {
      ...index.summary(this.turns), models,
    });
    metadata.totalEvents = index.events.length;
    metadata.totalTurns = this.turns.length;
    changedTurns.clear();
    return { events: index.events, turns: this.turns, metadata };
  }
}
