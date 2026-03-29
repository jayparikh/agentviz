// @vitest-environment jsdom

import { act } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import App from "../App.jsx";
import { parseSessionText } from "../lib/sessionParsing";
import { persistSessionSnapshot } from "../lib/sessionLibrary.js";

var FIXTURE_TEXT = readFileSync(resolve(process.cwd(), "test-files/test-copilot.jsonl"), "utf8");

function click(node) {
  if (!node) throw new Error("Expected node to click");
  return act(async function () {
    node.click();
  });
}

function changeInput(node, value) {
  if (!node) throw new Error("Expected input node");
  return act(async function () {
    var prototype = Object.getPrototypeOf(node);
    var descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
    descriptor.set.call(node, value);
    node.dispatchEvent(new Event("input", { bubbles: true }));
    node.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function sleep(ms) {
  await act(async function () {
    await new Promise(function (resolve) { setTimeout(resolve, ms); });
  });
}

async function waitFor(check, message, timeout) {
  var start = Date.now();
  var limit = timeout || 3000;
  while (Date.now() - start < limit) {
    var result = check();
    if (result) return result;
    await sleep(20);
  }
  throw new Error(message || "Timed out waiting for condition");
}

function findByText(container, text) {
  return Array.from(container.querySelectorAll("*"))
    .find(function (node) {
      return node.textContent && node.textContent.includes(text);
    }) || null;
}

function findByPattern(container, pattern) {
  return Array.from(container.querySelectorAll("*"))
    .find(function (node) {
      return node.textContent && pattern.test(node.textContent);
    }) || null;
}

function findExactButton(container, text) {
  return Array.from(container.querySelectorAll("button"))
    .find(function (node) {
      return node.textContent && node.textContent.trim() === text;
    }) || null;
}

function findClickableText(container, text) {
  return Array.from(container.querySelectorAll("button, span"))
    .find(function (node) {
      return node.textContent && node.textContent.trim() === text;
    }) || null;
}

function createInactiveFetch() {
  return vi.fn(async function () {
    return { ok: false };
  });
}

// Create a mock SSE response that streams a Q&A answer
function createSSEResponse(data) {
  var answer = data.answer || "";
  var refs = data.references || [];
  var model = data.model || "default";
  var qaSessionId = data.qaSessionId || null;
  var timing = data.timing || null;
  // Build SSE payload: one delta with the full text, then a done event
  var sseText = "data: " + JSON.stringify({ delta: answer }) + "\n\n" +
    "data: " + JSON.stringify({
      done: true,
      answer: answer,
      references: refs,
      model: model,
      qaSessionId: qaSessionId,
      timing: timing,
    }) + "\n\n";
  var encoder = new TextEncoder();
  var bytes = encoder.encode(sseText);
  var stream = new ReadableStream({
    start: function (controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
  return { ok: true, body: stream };
}

function createChunkedSSEResponse(events, delays) {
  var encoder = new TextEncoder();
  var stream = new ReadableStream({
    start: function (controller) {
      var index = 0;
      function enqueueNext() {
        if (index >= events.length) {
          controller.close();
          return;
        }
        controller.enqueue(encoder.encode("data: " + JSON.stringify(events[index]) + "\n\n"));
        var delay = Array.isArray(delays) ? (delays[index] || 0) : (delays || 0);
        index++;
        setTimeout(enqueueNext, delay);
      }
      enqueueNext();
    },
  });
  return { ok: true, body: stream };
}

function createSessionQAHistoryFetch(qaHandler) {
  var historyStore = {};
  var cacheStore = {};
  var fetchMock = vi.fn(async function (url, opts) {
    var s = String(url);
    if (s.includes("/api/session-qa-cache")) {
      var cacheUrlObj = new URL(s, "http://localhost");
      var cacheSessionKey = cacheUrlObj.searchParams.get("sessionKey");
      var cacheMethod = opts && opts.method ? opts.method : "GET";
      if (cacheMethod === "POST") {
        var cacheBody = JSON.parse(opts.body);
        cacheStore[cacheBody.sessionKey] = {
          events: cacheBody.events || [],
          turns: cacheBody.turns || [],
          metadata: cacheBody.metadata || {},
          sessionFilePath: cacheBody.sessionFilePath || null,
        };
        return {
          ok: true,
          json: async function () { return { success: true, sessionKey: cacheBody.sessionKey }; },
        };
      }
      if (cacheMethod === "DELETE") {
        delete cacheStore[cacheSessionKey];
        return {
          ok: true,
          json: async function () { return { success: true }; },
        };
      }
      return {
        ok: true,
        json: async function () { return { session: cacheSessionKey ? (cacheStore[cacheSessionKey] || null) : null }; },
      };
    }
    if (s.includes("/api/session-qa-history")) {
      var urlObj = new URL(s, "http://localhost");
      var sessionKey = urlObj.searchParams.get("sessionKey");
      var method = opts && opts.method ? opts.method : "GET";
      if (method === "POST") {
        var body = JSON.parse(opts.body);
        historyStore[body.sessionKey] = body.history;
        return {
          ok: true,
          json: async function () { return { success: true, history: historyStore[body.sessionKey] }; },
        };
      }
      if (method === "DELETE") {
        delete historyStore[sessionKey];
        return {
          ok: true,
          json: async function () { return { success: true }; },
        };
      }
      return {
        ok: true,
        json: async function () { return { history: sessionKey ? (historyStore[sessionKey] || null) : null }; },
      };
    }
    return qaHandler ? qaHandler(url, opts, historyStore, cacheStore) : { ok: false };
  });

  return { fetchMock: fetchMock, historyStore: historyStore, cacheStore: cacheStore };
}

async function renderApp(fetchImpl) {
  global.fetch = fetchImpl || createInactiveFetch();
  var container = document.createElement("div");
  document.body.appendChild(container);
  var root = createRoot(container);

  await act(async function () {
    root.render(<App />);
  });

  return {
    container: container,
    unmount: async function () {
      await act(async function () {
        root.unmount();
      });
      container.remove();
    },
  };
}

beforeEach(function () {
  var storage = {};
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  global.localStorage = {
    getItem: function (key) { return Object.prototype.hasOwnProperty.call(storage, key) ? storage[key] : null; },
    setItem: function (key, value) { storage[key] = String(value); },
    removeItem: function (key) { delete storage[key]; },
    clear: function () { storage = {}; },
  };
  global.ResizeObserver = class {
    observe() {}
    disconnect() {}
  };
  global.EventSource = class {
    close() {}
  };
  Object.defineProperty(window.navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: vi.fn(function () { return Promise.resolve(); }),
    },
  });
  document.body.innerHTML = "";
});

afterEach(function () {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("Q&A view integration", function () {
  it("renders the Q&A empty state with suggested questions when tab is clicked", async function () {
    var parsed = parseSessionText(FIXTURE_TEXT);
    persistSessionSnapshot("fixture.jsonl", parsed.result, FIXTURE_TEXT, global.localStorage);

    var app = await renderApp();

    await waitFor(function () {
      return findByText(app.container, "Inbox");
    }, "expected landing inbox to render");

    await click(findExactButton(app.container, "Open in Observe"));
    await waitFor(function () {
      return findByText(app.container, "fixture.jsonl");
    }, "expected stored session to open");

    // Navigate to Q&A tab
    await click(findClickableText(app.container, "Q&A"));
    await waitFor(function () {
      return findByText(app.container, "Ask about this session");
    }, "expected Q&A empty state to render");

    // Verify suggested questions are rendered
    expect(findByText(app.container, "What tools were used most frequently?")).toBeTruthy();
    expect(findByText(app.container, "What errors occurred and how were they resolved?")).toBeTruthy();

    // Verify input is present
    var input = app.container.querySelector("input[placeholder*='Ask a question']");
    expect(input).toBeTruthy();

    // Verify model selector is present in the header
    var modelSelect = app.container.querySelector("select[title='Choose model']");
    expect(modelSelect).toBeTruthy();
    expect(modelSelect.value).toBe("gpt-5.4"); // default model

    // Verify send button
    expect(findExactButton(app.container, "Send")).toBeTruthy();

    // Verify model status bar (no response yet)
    expect(findByText(app.container, "Powered by Copilot SDK")).toBeTruthy();

    await app.unmount();
  });

  it("shows a user message in the chat when a question is submitted", async function () {
    // Mock fetch to return a Q&A answer and capture the request body
    var qaFetchCalled = false;
    var capturedBody = null;
    var fetchMock = vi.fn(async function (url, opts) {
      if (String(url).includes("/api/qa")) {
        qaFetchCalled = true;
        if (opts && opts.body) capturedBody = JSON.parse(opts.body);
        return createSSEResponse({
          answer: "The session used the view tool in [Turn 0].",
          references: [{ turnIndex: 0 }],
          model: "gpt-5.4",
          timing: { totalMs: 8200 },
        });
      }
      return { ok: false };
    });

    var parsed = parseSessionText(FIXTURE_TEXT);
    persistSessionSnapshot("fixture.jsonl", parsed.result, FIXTURE_TEXT, global.localStorage);

    var app = await renderApp(fetchMock);

    await waitFor(function () {
      return findByText(app.container, "Inbox");
    }, "expected landing inbox to render");

    await click(findExactButton(app.container, "Open in Observe"));
    await waitFor(function () {
      return findByText(app.container, "fixture.jsonl");
    }, "expected stored session to open");

    await click(findClickableText(app.container, "Q&A"));
    await waitFor(function () {
      return findByText(app.container, "Ask about this session");
    }, "expected Q&A view to render");

    // Type a question into the input
    var input = app.container.querySelector("input[placeholder*='Ask a question']");
    await changeInput(input, "What tools were used?");

    // Submit the form
    await click(findExactButton(app.container, "Send"));

    // The user message should appear
    await waitFor(function () {
      return findByText(app.container, "What tools were used?");
    }, "expected user message to appear in chat");

    // The assistant response should appear
    await waitFor(function () {
      return findByText(app.container, "The session used the view tool");
    }, "expected assistant response to appear in chat", 5000);

    // Verify the fetch was called with /api/qa
    expect(qaFetchCalled).toBe(true);

    // Verify the [Turn 0] reference is rendered as a clickable link
    var turnRef = app.container.querySelector("button[title='Jump to Turn 0']");
    expect(turnRef).toBeTruthy();
    expect(turnRef.textContent).toBe("[Turn 0]");

    // Verify the model label is displayed
    expect(findByText(app.container, "Powered by GPT-5.4")).toBeTruthy();
    expect(findByText(app.container, "Answered in 8.2s")).toBeTruthy();

    // Verify the request included the selected model
    expect(capturedBody).toBeTruthy();
    expect(capturedBody.model).toBe("gpt-5.4");

    // Verify clicking a turn reference navigates to replay view
    await click(turnRef);
    await waitFor(function () {
      // After clicking a turn ref, the view should switch to replay
      return findByText(app.container, "Replay");
    }, "expected view to switch to replay after turn click");

    await app.unmount();
  });

  it("renders progress states and partial streamed answers incrementally", async function () {
    var fetchMock = vi.fn(async function (url) {
      if (String(url).includes("/api/qa")) {
        return createChunkedSSEResponse([
          {
            status: "Preparing session context...",
            phase: "preparing-context",
            detail: "Reviewing 42 events across 3 turns.",
            elapsedMs: 0,
          },
          {
            status: "Waiting for model response...",
            phase: "waiting-for-model",
            detail: "Prompt sent. Raw session file access is available if the model needs exact output.",
            elapsedMs: 1250,
          },
          {
            status: "Streaming answer...",
            phase: "streaming-answer",
            detail: "Composing the final answer.",
            elapsedMs: 1600,
          },
          { delta: "First chunk" },
          { delta: " and more" },
          { done: true, answer: "First chunk and more", references: [], model: "gpt-5.4" },
        ], [120, 180, 120, 250, 0, 0]);
      }
      return { ok: false };
    });

    var parsed = parseSessionText(FIXTURE_TEXT);
    persistSessionSnapshot("fixture.jsonl", parsed.result, FIXTURE_TEXT, global.localStorage);

    var app = await renderApp(fetchMock);

    await waitFor(function () {
      return findByText(app.container, "Inbox");
    }, "expected landing inbox to render");

    await click(findExactButton(app.container, "Open in Observe"));
    await waitFor(function () {
      return findByText(app.container, "fixture.jsonl");
    }, "expected stored session to open");

    await click(findClickableText(app.container, "Q&A"));
    await waitFor(function () {
      return findByText(app.container, "Ask about this session");
    }, "expected Q&A view to render");

    var input = app.container.querySelector("input[placeholder*='Ask a question']");
    await changeInput(input, "Stream it");
    await click(findExactButton(app.container, "Send"));

    await waitFor(function () {
      return findByText(app.container, "Preparing session context...");
    }, "expected initial progress state");

    await waitFor(function () {
      return findByText(app.container, "Reviewing 42 events across 3 turns.");
    }, "expected progress detail");

    await waitFor(function () {
      return findByText(app.container, "Waiting for model response...");
    }, "expected updated progress phase");

    await waitFor(function () {
      return findByText(app.container, "Prompt sent. Raw session file access is available if the model needs exact output.");
    }, "expected waiting detail");

    await waitFor(function () {
      return findByPattern(app.container, /^Elapsed 1\.[0-9]s$/);
    }, "expected live elapsed label");

    await waitFor(function () {
      return findByText(app.container, "First chunk");
    }, "expected first streamed chunk");

    await waitFor(function () {
      return findByText(app.container, "First chunk and more");
    }, "expected final streamed answer", 5000);

    await waitFor(function () {
      return !findByText(app.container, "Waiting for model response...");
    }, "expected waiting progress to clear");
    await waitFor(function () {
      return !findByText(app.container, "Composing the final answer.");
    }, "expected streaming detail to clear");
    await waitFor(function () {
      return !findByPattern(app.container, /^Elapsed /);
    }, "expected elapsed label to clear");

    await app.unmount();
  });

  it("renders router-specific progress updates for precomputed metric answers", async function () {
    var qaServer = createSessionQAHistoryFetch(async function (url) {
      if (String(url).includes("/api/qa")) {
        return createChunkedSSEResponse([
          {
            status: "Using precomputed metrics...",
            phase: "using-precomputed-metrics",
            detail: "Matched the longest autonomous run from the precomputed metrics catalog.",
            elapsedMs: 180,
          },
          {
            done: true,
            answer: "The longest autonomous run lasted 7s in [Turn 0].",
            references: [{ turnIndex: 0 }],
            model: "AGENTVIZ precomputed metrics",
          },
        ], [120, 0]);
      }
      return { ok: false };
    });

    var parsed = parseSessionText(FIXTURE_TEXT);
    persistSessionSnapshot("fixture.jsonl", parsed.result, FIXTURE_TEXT, global.localStorage);

    var app = await renderApp(qaServer.fetchMock);

    await waitFor(function () {
      return findByText(app.container, "Inbox");
    }, "expected landing inbox to render");

    await click(findExactButton(app.container, "Open in Observe"));
    await waitFor(function () {
      return findByText(app.container, "fixture.jsonl");
    }, "expected stored session to open");

    await click(findClickableText(app.container, "Q&A"));
    await waitFor(function () {
      return findByText(app.container, "Ask about this session");
    }, "expected Q&A view to render");

    var input = app.container.querySelector("input[placeholder*='Ask a question']");
    await changeInput(input, "How long was the longest autonomous agent run in this session?");
    await click(findExactButton(app.container, "Send"));

    await waitFor(function () {
      return findByText(app.container, "Using precomputed metrics...");
    }, "expected router progress label");

    await waitFor(function () {
      return findByText(app.container, "Matched the longest autonomous run from the precomputed metrics catalog.");
    }, "expected router progress detail");

    await waitFor(function () {
      return findByText(app.container, "The longest autonomous run lasted 7s in [Turn 0].");
    }, "expected direct metric answer");

    await waitFor(function () {
      return !findByText(app.container, "Using precomputed metrics...");
    }, "expected router progress label to clear");
    await waitFor(function () {
      return !findByText(app.container, "Matched the longest autonomous run from the precomputed metrics catalog.");
    }, "expected router progress detail to clear");
    expect(findByText(app.container, "Powered by AGENTVIZ precomputed metrics")).toBeTruthy();

    await app.unmount();
  });

  it("renders query-program and fact-store progress updates before the model answers", async function () {
    var qaServer = createSessionQAHistoryFetch(async function (url) {
      if (String(url).includes("/api/qa")) {
        return createChunkedSSEResponse([
          {
            status: "Compiling query program...",
            phase: "compiling-query-program",
            detail: "Compiled the question into the session summary family before choosing the fastest route.",
            elapsedMs: 35,
          },
          {
            status: "Checking paraphrase-aware cache...",
            phase: "checking-paraphrase-cache",
            detail: "No paraphrase-aware cache hit yet, so AGENTVIZ will evaluate the live session facts.",
            elapsedMs: 60,
          },
          {
            status: "Querying SQLite fact store...",
            phase: "querying-fact-store",
            detail: "Querying the SQLite fact store for the session summary family.",
            elapsedMs: 95,
          },
          {
            status: "Canceling slower route...",
            phase: "canceling-slower-route",
            detail: "The fact-store route produced enough context, so AGENTVIZ skipped the slower fallback path.",
            elapsedMs: 120,
          },
          {
            status: "Waiting for model response...",
            phase: "waiting-for-model",
            detail: "Prompt sent. Waiting for the first model response.",
            elapsedMs: 180,
          },
          {
            done: true,
            answer: "The session focused on inspecting and then editing auth.js.",
            references: [],
            model: "gpt-5.4",
          },
        ], [40, 40, 40, 40, 40, 0]);
      }
      return { ok: false };
    });

    var parsed = parseSessionText(FIXTURE_TEXT);
    persistSessionSnapshot("fixture.jsonl", parsed.result, FIXTURE_TEXT, global.localStorage);

    var app = await renderApp(qaServer.fetchMock);

    await waitFor(function () {
      return findByText(app.container, "Inbox");
    }, "expected landing inbox to render");

    await click(findExactButton(app.container, "Open in Observe"));
    await waitFor(function () {
      return findByText(app.container, "fixture.jsonl");
    }, "expected stored session to open");

    await click(findClickableText(app.container, "Q&A"));
    await waitFor(function () {
      return findByText(app.container, "Ask about this session");
    }, "expected Q&A view to render");

    var input = app.container.querySelector("input[placeholder*='Ask a question']");
    await changeInput(input, "What was the overall approach?");
    await click(findExactButton(app.container, "Send"));

    await waitFor(function () {
      return findByText(app.container, "Compiling query program...");
    }, "expected query-program progress label");

    await waitFor(function () {
      return findByText(app.container, "Querying SQLite fact store...");
    }, "expected fact-store progress label");

    await waitFor(function () {
      return findByText(app.container, "The session focused on inspecting and then editing auth.js.");
    }, "expected final answer");

    await waitFor(function () {
      return !findByText(app.container, "Querying SQLite fact store...");
    }, "expected fact-store progress label to clear");

    await app.unmount();
  });

  it("shows an error when the server returns a failure", async function () {
    var fetchMock = vi.fn(async function (url) {
      if (String(url).includes("/api/qa")) {
        return { ok: false, status: 500 };
      }
      return { ok: false };
    });

    var parsed = parseSessionText(FIXTURE_TEXT);
    persistSessionSnapshot("fixture.jsonl", parsed.result, FIXTURE_TEXT, global.localStorage);

    var app = await renderApp(fetchMock);

    await waitFor(function () {
      return findByText(app.container, "Inbox");
    }, "expected landing inbox to render");

    await click(findExactButton(app.container, "Open in Observe"));
    await waitFor(function () {
      return findByText(app.container, "fixture.jsonl");
    }, "expected stored session to open");

    await click(findClickableText(app.container, "Q&A"));
    await waitFor(function () {
      return findByText(app.container, "Ask about this session");
    }, "expected Q&A view to render");

    // Submit via a suggested question button
    await click(findExactButton(app.container, "What tools were used most frequently?"));

    // Should show the user message
    await waitFor(function () {
      return findByText(app.container, "What tools were used most frequently?");
    }, "expected user message to appear");

    // Should show an error message
    await waitFor(function () {
      return findByText(app.container, "Server error: 500");
    }, "expected error message to appear", 5000);

    await app.unmount();
  });

  it("clears the conversation when the Clear button is clicked", async function () {
    var fetchMock = vi.fn(async function (url) {
      if (String(url).includes("/api/qa")) {
        return createSSEResponse({ answer: "Here is your answer.", references: [] });
      }
      return { ok: false };
    });

    var parsed = parseSessionText(FIXTURE_TEXT);
    persistSessionSnapshot("fixture.jsonl", parsed.result, FIXTURE_TEXT, global.localStorage);

    var app = await renderApp(fetchMock);

    await waitFor(function () {
      return findByText(app.container, "Inbox");
    }, "expected landing inbox to render");

    await click(findExactButton(app.container, "Open in Observe"));
    await waitFor(function () {
      return findByText(app.container, "fixture.jsonl");
    }, "expected session to open");

    await click(findClickableText(app.container, "Q&A"));
    await waitFor(function () {
      return findByText(app.container, "Ask about this session");
    }, "expected Q&A view to render");

    // Ask a question
    var input = app.container.querySelector("input[placeholder*='Ask a question']");
    await changeInput(input, "Hello?");
    await click(findExactButton(app.container, "Send"));

    // Wait for response
    await waitFor(function () {
      return findByText(app.container, "Here is your answer.");
    }, "expected response to appear", 5000);

    // Session Q&A header with Clear button should now be visible
    expect(findByText(app.container, "Session Q&A")).toBeTruthy();
    var clearBtn = app.container.querySelector("button[title='Clear conversation']");
    expect(clearBtn).toBeTruthy();

    // Click Clear
    await click(clearBtn);

    // Should return to the empty state with suggested questions
    await waitFor(function () {
      return findByText(app.container, "Ask about this session");
    }, "expected empty state to return after clearing");

    // The old messages should be gone
    expect(findByText(app.container, "Hello?")).toBeFalsy();
    expect(findByText(app.container, "Here is your answer.")).toBeFalsy();

    await app.unmount();
  });

  it("does not crash when rendering any theme styles", async function () {
    // This test specifically catches the theme.spacing vs theme.space bug
    var parsed = parseSessionText(FIXTURE_TEXT);
    persistSessionSnapshot("fixture.jsonl", parsed.result, FIXTURE_TEXT, global.localStorage);

    var app = await renderApp();

    await waitFor(function () {
      return findByText(app.container, "Inbox");
    }, "expected inbox to render");

    await click(findExactButton(app.container, "Open in Observe"));
    await waitFor(function () {
      return findByText(app.container, "fixture.jsonl");
    }, "expected session to open");

    // Switch to Q&A - this should NOT throw
    await click(findClickableText(app.container, "Q&A"));

    // If we get here without a crash, the theme tokens are valid
    await waitFor(function () {
      return findByText(app.container, "Ask about this session");
    }, "expected Q&A to render without crashing");

    // Verify inline styles are applied (not undefined/NaN)
    var input = app.container.querySelector("input[placeholder*='Ask a question']");
    expect(input).toBeTruthy();
    expect(input.style.fontSize).not.toBe("");
    expect(input.style.borderRadius).not.toBe("");

    await app.unmount();
  });

  it("persists the model choice across tab switches", async function () {
    var parsed = parseSessionText(FIXTURE_TEXT);
    persistSessionSnapshot("fixture.jsonl", parsed.result, FIXTURE_TEXT, global.localStorage);

    var app = await renderApp();

    await waitFor(function () {
      return findByText(app.container, "Inbox");
    }, "expected inbox to render");

    await click(findExactButton(app.container, "Open in Observe"));
    await waitFor(function () {
      return findByText(app.container, "fixture.jsonl");
    }, "expected session to open");

    // Go to Q&A
    await click(findClickableText(app.container, "Q&A"));
    await waitFor(function () {
      return findByText(app.container, "Ask about this session");
    }, "expected Q&A to render");

    // Change model to claude-sonnet-4
    var modelSelect = app.container.querySelector("select[title='Choose model']");
    expect(modelSelect).toBeTruthy();
    await act(async function () {
      var descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(modelSelect), "value");
      descriptor.set.call(modelSelect, "claude-sonnet-4");
      modelSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(modelSelect.value).toBe("claude-sonnet-4");

    // Switch to Stats tab
    await click(findClickableText(app.container, "Stats"));
    await waitFor(function () {
      return findByText(app.container, "Session Overview");
    }, "expected stats view to render");

    // Switch back to Q&A
    await click(findClickableText(app.container, "Q&A"));
    await waitFor(function () {
      return findByText(app.container, "Ask about this session");
    }, "expected Q&A to render again");

    // Model should still be claude-sonnet-4
    var modelSelectAfter = app.container.querySelector("select[title='Choose model']");
    expect(modelSelectAfter.value).toBe("claude-sonnet-4");

    await app.unmount();
  });

  it("shows a fresh Q&A when switching to a new session", async function () {
    var callCount = 0;
    var fetchMock = vi.fn(async function (url) {
      if (String(url).includes("/api/qa")) {
        callCount++;
        return createSSEResponse({ answer: "Answer " + callCount + ".", references: [] });
      }
      return { ok: false };
    });

    var parsed = parseSessionText(FIXTURE_TEXT);
    persistSessionSnapshot("session-a.jsonl", parsed.result, FIXTURE_TEXT, global.localStorage);
    persistSessionSnapshot("session-b.jsonl", parsed.result, FIXTURE_TEXT, global.localStorage);

    var app = await renderApp(fetchMock);

    await waitFor(function () {
      return findByText(app.container, "Inbox");
    }, "expected inbox to render");

    // Open first session
    var openButtons = Array.from(app.container.querySelectorAll("button"))
      .filter(function (b) { return b.textContent.trim() === "Open in Observe"; });
    await click(openButtons[0]);
    await waitFor(function () {
      return findClickableText(app.container, "Replay");
    }, "expected session to open");

    // Go to Q&A and ask a question
    await click(findClickableText(app.container, "Q&A"));
    await waitFor(function () {
      return findByText(app.container, "Ask about this session");
    }, "expected Q&A to render");

    var input = app.container.querySelector("input[placeholder*='Ask a question']");
    await changeInput(input, "Question for session A");
    await click(findExactButton(app.container, "Send"));

    await waitFor(function () {
      return findByText(app.container, "Answer 1.");
    }, "expected response", 5000);

    // Go back to inbox
    var resetBtn = app.container.querySelector("button[title='Back to Inbox']");
    if (!resetBtn) { await app.unmount(); return; }
    await click(resetBtn);
    await waitFor(function () {
      return findByText(app.container, "Inbox");
    }, "expected inbox after reset");

    // Open the other session
    var openBtns2 = Array.from(app.container.querySelectorAll("button"))
      .filter(function (b) { return b.textContent.trim() === "Open in Observe"; });
    await click(openBtns2.length > 1 ? openBtns2[1] : openBtns2[0]);
    await waitFor(function () {
      return findClickableText(app.container, "Replay");
    }, "expected second session to open");

    // Q&A should show empty state (no conversation from session A)
    await click(findClickableText(app.container, "Q&A"));
    await waitFor(function () {
      return findByText(app.container, "Ask about this session");
    }, "expected fresh Q&A for new session");

    expect(findByText(app.container, "Question for session A")).toBeFalsy();
    expect(findByText(app.container, "Answer 1.")).toBeFalsy();

    await app.unmount();
  });

  it("restores Q&A conversation when returning to a previous session", async function () {
    var callCount = 0;
    var fetchMock = vi.fn(async function (url) {
      if (String(url).includes("/api/qa")) {
        callCount++;
        return createSSEResponse({ answer: "Answer " + callCount + ".", references: [] });
      }
      return { ok: false };
    });

    var parsed = parseSessionText(FIXTURE_TEXT);
    persistSessionSnapshot("session-a.jsonl", parsed.result, FIXTURE_TEXT, global.localStorage);
    persistSessionSnapshot("session-b.jsonl", parsed.result, FIXTURE_TEXT, global.localStorage);

    var app = await renderApp(fetchMock);

    await waitFor(function () {
      return findByText(app.container, "Inbox");
    }, "expected inbox");

    // Open session A and ask a question
    var openButtons = Array.from(app.container.querySelectorAll("button"))
      .filter(function (b) { return b.textContent.trim() === "Open in Observe"; });
    await click(openButtons[0]);
    await waitFor(function () {
      return findClickableText(app.container, "Replay");
    }, "expected session A to open");

    await click(findClickableText(app.container, "Q&A"));
    await waitFor(function () {
      return findByText(app.container, "Ask about this session");
    }, "expected Q&A");

    var input = app.container.querySelector("input[placeholder*='Ask a question']");
    await changeInput(input, "Question for A");
    await click(findExactButton(app.container, "Send"));
    await waitFor(function () {
      return findByText(app.container, "Answer 1.");
    }, "expected answer for A", 5000);

    // Go to session B
    var resetBtn = app.container.querySelector("button[title='Back to Inbox']");
    if (!resetBtn) { await app.unmount(); return; }
    await click(resetBtn);
    await waitFor(function () {
      return findByText(app.container, "Inbox");
    }, "expected inbox");

    var openBtns2 = Array.from(app.container.querySelectorAll("button"))
      .filter(function (b) { return b.textContent.trim() === "Open in Observe"; });
    await click(openBtns2.length > 1 ? openBtns2[1] : openBtns2[0]);
    await waitFor(function () {
      return findClickableText(app.container, "Replay");
    }, "expected session B to open");

    // Ask a question in session B
    await click(findClickableText(app.container, "Q&A"));
    await waitFor(function () {
      return findByText(app.container, "Ask about this session");
    }, "expected fresh Q&A for B");

    input = app.container.querySelector("input[placeholder*='Ask a question']");
    await changeInput(input, "Question for B");
    await click(findExactButton(app.container, "Send"));
    await waitFor(function () {
      return findByText(app.container, "Answer 2.");
    }, "expected answer for B", 5000);

    // Go back to session A
    resetBtn = app.container.querySelector("button[title='Back to Inbox']");
    if (!resetBtn) { await app.unmount(); return; }
    await click(resetBtn);
    await waitFor(function () {
      return findByText(app.container, "Inbox");
    }, "expected inbox again");

    var openBtns3 = Array.from(app.container.querySelectorAll("button"))
      .filter(function (b) { return b.textContent.trim() === "Open in Observe"; });
    await click(openBtns3[0]);
    await waitFor(function () {
      return findClickableText(app.container, "Replay");
    }, "expected session A to reopen");

    await click(findClickableText(app.container, "Q&A"));

    // Session A's conversation should be restored
    await waitFor(function () {
      return findByText(app.container, "Question for A");
    }, "expected session A conversation to be restored");

    expect(findByText(app.container, "Answer 1.")).toBeTruthy();
    // Session B's messages should NOT be present
    expect(findByText(app.container, "Question for B")).toBeFalsy();
    expect(findByText(app.container, "Answer 2.")).toBeFalsy();

    await app.unmount();
  });

  it("clears per-session history when Clear is clicked", async function () {
    var historyFetch = createSessionQAHistoryFetch(async function (url) {
      if (String(url).includes("/api/qa")) {
        return createSSEResponse({ answer: "Some answer.", references: [] });
      }
      return { ok: false };
    });
    var fetchMock = historyFetch.fetchMock;
    var historyStore = historyFetch.historyStore;

    var parsed = parseSessionText(FIXTURE_TEXT);
    persistSessionSnapshot("fixture.jsonl", parsed.result, FIXTURE_TEXT, global.localStorage);

    var app = await renderApp(fetchMock);

    await waitFor(function () {
      return findByText(app.container, "Inbox");
    }, "expected inbox");

    await click(findExactButton(app.container, "Open in Observe"));
    await waitFor(function () {
      return findByText(app.container, "fixture.jsonl");
    }, "expected session to open");

    await click(findClickableText(app.container, "Q&A"));
    await waitFor(function () {
      return findByText(app.container, "Ask about this session");
    }, "expected Q&A");

    // Ask and get a response
    var input = app.container.querySelector("input[placeholder*='Ask a question']");
    await changeInput(input, "My question");
    await click(findExactButton(app.container, "Send"));
    await waitFor(function () {
      return findByText(app.container, "Some answer.");
    }, "expected answer", 5000);

    expect(Object.keys(historyStore).length).toBe(1);

    // Clear the conversation
    var clearBtn = app.container.querySelector("button[title='Clear conversation']");
    await click(clearBtn);

    await waitFor(function () {
      return findByText(app.container, "Ask about this session");
    }, "expected empty state after clear");

    // Switch away and back -- should still be empty (clear purges saved history)
    await click(findClickableText(app.container, "Stats"));
    await waitFor(function () {
      return findByText(app.container, "Session Overview");
    }, "expected stats");

    await click(findClickableText(app.container, "Q&A"));
    await waitFor(function () {
      return findByText(app.container, "Ask about this session");
    }, "expected empty Q&A after returning");

    expect(findByText(app.container, "My question")).toBeFalsy();
    expect(findByText(app.container, "Some answer.")).toBeFalsy();

    expect(Object.keys(historyStore).length).toBe(0);

    await app.unmount();

    var app2 = await renderApp(fetchMock);

    await waitFor(function () {
      return findByText(app2.container, "Inbox");
    }, "expected inbox after remount");

    await click(findExactButton(app2.container, "Open in Observe"));
    await waitFor(function () {
      return findByText(app2.container, "fixture.jsonl");
    }, "expected session after remount");

    await click(findClickableText(app2.container, "Q&A"));
    await waitFor(function () {
      return findByText(app2.container, "Ask about this session");
    }, "expected empty Q&A after remount");

    expect(findByText(app2.container, "My question")).toBeFalsy();
    expect(findByText(app2.container, "Some answer.")).toBeFalsy();

    await app2.unmount();
  });

  it("lists all available models in the dropdown", async function () {
    var parsed = parseSessionText(FIXTURE_TEXT);
    persistSessionSnapshot("fixture.jsonl", parsed.result, FIXTURE_TEXT, global.localStorage);

    var app = await renderApp();

    await waitFor(function () {
      return findByText(app.container, "Inbox");
    }, "expected inbox to render");

    await click(findExactButton(app.container, "Open in Observe"));
    await waitFor(function () {
      return findByText(app.container, "fixture.jsonl");
    }, "expected session to open");

    await click(findClickableText(app.container, "Q&A"));
    await waitFor(function () {
      return findByText(app.container, "Ask about this session");
    }, "expected Q&A to render");

    var modelSelect = app.container.querySelector("select[title='Choose model']");
    var options = Array.from(modelSelect.querySelectorAll("option"));

    // Verify key models are present
    var optionLabels = options.map(function (o) { return o.textContent; });
    expect(optionLabels).toContain("GPT-5.4");
    expect(optionLabels).toContain("GPT-5.2");
    expect(optionLabels).toContain("GPT-4.1");
    expect(optionLabels).toContain("Claude Sonnet 4.5");
    expect(optionLabels).toContain("Claude Sonnet 4");
    expect(optionLabels).toContain("Claude Opus 4.6");
    expect(optionLabels).toContain("Claude Haiku 4.5");

    // Should have a substantial number of models
    expect(options.length).toBeGreaterThanOrEqual(10);

    await app.unmount();
  });

  it("persists Q&A conversations via server-backed history across app restarts", async function () {
    var historyFetch = createSessionQAHistoryFetch(async function (url) {
      if (String(url).includes("/api/qa")) {
        return createSSEResponse({
          answer: "Persisted answer.",
          references: [],
          model: "gpt-5.4",
          qaSessionId: "sdk-session-123",
          timing: { totalMs: 8200 },
        });
      }
      return { ok: false };
    });
    var fetchMock = historyFetch.fetchMock;
    var historyStore = historyFetch.historyStore;

    var parsed = parseSessionText(FIXTURE_TEXT);
    persistSessionSnapshot("persist-test.jsonl", parsed.result, FIXTURE_TEXT, global.localStorage);

    // First app instance: ask a question
    var app1 = await renderApp(fetchMock);

    await waitFor(function () {
      return findByText(app1.container, "Inbox");
    }, "expected inbox");

    await click(findExactButton(app1.container, "Open in Observe"));
    await waitFor(function () {
      return findClickableText(app1.container, "Replay");
    }, "expected session to open");

    await click(findClickableText(app1.container, "Q&A"));
    await waitFor(function () {
      return findByText(app1.container, "Ask about this session");
    }, "expected Q&A");

    var input = app1.container.querySelector("input[placeholder*='Ask a question']");
    await changeInput(input, "Question that should persist");
    await click(findExactButton(app1.container, "Send"));

    await waitFor(function () {
      return findByText(app1.container, "Persisted answer.");
    }, "expected answer", 5000);

    var keys = Object.keys(historyStore);
    expect(keys.length).toBeGreaterThanOrEqual(1);
    var entry = historyStore[keys[0]];
    expect(entry).toBeTruthy();
    expect(entry.messages.length).toBe(2); // user + assistant
    expect(entry.qaSessionId).toBe("sdk-session-123");
    expect(entry.messages[1].timing).toEqual({ totalMs: 8200 });

    await app1.unmount();

    // Second app instance: should restore the conversation from localStorage
    var app2 = await renderApp(fetchMock);

    await waitFor(function () {
      return findByText(app2.container, "Inbox");
    }, "expected inbox on second mount");

    await click(findExactButton(app2.container, "Open in Observe"));
    await waitFor(function () {
      return findClickableText(app2.container, "Replay");
    }, "expected session to reopen");

    await click(findClickableText(app2.container, "Q&A"));

    // The old conversation should be restored from server-backed history
    await waitFor(function () {
      return findByText(app2.container, "Question that should persist");
    }, "expected persisted user message to be restored");

    expect(findByText(app2.container, "Persisted answer.")).toBeTruthy();
    expect(findByText(app2.container, "Answered in 8.2s")).toBeTruthy();

    await app2.unmount();
  });

  it("sends lean follow-up requests with qaSessionId for session resumption", async function () {
    var callCount = 0;
    var capturedBodies = [];
    var historyFetch = createSessionQAHistoryFetch(async function (url, opts) {
      if (String(url).includes("/api/qa")) {
        callCount++;
        if (opts && opts.body) capturedBodies.push(JSON.parse(opts.body));
        return createSSEResponse({
          answer: "Answer " + callCount + ".",
          references: [],
          model: "gpt-5.4",
          qaSessionId: "sdk-sess-456",
        });
      }
      return { ok: false };
    });
    var fetchMock = historyFetch.fetchMock;
    var cacheStore = historyFetch.cacheStore;

    var parsed = parseSessionText(FIXTURE_TEXT);
    persistSessionSnapshot("followup-test.jsonl", parsed.result, FIXTURE_TEXT, global.localStorage);

    var app = await renderApp(fetchMock);

    await waitFor(function () {
      return findByText(app.container, "Inbox");
    }, "expected inbox");

    await click(findExactButton(app.container, "Open in Observe"));
    await waitFor(function () {
      return findClickableText(app.container, "Replay");
    }, "expected session");

    await click(findClickableText(app.container, "Q&A"));
    await waitFor(function () {
      return findByText(app.container, "Ask about this session");
    }, "expected Q&A");

    // First question - no qaSessionId yet
    var input = app.container.querySelector("input[placeholder*='Ask a question']");
    await changeInput(input, "First question");
    await click(findExactButton(app.container, "Send"));

    await waitFor(function () {
      return findByText(app.container, "Answer 1.");
    }, "expected first answer", 5000);

    expect(Object.keys(cacheStore).length).toBe(1);
    expect(capturedBodies[0].sessionKey).toBeTruthy();
    expect(capturedBodies[0].qaSessionId).toBeFalsy();
    expect(capturedBodies[0].events).toBeUndefined();
    expect(capturedBodies[0].turns).toBeUndefined();
    expect(capturedBodies[0].metadata).toBeUndefined();
    expect(capturedBodies[0].sessionFilePath).toBeUndefined();

    // Second question - should include qaSessionId from first response
    input = app.container.querySelector("input[placeholder*='Ask a question']");
    await changeInput(input, "Follow-up question");
    await click(findExactButton(app.container, "Send"));

    await waitFor(function () {
      return findByText(app.container, "Answer 2.");
    }, "expected second answer", 5000);

    expect(capturedBodies[1].sessionKey).toBe(capturedBodies[0].sessionKey);
    expect(capturedBodies[1].qaSessionId).toBe("sdk-sess-456");
    expect(capturedBodies[1].events).toBeUndefined();
    expect(capturedBodies[1].turns).toBeUndefined();
    expect(capturedBodies[1].metadata).toBeUndefined();
    expect(capturedBodies[1].sessionFilePath).toBeUndefined();

    await app.unmount();
  });

  it("rotates long-running Q&A sessions with a recap while preserving visible chat history", async function () {
    localStorage.setItem("agentviz:qa-session-turn-limit", "2");

    var callCount = 0;
    var capturedBodies = [];
    var qaSessionIds = [
      "sdk-sess-initial",
      "sdk-sess-initial",
      "sdk-sess-rotated",
      "sdk-sess-rotated",
    ];
    var answers = [
      "Answer 1.",
      "Answer 2.",
      "Compacted answer.",
      "Follow-up after compaction.",
    ];
    var historyFetch = createSessionQAHistoryFetch(async function (url, opts) {
      if (String(url).includes("/api/qa")) {
        if (opts && opts.body) capturedBodies.push(JSON.parse(opts.body));
        var responseIndex = callCount;
        callCount++;
        return createSSEResponse({
          answer: answers[responseIndex],
          references: [],
          model: "gpt-5.4",
          qaSessionId: qaSessionIds[responseIndex],
        });
      }
      return { ok: false };
    });
    var fetchMock = historyFetch.fetchMock;
    var historyStore = historyFetch.historyStore;

    var parsed = parseSessionText(FIXTURE_TEXT);
    persistSessionSnapshot("compaction-test.jsonl", parsed.result, FIXTURE_TEXT, global.localStorage);

    var app = await renderApp(fetchMock);

    await waitFor(function () {
      return findByText(app.container, "Inbox");
    }, "expected inbox");

    await click(findExactButton(app.container, "Open in Observe"));
    await waitFor(function () {
      return findClickableText(app.container, "Replay");
    }, "expected session");

    await click(findClickableText(app.container, "Q&A"));
    await waitFor(function () {
      return findByText(app.container, "Ask about this session");
    }, "expected Q&A");

    var input = app.container.querySelector("input[placeholder*='Ask a question']");
    await changeInput(input, "First question");
    await click(findExactButton(app.container, "Send"));
    await waitFor(function () {
      return findByText(app.container, "Answer 1.");
    }, "expected first answer", 5000);

    input = app.container.querySelector("input[placeholder*='Ask a question']");
    await changeInput(input, "Second question");
    await click(findExactButton(app.container, "Send"));
    await waitFor(function () {
      return findByText(app.container, "Answer 2.");
    }, "expected second answer", 5000);

    input = app.container.querySelector("input[placeholder*='Ask a question']");
    await changeInput(input, "Third question");
    await click(findExactButton(app.container, "Send"));
    await waitFor(function () {
      return findByText(app.container, "Compacted answer.");
    }, "expected compacted answer", 5000);

    expect(capturedBodies[0].qaSessionId).toBeFalsy();
    expect(capturedBodies[1].qaSessionId).toBe("sdk-sess-initial");
    expect(capturedBodies[2].qaSessionId).toBeFalsy();
    expect(capturedBodies[2].question).toContain("AGENTVIZ Q&A recap from earlier visible chat:");
    expect(capturedBodies[2].question).toContain("Q1 user: First question");
    expect(capturedBodies[2].question).toContain("A1 assistant: Answer 1.");
    expect(capturedBodies[2].question).toContain("Q2 user: Second question");
    expect(capturedBodies[2].question).toContain("A2 assistant: Answer 2.");
    expect(capturedBodies[2].question).toContain("Current question:\nThird question");
    expect(capturedBodies[2].events).toBeUndefined();
    expect(capturedBodies[2].turns).toBeUndefined();
    expect(capturedBodies[2].metadata).toBeUndefined();

    expect(findByText(app.container, "First question")).toBeTruthy();
    expect(findByText(app.container, "Answer 1.")).toBeTruthy();
    expect(findByText(app.container, "Second question")).toBeTruthy();
    expect(findByText(app.container, "Answer 2.")).toBeTruthy();
    expect(findByText(app.container, "Third question")).toBeTruthy();
    expect(findByText(app.container, "Compacted answer.")).toBeTruthy();

    input = app.container.querySelector("input[placeholder*='Ask a question']");
    await changeInput(input, "Fourth question");
    await click(findExactButton(app.container, "Send"));
    await waitFor(function () {
      return findByText(app.container, "Follow-up after compaction.");
    }, "expected follow-up answer after compaction", 5000);

    expect(capturedBodies[3].qaSessionId).toBe("sdk-sess-rotated");
    expect(capturedBodies[3].question).toBe("Fourth question");

    var keys = Object.keys(historyStore);
    expect(keys.length).toBeGreaterThanOrEqual(1);
    expect(historyStore[keys[0]].qaSessionId).toBe("sdk-sess-rotated");
    expect(historyStore[keys[0]].messages.length).toBe(8);
    expect(historyStore[keys[0]].messages.map(function (message) {
      return message.content;
    })).toEqual(expect.arrayContaining([
      "First question",
      "Answer 1.",
      "Second question",
      "Answer 2.",
      "Third question",
      "Compacted answer.",
      "Fourth question",
      "Follow-up after compaction.",
    ]));

    await app.unmount();
  });

  it("rotates resumed Q&A sessions with a recap while preserving visible chat history", async function () {
    localStorage.setItem("agentviz:qa-session-turn-limit", "2");

    var capturedBodies = [];
    var historyFetch = createSessionQAHistoryFetch(async function (url, opts) {
      if (String(url).includes("/api/qa")) {
        var body = opts && opts.body ? JSON.parse(opts.body) : {};
        capturedBodies.push(body);
        var requestNumber = capturedBodies.length;
        var qaSessionId = requestNumber >= 3 ? "sdk-session-beta" : "sdk-session-alpha";
        return createSSEResponse({
          answer: "Answer " + requestNumber + ".",
          references: [],
          model: "gpt-5.4",
          qaSessionId: qaSessionId,
        });
      }
      return { ok: false };
    });
    var fetchMock = historyFetch.fetchMock;
    var historyStore = historyFetch.historyStore;

    var parsed = parseSessionText(FIXTURE_TEXT);
    persistSessionSnapshot("rotation-test.jsonl", parsed.result, FIXTURE_TEXT, global.localStorage);

    var app = await renderApp(fetchMock);

    await waitFor(function () {
      return findByText(app.container, "Inbox");
    }, "expected inbox");

    await click(findExactButton(app.container, "Open in Observe"));
    await waitFor(function () {
      return findClickableText(app.container, "Replay");
    }, "expected session");

    await click(findClickableText(app.container, "Q&A"));
    await waitFor(function () {
      return findByText(app.container, "Ask about this session");
    }, "expected Q&A");

    var input = app.container.querySelector("input[placeholder*='Ask a question']");

    await changeInput(input, "First question");
    await click(findExactButton(app.container, "Send"));
    await waitFor(function () {
      return findByText(app.container, "Answer 1.");
    }, "expected first answer", 5000);

    input = app.container.querySelector("input[placeholder*='Ask a question']");
    await changeInput(input, "Second question");
    await click(findExactButton(app.container, "Send"));
    await waitFor(function () {
      return findByText(app.container, "Answer 2.");
    }, "expected second answer", 5000);

    input = app.container.querySelector("input[placeholder*='Ask a question']");
    await changeInput(input, "Third question");
    await click(findExactButton(app.container, "Send"));
    await waitFor(function () {
      return findByText(app.container, "Answer 3.");
    }, "expected rotated answer", 5000);

    expect(findByText(app.container, "First question")).toBeTruthy();
    expect(findByText(app.container, "Answer 1.")).toBeTruthy();
    expect(findByText(app.container, "Second question")).toBeTruthy();
    expect(findByText(app.container, "Answer 2.")).toBeTruthy();
    expect(findByText(app.container, "Third question")).toBeTruthy();
    expect(findByText(app.container, "Answer 3.")).toBeTruthy();

    input = app.container.querySelector("input[placeholder*='Ask a question']");
    await changeInput(input, "Fourth question");
    await click(findExactButton(app.container, "Send"));
    await waitFor(function () {
      return findByText(app.container, "Answer 4.");
    }, "expected post-rotation follow-up", 5000);

    expect(capturedBodies).toHaveLength(4);
    expect(capturedBodies[0].qaSessionId).toBeFalsy();
    expect(capturedBodies[0].question).toBe("First question");
    expect(capturedBodies[1].qaSessionId).toBe("sdk-session-alpha");
    expect(capturedBodies[1].question).toBe("Second question");

    expect(capturedBodies[2].qaSessionId).toBeFalsy();
    expect(capturedBodies[2].question).toContain("AGENTVIZ Q&A recap from earlier visible chat:");
    expect(capturedBodies[2].question).toContain("Q1 user: First question");
    expect(capturedBodies[2].question).toContain("A1 assistant: Answer 1.");
    expect(capturedBodies[2].question).toContain("Q2 user: Second question");
    expect(capturedBodies[2].question).toContain("A2 assistant: Answer 2.");
    expect(capturedBodies[2].question).toContain("Current question:\nThird question");

    expect(capturedBodies[3].qaSessionId).toBe("sdk-session-beta");
    expect(capturedBodies[3].question).toBe("Fourth question");

    var storedKeys = Object.keys(historyStore);
    expect(storedKeys.length).toBe(1);
    var storedEntry = historyStore[storedKeys[0]];
    expect(storedEntry.messages.length).toBe(8);
    expect(storedEntry.messages[0].content).toBe("First question");
    expect(storedEntry.messages[7].content).toBe("Answer 4.");
    expect(storedEntry.qaSessionId).toBe("sdk-session-beta");

    await app.unmount();
  });

  it("registers sessionFilePath in the session cache for live bootstrap requests", async function () {
    var capturedRegistration = null;
    var capturedBody = null;
    var fetchMock = vi.fn(async function (url, opts) {
      var s = String(url);
      if (s.includes("/api/meta")) {
        return {
          ok: true,
          json: async function () { return { filename: "live-session.jsonl", path: "/home/user/.copilot/sessions/abc/events.jsonl", live: true }; },
        };
      }
      if (s.includes("/api/file")) {
        return {
          ok: true,
          text: async function () { return FIXTURE_TEXT; },
        };
      }
      if (s.includes("/api/session-qa-cache")) {
        if (opts && opts.body) capturedRegistration = JSON.parse(opts.body);
        return {
          ok: true,
          json: async function () {
            return {
              success: true,
              sessionKey: capturedRegistration ? capturedRegistration.sessionKey : null,
            };
          },
        };
      }
      if (s.includes("/api/qa")) {
        if (opts && opts.body) capturedBody = JSON.parse(opts.body);
        return createSSEResponse({ answer: "Answer with file access.", references: [] });
      }
      return { ok: false };
    });

    var app = await renderApp(fetchMock);

    // Wait for live bootstrap to complete
    await waitFor(function () {
      return findByText(app.container, "live-session.jsonl");
    }, "expected live session to load", 5000);

    // Navigate to Q&A
    await click(findClickableText(app.container, "Q&A"));
    await waitFor(function () {
      return findByText(app.container, "Ask about this session");
    }, "expected Q&A to render");

    // Ask a question
    var input = app.container.querySelector("input[placeholder*='Ask a question']");
    await changeInput(input, "What kusto queries were used?");
    await click(findExactButton(app.container, "Send"));

    await waitFor(function () {
      return findByText(app.container, "Answer with file access.");
    }, "expected answer", 5000);

    expect(capturedRegistration).toBeTruthy();
    expect(capturedRegistration.sessionFilePath).toBe("/home/user/.copilot/sessions/abc/events.jsonl");
    expect(Array.isArray(capturedRegistration.events)).toBe(true);
    expect(Array.isArray(capturedRegistration.turns)).toBe(true);

    // Verify the Q&A request stayed lean and referenced the registered session
    expect(capturedBody).toBeTruthy();
    expect(capturedBody.sessionKey).toBe(capturedRegistration.sessionKey);
    expect(capturedBody.sessionFilePath).toBeUndefined();
    expect(capturedBody.events).toBeUndefined();
    expect(capturedBody.turns).toBeUndefined();
    expect(capturedBody.metadata).toBeUndefined();

    await app.unmount();
  });

  it("allows queuing messages while the model is thinking", async function () {
    var responseCount = 0;
    var fetchMock = vi.fn(async function (url) {
      if (String(url).includes("/api/qa")) {
        responseCount++;
        return createChunkedSSEResponse([
          { status: "Preparing session context..." },
          { delta: "Response " + responseCount + "." },
          { done: true, answer: "Response " + responseCount + ".", references: [] },
        ], [120, 120, 0]);
      }
      return { ok: false };
    });

    var parsed = parseSessionText(FIXTURE_TEXT);
    persistSessionSnapshot("queue-test.jsonl", parsed.result, FIXTURE_TEXT, global.localStorage);

    var app = await renderApp(fetchMock);

    await waitFor(function () {
      return findByText(app.container, "Inbox");
    }, "expected inbox");

    await click(findExactButton(app.container, "Open in Observe"));
    await waitFor(function () {
      return findClickableText(app.container, "Replay");
    }, "expected session");

    await click(findClickableText(app.container, "Q&A"));
    await waitFor(function () {
      return findByText(app.container, "Ask about this session");
    }, "expected Q&A");

    // Send first question
    var input = app.container.querySelector("input[placeholder*='Ask a question']");
    await changeInput(input, "First question");
    await click(findExactButton(app.container, "Send"));

    // Immediately send a second question (should be queued)
    await changeInput(input, "Second question");
    await click(findExactButton(app.container, "Send"));

    // Both user messages should be visible
    expect(findByText(app.container, "First question")).toBeTruthy();
    expect(findByText(app.container, "Second question")).toBeTruthy();

    await waitFor(function () {
      return findByText(app.container, "1 queued message behind this answer");
    }, "expected queued progress message", 5000);

    // Wait for both responses to complete
    await waitFor(function () {
      return findByText(app.container, "Response 1.");
    }, "expected first response", 5000);

    await waitFor(function () {
      return findByText(app.container, "Response 2.");
    }, "expected second response (queued)", 5000);

    await app.unmount();
  });

  it("stops an in-flight answer and allows retrying", async function () {
    var requestCount = 0;
    var historyFetch = createSessionQAHistoryFetch(async function (url, opts) {
      if (String(url).includes("/api/qa")) {
        requestCount++;
        if (requestCount === 1) {
          var signal = opts && opts.signal;
          var encoder = new TextEncoder();
          var stream = new ReadableStream({
            start: function (controller) {
              controller.enqueue(encoder.encode("data: " + JSON.stringify({ status: "Searching the session..." }) + "\n\n"));
              if (signal) {
                signal.addEventListener("abort", function () {
                  var abortError = new Error("Aborted");
                  abortError.name = "AbortError";
                  controller.error(abortError);
                });
              }
            },
          });
          return { ok: true, body: stream };
        }
        return createSSEResponse({ answer: "Recovered answer.", references: [] });
      }
      return { ok: false };
    });
    var fetchMock = historyFetch.fetchMock;

    var parsed = parseSessionText(FIXTURE_TEXT);
    persistSessionSnapshot("stop-test.jsonl", parsed.result, FIXTURE_TEXT, global.localStorage);

    var app = await renderApp(fetchMock);

    await waitFor(function () {
      return findByText(app.container, "Inbox");
    }, "expected inbox");

    await click(findExactButton(app.container, "Open in Observe"));
    await waitFor(function () {
      return findClickableText(app.container, "Replay");
    }, "expected session");

    await click(findClickableText(app.container, "Q&A"));
    await waitFor(function () {
      return findByText(app.container, "Ask about this session");
    }, "expected Q&A");

    var input = app.container.querySelector("input[placeholder*='Ask a question']");
    await changeInput(input, "Question to stop");
    await click(findExactButton(app.container, "Send"));

    await waitFor(function () {
      return findByText(app.container, "Searching the session...");
    }, "expected in-flight status");

    await click(findExactButton(app.container, "Stop"));

    await waitFor(function () {
      return !findByText(app.container, "Searching the session...") && !findExactButton(app.container, "Stop");
    }, "expected loading to stop", 5000);

    input = app.container.querySelector("input[placeholder*='Ask a question']");
    await changeInput(input, "Retry after stop");
    await click(findExactButton(app.container, "Send"));

    await waitFor(function () {
      return findByText(app.container, "Recovered answer.");
    }, "expected retry answer", 5000);

    expect(requestCount).toBe(2);

    await app.unmount();
  });
});

