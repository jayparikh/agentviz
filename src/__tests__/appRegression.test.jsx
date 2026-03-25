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

var FIXTURE_TEXT = readFileSync(resolve(process.cwd(), "test-files/test-copilot.jsonl"), "utf8");

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
