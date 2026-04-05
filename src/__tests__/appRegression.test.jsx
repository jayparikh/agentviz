// @vitest-environment jsdom

import { act } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";

var exportMocks = vi.hoisted(function () {
  return {
    exportSingleSession: vi.fn(function () { return Promise.resolve(); }),
    exportComparison: vi.fn(function () { return Promise.resolve(); }),
  };
});

vi.mock("../lib/exportHtml.js", function () {
  return {
    exportSingleSession: exportMocks.exportSingleSession,
    exportComparison: exportMocks.exportComparison,
  };
});

import App from "../App.jsx";

var FIXTURE_TEXT = readFileSync(resolve(process.cwd(), "src/__tests__/fixtures/test-copilot.jsonl"), "utf8");

function createJsonResponse(payload) {
  return {
    ok: true,
    json: async function () { return payload; },
  };
}

function createTextResponse(payload) {
  return {
    ok: true,
    text: async function () { return payload; },
  };
}

function createInactiveFetch() {
  return vi.fn(async function () {
    return { ok: false };
  });
}

function createBootstrapFetch(filename, text, live) {
  return vi.fn(async function (url) {
    if (String(url).includes("/api/meta")) {
      return createJsonResponse({ filename: filename, live: live });
    }
    if (String(url).includes("/api/file")) {
      return createTextResponse(text);
    }
    throw new Error("Unexpected fetch: " + url);
  });
}

function createLiveFetch(filename, text) {
  return createBootstrapFetch(filename, text, true);
}

function createExportBootstrapFetch(filename, text) {
  return createBootstrapFetch(filename, text, false);
}

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

function findButtonByTitle(container, title) {
  return Array.from(container.querySelectorAll("button"))
    .find(function (node) { return node.title === title; }) || null;
}

function findClickableText(container, text) {
  return Array.from(container.querySelectorAll("button, span"))
    .find(function (node) {
      return node.textContent && node.textContent.trim() === text;
    }) || null;
}

function getSearchCount(container) {
  var input = container.querySelector("#agentviz-search");
  if (!input || !input.parentElement) return null;
  var children = Array.from(input.parentElement.children);
  var lastChild = children[children.length - 1];
  if (!lastChild || lastChild === input) return null;
  return lastChild.textContent || null;
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
  exportMocks.exportSingleSession.mockClear();
  exportMocks.exportComparison.mockClear();
  var storage = {};
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  global.localStorage = {
    getItem: function (key) { return Object.prototype.hasOwnProperty.call(storage, key) ? storage[key] : null; },
    setItem: function (key, value) { storage[key] = String(value); },
    removeItem: function (key) { delete storage[key]; },
    clear: function () { storage = {}; },
  };
  document.body.innerHTML = "";
  global.ResizeObserver = class {
    observe() {}
    disconnect() {}
  };
  global.EventSource = class {
    close() {}
  };
});

