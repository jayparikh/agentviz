import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import TracksView from "../components/TracksView";
import { createLiveSessionParser, appendLiveSessionText } from "../lib/liveSessionParser";
import { createSessionStorageId } from "../lib/sessionLibrary";
import { createLiveParserClient } from "../lib/liveParserClient";
import { buildTrackMarks } from "../lib/tracksLayout";
import { parseSession } from "../lib/parseSession";

export function transcript(count) {
  return Array.from({ length: count }, (_, i) => JSON.stringify({
    type: i % 2 ? "assistant" : "user", sessionId: "benchmark-session",
    timestamp: new Date(1700000000000 + i * 1000).toISOString(),
    message: { role: i % 2 ? "assistant" : "user", content: "Event " + i },
  })).join("\n") + "\n";
}

describe("cleanup scaling evidence", () => {
  it("reports deterministic 10000-event normalization and Tracks DOM work", () => {
    const raw = transcript(10000);
    const state = createLiveSessionParser(raw);
    const start = performance.now();
    const next = appendLiveSessionText(state, transcript(1));
    const elapsed = performance.now() - start;
    expect(next.state.lastAppendParsedLineCount).toBe(1);
    const entries = state.result.events.map((event, index) => ({ event, index }));
    const renderStart = performance.now();
    const html = renderToStaticMarkup(<TracksView currentTime={0} totalTime={10000} eventEntries={entries} />);
    expect((html.match(/data-track-mark/g) || []).length).toBeLessThanOrEqual(400);
    process.stdout.write(JSON.stringify({ fixture: 10000, appendMs: elapsed, tracksRenderMs: performance.now() - renderStart,
      tracksElements: (html.match(/<(div|span|button)\b/g) || []).length }) + "\n");
  });

  it("reports large transcript identity cost", () => {
    const raw = transcript(10000);
    const start = performance.now();
    createSessionStorageId("session.jsonl", {}, raw);
    process.stdout.write(JSON.stringify({ identityBytes: raw.length, identityMs: performance.now() - start }) + "\n");
  });

  it("keeps all dense evidence identities and error markers in bounded marks", () => {
    const entries = Array.from({ length: 10000 }, (_, index) => ({ index, event: { t: 0, duration: 0, isError: index === 9999 } }));
    const marks = buildTrackMarks(entries, 100);
    expect(marks).toHaveLength(1);
    expect(marks[0].isError).toBe(true);
    expect(marks[0].entries.map(entry => entry.index)).toEqual(entries.map(entry => entry.index));
  });

  it("preserves Claude identity across appended snapshots and distinguishes sessions", () => {
    const raw = transcript(10);
    const first = parseSession(raw);
    const later = parseSession(raw + transcript(2));
    expect(first.metadata.sessionId).toBe("benchmark-session");
    expect(createSessionStorageId("a.jsonl", first.metadata, raw)).toBe(createSessionStorageId("a.jsonl", later.metadata, raw + transcript(2)));
    expect(createSessionStorageId("a.jsonl", first.metadata, raw)).not.toBe(createSessionStorageId("a.jsonl", { ...first.metadata, sessionId: "other" }, raw));
  });

  it("coalesces worker backpressure and discards pre-reset results", () => {
    const messages = [], results = [], errors = [];
    let terminated = false;
    const worker = { postMessage: message => messages.push(message), terminate: () => { terminated = true; } };
    const client = createLiveParserClient(worker, "initial", result => results.push(result), error => errors.push(error));
    for (let i = 0; i < 100; i++) client.append("line" + i);
    expect(messages).toHaveLength(1);
    client.append("replacement", true);
    client.append("tail");
    worker.onmessage({ data: { rawText: "old" } });
    expect(results).toHaveLength(0);
    expect(messages[1]).toEqual({ text: "replacement\ntail", reset: true });
    worker.onmessage({ data: { rawText: "new" } });
    expect(results).toEqual([{ rawText: "new" }]);
    client.dispose();
    worker.onmessage({ data: { rawText: "late" } });
    expect(results).toHaveLength(1);
    expect(terminated).toBe(true);
  });
});
