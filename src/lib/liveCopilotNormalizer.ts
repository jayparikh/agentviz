import { copilotLive as helpers } from "./copilotCliParser";
import { EventIndex, NumericIndex, lowerBound, upperBound, type LiveNormalizer, type RawRecord } from "./liveNormalization";
import type { NormalizedEvent, ParsedSession, SessionTurn } from "./sessionTypes";

type Node = { record: RawRecord; positions: number[]; ordinal: number };
type Slot = { node: Node; offset: number; event: NormalizedEvent };
type Turn = { value: SessionTurn; ends: NumericIndex; errors: number; end: number };

export class LiveCopilotNormalizer implements LiveNormalizer {
  private index = new EventIndex();
  private nodes: Node[] = [];
  private slots: Slot[] = [];
  private dependencies = new Map<string, Set<Node>>();
  private completes: Record<string, RawRecord> = Object.create(null);
  private retained = {
    taskToolMap: Object.create(null), subagentStartTimes: Object.create(null), subagentLifecycle: Object.create(null),
  };
  private seenStarts = new Set<string>();
  private start: number | null = null;
  private foundStart = false;
  private firstTimestamp = 0;
  private info: Record<string, RawRecord> = {};
  private turns: Turn[] = [];
  private turnValues: SessionTurn[] = [];
  private boundaries: { t: number; ordinal: number; winner: number }[] = [];
  private lastUser: string | null = null;
  private effortChanges: { t: number; effort: string }[] = [];
  private effortHistory = new Set<string>();
  private currentEffort: string | null = null;
  private hasInitialEffort = false;
  get work() { return this.index.work; }

  private depend(id: unknown, node: Node): void {
    if (typeof id !== "string") return;
    if (!this.dependencies.has(id)) this.dependencies.set(id, new Set());
    this.dependencies.get(id)!.add(node);
  }
  private effort(t: number): string | undefined {
    return this.effortChanges[upperBound(this.effortChanges, t, change => change.t) - 1]?.effort;
  }
  private owner(t: number): number {
    return this.boundaries[upperBound(this.boundaries, t, boundary => boundary.t) - 1]?.winner ?? (this.turns.length ? 0 : -1);
  }
  private remove(i: number, event: NormalizedEvent): void {
    const turn = this.turns[event.turnIndex!];
    if (!turn || !turn.value.eventIndices.length) return;
    const position = lowerBound(turn.value.eventIndices, i, n => n);
    if (turn.value.eventIndices[position] !== i) return;
    turn.value.eventIndices.splice(position, 1);
    turn.ends.set(i, -Infinity);
    if (event.track === "tool_call") turn.value.toolCount!--;
    if (event.isError) turn.errors--;
    turn.value.hasError = turn.errors > 0;
    turn.value.endTime = Math.max(turn.end, turn.ends.max);
    this.index.work.turns++;
  }
  private assign(i: number): void {
    const event = this.index.events[i];
    const owner = this.owner(event.t);
    event.turnIndex = Math.max(0, owner);
    if (owner < 0) return;
    const turn = this.turns[owner];
    const position = lowerBound(turn.value.eventIndices, i, n => n);
    turn.value.eventIndices.splice(position, 0, i);
    turn.ends.set(i, event.t + event.duration);
    if (event.track === "tool_call") turn.value.toolCount!++;
    if (event.isError) turn.errors++;
    turn.value.hasError = turn.errors > 0;
    turn.value.endTime = Math.max(turn.end, turn.ends.max);
    this.index.work.turns++;
  }

  private replace(position: number, event: NormalizedEvent): void {
    const previous = this.index.events[position];
    const owner = this.owner(event.t);
    const indices = this.turns[owner]?.value.eventIndices;
    const assigned = indices && indices[lowerBound(indices, position, i => i)] === position;
    if (owner >= 0 && previous.turnIndex === owner && assigned) {
      const turn = this.turns[owner];
      turn.ends.set(position, event.t + event.duration);
      turn.value.toolCount! += Number(event.track === "tool_call") - Number(previous.track === "tool_call");
      turn.errors += Number(event.isError) - Number(previous.isError);
      turn.value.hasError = turn.errors > 0;
      turn.value.endTime = Math.max(turn.end, turn.ends.max);
      event.turnIndex = owner;
      this.index.set(position, event);
      this.index.work.turns++;
    } else if (owner < 0) {
      this.index.set(position, event);
    } else {
      this.remove(position, previous);
      this.index.set(position, event);
      this.assign(position);
    }
  }

