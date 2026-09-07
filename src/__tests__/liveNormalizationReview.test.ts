import { expect, it } from "vitest";
import { createLiveSessionParser, appendLiveSessionText } from "../lib/liveSessionParser";
import { parseSession } from "../lib/parseSession";

const encode = (records: unknown[]) => records.map(record => JSON.stringify(record)).join("\n");
const time = (i: number) => new Date(1700000000000 + i * 1000).toISOString();

it("activates an earlier Codex turn and removes the old empty turn in one append", () => {
  const records = [
    { type: "session_meta", payload: { originator: "codex-cli" } },
    { type: "response_item", timestamp: time(1), payload: { type: "message", role: "assistant", content: "unbound" } },
    { type: "event_msg", timestamp: time(18), payload: { type: "task_started", turn_id: "b" } },
    { type: "turn_context", payload: { turn_id: "a", model: "m1" } },
    { type: "response_item", timestamp: time(12), payload: { type: "message", role: "user", content: "hello" } },
  ];
  let state = createLiveSessionParser("");
  for (const record of records) {
    state = appendLiveSessionText(state, encode([record])).state;
    expect(state.result).toEqual(parseSession(state.rawText));
  }
  expect(state.result?.turns.map(turn => turn.turnId)).toEqual(["a"]);
});

for (const count of [100, 5000]) {
  it(`does not shift ${count} turn indices to update one Copilot completion`, () => {
    const initial = [
      { type: "session.start", timestamp: time(0), data: { producer: "copilot-agent", startTime: time(0) } },
      { type: "assistant.turn_start", timestamp: time(0) },
      { type: "tool.execution_start", timestamp: time(1), data: { toolName: "read", toolCallId: "old" } },
      ...Array.from({ length: count }, (_, i) => ({ type: "assistant.message", timestamp: time(i + 2), data: { content: "message " + i } })),
    ];
    let state = createLiveSessionParser(encode(initial), { snapshot: false });
    const indices = state.result!.turns[0].eventIndices;
    let shifted = 0;
    Object.defineProperty(indices, "splice", { configurable: true, value(start: number, remove: number, ...items: number[]) {
      shifted += indices.length - start - remove;
      return Array.prototype.splice.call(indices, start, remove, ...items);
    } });
    const delta = { type: "tool.execution_complete", timestamp: time(count + 2), data: { toolCallId: "old", success: false, result: { content: "failed" } } };
    state = appendLiveSessionText(state, encode([delta])).state;
    expect(shifted).toBe(0);
    expect(state.result).toEqual(parseSession(encode([...initial, delta])));
  });
}

it("skips unaffected VS Code requests between distant patches without an explicit creation date", () => {
  const initial = { kind: 0, v: { version: 3, sessionId: "sparse", requests: Array.from({ length: 5000 }, (_, i) => ({
    timestamp: 1700000000000 + i * 1000, message: { text: "message " + i }, response: [],
  })) } };
  const delta = [0, 4999].map(i => ({ kind: 1, k: ["requests", i, "message", "text"], v: "changed " + i }));
  let state = appendLiveSessionText(createLiveSessionParser(encode([initial])), encode(delta)).state;
  expect(state.result).toEqual(parseSession(encode([initial, ...delta])));
  expect(state.normalizationWork.records).toBe(4);
  expect(state.normalizationWork.events).toBe(2);
  const truncate = { kind: 1, k: ["requests", "length"], v: 4999 };
  state = appendLiveSessionText(state, encode([truncate])).state;
  expect(state.result).toEqual(parseSession(encode([initial, ...delta, truncate])));
  expect(state.normalizationWork.records).toBe(1);
  expect(state.normalizationWork.events).toBe(1);
});
