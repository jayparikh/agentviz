import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseSessionText } from "../lib/sessionParsing";
import { createSessionStorageId, loadStoredSessionContent, persistSessionSnapshot, pruneDeadEntries, readSessionLibrary, reconcileSessionLibrary, SESSION_LIBRARY_KEY } from "../lib/sessionLibrary.js";

var COPILOT_FIXTURE = readFileSync(resolve(process.cwd(), "src/__tests__/fixtures/test-copilot.jsonl"), "utf8");
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

    // The new session stored successfully
    expect(second.entry.hasContent).toBe(true);
    expect(loadStoredSessionContent(second.entry.id, storage)).toBe(alternateFixture);

    // The evicted session's content is gone
    expect(loadStoredSessionContent(first.entry.id, storage)).toBe("");

    // The library index reflects the eviction: hasContent is false for the evicted entry
    var entries = readSessionLibrary(storage);
    var evictedEntry = entries.find(function (e) { return e.id === first.entry.id; });
    expect(evictedEntry.hasContent).toBe(false);
  });

  it("preserves discoveredPath when refreshing an existing entry", function () {
    var parsed = parseSessionText(COPILOT_FIXTURE);
    var storage = createMemoryStorage();

    expect(parsed.result).toBeTruthy();

    var first = persistSessionSnapshot("test-copilot.jsonl", parsed.result, COPILOT_FIXTURE, storage);
    var entries = readSessionLibrary(storage);
    entries[0].discoveredPath = "C:\\Users\\tester\\.copilot\\session-state\\abc\\events.jsonl";
    storage.setItem("agentviz:session-library:v1", JSON.stringify(entries));

    var second = persistSessionSnapshot("test-copilot.jsonl", parsed.result, COPILOT_FIXTURE, storage);
    expect(second.entry.discoveredPath).toBe("C:\\Users\\tester\\.copilot\\session-state\\abc\\events.jsonl");
  });
});

describe("reconcileSessionLibrary", function () {
  it("corrects stale hasContent flags when content keys are missing", function () {
    var storage = createMemoryStorage();

    // Simulate a stale library: entry claims hasContent but the content key is gone
    storage.setItem(SESSION_LIBRARY_KEY, JSON.stringify([
      { id: "stale-session", file: "stale.jsonl", hasContent: true, updatedAt: "2026-01-01T00:00:00Z" },
      { id: "healthy-session", file: "healthy.jsonl", hasContent: true, updatedAt: "2026-01-02T00:00:00Z" },
    ]));
    // Only the healthy session has actual content
    storage.setItem("agentviz:session-content:v1:healthy-session", "real content");

    var result = reconcileSessionLibrary(storage);

    expect(result).toHaveLength(2);
    expect(result.find(function (e) { return e.id === "stale-session"; }).hasContent).toBe(false);
    expect(result.find(function (e) { return e.id === "healthy-session"; }).hasContent).toBe(true);

    // The fix is persisted to storage
    var persisted = readSessionLibrary(storage);
    expect(persisted.find(function (e) { return e.id === "stale-session"; }).hasContent).toBe(false);
  });

  it("leaves the library unchanged when all flags are accurate", function () {
    var storage = createMemoryStorage();

    storage.setItem(SESSION_LIBRARY_KEY, JSON.stringify([
      { id: "a", file: "a.jsonl", hasContent: true, updatedAt: "2026-01-01T00:00:00Z" },
      { id: "b", file: "b.jsonl", hasContent: false, updatedAt: "2026-01-02T00:00:00Z" },
    ]));
    storage.setItem("agentviz:session-content:v1:a", "content for a");
    var libraryBefore = storage.getItem(SESSION_LIBRARY_KEY);

    reconcileSessionLibrary(storage);

    // No write needed — library string should be identical
    expect(storage.getItem(SESSION_LIBRARY_KEY)).toBe(libraryBefore);
  });
});

describe("pruneDeadEntries", function () {
  it("removes entries with no content and no discoveredPath", function () {
    var storage = createMemoryStorage();
    storage.setItem(SESSION_LIBRARY_KEY, JSON.stringify([
      { id: "alive", file: "a.jsonl", hasContent: true, updatedAt: "2026-01-01T00:00:00Z" },
      { id: "with-path", file: "b.jsonl", hasContent: false, discoveredPath: "/some/path", updatedAt: "2026-01-02T00:00:00Z" },
      { id: "dead", file: "c.jsonl", hasContent: false, updatedAt: "2026-01-03T00:00:00Z" },
    ]));
    storage.setItem("agentviz:session-content:v1:alive", "content");

    var result = pruneDeadEntries(storage);
    expect(result).toHaveLength(2);
    expect(result.map(function (e) { return e.id; })).toEqual(["alive", "with-path"]);

    // Verify the library was written back without the dead entry
    var persisted = JSON.parse(storage.getItem(SESSION_LIBRARY_KEY));
    expect(persisted).toHaveLength(2);
  });

  it("returns all entries when none are dead", function () {
    var storage = createMemoryStorage();
    storage.setItem(SESSION_LIBRARY_KEY, JSON.stringify([
      { id: "a", file: "a.jsonl", hasContent: true, updatedAt: "2026-01-01T00:00:00Z" },
    ]));
    storage.setItem("agentviz:session-content:v1:a", "content");

    var result = pruneDeadEntries(storage);
    expect(result).toHaveLength(1);
  });
});