  append(records: RawRecord[], malformedLines: number): ParsedSession | null {
    const index = this.index;
    index.begin(records.length);
    const dirty = new Set<Node>();
    const added: Node[] = [];
    let effortFrom = Infinity;
    let turnFrom = Infinity;
    let rebase = false;
    const mark = (id: unknown) => { for (const node of this.dependencies.get(String(id)) || []) dirty.add(node); };
    for (const record of records) {
      const data = record.data || {};
      if (!this.nodes.length) this.firstTimestamp = helpers.parseTimestamp(record.timestamp) || 0;
      const candidate = record.type === "session.start" ? data.startTime : record.type === "session.resume" ? data.resumeTime : null;
      if (!this.foundStart && candidate) {
        const next = helpers.parseTimestamp(candidate) ?? this.firstTimestamp;
        rebase ||= this.start !== null && next !== this.start;
        this.start = next;
        this.foundStart = true;
      }
      this.start ??= this.firstTimestamp;
      if (["session.start", "session.resume", "session.shutdown"].includes(record.type)) this.info[record.type] = record;
      const node: Node = { record, positions: [], ordinal: this.nodes.length };
      this.nodes.push(node);
      added.push(node);
      if (record.type === "tool.execution_complete" && data.toolCallId) {
        this.completes[data.toolCallId] = record;
        mark(data.toolCallId);
      }
      if (record.type === "tool.execution_start" && data.toolName === "task") {
        const args = data.arguments || {};
        this.retained.taskToolMap[data.toolCallId] = { agentType: args.agent_type || "task", description: args.description || args.name || "" };
        mark(data.toolCallId);
      }
      if (record.type === "subagent.started") {
        const timestamp = helpers.parseTimestamp(record.timestamp);
        if (data.toolCallId && timestamp !== null) this.retained.subagentStartTimes[data.toolCallId] = timestamp;
        this.retained.subagentLifecycle[data.toolCallId || ""] = {
          agentName: data.agentName || data.agentType, agentDisplayName: data.agentDisplayName || data.agentName,
        };
        mark(data.toolCallId || "");
      }
      this.depend(data.toolCallId, node);
      this.depend(data.parentToolCallId, node);
      for (const request of Array.isArray(data.toolRequests) ? data.toolRequests : []) this.depend(request.toolCallId, node);

      if (record.type === "user.message") this.lastUser = data.content || "";
      if (record.type === "assistant.turn_start") {
        const t = helpers.parseTimestamp(record.timestamp);
        const start = t ? t - this.start : 0;
        const ordinal = this.turns.length;
        this.turns.push({
          value: { index: ordinal, startTime: start, endTime: 0, eventIndices: [], userMessage: this.lastUser || "(continuation)", toolCount: 0, hasError: false },
          ends: new NumericIndex(), errors: 0, end: 0,
        });
        this.turnValues.push(this.turns[ordinal].value);
        this.lastUser = null;
        const position = lowerBound(this.boundaries, start, item => item.t);
        this.boundaries.splice(position, 0, { t: start, ordinal, winner: ordinal });
        for (let i = position; i < this.boundaries.length; i++) {
          this.boundaries[i].winner = Math.max(this.boundaries[i].ordinal, this.boundaries[i - 1]?.winner ?? -1);
          index.work.turns++;
        }
        turnFrom = Math.min(turnFrom, ordinal === 0 ? -Infinity : start);
      }
      if (record.type === "assistant.turn_end" && this.turns.length) {
        const t = helpers.parseTimestamp(record.timestamp);
        const turn = this.turns[this.turns.length - 1];
        if (t) turn.end = t - this.start;
        turn.value.endTime = Math.max(turn.end, turn.ends.max);
        index.work.turns++;
      }
      if (["session.start", "session.resume", "session.model_change"].includes(record.type)) {
        const effort = helpers.getReasoningEffort(data);
        const previous = record.type === "session.model_change" ? helpers.getReasoningEffort(data, "previousReasoningEffort") : null;
        if (previous) this.effortHistory.add(previous);
        if (effort) this.effortHistory.add(effort);
        this.currentEffort = effort || this.currentEffort;
        const changes: { t: number; effort: string }[] = [];
        if (!this.hasInitialEffort && previous) {
          changes.push({ t: 0, effort: previous });
          this.hasInitialEffort = true;
        }
        const t = helpers.parseTimestamp(record.type === "session.start" ? data.startTime || record.timestamp
          : record.type === "session.resume" ? data.resumeTime || record.timestamp : record.timestamp);
        if (effort && t !== null) {
          changes.push({ t: Math.max(t - this.start, 0), effort });
          if (record.type !== "session.model_change") this.hasInitialEffort = true;
        }
        for (const change of changes) {
          const position = upperBound(this.effortChanges, change.t, item => item.t);
          this.effortChanges.splice(position, 0, change);
          effortFrom = Math.min(effortFrom, change.t);
        }
      }
    }
    // An origin change alters every timestamp, including turn/effort boundaries.
    if (rebase) return this.rebuild(malformedLines);
    const newSlots: Slot[] = [];
    for (const node of added) {
      const data = node.record.data || {};
      if (node.record.type === "tool.execution_start" && typeof data.toolCallId === "string" && data.toolCallId) {
        if (this.seenStarts.has(data.toolCallId) && helpers.parseTimestamp(node.record.timestamp) !== null) continue;
        if (helpers.parseTimestamp(node.record.timestamp) !== null) this.seenStarts.add(data.toolCallId);
      }
      const events = helpers.buildNormalizedEvents([node.record], this.start!, { completes: this.completes }, this.retained);
      events.forEach((event, offset) => newSlots.push({ node, offset, event }));
      dirty.delete(node);
    }
    for (const node of dirty) {
      if (!node.positions.length) continue;
      index.work.records++;
      const events = helpers.buildNormalizedEvents([node.record], this.start!, { completes: this.completes }, this.retained);
      node.positions.forEach((position, offset) => {
        const event = events[offset];
        delete event.reasoningEffort;
        const effort = this.effort(event.t);
        if (effort) event.reasoningEffort = effort;
        this.slots[position].event = event;
        this.replace(position, event);
      });
    }
    newSlots.sort((a, b) => a.event.t - b.event.t || a.node.ordinal - b.node.ordinal || a.offset - b.offset);
    let firstInsertion = index.events.length;
    for (const slot of newSlots) {
      let low = 0;
      let high = this.slots.length;
      while (low < high) {
        const mid = (low + high) >>> 1;
        const other = this.slots[mid];
        if (other.event.t < slot.event.t || other.event.t === slot.event.t && other.node.ordinal <= slot.node.ordinal) low = mid + 1;
        else high = mid;
      }
      firstInsertion = Math.min(firstInsertion, low);
      this.slots.splice(low, 0, slot);
    }
    for (let i = index.events.length - 1; i >= firstInsertion; i--) this.remove(i, index.events[i]);
    for (let i = firstInsertion; i < this.slots.length; i++) {
      const slot = this.slots[i];
      slot.node.positions[slot.offset] = i;
      const event = { ...slot.event };
      delete event.reasoningEffort;
      const effort = this.effort(event.t);
      if (effort) event.reasoningEffort = effort;
      index.set(i, event);
      this.assign(i);
    }
    for (let i = lowerBound(index.events, Math.min(turnFrom, effortFrom), event => event.t); i < firstInsertion; i++) {
      if (index.events[i].t >= turnFrom) {
        this.remove(i, index.events[i]);
        this.assign(i);
      }
      if (index.events[i].t >= effortFrom) {
        const event = { ...index.events[i] };
        delete event.reasoningEffort;
        const effort = this.effort(event.t);
        if (effort) event.reasoningEffort = effort;
        index.set(i, event);
      }
    }
    if (!index.events.length) return null;
    const turns = this.turnValues;
    const summary = index.summary(turns);
    const metadata = helpers.buildMetadata(Object.values(this.info), [], [], malformedLines, summary);
    Object.assign(metadata, { totalEvents: index.events.length, totalTurns: turns.length, reasoningEffort: this.currentEffort, reasoningEfforts: [...this.effortHistory] });
    return { events: index.events, turns, metadata };
  }
  private rebuild(malformedLines: number): ParsedSession | null {
    const records = this.nodes.map(node => node.record);
    const replacement = new LiveCopilotNormalizer();
    replacement.start = this.start;
    replacement.foundStart = true;
    const result = replacement.append(records, malformedLines);
    Object.assign(this, replacement);
    return result;
  }
}
