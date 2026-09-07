import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { appendLiveSessionText, createLiveSessionParser } from "../lib/liveSessionParser";
import { parseSession } from "../lib/parseSession";

const encode = (records: unknown[]) => records.map(record => JSON.stringify(record)).join("\n");
const stamp = (i: number) => new Date(Date.UTC(2026, 0, 1) + i * 1000).toISOString();

export function workload(format: string, size: number): unknown[] {
  if (format === "claude-code") return Array.from({ length: size }, (_, i) => ({
    type: "user", timestamp: stamp(i), message: { content: "message " + i },
  }));
  if (format === "copilot-cli") return [
    { type: "session.start", timestamp: stamp(0), data: { producer: "copilot-agent", startTime: stamp(0) } },
    ...Array.from({ length: size }, (_, i) => ({ type: "user.message", timestamp: stamp(i), data: { content: "message " + i } })),
  ];
  if (format === "codex") return [
    { type: "session_meta", payload: { originator: "codex-cli" } },
    ...Array.from({ length: size }, (_, i) => ({
      type: "response_item", timestamp: stamp(i), payload: { type: "message", role: "user", content: "message " + i },
    })),
  ];
  return [
    { kind: 0, v: { version: 3, sessionId: "scaling", creationDate: Date.UTC(2026, 0, 1), requests: [] } },
    ...Array.from({ length: size }, (_, i) => ({
      kind: 2, k: ["requests"], v: [{ timestamp: Date.UTC(2026, 0, 1) + i * 1000, message: { text: "message " + i }, response: [] }],
    })),
  ];
}

  for (const format of ["claude-code", "copilot-cli", "codex", "vscode-chat"]) {
    it(`${format}: equal deltas do not revisit unaffected history`, () => {
      const work = [100, 5000].map(size => {
        const records = workload(format, size + 5);
        let state = createLiveSessionParser(encode(records.slice(0, -5)));
        state = appendLiveSessionText(state, encode(records.slice(-5))).state;
        expect(state.result).toEqual(parseSession(encode(records)));
        expect(state.result).toEqual(parseSession(state.rawText));
        return (state as any).normalizationWork;
      });
      expect(work[0]).toBeDefined();
      expect(work[1].records).toBe(format === "vscode-chat" ? 10 : 5);
      expect(work[1].events).toBeLessThanOrEqual(work[0].events + 5);
      expect(work[1].turns).toBeLessThanOrEqual(work[0].turns + 5);
    });
  }

    const claudeRecords = [
      { type: "user", sessionId: "retained", message: { content: "first" } },
      { type: "assistant", message: { id: "a", model: "first-model", content: [{ type: "tool_use", id: "tool", name: "read", input: {} }] } },
      { type: "assistant", timestamp: stamp(4), message: { id: "a", model: "other-model", usage: { input_tokens: 10, output_tokens: 2 }, content: [{ type: "text", text: "partial" }] } },
      { type: "tool_result", timestamp: stamp(5), tool_use_id: "tool", content: "first result" },
      { type: "tool_result", timestamp: stamp(6), tool_use_id: "tool", content: "updated result" },
      { type: "assistant", timestamp: stamp(7), message: { id: "a", usage: { input_tokens: 12, output_tokens: 9, cache_read_input_tokens: 4 }, content: [{ type: "text", text: "final" }] } },
      { type: "user", timestamp: stamp(1), message: { content: "backdated user" } },
      { type: "assistant", message: { content: [{ type: "thinking", thinking: "without timestamp" }] } },
      ...Array.from({ length: 8 }, () => ({ type: "ignored" })),
    ];

    const copilotRecords = [
      { type: "session.start", timestamp: stamp(0), data: { producer: "copilot-agent", startTime: stamp(0), sessionId: "retained" } },
      { type: "user.message", timestamp: stamp(1), data: { content: "hello" } },
      { type: "assistant.turn_start", timestamp: stamp(2) },
      { type: "assistant.message", timestamp: stamp(3), data: { content: "working", toolRequests: [{ name: "read", toolCallId: "tool" }] } },
      { type: "tool.execution_start", timestamp: stamp(4), data: { toolCallId: "tool", toolName: "read", parentToolCallId: "task", arguments: { path: "x" } } },
      { type: "tool.execution_complete", timestamp: stamp(9), data: { toolCallId: "tool", model: "model-a", success: false, result: { content: "failed" } } },
      { type: "tool.execution_start", timestamp: stamp(3), data: { toolCallId: "task", toolName: "task", arguments: { agent_type: "explore", description: "Explore" } } },
      { type: "subagent.started", timestamp: stamp(3), data: { toolCallId: "task", agentName: "research", agentDisplayName: "Researcher" } },
      { type: "subagent.completed", timestamp: stamp(11), data: { toolCallId: "task" } },
      { type: "session.model_change", timestamp: stamp(5), data: { previousReasoningEffort: "low", reasoningEffort: "high" } },
      { type: "assistant.turn_end", timestamp: stamp(12) },
      { type: "tool.execution_complete", timestamp: stamp(6), data: { toolCallId: "tool", model: "model-b", success: true, result: { content: "ok" } } },
      { type: "assistant.turn_start", timestamp: stamp(4) },
      { type: "assistant.message", timestamp: stamp(8), data: { content: "earlier" } },
      { type: "session.shutdown", timestamp: stamp(13), data: { shutdownType: "error", errorReason: "interrupted", totalNanoAiu: 1e9, modelMetrics: { "model-b": { usage: { inputTokens: 30, outputTokens: 5, cacheReadTokens: 10 }, requests: { count: 4 } } } } },
      { type: "session.resume", timestamp: stamp(14), data: { producer: "copilot-agent", resumeTime: stamp(14), reasoningEffort: "medium" } },
    ];

    const codexRecords = [
      { type: "session_meta", payload: { originator: "codex-cli", id: "retained" } },
      { type: "response_item", timestamp: stamp(0), payload: { type: "message", role: "assistant", content: "before lifecycle" } },
      { type: "event_msg", timestamp: stamp(1), payload: { type: "task_started", turn_id: "a" } },
      { type: "turn_context", payload: { turn_id: "a", model: "model-a", effort: "low" } },
      { type: "response_item", timestamp: stamp(2), payload: { type: "message", role: "user", content: "hello" } },
      { type: "response_item", timestamp: stamp(3), payload: { type: "web_search_call", action: { query: "one" } } },
      { type: "event_msg", timestamp: stamp(5), payload: { type: "web_search_end", call_id: "web", query: "one" } },
      { type: "response_item", timestamp: stamp(6), payload: { type: "function_call", call_id: "read", name: "read", arguments: '{"path":"x"}' } },
      { type: "response_item", timestamp: stamp(9), payload: { type: "function_call_output", call_id: "read", output: "ok" } },
      { type: "event_msg", timestamp: stamp(10), payload: { type: "token_count", info: { total_token_usage: { input_tokens: 30, cached_input_tokens: 10, output_tokens: 5 } } } },
      { type: "event_msg", timestamp: stamp(12), payload: { type: "task_complete", turn_id: "a" } },
      { type: "event_msg", timestamp: stamp(4), payload: { type: "task_started", turn_id: "b" } },
      { type: "turn_context", payload: { turn_id: "b", model: "model-b", effort: "high", summary: "new turn" } },
      { type: "response_item", timestamp: stamp(7), payload: { type: "message", role: "assistant", content: "out of order" } },
      { type: "response_item", timestamp: stamp(11), payload: { type: "function_call_output", call_id: "read", output: "updated" } },
      { type: "turn_context", payload: { turn_id: "a", model: "changed", effort: "medium" } },
      { type: "event_msg", timestamp: stamp(15), payload: { type: "token_count", info: { total_token_usage: { input_tokens: 40, output_tokens: 12 } } } },
      { type: "response_item", timestamp: stamp(-2), payload: { type: "message", role: "user", content: "new origin" } },
    ];

    const request = (i: number) => ({ timestamp: Date.UTC(2026, 0, 1) + i * 1000, message: { text: "request " + i }, response: [{ value: "response" }] });
    const vscodeRecords = [
      { kind: 0, v: { version: 3, sessionId: "retained", requests: [request(1)] } },
      { kind: 2, k: ["requests"], v: [request(10), request(20)] },
      { kind: 2, k: ["requests", 0, "response"], v: [{ kind: "toolInvocationSerialized", toolId: "read", toolCallId: "tool", resultDetails: [{ value: "ok" }] }] },
      { kind: 1, k: ["requests", 0, "response", 1, "resultDetails"], v: [{ value: "error" }] },
      { kind: 1, k: ["requests", 0, "result"], v: { timings: { totalElapsed: 90000 } } },
      { kind: 1, k: ["requests", 1, "response"], v: [] },
      { kind: 1, k: ["selectedModel"], v: { identifier: "new-model" } },
      { kind: 1, k: ["requests", 0, "timestamp"], v: Date.UTC(2026, 0, 1) - 30000 },
      { kind: 1, k: ["customTitle"], v: "Title" },
      { kind: 1, k: ["requests", "length"], v: 1 },
      { kind: 1, k: ["requests"], v: [] },
      { kind: 2, k: ["requests"], v: [request(30)] },
    ];

    describe("cross-record invalidation and delivery", () => {
      for (const [format, records] of Object.entries({ claude: claudeRecords, copilot: copilotRecords, codex: codexRecords, vscode: vscodeRecords })) {
        for (const partition of [1, 3, 100]) {
          it(`${format}: batch oracle parity at every boundary, partition ${partition}`, () => {
            let state = createLiveSessionParser("");
            for (let i = 0; i < records.length; i += partition) {
              const previous = state.result;
              const saved = structuredClone(previous);
              state = appendLiveSessionText(state, encode(records.slice(i, i + partition))).state;
              expect(state.result).toEqual(parseSession(state.rawText));
              expect(previous).toEqual(saved);
            }
          });
        }
        it(`${format}: deterministic random byte partitions, blank lines, CRLF, unfinished tails and reset`, () => {
          const text = "\r\n" + records.map(record => JSON.stringify(record)).join("\r\n\r\n") + "\r\n";
          let state = createLiveSessionParser("");
          let seed = 12345;
          for (let cursor = 0; cursor < text.length;) {
            seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
            const length = seed % 73 + 1;
            state = appendLiveSessionText(state, text.slice(cursor, cursor + length)).state;
            cursor += length;
          }
          expect(state.result).toEqual(parseSession(encode(records)));
          state = appendLiveSessionText(state, '{"unfinished":').state;
          expect(state.pendingText).not.toBe("");
          state = createLiveSessionParser(encode(records.slice(0, 2)));
          expect(state.result).toEqual(parseSession(encode(records.slice(0, 2))));
        });
        if (format !== "vscode") {
          it(`${format}: deterministic reordered-record parity`, () => {
            for (let seed = 1; seed <= 12; seed++) {
              const reordered = records.slice(1);
              let random = seed;
              for (let i = reordered.length - 1; i > 0; i--) {
                random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
                const j = random % (i + 1);
                [reordered[i], reordered[j]] = [reordered[j], reordered[i]];
              }
              let state = createLiveSessionParser(encode(records.slice(0, 1)));
              for (let i = 0; i < reordered.length; i++) {
                state = appendLiveSessionText(state, encode([reordered[i]])).state;
                expect(state.result, `seed=${seed}, record=${i}, type=${(reordered[i] as any).type}`).toEqual(parseSession(state.rawText));
              }
            }
          });
        }
      }
    });

  const fixtures = readdirSync(join(__dirname, "fixtures")).filter(name => name.endsWith(".jsonl"));
  for (const name of fixtures) {
    it(`${name}: every completed prefix agrees with the batch oracle`, () => {
      const text = readFileSync(join(__dirname, "fixtures", name), "utf8");
      let state = createLiveSessionParser("");
      for (const record of text.split("\n").filter(line => line.trim())) {
        state = appendLiveSessionText(state, record + "\n").state;
        expect(state.result).toEqual(parseSession(state.rawText));
      }
      const lines = text.split("\n").filter(line => line.trim());
      for (const partition of [3, lines.length]) {
        state = createLiveSessionParser("\r\n \r\n");
        for (let i = 0; i < lines.length; i += partition) {
          state = appendLiveSessionText(state, lines.slice(i, i + partition).join("\r\n \r\n") + "\r\n").state;
          expect(state.result).toEqual(parseSession(state.rawText));
        }
      }
    });
  }

    describe("bounded late updates", () => {
      for (const size of [100, 5000]) {
        it(`Claude usage and tool results update early records directly after ${size} records`, () => {
          const initial = [
            { type: "assistant", timestamp: stamp(0), message: { id: "dedup", usage: { input_tokens: 1 }, content: [{ type: "tool_use", id: "old", name: "read", input: {} }] } },
            ...workload("claude-code", size),
          ];
          const delta = [
            { type: "assistant", timestamp: stamp(size + 1), message: { id: "dedup", usage: { input_tokens: 50, output_tokens: 10 }, content: [{ type: "text", text: "done" }] } },
            { type: "tool_result", timestamp: stamp(size + 2), tool_use_id: "old", content: "completed" },
          ];
          const state = appendLiveSessionText(createLiveSessionParser(encode(initial)), encode(delta)).state;
          expect(state.result).toEqual(parseSession(encode([...initial, ...delta])));
          expect(state.normalizationWork.events).toBeLessThan(20);
        });
        it(`Copilot completion updates dependent tool/message and turn aggregates after ${size} records`, () => {
          const initial = [
            copilotRecords[0], copilotRecords[1], copilotRecords[2], copilotRecords[3], copilotRecords[4],
            ...Array.from({ length: size }, (_, i) => ({ type: "assistant.message", timestamp: stamp(i + 20), data: { content: "message " + i } })),
          ];
          const delta = [copilotRecords[5]];
          const state = appendLiveSessionText(createLiveSessionParser(encode(initial)), encode(delta)).state;
          expect(state.result).toEqual(parseSession(encode([...initial, ...delta])));
          expect(state.normalizationWork.records).toBeLessThan(5);
          expect(state.normalizationWork.events).toBeLessThan(10);
          expect(state.normalizationWork.turns).toBeLessThan(10);
        });
        it(`Codex lifecycle/model metadata and cumulative tokens avoid revisiting ${size} events`, () => {
          const initial = [
            codexRecords[0], codexRecords[2], codexRecords[3],
            ...Array.from({ length: size }, (_, i) => ({ type: "response_item", timestamp: stamp(i + 20), payload: { type: "message", role: "assistant", content: "message " + i } })),
          ];
          const delta = [codexRecords[15], codexRecords[16], codexRecords[10]];
          const state = appendLiveSessionText(createLiveSessionParser(encode(initial)), encode(delta)).state;
          expect(state.result).toEqual(parseSession(encode([...initial, ...delta])));
          expect(state.normalizationWork.events).toBeLessThan(10);
          expect(state.normalizationWork.turns).toBeLessThan(10);
        });
        it(`VS Code patches one tool result without renormalizing ${size} sibling responses`, () => {
          const initial = [{ kind: 0, v: { version: 3, sessionId: "parts", requests: [{
            message: { text: "hello" }, response: [
              { kind: "toolInvocationSerialized", toolId: "read", resultDetails: [{ value: "initial" }] },
              ...Array.from({ length: size }, (_, i) => ({ value: "message " + i })),
            ],
          }] } }];
          const delta = [{ kind: 1, k: ["requests", 0, "response", 0, "resultDetails"], v: [{ value: "failed" }] }];
          const state = appendLiveSessionText(createLiveSessionParser(encode(initial)), encode(delta)).state;
          expect(state.result).toEqual(parseSession(encode([...initial, ...delta])));
          expect(state.normalizationWork.records).toBeLessThan(5);
          expect(state.normalizationWork.events).toBeLessThan(5);
        });
      }
    });
