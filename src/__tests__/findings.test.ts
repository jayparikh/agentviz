import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseSessionText } from "../lib/sessionParsing";
import { appendLiveSessionText, createLiveSessionParser } from "../lib/liveSessionParser";
import {
  FINDINGS_PREFIX, anchorId, buildEventAnchors, createFinding, findingsSessionId,
  fingerprint, matchesAnchor, readFindings, saveFindings, validateFindingsPayload,
} from "../lib/findings";

function storage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); } } as Storage;
}
const events = [
  { t: 0, agent: "user", track: "output", text: "First", raw: { id: "a", timestamp: "2026-01-01" } },
  { t: 0, agent: "assistant", track: "output", text: "Second", raw: { id: "b", timestamp: "2026-01-01" } },
];
const anchors = buildEventAnchors(events);
const first = createFinding(anchors[0], events[0], "A note");
const second = createFinding(anchors[1], events[1], "Another note");

describe("findings identities and anchors", () => {
  it("distinguishes index zero, equal times and duplicate occurrences", () => {
    expect(anchorId(anchors[0])).not.toBe(anchorId(anchors[1]));
    expect(matchesAnchor(first.anchor, anchors)).toBe(true);
    const repeated = buildEventAnchors([events[0], events[0]]);
    expect(repeated[0].occurrence).toBe(0);
    expect(repeated[1].occurrence).toBe(1);
    expect(anchorId(repeated[0])).not.toBe(anchorId(repeated[1]));
  });
  it("keeps anchors on append and completion but rejects truncation, replacement and reorder", () => {
    expect(matchesAnchor(second.anchor, buildEventAnchors([...events, { text: "Third" }]))).toBe(true);
    expect(matchesAnchor(second.anchor, buildEventAnchors(events.map(e => ({ ...e, duration: 99, toolOutput: "Late", tokenUsage: { input: 100 } }))))).toBe(true);
    expect(matchesAnchor(second.anchor, buildEventAnchors(events.slice(0, 1)))).toBe(false);
    expect(matchesAnchor(second.anchor, buildEventAnchors([...events].reverse()))).toBe(false);
    expect(matchesAnchor(second.anchor, buildEventAnchors([{ ...events[0], text: "Replaced" }, events[1]]))).toBe(false);
    expect(matchesAnchor(first.anchor, [])).toBe(false);
  });
  it("guards untruncated source text and timestamps when normalized previews are identical", () => {
    const shared = "a".repeat(300);
    const original = { t: 0, agent: "assistant", track: "output", text: shared, raw: { type: "text", text: shared + "original" } };
    const anchor = buildEventAnchors([original])[0];
    expect(matchesAnchor(anchor, buildEventAnchors([{ ...original, raw: { type: "text", text: shared + "replacement" } }]))).toBe(false);
    expect(matchesAnchor(anchor, buildEventAnchors([{ ...original, t: 10 }]))).toBe(false);
  });
  it("keeps pending Copilot tool anchors through actual late completion normalization", () => {
    const raw = readFileSync(resolve(process.cwd(), "src", "__tests__", "fixtures", "test-copilot.jsonl"), "utf8");
    const lines = raw.trim().split("\n");
    const initialText = lines.slice(0, 5).join("\n") + "\n";
    const initial = parseSessionText(initialText).result!;
    const pending = buildEventAnchors(initial.events);
    const live = appendLiveSessionText(createLiveSessionParser(initialText), lines.slice(5).join("\n") + "\n");
    const completed = buildEventAnchors(live.result!.events);
    expect(initial.events.some(event => event.track === "tool_call")).toBe(true);
    pending.forEach(anchor => expect(matchesAnchor(anchor, completed)).toBe(true));
  });
  it("uses explicit session identity across snapshots, independent of path and name", () => {
    expect(findingsSessionId({ format: "test", sessionId: "one", sourcePath: "foreign" }, "first"))
      .toBe(findingsSessionId({ format: "test", sessionId: "one" }, "second"));
    expect(findingsSessionId({ format: "test", sessionId: "two" }, "first"))
      .not.toBe(findingsSessionId({ format: "test", sessionId: "one" }, "first"));
  });
  it("recognizes renamed inferred JSONL reimports and append but not different first records", () => {
    const text = '{"timestamp":"first","content":"hello"}\n{"content":"second"}';
    const id = findingsSessionId({ format: "test", sourcePath: "old" }, text);
    expect(findingsSessionId({ format: "test", sourcePath: "new" }, text + '\n{"content":"third"}')).toBe(id);
    expect(findingsSessionId({ format: "test" }, "\n \n" + text)).toBe(id);
    expect(findingsSessionId({ format: "test", sourcePath: "old" }, text.replace("first", "other"))).not.toBe(id);
    expect(findingsSessionId(null, '{"a":1,"b":2}')).toBe(findingsSessionId(null, '{"b":2,"a":1}'));
    expect(findingsSessionId(null, '{"a":1}')).not.toBe(findingsSessionId(null, '{"a":2}'));
  });
  it("validates export snapshot ownership, unique anchors, bounded plain-text notes and drafts", () => {
    const payload = { version: 1, sessionId: "one", snapshot: fingerprint("raw"), items: [first], drafts: [second] };
    expect(validateFindingsPayload(payload, "one", "raw").items).toEqual([first]);
    expect(() => validateFindingsPayload(payload, "two", "raw")).toThrow();
    expect(() => validateFindingsPayload(payload, "one", "other")).toThrow();
    for (const items of [[first, first], [{ ...first, note: "x".repeat(20001) }], [{ ...first, id: "wrong" }],
      [{ ...first, anchor: { ...first.anchor, index: -1 } }]]) {
      expect(() => validateFindingsPayload({ ...payload, items }, "one", "raw")).toThrow();
    }
  });
});

