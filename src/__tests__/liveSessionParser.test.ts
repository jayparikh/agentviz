import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { createLiveSessionParser, appendLiveSessionText } from "../lib/liveSessionParser";
import { parseSession } from "../lib/parseSession";

function line(obj: unknown): string {
  return JSON.stringify(obj);
}

function readFixture(name: string): string {
  return readFileSync(join(__dirname, "fixtures", name), "utf8");
}

function expectSameSession(actual: any, expected: any): void {
  expect(actual).not.toBeNull();
  expect(expected).not.toBeNull();
  expect(actual.events).toEqual(expected.events);
  expect(actual.turns).toEqual(expected.turns);
  expect(actual.metadata).toEqual(expected.metadata);
}

function appendInBatches(lines: string[], batchSizes: number[]): any {
  var state = createLiveSessionParser("");
  var cursor = 0;
  for (var index = 0; index < batchSizes.length && cursor < lines.length; index += 1) {
    var take = batchSizes[index];
    state = appendLiveSessionText(state, lines.slice(cursor, cursor + take).join("\n")).state;
    cursor += take;
  }
  if (cursor < lines.length) {
    state = appendLiveSessionText(state, lines.slice(cursor).join("\n")).state;
  }
  return state;
}

function buildVSCodePatchJsonlFixture(): string {
  var base = {
    version: 3,
    sessionId: "patch-test",
    creationDate: 1772000000000,
    requests: [],
  };
  var request = {
    requestId: "req-1",
    timestamp: 1772000010000,
    message: { text: "Hello from patch" },
    response: [],
    result: { timings: { totalElapsed: 5000 } },
  };
  return [
    line({ kind: 0, v: base }),
    line({ kind: 1, k: ["customTitle"], v: "Patched Title" }),
    line({ kind: 2, k: ["requests"], v: [request] }),
    line({ kind: 2, k: ["requests", 0, "response"], v: [
      { kind: "thinking", value: "Let me think..." },
      { kind: "toolInvocationSerialized", toolId: "copilot_readFile", invocationMessage: { value: "Read file.ts" }, isConfirmed: { type: 1 }, isComplete: true },
      { value: "Done" },
    ] }),
  ].join("\n");
}