afterEach(function () {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("App browser regressions", function () {
  it("disables Open button for entries with evicted content", async function () {
    // Simulate a library entry whose content was evicted: hasContent is true
    // but the actual content key is missing from localStorage.
    global.localStorage.setItem("agentviz:session-library:v1", JSON.stringify([
      {
        id: "claude-code:evicted-session",
        file: "evicted-session.jsonl",
        format: "claude-code",
        sessionId: "evicted-session",
        primaryPrompt: "Ship the fix safely",
        importedAt: "2026-04-04T00:00:00.000Z",
        updatedAt: "2026-04-04T00:00:00.000Z",
        hasContent: true, // lies: no content key in localStorage
      },
    ]));
    // Note: no agentviz:session-content:v1:claude-code:evicted-session key set

    var app = await renderApp();

    await waitFor(function () {
      return findByText(app.container, "evicted-session.jsonl");
    }, "expected evicted session to appear in inbox");

    // reconcileSessionLibrary should have corrected hasContent on startup,
    // so the Open button should be disabled
    var openBtn = findExactButton(app.container, "Open");
    expect(openBtn).toBeTruthy();
    expect(openBtn.disabled).toBe(true);

    await app.unmount();
  });

  it("hides continuation-summary sessions and opens discovered sessions", async function () {
    global.localStorage.setItem("agentviz:session-library:v1", JSON.stringify([
      {
        id: "copilot-cli:stale-continuation",
        file: "events.jsonl",
        format: "copilot-cli",
        sessionId: "stale-continuation",
        primaryPrompt: "Summarize the following conversation for context continuity. Preserve the important details.",
        importedAt: "2026-04-04T00:00:00.000Z",
        updatedAt: "2026-04-04T00:00:00.000Z",
        hasContent: false,
      },
    ]));

    var discoveredPath = "C:\\Users\\jayp\\.copilot\\session-state\\real-session\\events.jsonl";
    var fetchMock = vi.fn(async function (url) {
      if (String(url).includes("/api/meta")) {
        return { ok: false };
      }
      if (String(url).includes("/api/sessions")) {
        return createJsonResponse([
          {
            id: "copilot-cli:real-session:events.jsonl",
            path: discoveredPath,
            filename: "events.jsonl",
            file: "Tell me what this project does",
            summary: "Tell me what this project does",
            project: "Tell me what this project does",
            sessionId: "real-session",
            format: "copilot-cli",
            size: 12000,
            mtime: "2026-04-04T00:00:00.000Z",
          },
        ]);
      }
      if (String(url).includes("/api/session?path=")) {
        return createTextResponse(FIXTURE_TEXT);
      }
      throw new Error("Unexpected fetch: " + url);
    });

    var app = await renderApp(fetchMock);

    await waitFor(function () {
      return findByText(app.container, "Tell me what this project does");
    }, "expected discovered session to appear");

    // Continuation-summary session should be hidden
    var allButtons = Array.from(app.container.querySelectorAll("button"));
    var openButtons = allButtons.filter(function (b) { return b.textContent.trim() === "Open"; });
    expect(openButtons).toHaveLength(1);

    await click(openButtons[0]);
    await waitFor(function () {
      return findByText(app.container, "Tell me what this project does");
    }, "expected discovered session to open");

    await app.unmount();
  });

  it("loads the demo session and keeps compare session B empty", async function () {
    var app = await renderApp();

    await click(findClickableText(app.container, "load a demo session"));
    await waitFor(function () {
      return findByText(app.container, "demo-session.jsonl");
    }, "expected demo session to load");

    await click(findButtonByTitle(app.container, "Compare with another session"));
    expect(findByText(app.container, "demo-session.jsonl")).toBeTruthy();
    expect(findByText(app.container, "Drop a session file here")).toBeTruthy();

    await app.unmount();
  });

  it("updates search results and track filters on the loaded demo session", async function () {
    var app = await renderApp();

    await click(findClickableText(app.container, "load a demo session"));
    await waitFor(function () {
      return findByText(app.container, "demo-session.jsonl");
    }, "expected demo session to load");

    var searchInput = app.container.querySelector("#agentviz-search");
    await changeInput(searchInput, "rate limiting");
    expect(await waitFor(function () {
      return getSearchCount(app.container);
    }, "expected search count to appear")).toBe("1");

    await click(findButtonByTitle(app.container, "Filter tracks"));
    await waitFor(function () {
      return findClickableText(app.container, "Tool Calls");
    }, "expected filter popover to open");

    await click(findClickableText(app.container, "Tool Calls"));
    await waitFor(function () {
      return findButtonByTitle(app.container, "Filter tracks");
    }, "expected hidden filter count to update");

    await app.unmount();
  });

  it("preserves a raw light theme preference through initial mount", async function () {
    global.localStorage.setItem("agentviz:theme-mode", "light");

    var warnSpy = vi.spyOn(console, "warn").mockImplementation(function () {});

    var app = await renderApp();

    expect(document.documentElement.dataset.themePreference).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");

    // No console warnings during migration from bare string to JSON
    var themeWarnings = warnSpy.mock.calls.filter(function (args) {
      return String(args[0] || "").includes("theme-mode") || String(args[1] || "").includes("theme-mode");
    });
    expect(themeWarnings).toHaveLength(0);

    await sleep(350);

    expect(global.localStorage.getItem("agentviz:theme-mode")).toBe("\"light\"");
    expect(document.documentElement.dataset.theme).toBe("light");

    warnSpy.mockRestore();
    await app.unmount();
  });

  it("bootstraps a live session, exports it, and still leaves compare session B blank", async function () {
    var app = await renderApp(createLiveFetch("fixture.jsonl", FIXTURE_TEXT));

    await waitFor(function () {
      return findByText(app.container, "fixture.jsonl");
    }, "expected live session to bootstrap");

    await click(findExactButton(app.container, "Export"));
    await waitFor(function () {
      return exportMocks.exportSingleSession.mock.calls.length > 0;
    }, "expected export handler to run");

    expect(exportMocks.exportSingleSession).toHaveBeenCalledWith(FIXTURE_TEXT, "fixture.jsonl");

    await click(findButtonByTitle(app.container, "Compare with another session"));
    await waitFor(function () {
      return findByText(app.container, "Session B");
    }, "expected compare landing to open");

    expect(findByText(app.container, "Drop a session file here")).toBeTruthy();

    await app.unmount();
  });

  it("bootstraps an exported session when meta is non-live", async function () {
    var fetchMock = createExportBootstrapFetch("exported.jsonl", FIXTURE_TEXT);
    var app = await renderApp(fetchMock);

    await waitFor(function () {
      return findByText(app.container, "exported.jsonl");
    }, "expected exported session to bootstrap");

    expect(findByText(app.container, "Drop a session file here")).toBeFalsy();
    expect(fetchMock).toHaveBeenCalledWith("/api/file");

    await app.unmount();
  });
});
