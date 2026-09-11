export const FINDINGS_PREFIX = "agentviz:findings:v1:";
export const FINDINGS_CHANGED = "agentviz:findings-changed";
export const MAX_NOTE_LENGTH = 20000;

export interface EventAnchor {
  index: number;
  fingerprint: string;
  occurrence: number;
  prefix: string;
}
export interface Finding {
  id: string;
  anchor: EventAnchor;
  label: string;
  note: string;
}
export interface FindingsPayload {
  version: 1;
  sessionId: string;
  snapshot: string;
  items: Finding[];
  drafts?: Finding[];
}
export interface FindingsError { kind: string; message: string }

// Two independently mixed words plus length. These fingerprints are identity
// guards, not cryptographic signatures or authentication.
export function fingerprint(text: string): string {
  let a = 0xdeadbeef, b = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    a = Math.imul(a ^ text.charCodeAt(i), 2654435761);
    b = Math.imul(b ^ text.charCodeAt(i), 1597334677);
  }
  a = Math.imul(a ^ (a >>> 16), 2246822507) ^ Math.imul(b ^ (b >>> 13), 3266489909);
  b = Math.imul(b ^ (b >>> 16), 2246822507) ^ Math.imul(a ^ (a >>> 13), 3266489909);
  return (a >>> 0).toString(16).padStart(8, "0") + (b >>> 0).toString(16).padStart(8, "0") + ":" + text.length;
}

function canonical(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  const obj = value as Record<string, unknown>;
  return "{" + Object.keys(obj).sort().map(key => JSON.stringify(key) + ":" + canonical(obj[key])).join(",") + "}";
}

