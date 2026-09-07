import { applyVSCodeJsonlPatch, vscodeLive as helpers, type VSCodeSession } from "./vscodeSessionParser";
import { EventIndex, upperBound, type LiveNormalizer, type RawRecord } from "./liveNormalization";
import type { ParsedSession, SessionTurn } from "./sessionTypes";

export class LiveVSCodeNormalizer implements LiveNormalizer {
  private index = new EventIndex();
  private session: VSCodeSession | null = null;
  private turns: SessionTurn[] = [];
  private offsets: number[] = [];
  private parts: Map<number, { position: number; kind: unknown; timestamp: unknown }>[] = [];
  private errors: number[] = [];
  get work() { return this.index.work; }

  append(records: RawRecord[]): ParsedSession | null {
    const index = this.index;
    index.begin(records.length);
    let from = Infinity;
    let through = -1;
    const previousOrigin = this.session?.creationDate || this.session?.requests?.[0]?.timestamp || 0;
    const requested = new Set<number>();
    let allRequests = false;
    const localParts = new Map<number, Set<number>>();
    for (const record of records) {
      if (!this.session && (record.kind === 0 || helpers.isVSCodeSession(record))) {
        // Own the mutable patch tree, not the retained raw JSONL record.
        this.session = structuredClone(record.kind === 0 ? record.v : record);
        from = 0;
        allRequests = true;
        through = (this.session?.requests?.length || 0) - 1;
        continue;
      }
      if (!this.session) continue;
      const count = this.session.requests?.length || 0;
      if (!applyVSCodeJsonlPatch(this.session, record)) continue;
      const key = record.k;
      if (key[0] === "requests") {
        if (key.length === 2 && key[1] === "length") {
          from = Math.min(from, this.session.requests.length);
          through = Math.max(through, this.session.requests.length - 1);
          continue;
        }
        const request = key.length > 1 ? Number(key[1]) : record.kind === 2 ? count : 0;
        if (key[2] === "response" && key.length >= 4 && Number.isInteger(Number(key[3]))) {
          if (!localParts.has(request)) localParts.set(request, new Set());
          localParts.get(request)!.add(Number(key[3]));
          continue;
        }
        from = Math.min(from, Number.isInteger(request) && request >= 0 ? request : 0);
        through = Math.max(through, key.length > 1 ? request : (this.session.requests?.length || 0) - 1);
        if (key.length > 1 && Number.isInteger(request)) requested.add(request);
        else if (key.length === 1 && record.kind === 2) {
          for (let i = count; i < this.session.requests.length; i++) requested.add(i);
        } else allRequests = true;
      } else if (key[0] === "creationDate" || key[0] === "selectedModel") {
        from = 0;
        allRequests = true;
        through = (this.session.requests?.length || 0) - 1;
      }
    }
    if (!this.session || !helpers.isVSCodeSession(this.session)) return null;
    const requests = this.session.requests;
    for (const [ri, parts] of localParts) {
      for (const pi of parts) {
        index.work.records++;
        const previous = this.parts[ri]?.get(pi);
        const part = requests[ri]?.response?.[pi];
        const timestamp = part?.toolSpecificData?.terminalCommandState?.timestamp;
        const event = previous && index.events[previous.position];
        const mapped = event && part && part.kind === previous.kind && timestamp === previous.timestamp
          ? helpers.mapResponsePart(part, event.t, event.model || null) : null;
        if (!mapped || !previous || !event) {
          from = Math.min(from, ri);
          through = Math.max(through, ri);
          requested.add(ri);
          continue;
        }
        this.errors[ri] += Number(mapped.isError) - Number(event.isError);
        this.turns[ri].toolCount! += Number(mapped.track === "tool_call") - Number(event.track === "tool_call");
        this.turns[ri].hasError = this.errors[ri] > 0;
        index.set(previous.position, { ...mapped, turnIndex: ri });
        index.work.turns++;
      }
    }
    const origin = this.session.creationDate || requests[0]?.timestamp || 0;
    if (origin !== previousOrigin) {
      from = 0;
      through = requests.length - 1;
      allRequests = true;
    }
    const dirtyRequests = [...requested].sort((a, b) => a - b);
    for (let ri = from; ri < requests.length; ri++) {
      index.work.records++;
      const position = this.offsets[ri] ?? index.events.length;
      const previousEnd = this.offsets[ri + 1] ?? index.events.length;
      const oldLast = index.events[previousEnd - 1];
      const oldTime = oldLast?.t;
      const oldCount = previousEnd - position;
      const single = {
        ...this.session,
        creationDate: this.session.creationDate || requests[0]?.timestamp || 0,
        requests: [requests[ri]],
      };
      const normalized = helpers.buildTimeline(single, index.events[position - 1]);
      const changedCount = oldCount !== normalized.events.length;
      if (changedCount) {
        // A count change shifts all following public evidence indices.
        index.truncate(position);
        this.offsets.length = ri + 1;
        this.turns.length = ri;
        through = requests.length - 1;
        allRequests = true;
      }
      this.offsets[ri] = position;
      normalized.events.forEach((event, offset) => index.set(position + offset, { ...event, turnIndex: ri }));
      const positions = new Map(normalized.events.map((event, offset) => [event.raw, position + offset]));
      this.parts[ri] = new Map();
      const response = requests[ri].response || [];
      for (let pi = 0; pi < response.length; pi++) {
        const part = response[pi];
        const offset = positions.get(part);
        if (offset !== undefined) this.parts[ri].set(pi, {
          position: offset, kind: part.kind, timestamp: part.toolSpecificData?.terminalCommandState?.timestamp,
        });
        index.work.events++;
      }
      this.errors[ri] = normalized.events.reduce((sum, event) => sum + Number(event.isError), 0);
      this.offsets[ri + 1] = position + normalized.events.length;
      const turn = normalized.turns[0];
      turn.index = ri;
      turn.eventIndices = turn.eventIndices.map(i => i + position);
      this.turns[ri] = turn;
      index.work.turns++;
      const newTime = index.events[this.offsets[ri + 1] - 1]?.t;
      // Minimum spacing propagates only until the next request's boundary settles.
      if (oldTime === newTime) {
        if (ri >= through) break;
        if (!allRequests) {
          const next = dirtyRequests[upperBound(dirtyRequests, ri, i => i)];
          if (next === undefined) break;
          ri = next - 1;
        }
      }
    }
    if (this.turns.length > requests.length) {
      index.truncate(this.offsets[requests.length] || 0);
      this.turns.length = requests.length;
      this.offsets.length = requests.length + 1;
      this.parts.length = requests.length;
      this.errors.length = requests.length;
    }
    if (!index.events.length) return null;
    const metadata = {
      ...helpers.buildMetadata([], [], this.session),
      ...index.summary(this.turns),
    };
    return { events: index.events, turns: this.turns, metadata };
  }
}
