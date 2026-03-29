import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, vi } from "vitest";

// Check if node:sqlite is available (experimental, may not be in CI)
var hasSqlite = false;
try { await import("node:sqlite"); hasSqlite = true; } catch (e) {}
import {
  buildQAProgressPayload,
  createServer,
  createSessionQACacheStore,
  buildQADonePayload,
  buildQASessionConfig,
  buildSessionQAPrecomputeEntry,
  buildSessionQAPrecomputeFingerprint,
  describeQAToolStatus,
    ensureSessionQAPrecomputed,
    getCompleteJsonlLines,
    getSessionQACacheEntry,
    getSessionQAPrecomputeCacheDir,
    getSessionQASidecarFilePath,
    readSessionQAPrecompute,
    getQAEventText,
    getJsonlStreamChunk,
    getSessionQAHistoryEntry,
  getSessionQAHistoryFilePath,
  readSessionQAHistoryStore,
  removeSessionQAHistoryEntry,
  resolveSessionQAArtifacts,
  saveSessionQACacheEntry,
  saveSessionQAHistoryEntry,
  writeSessionQAPrecompute,
} from "../../server.js";
import {
  ensureSessionQAFactStore,
  getManagedSessionQAFactStorePath,
  getSessionQAFactStoreSidecarPath,
  querySessionQAFactStore,
} from "../../src/lib/sessionQAFactStore.js";
import { compileSessionQAQueryProgram } from "../../src/lib/sessionQA.js";

describe("server live JSONL helpers", function () {
  it("ignores a trailing partial Claude record until it is newline-terminated", function () {
    var firstChunk = getJsonlStreamChunk(
      '{"type":"user","message":{"content":"hello"}}\n'
      + '{"type":"assistant","message":{"content":[{"type":"text","text":"partial"}}',
      0
    );

    expect(firstChunk.lines).toEqual([
      '{"type":"user","message":{"content":"hello"}}',
    ]);
    expect(firstChunk.nextLineIdx).toBe(1);

    var secondChunk = getJsonlStreamChunk(
      '{"type":"user","message":{"content":"hello"}}\n'
      + '{"type":"assistant","message":{"content":[{"type":"text","text":"partial"}]}}\n',
      firstChunk.nextLineIdx
    );

    expect(secondChunk.lines).toEqual([
      '{"type":"assistant","message":{"content":[{"type":"text","text":"partial"}]}}',
    ]);
    expect(secondChunk.nextLineIdx).toBe(2);
  });

  it("counts only complete newline-terminated records during initialization", function () {
    var lines = getCompleteJsonlLines(
      '{"type":"user","message":{"content":"hello"}}\n'
      + '{"type":"assistant","message":{"content":[{"type":"text","text":"partial"}}'
    );

    expect(lines).toEqual([
      '{"type":"user","message":{"content":"hello"}}',
    ]);
  });
});

describe("Q&A session config", function () {
  it("always replaces the system message for resumed and new sessions", function () {
    var approve = vi.fn();
    var config = buildQASessionConfig("system prompt", approve);

    expect(config).toEqual({
      onPermissionRequest: approve,
      streaming: true,
      systemMessage: {
        mode: "replace",
        content: "system prompt",
      },
    });
  });
});

describe("Q&A streaming helpers", function () {
  it("extracts delta text from SDK streaming events", function () {
    expect(getQAEventText({ deltaContent: "hello" }, true)).toBe("hello");
  });

  it("extracts final text from array-based content payloads", function () {
    expect(getQAEventText({ content: [{ text: "hello" }, { text: " world" }] }, false)).toBe("hello world");
  });

  it("formats friendly tool progress labels", function () {
    expect(describeQAToolStatus("view", "start")).toBe("Searching the session...");
    expect(describeQAToolStatus("powershell", "complete")).toBe("Analyzing command output...");
  });

  it("builds rich progress payloads with phase metadata and timing", function () {
    expect(buildQAProgressPayload("waiting-for-model", {
      detail: "Prompt sent. Waiting for the first model response.",
      elapsedMs: 1875,
    })).toEqual({
      status: "Waiting for model response...",
      phase: "waiting-for-model",
      detail: "Prompt sent. Waiting for the first model response.",
      elapsedMs: 1875,
    });
  });

  it("adds tool details to tool progress payloads", function () {
    expect(buildQAProgressPayload("tool-running", {
      toolName: "view",
      elapsedMs: 2400,
    })).toEqual({
      status: "Searching the session...",
      phase: "tool-running",
      detail: "Tool: view",
      elapsedMs: 2400,
    });
  });

  it("includes timing metadata in the done payload", function () {
    expect(buildQADonePayload(
      "hello",
      [{ turnIndex: 0 }],
      "gpt-5.4",
      "sdk-session-1",
      1000,
      9250
    )).toEqual({
      done: true,
      answer: "hello",
      references: [{ turnIndex: 0 }],
      model: "gpt-5.4",
      qaSessionId: "sdk-session-1",
      timing: { totalMs: 8250 },
    });
  });
});

