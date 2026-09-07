import { expect, it } from "vitest";
import { createLiveSessionParser } from "../lib/liveSessionParser";
import { parseSession } from "../lib/parseSession";

const time = (i: number) => new Date(1700000000000 + i * 1000).toISOString();
const encode = (records: unknown[]) => records.map(record => JSON.stringify(record)).join("\n");
const median = (values: number[]) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];

function records(format: string, start: number, count: number): Record<string, any>[] {
  return Array.from({ length: count }, (_, offset) => {
    const i = start + offset;
    if (format === "claude-code") return { type: "user", timestamp: time(i), message: { content: "message " + i } };
    if (format === "copilot-cli") return { type: "assistant.message", timestamp: time(i), data: { content: "message " + i } };
    if (format === "codex") return { type: "response_item", timestamp: time(i), payload: { type: "message", role: "assistant", content: "message " + i } };
    return { kind: 2, k: ["requests"], v: [{ timestamp: 1700000000000 + i * 1000, message: { text: "message " + i }, response: [{ value: "response" }] }] };
  });
}

function header(format: string): Record<string, any>[] {
  if (format === "copilot-cli") return [
    { type: "session.start", timestamp: time(0), data: { producer: "copilot-agent", startTime: time(0) } },
    { type: "assistant.turn_start", timestamp: time(0) },
  ];
  if (format === "codex") return [
    { type: "session_meta", payload: { originator: "codex-cli" } },
    { type: "event_msg", timestamp: time(0), payload: { type: "task_started", turn_id: "active" } },
    { type: "turn_context", payload: { turn_id: "active", model: "model" } },
  ];
  if (format === "vscode-chat") return [{ kind: 0, v: { version: 3, sessionId: "benchmark", requests: [], creationDate: 1700000000000 } }];
  return [];
}

for (const format of ["claude-code", "copilot-cli", "codex", "vscode-chat"]) {
  it(`${format}: measures normalization separately from full snapshot cloning`, () => {
    const measurements = [100, 10000].map(history => {
      const all = [...header(format), ...records(format, 0, history)];
      const state = createLiveSessionParser(encode(all), { snapshot: false });
      const normalizer = state.normalizer!;
      const normalization: number[] = [];
      const snapshots: number[] = [];
      let result = state.result;
      for (let batch = 0; batch < 11; batch++) {
        const delta = records(format, history + batch * 10, 10);
        const start = performance.now();
        result = normalizer.append(delta, 0);
        normalization.push(performance.now() - start);
        const deliveryStart = performance.now();
        structuredClone(result);
        snapshots.push(performance.now() - deliveryStart);
        all.push(...delta);
      }
      expect(result).toEqual(parseSession(encode(all)));
      return {
        format, history, delta: 10, ...normalizer.work,
        normalizationMedianMs: +median(normalization).toFixed(3),
        snapshotCloneMedianMs: +median(snapshots).toFixed(3),
      };
    });
    expect(measurements[1].records).toBe(measurements[0].records);
    expect(measurements[1].events).toBe(measurements[0].events);
    expect(measurements[1].turns).toBe(measurements[0].turns);
    process.stdout.write("Retained normalization benchmark " + JSON.stringify(measurements) + "\n");
  });
}