describe("findings persistence", () => {
  it("saves, reads and removes independently of transcript storage", () => {
    const store = storage();
    store.setItem("agentviz:session-content:v1:one", "unchanged raw");
    expect(saveFindings("one", [first], [], store).error).toBeNull();
    expect(readFindings("one", store).items).toEqual([first]);
    expect(readFindings("two", store).items).toEqual([]);
    expect(saveFindings("one", [], [first], store).items).toEqual([]);
    expect(store.getItem("agentviz:session-content:v1:one")).toBe("unchanged raw");
  });
  it("preserves corrupt JSON and structurally corrupt stores without overwriting", () => {
    const store = storage();
    for (const raw of ["{broken", '{"version":2,"sessionId":"one","items":[]}', '{"version":1,"sessionId":"other","items":[]}']) {
      store.setItem(FINDINGS_PREFIX + "one", raw);
      expect(readFindings("one", store).error?.kind).toBe("corrupt");
      expect(saveFindings("one", [first], [], store).error?.kind).toBe("corrupt");
      expect(store.getItem(FINDINGS_PREFIX + "one")).toBe(raw);
    }
  });
  it("surfaces read and write access failures, quota failures, and successful retry", () => {
    const store = storage();
    const write = store.setItem;
    store.setItem = () => { throw new DOMException("Full", "QuotaExceededError"); };
    expect(saveFindings("one", [first], [], store).error?.kind).toBe("quota");
    store.setItem = write;
    expect(saveFindings("one", [first], [], store).items).toEqual([first]);
    store.getItem = () => { throw new Error("Blocked"); };
    expect(readFindings("one", store).error?.kind).toBe("access");
    expect(saveFindings("one", [second], [first], store).error?.kind).toBe("access");
  });
  it("merges independent A/B edits but refuses concurrent changes to the same finding", () => {
    const store = storage();
    saveFindings("one", [first], [], store);
    expect(saveFindings("one", [second], [], store).items).toEqual([first, second]);
    const changed = { ...first, note: "From A" };
    saveFindings("one", [changed, second], [first, second], store);
    expect(saveFindings("one", [{ ...first, note: "From B" }, second], [first, second], store).error?.kind).toBe("conflict");
    expect(readFindings("one", store).items).toEqual([changed, second]);
  });
  it("does not overwrite findings discovered after a previously blocked read", () => {
    const store = storage();
    saveFindings("one", [first], [], store);
    expect(saveFindings("one", [second], null, store).error?.kind).toBe("conflict");
    expect(readFindings("one", store).items).toEqual([first]);
  });
});