describe("Q&A history persistence", function () {
  it("persists and removes session history entries on disk", function () {
    var tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentviz-qa-history-"));
    var historyFile = getSessionQAHistoryFilePath(tempDir);

    expect(readSessionQAHistoryStore(historyFile).sessions).toEqual({});

    var saved = saveSessionQAHistoryEntry(historyFile, "session-key", {
      messages: [
        { role: "user", content: "hello" },
        { role: "assistant", content: "world", references: [{ turnIndex: 0 }], timing: { totalMs: 8200 } },
      ],
      qaSessionId: "sdk-session-1",
      responseModel: "gpt-5.4",
    });

    expect(saved.qaSessionId).toBe("sdk-session-1");
    expect(getSessionQAHistoryEntry(historyFile, "session-key").messages.length).toBe(2);
    expect(getSessionQAHistoryEntry(historyFile, "session-key").messages[1].timing).toEqual({ totalMs: 8200 });

    expect(removeSessionQAHistoryEntry(historyFile, "session-key")).toBe(true);
    expect(getSessionQAHistoryEntry(historyFile, "session-key")).toBeNull();

    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});

describe("Q&A session cache", function () {
  it("registers session artifacts by stable sessionKey", function () {
    var cache = createSessionQACacheStore();
    var saved = saveSessionQACacheEntry(cache, "session-key", {
      events: [{ t: 1, agent: "assistant", track: "output", text: "hello" }],
      turns: [{ index: 0, eventIndices: [0], startTime: 0, endTime: 1 }],
      metadata: { totalEvents: 1, totalTurns: 1, duration: 1 },
      sessionFilePath: "C:\\sessions\\agentviz.jsonl",
    });

    expect(saved.sessionFilePath).toBe("C:\\sessions\\agentviz.jsonl");
    expect(getSessionQACacheEntry(cache, "session-key")).toMatchObject({
      metadata: { totalEvents: 1, totalTurns: 1, duration: 1 },
      sessionFilePath: "C:\\sessions\\agentviz.jsonl",
    });
    expect(getSessionQACacheEntry(cache, "session-key").events).toHaveLength(1);
    expect(getSessionQACacheEntry(cache, "session-key").turns).toHaveLength(1);
  });

  it("resolves lean qa payloads from cached session artifacts", function () {
    var cache = createSessionQACacheStore();
    saveSessionQACacheEntry(cache, "session-key", {
      events: [{ t: 1, agent: "assistant", track: "output", text: "hello" }],
      turns: [{ index: 0, eventIndices: [0], startTime: 0, endTime: 1 }],
      metadata: { totalEvents: 1, totalTurns: 1, duration: 1 },
      sessionFilePath: "C:\\sessions\\agentviz.jsonl",
    });

    var resolved = resolveSessionQAArtifacts(cache, {
      sessionKey: "session-key",
      question: "What happened?",
    });

    expect(resolved).toMatchObject({
      sessionKey: "session-key",
      source: "cache",
      metadata: { totalEvents: 1, totalTurns: 1, duration: 1 },
      sessionFilePath: "C:\\sessions\\agentviz.jsonl",
    });
    expect(resolved.events[0].text).toBe("hello");
    expect(resolved.turns[0].index).toBe(0);
  });

  it("seeds the cache from inline artifacts when a sessionKey is supplied", function () {
    var cache = createSessionQACacheStore();
    var resolved = resolveSessionQAArtifacts(cache, {
      sessionKey: "session-key",
      events: [{ t: 1, agent: "assistant", track: "output", text: "hello" }],
      turns: [{ index: 0, eventIndices: [0], startTime: 0, endTime: 1 }],
      metadata: { totalEvents: 1, totalTurns: 1, duration: 1 },
      sessionFilePath: "C:\\sessions\\agentviz.jsonl",
    });

    expect(resolved.source).toBe("inline");
    expect(getSessionQACacheEntry(cache, "session-key")).toMatchObject({
      metadata: { totalEvents: 1, totalTurns: 1, duration: 1 },
      sessionFilePath: "C:\\sessions\\agentviz.jsonl",
    });
  });
});

describe("Q&A precompute persistence", function () {
  it("builds sidecar and managed precompute paths", function () {
    expect(getSessionQASidecarFilePath("C:\\sessions\\events.jsonl")).toBe("C:\\sessions\\events.agentviz-qa.json");
    expect(getSessionQAPrecomputeCacheDir("C:\\tmp\\agentviz-home")).toBe(path.join("C:\\tmp\\agentviz-home", ".agentviz", "session-qa-cache"));
  });

  it("changes the precompute fingerprint when the raw session content changes", function () {
    var base = buildSessionQAPrecomputeFingerprint({
      events: [{ t: 1, agent: "assistant", track: "output", text: "hello" }],
      turns: [{ index: 0, eventIndices: [0], startTime: 0, endTime: 1 }],
      metadata: { totalEvents: 1, totalTurns: 1, duration: 1 },
      rawText: "{\"type\":\"assistant\"}\n",
    });
    var changed = buildSessionQAPrecomputeFingerprint({
      events: [{ t: 1, agent: "assistant", track: "output", text: "hello" }],
      turns: [{ index: 0, eventIndices: [0], startTime: 0, endTime: 1 }],
      metadata: { totalEvents: 1, totalTurns: 1, duration: 1 },
      rawText: "{\"type\":\"assistant\",\"extra\":true}\n",
    });

    expect(changed).not.toBe(base);
  });

  it("writes and reuses a persisted sidecar artifact when a session path is available", function () {
    var tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentviz-qa-precompute-"));
    var sessionDir = path.join(tempDir, "sessions");
    var sessionFile = path.join(sessionDir, "events.jsonl");
    fs.mkdirSync(sessionDir, { recursive: true });
    fs.writeFileSync(
      sessionFile,
      [
        "{\"type\":\"tool.execution_start\",\"data\":{\"toolName\":\"bash\",\"toolInput\":{\"command\":\"npm test\"},\"toolCallId\":\"call-1\"}}",
        "{\"type\":\"tool.execution_complete\",\"data\":{\"toolCallId\":\"call-1\",\"result\":\"FAIL src/auth.test.js\"}}",
      ].join("\n") + "\n",
      "utf8"
    );

    var entry = {
      events: [
        {
          t: 1,
          agent: "assistant",
          track: "tool_call",
          text: "npm test",
          duration: 1,
          toolName: "bash",
          toolInput: { command: "npm test" },
          turnIndex: 0,
        },
      ],
      turns: [{ index: 0, eventIndices: [0], startTime: 0, endTime: 1, userMessage: "hello" }],
      metadata: { totalEvents: 1, totalTurns: 1, totalToolCalls: 1, duration: 1, format: "copilot-cli" },
      sessionFilePath: sessionFile,
    };

    var first = buildSessionQAPrecomputeEntry(entry, { homeDir: tempDir });
    var second = buildSessionQAPrecomputeEntry(entry, { homeDir: tempDir });
    var persisted = readSessionQAPrecompute(getSessionQASidecarFilePath(sessionFile));

    expect(first.storage).toBe("sidecar");
    expect(first.reused).toBe(false);
    expect(fs.existsSync(getSessionQASidecarFilePath(sessionFile))).toBe(true);
    expect(second.reused).toBe(true);
    expect(second.fingerprint).toBe(first.fingerprint);
    expect(persisted.version).toBe(2);
    expect(persisted.rawText).toBeNull();
    expect(persisted.artifacts.rawIndex).toBeNull();
    expect(persisted.artifacts.ledgerIndex).toBeUndefined();
    expect(persisted.artifacts.rawLookup).toEqual({ matchedCount: expect.any(Number) });
    expect(
      !persisted.artifacts.ledger[0].rawSlice ||
      persisted.artifacts.ledger[0].rawSlice.text === undefined
    ).toBe(true);
    expect(second.artifacts.rawLookup.rawText).toContain("\"tool.execution_start\"");
    expect(second.artifacts.ledgerIndex.entriesById[second.artifacts.ledger[0].id].toolName).toBe("bash");

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("reuses in-memory precompute artifacts when the fingerprint is unchanged", function () {
    var tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentviz-qa-cache-"));
    var cache = createSessionQACacheStore();
    var saved = saveSessionQACacheEntry(cache, "session-key", {
      events: [{ t: 1, agent: "assistant", track: "output", text: "hello" }],
      turns: [{ index: 0, eventIndices: [0], startTime: 0, endTime: 1, userMessage: "hello" }],
      metadata: { totalEvents: 1, totalTurns: 1, totalToolCalls: 0, duration: 1, format: "copilot-cli" },
      rawText: "{\"type\":\"assistant\",\"message\":{\"content\":\"hello\"}}\n",
    });

    var first = ensureSessionQAPrecomputed(saved, { homeDir: tempDir });
    var second = ensureSessionQAPrecomputed(saved, { homeDir: tempDir });

    expect(first).toBe(second);
    expect(first.artifacts.metricCatalog.totalTurns).toBe(1);

    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});

describe("Q&A fact store", function () {
  it("builds sidecar and managed fact-store paths", function () {
    expect(getSessionQAFactStoreSidecarPath("C:\\sessions\\events.jsonl")).toBe("C:\\sessions\\events.agentviz-qa.sqlite");
    var managedPath = getManagedSessionQAFactStorePath("fingerprint-1", "C:\\tmp\\agentviz-home");
    expect(path.dirname(managedPath)).toBe(path.join("C:\\tmp\\agentviz-home", ".agentviz", "session-qa-cache"));
    expect(path.basename(managedPath)).toMatch(/^session-\d+\.sqlite$/);
  });

  it("answers deterministic turn lookups from the SQLite fact store", async function () {
    if (!hasSqlite) return;
    var tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentviz-qa-fact-store-"));
    var cache = createSessionQACacheStore();
    var rawText = [
      "{\"type\":\"tool.execution_start\",\"data\":{\"toolCallId\":\"call-1\",\"toolName\":\"bash\",\"arguments\":{\"command\":\"npm test\"}}}",
      "{\"type\":\"tool.execution_complete\",\"data\":{\"toolCallId\":\"call-1\",\"result\":{\"content\":\"FAIL src/auth.test.js\"}}}",
    ].join("\n") + "\n";
    var saved = saveSessionQACacheEntry(cache, "session-key", {
      events: [
        {
          t: 1,
          agent: "assistant",
          track: "tool_call",
          text: "FAIL src/auth.test.js",
          duration: 4,
          toolName: "bash",
          toolInput: { command: "npm test" },
          isError: true,
          turnIndex: 0,
        },
      ],
      turns: [
        {
          index: 0,
          eventIndices: [0],
          startTime: 0,
          endTime: 4,
          userMessage: "Run npm test",
          toolCount: 1,
          hasError: true,
        },
      ],
      metadata: {
        totalEvents: 1,
        totalTurns: 1,
        totalToolCalls: 1,
        errorCount: 1,
        duration: 4,
        format: "copilot-cli",
      },
      rawText: rawText,
    });

    var precomputed = ensureSessionQAPrecomputed(saved, { homeDir: tempDir });
    var factStore = await ensureSessionQAFactStore(saved, precomputed, { homeDir: tempDir });
    var program = compileSessionQAQueryProgram("What happened in Turn 0?", precomputed.artifacts);
    var result = await querySessionQAFactStore(program, factStore, { rawText: rawText });

    expect(factStore.path).toBeTruthy();
    expect(fs.existsSync(factStore.path)).toBe(true);
    expect(result.answer).toContain("Turn 0 ran 1 tool call");
    expect(result.references).toEqual([{ turnIndex: 0 }]);

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("builds compact summary context for model-backed questions", async function () {
    if (!hasSqlite) return;
    var tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentviz-qa-fact-store-summary-"));
    var cache = createSessionQACacheStore();
    var saved = saveSessionQACacheEntry(cache, "session-key", {
      events: [
        {
          t: 1,
          agent: "assistant",
          track: "tool_call",
          text: "Viewed src/auth.js",
          duration: 1,
          toolName: "view",
          toolInput: { path: "src/auth.js" },
          turnIndex: 0,
        },
        {
          t: 3,
          agent: "assistant",
          track: "tool_call",
          text: "Edited src/auth.js",
          duration: 1,
          toolName: "edit",
          toolInput: { path: "src/auth.js" },
          turnIndex: 1,
        },
      ],
      turns: [
        { index: 0, eventIndices: [0], startTime: 0, endTime: 1, userMessage: "Inspect auth", toolCount: 1, hasError: false },
        { index: 1, eventIndices: [1], startTime: 2, endTime: 3, userMessage: "Patch auth", toolCount: 1, hasError: false },
      ],
      metadata: {
        totalEvents: 2,
        totalTurns: 2,
        totalToolCalls: 2,
        duration: 3,
        format: "copilot-cli",
      },
    });

    var precomputed = ensureSessionQAPrecomputed(saved, { homeDir: tempDir });
    var factStore = await ensureSessionQAFactStore(saved, precomputed, { homeDir: tempDir });
    var program = compileSessionQAQueryProgram("What was the overall approach?", precomputed.artifacts);
    var result = await querySessionQAFactStore(program, factStore, {});

    expect(result.context).toContain("FACT STORE SESSION SUMMARY");
    expect(result.context).toContain("Turns 0-1");

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns a deterministic out-of-range answer for invalid turn indices", async function () {
    if (!hasSqlite) return;
    var tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentviz-qa-oor-"));
    var cache = createSessionQACacheStore();
    var saved = saveSessionQACacheEntry(cache, "session-key", {
      events: [
        { t: 1, agent: "assistant", track: "tool_call", text: "test output", duration: 4, toolName: "bash", toolInput: { command: "npm test" }, isError: false, turnIndex: 0 },
      ],
      turns: [
        { index: 0, eventIndices: [0], startTime: 0, endTime: 4, userMessage: "Run tests", toolCount: 1, hasError: false },
      ],
      metadata: { totalEvents: 1, totalTurns: 1, totalToolCalls: 1, errorCount: 0, duration: 4, format: "copilot-cli" },
      rawText: "{\"type\":\"tool.execution_start\"}\n",
    });

    var precomputed = ensureSessionQAPrecomputed(saved, { homeDir: tempDir });
    var factStore = await ensureSessionQAFactStore(saved, precomputed, { homeDir: tempDir });
    var program = compileSessionQAQueryProgram("What happened in Turn 99?", precomputed.artifacts);
    var result = await querySessionQAFactStore(program, factStore, {});

    expect(result).toBeTruthy();
    expect(result.answer).toContain("out of range");
    expect(result.answer).toContain("zero-based");
    expect(result.answer).toContain("0");
    expect(result.model).toBe("AGENTVIZ turn-range guard");

    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});

describe("Q&A body overflow handling", function () {
  it("returns 413 with Connection: keep-alive for oversized /api/session-qa-cache POST", async function () {
    var http = await import("node:http");
    var server = createServer({ distDir: "./dist", maxBodyBytes: 1024 });
    await new Promise(function (resolve) { server.listen(0, resolve); });
    var port = server.address().port;

    try {
      var response = await new Promise(function (resolve, reject) {
        var body = JSON.stringify({ sessionKey: "test", rawText: "x".repeat(2048) });
        var req = http.request({
          hostname: "127.0.0.1",
          port: port,
          path: "/api/session-qa-cache",
          method: "POST",
          headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
        }, function (res) {
          var data = "";
          res.on("data", function (c) { data += c; });
          res.on("end", function () { resolve({ status: res.statusCode, headers: res.headers, body: data }); });
        });
        req.on("error", reject);
        req.write(body);
        req.end();
      });

      expect(response.status).toBe(413);
      expect(response.headers["content-type"]).toContain("application/json");
      expect(response.headers["connection"]).toBe("keep-alive");
      expect(JSON.parse(response.body).error).toContain("too large");

      // Verify the server still accepts subsequent requests
      var healthCheck = await new Promise(function (resolve, reject) {
        var req = http.request({
          hostname: "127.0.0.1",
          port: port,
          path: "/api/meta",
          method: "GET",
        }, function (res) {
          var data = "";
          res.on("data", function (c) { data += c; });
          res.on("end", function () { resolve({ status: res.statusCode, body: data }); });
        });
        req.on("error", reject);
        req.end();
      });

      expect(healthCheck.status).toBe(200);
    } finally {
      server.close();
    }
  });
});
