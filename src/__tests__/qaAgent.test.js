import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mock the Copilot SDK before qaAgent imports it ──────────────────────────
var mockSession = {
  on: vi.fn(),
  send: vi.fn(),
  disconnect: vi.fn().mockReturnValue(Promise.resolve()),
  abort: vi.fn().mockReturnValue(Promise.resolve()),
};

var mockClient = {
  start: vi.fn().mockResolvedValue(undefined),
  createSession: vi.fn().mockResolvedValue(mockSession),
};

vi.mock("@github/copilot-sdk", function () {
  return {
    CopilotClient: vi.fn().mockImplementation(function () { return mockClient; }),
    approveAll: vi.fn(),
  };
});

// Import AFTER mock is in place -- resetModules ensures fresh module state per test
var mod;
beforeEach(async function () {
  vi.resetModules();
  mod = await import("../lib/qaAgent.js");
});

afterEach(function () {
  if (mod && mod.resetQASession) mod.resetQASession();
  vi.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// resetQASession
// ─────────────────────────────────────────────────────────────────────────────

describe("resetQASession", function () {
  it("is a function export", function () {
    expect(typeof mod.resetQASession).toBe("function");
  });

  it("does not throw when called with no active session", function () {
    expect(function () { mod.resetQASession(); }).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// runQAQuery -- streaming behavior
// ─────────────────────────────────────────────────────────────────────────────

describe("runQAQuery", function () {
  it("streams tokens via onToken callback", async function () {
    var tokens = [];

    mockSession.on.mockImplementation(function (handler) {
      queueMicrotask(function () {
        handler({ type: "content.delta", data: { text: "Hello" } });
        handler({ type: "content.delta", data: { text: " world" } });
        handler({ type: "session.idle" });
      });
      return function unsubscribe() {};
    });
    mockSession.send.mockResolvedValue(undefined);

    await mod.runQAQuery(
      { question: "What happened?", context: { metadata: "test" } },
      { onToken: function (t) { tokens.push(t); } }
    );

    expect(tokens).toEqual(["Hello", " world"]);
  });

  it("calls onStatus with progress updates", async function () {
    var statuses = [];

    mockSession.on.mockImplementation(function (handler) {
      queueMicrotask(function () {
        handler({ type: "session.idle" });
      });
      return function unsubscribe() {};
    });
    mockSession.send.mockResolvedValue(undefined);

    await mod.runQAQuery(
      { question: "test", context: {} },
      { onStatus: function (s) { statuses.push(s); } }
    );

    expect(statuses).toContain("Connecting to AI...");
    expect(statuses).toContain("Generating answer...");
  });

  it("rejects on session error events", async function () {
    mockSession.on.mockImplementation(function (handler) {
      queueMicrotask(function () {
        handler({ type: "session.error", data: { message: "model overloaded" } });
      });
      return function unsubscribe() {};
    });
    mockSession.send.mockResolvedValue(undefined);

    await expect(
      mod.runQAQuery({ question: "test", context: {} }, {})
    ).rejects.toThrow("model overloaded");
  });

  it("respects abort signal", async function () {
    var controller = new AbortController();
    controller.abort();

    // Even with a session that would respond, pre-aborted signal should throw
    mockSession.on.mockImplementation(function () {
      return function unsubscribe() {};
    });

    await expect(
      mod.runQAQuery({ question: "test", context: {} }, { signal: controller.signal })
    ).rejects.toThrow("Aborted");
  });

  it("uses assistant.message when no deltas arrive", async function () {
    var tokens = [];

    mockSession.on.mockImplementation(function (handler) {
      queueMicrotask(function () {
        handler({ type: "assistant.message", data: { content: "Full answer here" } });
        handler({ type: "session.idle" });
      });
      return function unsubscribe() {};
    });
    mockSession.send.mockResolvedValue(undefined);

    await mod.runQAQuery(
      { question: "test", context: {} },
      { onToken: function (t) { tokens.push(t); } }
    );

    expect(tokens).toEqual(["Full answer here"]);
  });

  it("ignores assistant.message when deltas were received", async function () {
    var tokens = [];

    mockSession.on.mockImplementation(function (handler) {
      queueMicrotask(function () {
        handler({ type: "content.delta", data: { text: "streamed" } });
        handler({ type: "assistant.message", data: { content: "full duplicate" } });
        handler({ type: "session.idle" });
      });
      return function unsubscribe() {};
    });
    mockSession.send.mockResolvedValue(undefined);

    await mod.runQAQuery(
      { question: "test", context: {} },
      { onToken: function (t) { tokens.push(t); } }
    );

    expect(tokens).toEqual(["streamed"]);
  });

  it("includes conversation history in prompt when provided", async function () {
    var sentPrompt = null;

    mockSession.on.mockImplementation(function (handler) {
      queueMicrotask(function () {
        handler({ type: "session.idle" });
      });
      return function unsubscribe() {};
    });
    mockSession.send.mockImplementation(function (msg) {
      sentPrompt = msg.prompt;
      return Promise.resolve();
    });

    await mod.runQAQuery(
      {
        question: "follow-up question",
        context: { metadata: "test" },
        history: [
          { role: "user", content: "first question" },
          { role: "assistant", content: "first answer" },
        ],
      },
      {}
    );

    expect(sentPrompt).toContain("Prior conversation");
    expect(sentPrompt).toContain("User: first question");
    expect(sentPrompt).toContain("Assistant: first answer");
    expect(sentPrompt).toContain("follow-up question");
  });
});