describe("liveSessionParser", function () {
  it("keeps Codex snapshot and multiple append batches equivalent to full parsing", function () {
    var text = readFixture("test-codex.jsonl").trim();
    var lines = text.split("\n");
    var state = createLiveSessionParser(lines.slice(0, 4).join("\n"));
    state = appendLiveSessionText(state, lines.slice(4).join("\n")).state;
    expectSameSession(state.result, parseSession(text));
    expectSameSession(appendInBatches(lines, [1, 2, 1, 3]).result, parseSession(text));
    var split = Math.floor(lines[4].length / 2);
    state = createLiveSessionParser(lines.slice(0, 4).join("\n") + "\n" + lines[4].slice(0, split));
    state = appendLiveSessionText(state, lines[4].slice(split) + "\n" + lines.slice(5).join("\n")).state;
    expectSameSession(state.result, parseSession(text));
    expect(state.format).toBe("codex");
  });
  it("starts empty and reports no parsed session", function () {
    var state = createLiveSessionParser("");
    expect(state.result).toBeNull();
    expect(state.rawText).toBe("");
    expect(state.completeLineCount).toBe(0);
    expect(state.parsedRecordCount).toBe(0);
    expect(state.initialFullParseCount).toBe(0);
    expect(state.fallbackFullParseCount).toBe(0);
  });

  it("matches full parse for Claude Code when appended one line at a time", function () {
    var user = { type: "human", timestamp: "2026-01-01T00:00:00.000Z", message: { content: "hello" } };
    var assistant = { type: "assistant", timestamp: "2026-01-01T00:00:02.000Z", message: { content: [{ type: "text", text: "hi" }] } };
    var lines = [line(user), line(assistant)];
    var state = appendInBatches(lines, [1, 1]);
    expectSameSession(state.result, parseSession(lines.join("\n")));
    expect(state.lastAppendParsedLineCount).toBe(1);
    expect(state.fallbackFullParseCount).toBe(0);
  });

  it("matches full parse for Copilot CLI fixture", function () {
    var text = readFixture("test-copilot.jsonl").trim();
    var lines = text.split("\n");
    var state = appendInBatches(lines, [1, 3, 2, 10]);
    expectSameSession(state.result, parseSession(text));
    expect(state.fallbackFullParseCount).toBe(0);
  });

  it("matches full parse for VS Code JSONL patches", function () {
    var text = buildVSCodePatchJsonlFixture();
    var lines = text.split("\n");
    var state = appendInBatches(lines, [1, 1, 2]);
    expectSameSession(state.result, parseSession(text));
    expect(state.format).toBe("vscode-chat");
    expect(state.fallbackFullParseCount).toBe(0);
  });

  it("counts malformed complete lines while preserving valid records", function () {
    var user = line({ type: "human", timestamp: "2026-01-01T00:00:00.000Z", message: { content: "hello" } });
    var assistant = line({ type: "assistant", timestamp: "2026-01-01T00:00:02.000Z", message: { content: [{ type: "text", text: "hi" }] } });
    var text = user + "\n{broken json\n" + assistant;
    var state = appendLiveSessionText(createLiveSessionParser(""), text).state;
    expect(state.malformedLineCount).toBe(1);
    expectSameSession(state.result, parseSession(text));
  });

  it("detects Copilot format from an empty initial state when session.start arrives first", function () {
    var start = line({ type: "session.start", data: { producer: "copilot-agent", startTime: "2026-03-18T15:00:00.000Z" }, timestamp: "2026-03-18T15:00:00.000Z" });
    var state = appendLiveSessionText(createLiveSessionParser(""), start).state;
    expect(state.format).toBe("copilot-cli");
  });

  it("detects VS Code format from an empty initial state when kind 0 arrives first", function () {
    var base = line({ kind: 0, v: { version: 3, sessionId: "x", creationDate: 1772000000000, requests: [] } });
    var state = appendLiveSessionText(createLiveSessionParser(""), base).state;
    expect(state.format).toBe("vscode-chat");
  });

  it("does not double-insert newlines when initial raw text already ends with newline", function () {
    var first = line({ type: "human", message: { content: "hello" } });
    var second = line({ type: "assistant", message: { content: [{ type: "text", text: "hi" }] } });
    var state = createLiveSessionParser(first + "\n");
    state = appendLiveSessionText(state, second).state;
    expect(state.rawText).toBe(first + "\n" + second);
  });

  it("falls back to full parse when appended records conflict with established format", function () {
    var claude = line({ type: "human", message: { content: "hello" } });
    var copilot = line({ type: "session.start", data: { producer: "copilot-agent" }, timestamp: "2026-01-01T00:00:00.000Z" });
    var state = createLiveSessionParser(claude);
    state = appendLiveSessionText(state, copilot).state;
    expect(state.fallbackFullParseCount).toBeGreaterThan(0);
  });

  it("buffers incomplete trailing JSON instead of counting it malformed", function () {
    var state = appendLiveSessionText(createLiveSessionParser(""), "{\"type\":\"human\",").state;
    expect(state.malformedLineCount).toBe(0);
    expect(state.pendingText).not.toBe("");
  });

  it("joins split JSON fragments without inserting a synthetic newline", function () {
    var first = "{\"type\":\"human\",";
    var second = "\"message\":{\"content\":\"hello\"}}";
    var state = appendLiveSessionText(createLiveSessionParser(""), first).state;
    state = appendLiveSessionText(state, second).state;
    expect(state.rawText).toBe(first + second);
    expect(state.pendingText).toBe("");
    expect(state.parsedRecordCount).toBe(1);
  });

  it("keeps append parse counters proportional to appended lines", function () {
    var lines: string[] = [];
    for (var index = 0; index < 100; index += 1) {
      lines.push(line({
        type: "human",
        timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
        message: { content: "msg " + index },
      }));
    }

    var state = createLiveSessionParser(lines.slice(0, 90).join("\n"));
    var initialFullParses = state.initialFullParseCount;
    state = appendLiveSessionText(state, lines.slice(90).join("\n")).state;

    expect(state.initialFullParseCount).toBe(initialFullParses);
    expect(state.fallbackFullParseCount).toBe(0);
    expect(state.lastAppendParsedLineCount).toBe(10);
    expect(state.parsedRecordCount).toBe(100);
  });

  it("applies VS Code patches without fallback after kind 0", function () {
    var lines = buildVSCodePatchJsonlFixture().split("\n");
    var state = createLiveSessionParser(lines[0]);
    state = appendLiveSessionText(state, lines.slice(1).join("\n")).state;
    expect(state.format).toBe("vscode-chat");
    expect(state.fallbackFullParseCount).toBe(0);
    expect(state.lastAppendParsedLineCount).toBe(lines.length - 1);
  });
});