export function findingsSessionId(metadata: Record<string, unknown> | null, rawText: string): string {
  const format = metadata?.format || "session";
  if (metadata?.sessionId) return format + ":id:" + metadata.sessionId;
  // Names and discovery paths are transport metadata, not session identity.
  // JSONL's first complete source record survives append and renamed reimports.
  // A single JSON document without an explicit ID remains snapshot-specific.
  let source: unknown;
  try { source = JSON.parse(rawText); }
  catch {
    const first = rawText.match(/^[ \t]*\S[^\r\n]*/m)?.[0] || "";
    try { source = JSON.parse(first); } catch { source = rawText; }
  }
  return format + ":source:" + fingerprint(canonical(source));
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

export function buildEventAnchors(events: Array<Record<string, unknown>>): EventAnchor[] {
  const occurrences = new Map<string, number>();
  let prefix = "start";
  return events.map((event, index) => {
    const raw = objectRecord(event.raw);
    // Completion output, duration, usage, and inferred live metadata can change.
    // Use source IDs/timestamps and the original action, not those aggregates.
    const evidence = [event.t, event.agent, event.track, event.text, event.toolName, event.toolInput,
      event.toolCallId, raw.uuid, raw.id, raw.timestamp, raw.ts, raw.type,
      typeof event.raw === "string" ? event.raw : null,
      raw.text, raw.thinking, raw.value, raw.content, objectRecord(raw.message).content,
      objectRecord(raw.data).content, objectRecord(raw.payload).text,
      objectRecord(raw.payload).message, objectRecord(raw.payload).arguments];
    const fp = fingerprint(canonical(evidence));
    const occurrence = occurrences.get(fp) || 0;
    occurrences.set(fp, occurrence + 1);
    prefix = fingerprint(prefix + "|" + fp);
    return { index, fingerprint: fp, occurrence, prefix };
  });
}

export function anchorId(anchor: EventAnchor): string {
  return anchor.index + ":" + anchor.occurrence + ":" + anchor.fingerprint + ":" + anchor.prefix;
}

export function matchesAnchor(anchor: EventAnchor, anchors: EventAnchor[]): boolean {
  const current = anchors[anchor.index];
  return Boolean(current && anchorId(current) === anchorId(anchor));
}

export function createFinding(anchor: EventAnchor, event: Record<string, unknown>, note = ""): Finding {
  return { id: anchorId(anchor), anchor, label: String(event.text || event.toolName || event.track || "Event").slice(0, 180), note };
}

function validateItems(value: unknown): Finding[] {
  if (!Array.isArray(value)) throw new SyntaxError("Invalid findings");
  const ids = new Set<string>();
  return value.map(item => {
    const a = item?.anchor;
    if (!a || !Number.isSafeInteger(a.index) || a.index < 0
      || !Number.isSafeInteger(a.occurrence) || a.occurrence < 0
      || typeof a.fingerprint !== "string" || a.fingerprint.length > 100
      || typeof a.prefix !== "string" || a.prefix.length > 100
      || typeof item.label !== "string" || item.label.length > 180
      || typeof item.note !== "string" || item.note.length > MAX_NOTE_LENGTH
      || item.id !== anchorId(a) || ids.has(item.id)) throw new SyntaxError("Invalid finding");
    ids.add(item.id);
    return { id: item.id, anchor: { index: a.index, fingerprint: a.fingerprint, occurrence: a.occurrence, prefix: a.prefix },
      label: item.label, note: item.note };
  });
}

export function validateFindingsPayload(value: unknown, sessionId: string, rawText: string): FindingsPayload {
  const payload = value as FindingsPayload;
  if (!payload || payload.version !== 1 || payload.sessionId !== sessionId
    || payload.snapshot !== fingerprint(rawText)) throw new SyntaxError("Findings do not belong to this transcript");
  return { version: 1, sessionId, snapshot: payload.snapshot, items: validateItems(payload.items),
    drafts: validateItems(payload.drafts || []) };
}

function getStorage(storage?: Storage): Storage {
  if (storage) return storage;
  if (typeof window === "undefined") throw new Error("Storage unavailable");
  return window.localStorage;
}

export function findingsError(error: unknown): FindingsError {
  const name = (error as Error)?.name;
  return name === "SyntaxError"
    ? { kind: "corrupt", message: "Saved findings are damaged or invalid. They have not been replaced." }
    : name === "QuotaExceededError"
      ? { kind: "quota", message: "Browser storage is full. Findings are kept in memory." }
      : { kind: "access", message: "Browser storage could not be accessed. Findings are kept in memory." };
}

export function readFindings(sessionId: string, storage?: Storage): { items: Finding[] | null; error: FindingsError | null; exists?: boolean } {
  try {
    const raw = getStorage(storage).getItem(FINDINGS_PREFIX + sessionId);
    if (raw === null) return { items: [], error: null, exists: false };
    const data = objectRecord(JSON.parse(raw));
    if (data.version !== 1 || data.sessionId !== sessionId) throw new SyntaxError("Invalid findings store");
    return { items: validateItems(data.items), error: null, exists: true };
  } catch (error) { return { items: null, error: findingsError(error) }; }
}

// Merge only edits relative to the caller's baseline. A/B copies and other tabs
// may add different findings without losing each other's work.
export function saveFindings(sessionId: string, items: Finding[], baseline: Finding[] | null, storage?: Storage) {
  const latest = readFindings(sessionId, storage);
  if (latest.error) return latest;
  if (baseline === null && latest.items!.length) return {
    items: null, error: { kind: "conflict", message: "Saved findings are now available. Download your edits, then reload saved findings before editing." },
  };
  const base = new Map((baseline || []).map(item => [item.id, item]));
  const next = new Map(items.map(item => [item.id, item]));
  const merged = new Map(latest.items!.map(item => [item.id, item]));
  for (const id of new Set([...base.keys(), ...next.keys()])) {
    if (canonical(base.get(id)) === canonical(next.get(id))) continue;
    if (canonical(merged.get(id)) !== canonical(base.get(id)) && canonical(merged.get(id)) !== canonical(next.get(id))) {
      return { items: null, error: { kind: "conflict", message: "This finding changed in another view or tab. Download your edits, then reload saved findings." } };
    }
    if (next.has(id)) merged.set(id, next.get(id)!);
    else merged.delete(id);
  }
  try {
    const saved = validateItems(Array.from(merged.values()));
    getStorage(storage).setItem(FINDINGS_PREFIX + sessionId, JSON.stringify({ version: 1, sessionId, items: saved }));
    return { items: saved, error: null };
  } catch (error) { return { items: null, error: findingsError(error) }; }
}
