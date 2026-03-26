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

function createInactiveFetch() {
  return vi.fn(async function () {
    return { ok: false };
  });
}

function click(node) {
  if (!node) throw new Error("Expected node to click");
  return act(async function () {
    node.click();
  });
}

async function sleep(ms) {
  await act(async function () {
    await new Promise(function (resolve) { setTimeout(resolve, ms); });
  });
}

async function waitFor(check, message) {
  var start = Date.now();
  while (Date.now() - start < 3000) {
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

function findExactButton(container, text) {
  return Array.from(container.querySelectorAll("button"))
    .find(function (node) {
      return node.textContent && node.textContent.trim() === text;
    }) || null;
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

describe("AGENTVIZ MVP flow", function () {
  it("opens a stored inbox session into observe and then reviews coach drafts", async function () {
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

    expect(findByText(app.container, "Autonomy Metrics")).toBeTruthy();
    expect(findByText(app.container, "Coach this session")).toBeTruthy();

    await click(findExactButton(app.container, "Coach"));
    await waitFor(function () {
      return findByText(app.container, "Session coaching:");
    }, "expected debrief view to open");

    // AI-first: static rec cards are gone; coach header and stats grid should be present
    expect(findByText(app.container, "Session coaching:")).toBeTruthy();
    expect(findByText(app.container, "Coach")).toBeTruthy();

    await app.unmount();
  });

  it("shows a clean HTTP error when coach endpoint returns empty body", async function () {
    var parsed = parseSessionText(FIXTURE_TEXT);
    persistSessionSnapshot("fixture.jsonl", parsed.result, FIXTURE_TEXT, global.localStorage);

    // Simulate a server returning 503 with no body (e.g. endpoint not available in dev mode)
    var fetchMock = vi.fn(async function (url) {
      if (String(url).includes("/api/coach/analyze")) {
        return { ok: false, status: 503, text: async function () { return ""; } };
      }
      return { ok: false };
    });

    var app = await renderApp(fetchMock);

    await waitFor(function () {
      return findByText(app.container, "Inbox");
    }, "expected landing inbox to render");

    await click(findExactButton(app.container, "Open in Observe"));
    await waitFor(function () {
      return findByText(app.container, "fixture.jsonl");
    }, "expected stored session to open");

    await click(findExactButton(app.container, "Coach"));
    await waitFor(function () {
      return findByText(app.container, "Session coaching:");
    }, "expected debrief view to open");

    // Wait for the auto-started analysis to fail and display a clean HTTP error, not a JSON parse error
    await waitFor(function () {
      return findByText(app.container, "AI analysis failed: HTTP 503");
    }, "expected AI analysis error to appear");

    await app.unmount();
  });
});
