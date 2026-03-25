import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseSessionText } from "../lib/sessionParsing";
import { createSessionStorageId, loadStoredSessionContent, persistSessionSnapshot, readSessionLibrary } from "../lib/sessionLibrary.js";

var COPILOT_FIXTURE = readFileSync(resolve(process.cwd(), "test-files/test-copilot.jsonl"), "utf8");
var CLAUDE_FIXTURE = [
  "{\"type\":\"user\",\"message\":{\"content\":\"Ship the fix safely\"},\"timestamp\":\"2026-03-01T10:00:00.000Z\"}",
  "{\"type\":\"assistant\",\"message\":{\"model\":\"claude-sonnet-4-5\",\"usage\":{\"input_tokens\":1200,\"output_tokens\":500},\"content\":[{\"type\":\"text\",\"text\":\"I'll inspect the current implementation.\"},{\"type\":\"tool_use\",\"name\":\"bash\",\"input\":{\"command\":\"npm test\"}}]},\"timestamp\":\"2026-03-01T10:00:04.000Z\"}",
  "{\"type\":\"assistant\",\"message\":{\"content\":[{\"type\":\"tool_result\",\"content\":\"Error: 2 tests failed\",\"is_error\":true},{\"type\":\"text\",\"text\":\"I found the regression and will add coverage.\"}]},\"timestamp\":\"2026-03-01T10:00:20.000Z\"}",
  "{\"type\":\"user\",\"message\":{\"content\":\"Please add a regression test too.\"},\"timestamp\":\"2026-03-01T10:01:00.000Z\"}",
  "{\"type\":\"assistant\",\"message\":{\"content\":[{\"type\":\"text\",\"text\":\"Added the regression test and reran the suite.\"}]},\"timestamp\":\"2026-03-01T10:01:12.000Z\"}",
].join("\n");

function createMemoryStorage() {
  var storage = {};

  return {
    getItem: function (key) { return Object.prototype.hasOwnProperty.call(storage, key) ? storage[key] : null; },
    setItem: function (key, value) { storage[key] = String(value); },
    removeItem: function (key) { delete storage[key]; },
    clear: function () { storage = {}; },
  };
}

function createQuotaStorage(maxContentEntries) {
  var storage = {};

  function countContentEntries() {
    return Object.keys(storage).filter(function (key) {
      return key.indexOf("agentviz:session-content:v1:") === 0;
    }).length;
  }

  return {
    getItem: function (key) { return Object.prototype.hasOwnProperty.call(storage, key) ? storage[key] : null; },
    setItem: function (key, value) {
      var nextValue = String(value);
      var isContentKey = key.indexOf("agentviz:session-content:v1:") === 0;
      var isNewKey = !Object.prototype.hasOwnProperty.call(storage, key);

      if (isContentKey && isNewKey && countContentEntries() >= maxContentEntries) {
        var error = new Error("Quota exceeded");
        error.name = "QuotaExceededError";
        throw error;
      }

      storage[key] = nextValue;
    },
    removeItem: function (key) { delete storage[key]; },
    clear: function () { storage = {}; },
  };
}

describe("session library persistence", function () {
  it("stores metadata summaries and raw content for imported copilot sessions", function () {
    var parsed = parseSessionText(COPILOT_FIXTURE);
    var storage = createMemoryStorage();

    expect(parsed.result).toBeTruthy();

    var persisted = persistSessionSnapshot("test-copilot.jsonl", parsed.result, COPILOT_FIXTURE, storage);
    var entries = readSessionLibrary(storage);

    expect(persisted.entry.format).toBe("copilot-cli");
    expect(entries).toHaveLength(1);
    expect(entries[0].autonomyMetrics).toBeTruthy();
    expect(entries[0].autonomyMetrics.totalToolCalls).toBe(parsed.result.metadata.totalToolCalls);
    expect(loadStoredSessionContent(entries[0].id, storage)).toBe(COPILOT_FIXTURE);
  });

  it("updates an existing claude session entry instead of duplicating it", function () {
    var parsed = parseSessionText(CLAUDE_FIXTURE);
    var storage = createMemoryStorage();

    expect(parsed.result).toBeTruthy();

    var first = persistSessionSnapshot("claude-session.jsonl", parsed.result, CLAUDE_FIXTURE, storage);
    var second = persistSessionSnapshot("claude-session.jsonl", parsed.result, CLAUDE_FIXTURE, storage);
    var entries = readSessionLibrary(storage);
    var expectedId = createSessionStorageId("claude-session.jsonl", parsed.result.metadata, CLAUDE_FIXTURE);

    expect(first.entry.id).toBe(expectedId);
    expect(second.entry.id).toBe(expectedId);
    expect(entries).toHaveLength(1);
    expect(entries[0].format).toBe("claude-code");
    expect(entries[0].autonomyMetrics.interventionCount).toBe(1);
    expect(entries[0].errorCount).toBeGreaterThan(0);
  });

  it("evicts older cached content when storage quota is exceeded", function () {
    var parsed = parseSessionText(COPILOT_FIXTURE);
    var storage = createQuotaStorage(1);
    var alternateFixture = COPILOT_FIXTURE + "\n";
    var secondResult = {
      events: parsed.result.events,
      turns: parsed.result.turns,
      metadata: Object.assign({}, parsed.result.metadata, { sessionId: String(parsed.result.metadata.sessionId || "session") + "-2" }),
    };

    var first = persistSessionSnapshot("session-a.jsonl", parsed.result, COPILOT_FIXTURE, storage);
    var second = persistSessionSnapshot("session-b.jsonl", secondResult, alternateFixture, storage);

    expect(first.entry.hasContent).toBe(true);
    expect(second.entry.hasContent).toBe(true);
    expect(loadStoredSessionContent(first.entry.id, storage)).toBe("");
    expect(loadStoredSessionContent(second.entry.id, storage)).toBe(alternateFixture);
  });
});
