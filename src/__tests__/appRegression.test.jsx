// @vitest-environment jsdom

import { act, createElement } from "react";
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

var reviewRender = vi.hoisted(function () { return vi.fn(); });
vi.mock("../components/v2/ReviewHub.jsx", async function (importOriginal) {
  var original = await importOriginal();
  return { default: function (props) {
    reviewRender();
    return createElement(original.default, props);
  } };
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

function closeQAButton(container) {
  return Array.from(container.querySelectorAll("button")).find(function (node) { return node.getAttribute("aria-label") === "Close Q&A drawer"; });
}

function findClickableText(container, text) {
  return Array.from(container.querySelectorAll("button, span"))
    .find(function (node) {
      return node.textContent && node.textContent.trim() === text;
    }) || null;
}

function getSearchCount(container) {
  return Array.from(container.querySelectorAll("span")).map(function (node) { return node.textContent; })
    .find(function (text) { return /^\d+ match(es)?$/.test(text); });
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
  window.history.replaceState(null, "", "#/");
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
  it("shows a non-blocking unsaved state and raw download recovery when the metadata index fails", async function () {
    var write = global.localStorage.setItem;
    var failure = vi.spyOn(global.localStorage, "setItem").mockImplementation(function (key, text) {
      if (key === "agentviz:session-library:v1") throw new DOMException("Full", "QuotaExceededError");
      write(key, text);
    });
    var app = await renderApp(createExportBootstrapFetch("unsaved.jsonl", FIXTURE_TEXT));
    try {
      await waitFor(function () { return findExactButton(app.container, "Retry saving"); });
      expect(app.container.textContent).toContain("A active: unsaved.jsonl");
      expect(app.container.textContent).toContain("The session index could not be saved.");
      expect(app.container.textContent).not.toContain("Failed to load session");
      expect(findExactButton(app.container, "Download transcript")).toBeTruthy();
      await click(app.container.querySelector('button[aria-label^="Investigate,"]'));
      expect(app.container.textContent).toContain("Retry saving");
      failure.mockRestore();
      await click(findExactButton(app.container, "Retry saving"));
      expect(app.container.textContent).toContain("Saved locally.");
      expect(findExactButton(app.container, "Retry saving")).toBeFalsy();
      await click(app.container.querySelector('[aria-label="Close session"]'));
      expect(app.container.textContent).not.toContain("Saved locally.");
      expect(app.container.textContent).not.toContain("unsaved.jsonl. Latest");
    } finally { await app.unmount(); }
  });

  it("can close a live stream before its first event arrives", async function () {
    var sources = [];
    global.EventSource = class {
      constructor() { this.close = vi.fn(); sources.push(this); }
    };
    var app = await renderApp(createLiveFetch("empty-live.jsonl", ""));
    try {
      await waitFor(function () { return sources.length === 1; });
      expect(app.container.querySelector('[aria-label="Close session"]')).toBeTruthy();
      await click(app.container.querySelector('[aria-label="Close session"]'));
      expect(sources[0].close).toHaveBeenCalledOnce();
      expect(window.location.hash).toBe("#/v2/find");
      expect(app.container.textContent).not.toContain("Live session streaming");
    } finally { await app.unmount(); }
  });

  it("does not rerender Review on background playback ticks", async function () {
    var app = await renderApp();
    try {
      await click(findClickableText(app.container, "Load a demo session"));
      await click(app.container.querySelector('button[aria-label^="Investigate,"]'));
      await click(app.container.querySelector('[aria-label="Play playback"]'));
      await click(app.container.querySelector('button[aria-label^="Review,"]'));
      var renders = reviewRender.mock.calls.length;
      await sleep(250);
      expect(reviewRender.mock.calls.length).toBe(renders);
      await click(app.container.querySelector('button[aria-label^="Investigate,"]'));
      expect(Number(app.container.querySelector('[role="slider"]').getAttribute("aria-valuenow"))).toBeGreaterThan(0);
    } finally { await app.unmount(); }
  });

  it("cancels an unfinished file read on Close and ignores its late completion", async function () {
    var originalReader = global.FileReader;
    var reader;
    global.FileReader = class {
      constructor() { reader = this; this.readyState = 0; this.abort = vi.fn(); }
      readAsText() { this.readyState = 1; }
    };
    var app = await renderApp();
    try {
      var upload = app.container.querySelector('input[type="file"]');
      Object.defineProperty(upload, "files", { value: [new File([FIXTURE_TEXT], "late.jsonl")] });
      await act(async function () { upload.dispatchEvent(new Event("change", { bubbles: true })); });
      expect(app.container.textContent).toContain("Reading session file...");
      await click(app.container.querySelector('[aria-label="Close session"]'));
      expect(reader.abort).toHaveBeenCalledOnce();
      await act(async function () { reader.onload({ target: { result: FIXTURE_TEXT } }); });
      await sleep(30);
      expect(app.container.querySelector('[aria-label="Close session"]')).toBeNull();
      expect(window.location.hash).toBe("#/v2/find");
      expect(app.container.textContent).not.toContain("late.jsonl");
    } finally {
      await app.unmount();
      global.FileReader = originalReader;
    }
  });

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

  it("uses Find controls despite retired landing preferences and rescans sessions", async function () {
    global.localStorage.setItem("agentviz:landing-mode", "\"dashboard\"");
    global.localStorage.setItem("agentviz:session-library:v1", JSON.stringify([
      {
        id: "claude-code:dashboard-session",
        file: "dashboard-session.jsonl",
        format: "claude-code",
        sessionId: "dashboard-session",
        primaryPrompt: "Refine the landing dashboard layout",
        importedAt: "2026-04-04T00:00:00.000Z",
        updatedAt: "2026-04-04T00:00:00.000Z",
        reviewScore: 6.2,
        totalEvents: 24,
        totalCost: 0.18,
        errorCount: 1,
        autonomyMetrics: { autonomyEfficiency: 0.71 },
        hasContent: true,
      },
    ]));

    var fetchMock = vi.fn(async function (url) {
      if (String(url).includes("/api/meta")) {
        return { ok: false };
      }
      if (String(url).includes("/api/sessions")) {
        return createJsonResponse([]);
      }
      throw new Error("Unexpected fetch: " + url);
    });

    function getSessionRequestCount() {
      return fetchMock.mock.calls.filter(function (call) {
        return String(call[0]).includes("/api/sessions");
      }).length;
    }

    var app = await renderApp(fetchMock);

    await waitFor(function () {
      return findByText(app.container, "dashboard-session.jsonl");
    }, "expected dashboard session to render");

    expect(app.container.querySelectorAll("select")).toHaveLength(0);
    var formatButton = findExactButton(app.container, "All clients");
    expect(formatButton).toBeTruthy();
    expect(formatButton.getAttribute("aria-haspopup")).toBe("listbox");
    expect(formatButton.getAttribute("aria-expanded")).toBe("false");
    await click(findExactButton(app.container, "Most recent"));
    await click(Array.from(app.container.querySelectorAll('[role="option"]')).find(function (node) { return node.textContent === "Needs review"; }));
    expect(findExactButton(app.container, "Needs review")).toBeTruthy();
    expect(getSessionRequestCount()).toBe(1);

    await click(formatButton);
    expect(formatButton.getAttribute("aria-expanded")).toBe("true");
    expect(app.container.querySelector('[role="listbox"]')).toBeTruthy();
    expect(app.container.querySelectorAll('[role="option"]').length).toBeGreaterThan(0);
    await act(async function () {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    await waitFor(function () {
      return formatButton.getAttribute("aria-expanded") === "false";
    }, "expected escape to close toolbar select");

    var refreshButton = app.container.querySelector('button[aria-label="Rescan v2 session directories"]');
    expect(refreshButton).toBeTruthy();
    await click(refreshButton);

    await waitFor(function () {
      return getSessionRequestCount() === 2;
    }, "expected dashboard refresh to rescan sessions");

    await app.unmount();
  });

  it("loads the demo session and keeps compare session B empty", async function () {
    var app = await renderApp();

    await click(findClickableText(app.container, "Load a demo session"));
    await waitFor(function () {
      return findByText(app.container, "demo-session.jsonl");
    }, "expected demo session to load");

    await click(app.container.querySelector('button[aria-label^="Compare,"]'));
    expect(findByText(app.container, "demo-session.jsonl")).toBeTruthy();
    expect(findByText(app.container, "Select two sessions to compare")).toBeTruthy();

    await app.unmount();
  });

  it.each([null, "false", "true", "{broken"])("mounts only the workflow with retired preference %s", async function (value) {
    if (value !== null) window.localStorage.setItem("agentviz:v2:enabled", value);
    var app = await renderApp();
    expect(app.container.querySelector('button[aria-label^="Find,"]')).toBeTruthy();
    expect(findExactButton(app.container, "Classic UI")).toBeNull();
    expect(findExactButton(app.container, "Default UI")).toBeNull();
    expect(window.localStorage.getItem("agentviz:v2:enabled")).toBe(value);
    await app.unmount();
  });

  it.each(["#/", "#/session"])("maps old %s links to Find without losing query parameters", async function (hash) {
    window.history.replaceState(null, "", "?demo=empty&tag=review" + hash);
    var app = await renderApp();
    expect(window.location.hash).toBe("#/v2/find");
    expect(window.location.search).toBe("?demo=empty&tag=review");
    expect(app.container.querySelector('[aria-label="Search v2 sessions"]')).toBeTruthy();
    await app.unmount();
    window.history.replaceState(null, "", "/");
  });

  it("updates search results and track filters on the loaded demo session", async function () {
    var app = await renderApp();

    await click(findClickableText(app.container, "Load a demo session"));
    await waitFor(function () {
      return findByText(app.container, "demo-session.jsonl");
    }, "expected demo session to load");

    await click(app.container.querySelector('button[aria-label^="Investigate,"]'));
    var searchInput = app.container.querySelector('[aria-label="Search evidence events"]');
    await changeInput(searchInput, "rate limiting");
    expect(await waitFor(function () {
      return getSearchCount(app.container);
    }, "expected search count to appear")).toBe("1 match");

    expect(findClickableText(app.container, "User only")).toBeTruthy();

    await click(findClickableText(app.container, "Tool calls"));
    expect(findExactButton(app.container, "Tool calls").getAttribute("aria-pressed")).toBe("true");

    await app.unmount();
  });

  it("keeps visualization and command palette journeys in the workflow", async function () {
    var app = await renderApp();

    await click(findClickableText(app.container, "Load a demo session"));
    await waitFor(function () {
      return findByText(app.container, "demo-session.jsonl");
    }, "expected demo session to load");

    await click(app.container.querySelector('button[aria-label^="Investigate,"]'));
    expect(findByText(app.container, "Session Info")).toBeTruthy();
    await click(app.container.querySelector('button[aria-label^="Analyze,"]'));
    var viewExpectations = [
      ["Tracks", "Tracks"],
      ["Waterfall", "Waterfall Stats"],
      ["Stats", "Autonomy Metrics"],
      ["Cost", "Token spend & context buildup"],
    ];

    for (var i = 0; i < viewExpectations.length; i++) {
      await click(findExactButton(app.container, viewExpectations[i][0]));
      await waitFor(function (expectedText) {
        return function () {
          return findByText(app.container, expectedText);
        };
      }(viewExpectations[i][1]), "expected " + viewExpectations[i][0] + " view to render");
    }
    await click(app.container.querySelector('button[aria-label^="Improve,"]'));
    await waitFor(function () { return findByText(app.container, "Session coaching:"); });

    await click(findButtonByTitle(app.container, "Command Palette (Cmd+K)"));
    await waitFor(function () {
      return app.container.querySelector('input[aria-label="Search command palette"]');
    }, "expected command palette to open");

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

  it("applies theme changes immediately without a reload", async function () {
    global.localStorage.setItem("agentviz:theme-mode", "dark");

    var app = await renderApp();

    await click(findClickableText(app.container, "Load a demo session"));
    await waitFor(function () {
      return findByText(app.container, "demo-session.jsonl");
    }, "expected demo session to load");

    var appShell = app.container.firstElementChild;
    var initialStyle = appShell.getAttribute("style");
    expect(initialStyle).toContain("background: rgb(0, 0, 0)");

    await click(app.container.querySelector('button[aria-label="Theme selector"]'));
    await click(findExactButton(app.container, "Light"));

    await waitFor(function () {
      var style = appShell.getAttribute("style") || "";
      return style.includes("background: rgb(246, 247, 251)") ? style : "";
    }, "expected session shell background to switch to light mode");

    expect(document.documentElement.dataset.themePreference).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(appShell.getAttribute("style")).toContain("background: rgb(246, 247, 251)");
    expect(appShell.getAttribute("style")).not.toBe(initialStyle);

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

    expect(app.container.querySelector('button[aria-label^="Compare,"]').getAttribute("aria-disabled")).toBe("true");
    expect(app.container.querySelector('button[aria-label^="Improve,"]').getAttribute("aria-disabled")).toBe("true");
    await click(app.container.querySelector('button[aria-label^="Investigate,"]'));
    expect(app.container.querySelector('[aria-label="Play playback"]')).toBeNull();
    expect(app.container.querySelector('[aria-label="Playback speed"]')).toBeNull();
    expect(app.container.querySelector('[aria-label="Playback position"]')).toBeTruthy();
    await click(app.container.querySelector('[aria-label="Close session"]'));
    expect(findByText(app.container, "Live session streaming")).toBeNull();
    expect(window.location.hash).toBe("#/v2/find");

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

  it("keeps transport time and speed across zones and uses workflow shortcuts without stealing native keys", async function () {
    var app = await renderApp();
    await click(findClickableText(app.container, "Load a demo session"));
    async function key(key, extras, target) {
      await act(async function () {
        (target || document.body).dispatchEvent(new KeyboardEvent("keydown", Object.assign({ key: key, code: key === " " ? "Space" : key, bubbles: true, cancelable: true }, extras)));
      });
    }
    await key("3");
    expect(window.location.hash).toBe("#/v2/investigate");
    var slider = app.container.querySelector('[role="slider"]');
    await key("Home", {}, slider);
    expect(slider.getAttribute("aria-valuenow")).toBe("0");
    await key("ArrowRight", {}, slider);
    var time = slider.getAttribute("aria-valuenow");
    expect(Number(time)).toBeGreaterThan(0);
    await click(app.container.querySelector('[aria-label="Playback speed"]'));
    await click(Array.from(app.container.querySelectorAll('[role="option"]')).find(function (node) { return node.textContent === "4x"; }));
    await key("4");
    expect(window.location.hash).toBe("#/v2/analyze");
    expect(app.container.querySelector('[role="slider"]').getAttribute("aria-valuenow")).toBe(time);
    expect(app.container.querySelector('[aria-label="Playback speed"]').textContent).toBe("4x");
    await key("1", { ctrlKey: true });
    expect(window.location.hash).toBe("#/v2/analyze");
    await key(" ", {}, app.container.querySelector('[aria-label="Play playback"]'));
    expect(app.container.querySelector('[aria-label="Play playback"]')).toBeTruthy();
    await key(" ");
    expect(app.container.querySelector('[aria-label="Pause playback"]')).toBeTruthy();
    await key(" ");
    await key("7");
    expect(window.location.hash).toBe("#/v2/improve");
    expect(app.container.textContent).toContain("Coach is now Improve");
    await key("?");
    expect(app.container.querySelector('[role="dialog"][aria-label="Keyboard shortcuts"]')).toBeTruthy();
    await click(app.container.querySelector('[aria-label="Close keyboard shortcuts"]'));
    await key("1");
    await key("/");
    expect(document.activeElement.getAttribute("aria-label")).toBe("Search v2 sessions");
    await app.unmount();
  });

  it("preserves Q&A messages and drafts across zones and failed loads, but Close resets them and retains saved runs", async function () {
    global.localStorage.setItem("agentviz:density", '"comfortable"');
    global.localStorage.setItem("agentviz:theme-mode", '"light"');
    global.localStorage.setItem("agentviz:v2:find:sort", '"cost"');
    var app = await renderApp(createExportBootstrapFetch("qa-session.jsonl", FIXTURE_TEXT));
    await waitFor(function () { return app.container.querySelector('[aria-label="Close session"]'); });
    async function askShortcut() {
      await act(async function () { document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "K", ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true })); });
    }
    await askShortcut();
    var input = app.container.querySelector('[aria-label="Ask about this session"]');
    await changeInput(input, "how many turns?");
    await act(async function () { input.closest("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(app.container.textContent).toContain("quick answer");
    await changeInput(input, "my unfinished question");
    await click(closeQAButton(app.container));
    await click(app.container.querySelector('button[aria-label^="Analyze,"]'));
    await click(app.container.querySelector('button[aria-label^="Improve,"]'));
    await click(findExactButton(app.container, "Ask about session"));
    expect(app.container.querySelector('[aria-label="Ask about this session"]').value).toBe("my unfinished question");
    expect(app.container.textContent).toContain("how many turns?");
    await click(closeQAButton(app.container));
    await click(app.container.querySelector('button[aria-label^="Find,"]'));
    expect(app.container.querySelector('[aria-label="Close session"]')).toBeTruthy();
    var upload = app.container.querySelector('input[type="file"]');
    Object.defineProperty(upload, "files", { value: [new File(["{}"], "bad.jsonl")], configurable: true });
    await act(async function () { upload.dispatchEvent(new Event("change", { bubbles: true })); });
    await waitFor(function () { return app.container.querySelector('[role="alert"]'); });
    await askShortcut();
    expect(app.container.querySelector('[aria-label="Ask about this session"]').value).toBe("my unfinished question");
    expect(app.container.textContent).toContain("how many turns?");
    await click(closeQAButton(app.container));
    var library = global.localStorage.getItem("agentviz:session-library:v1");
    await click(app.container.querySelector('[aria-label="Close session"]'));
    expect(global.localStorage.getItem("agentviz:session-library:v1")).toBe(library);
    expect(global.localStorage.getItem("agentviz:density")).toBe('"comfortable"');
    expect(global.localStorage.getItem("agentviz:theme-mode")).toBe('"light"');
    expect(global.localStorage.getItem("agentviz:v2:find:sort")).toBe('"cost"');
    expect(app.container.querySelector('[aria-label="Close session"]')).toBeNull();
    await click(findExactButton(app.container, "Open"));
    await waitFor(function () { return window.location.hash === "#/v2/review"; });
    await askShortcut();
    expect(app.container.querySelector('[aria-label="Ask about this session"]').value).toBe("");
    expect(app.container.textContent).not.toContain("how many turns?");
    await app.unmount();
  });

  it.each(["replacement", "close"])("aborts session Q&A on successful %s, not zone changes or failed loads", async function (disposal) {
    var signal;
    var finishRead;
    var reader = {
      read: vi.fn(function () { return new Promise(function (resolve) { finishRead = resolve; }); }),
      cancel: vi.fn(async function () {}),
    };
    var bootstrap = createExportBootstrapFetch("stream-session.jsonl", FIXTURE_TEXT);
    var app = await renderApp(function (url, options) {
      if (url === "/api/qa/ask") {
        signal = options.signal;
        return Promise.resolve({ ok: true, body: { getReader: function () { return reader; } } });
      }
      return bootstrap(url, options);
    });
    await waitFor(function () { return app.container.querySelector('[aria-label="Close session"]'); });
    async function openQA() {
      await act(async function () {
        document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "K", ctrlKey: true, shiftKey: true, bubbles: true }));
      });
    }
    await openQA();
    var input = app.container.querySelector('[aria-label="Ask about this session"]');
    await changeInput(input, "Propose an alternative implementation strategy");
    await act(async function () { input.closest("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    await waitFor(function () { return signal; });
    await changeInput(input, "retain this draft");
    await click(closeQAButton(app.container));
    await click(app.container.querySelector('button[aria-label^="Analyze,"]'));
    expect(signal.aborted).toBe(false);
    await click(app.container.querySelector('button[aria-label^="Find,"]'));
    var upload = app.container.querySelector('input[type="file"]');
    async function importText(text, name) {
      Object.defineProperty(upload, "files", { value: [new File([text], name)], configurable: true });
      await act(async function () { upload.dispatchEvent(new Event("change", { bubbles: true })); });
    }
    await importText("{}", "invalid.jsonl");
    await waitFor(function () { return app.container.querySelector('[role="alert"]'); });
    expect(signal.aborted).toBe(false);
    if (disposal === "close") {
      await click(app.container.querySelector('[aria-label="Close session"]'));
      await click(findExactButton(app.container, "Open"));
    } else {
      await importText(FIXTURE_TEXT, "replacement.jsonl");
    }
    await waitFor(function () { return window.location.hash === "#/v2/review"; });
    expect(signal.aborted).toBe(true);
    expect(reader.cancel).toHaveBeenCalledTimes(1);
    await act(async function () {
      finishRead({ done: false, value: new TextEncoder().encode('data: {"token":"stale answer"}\n') });
    });
    await openQA();
    expect(app.container.querySelector('[aria-label="Ask about this session"]').value).toBe("");
    expect(app.container.textContent).not.toContain("Propose an alternative implementation strategy");
    expect(app.container.textContent).not.toContain("stale answer");
    await app.unmount();
  });
});
