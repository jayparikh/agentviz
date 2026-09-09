// @vitest-environment jsdom

import React, { useEffect } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

var exportMocks = vi.hoisted(function () {
  return {
    exportSingleSession: vi.fn(function () { return Promise.resolve("single"); }),
    exportComparison: vi.fn(function () { return Promise.resolve("compare"); }),
  };
});

vi.mock("../lib/exportHtml.js", function () {
  return {
    exportSingleSession: exportMocks.exportSingleSession,
    exportComparison: exportMocks.exportComparison,
  };
});

import {
  SessionProvider,
  mergeSessionSources,
  useSessionContext,
} from "../contexts/SessionProvider.jsx";
import { parseSessionText } from "../lib/sessionParsing";
import { persistSessionSnapshot } from "../lib/sessionLibrary.js";

var FIXTURE_TEXT = readFileSync(resolve(process.cwd(), "src/__tests__/fixtures/test-copilot.jsonl"), "utf8");

function createInactiveFetch() {
  return vi.fn(async function () {
    return { ok: false };
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

function Probe({ onContext }) {
  var ctx = useSessionContext();
  useEffect(function () {
    if (onContext) onContext(ctx);
  }, [ctx, onContext]);

  return (
    <div>
      <div id="file">{ctx.session.file || "none"}</div>
      <div id="source-path">{ctx.session.sourcePath || "none"}</div>
      <div id="file-b">{ctx.sessionB.file || "none"}</div>
      <div id="event-count">{ctx.session.events ? ctx.session.events.length : 0}</div>
      <div id="summary-label">
        {ctx.debrief.summary && ctx.debrief.summary[0] ? ctx.debrief.summary[0].label : "none"}
      </div>
      <div id="session-count">{ctx.allSessions.length}</div>
      <div id="compare-ready">{ctx.compareReady ? "ready" : "not-ready"}</div>
      <button type="button" onClick={function () { ctx.loadSample(); }}>Load sample</button>
      <button type="button" onClick={ctx.reset}>Reset</button>
      <button type="button" onClick={function () { ctx.openStoredSession(ctx.allSessions[0]); }}>Open first</button>
      <button type="button" onClick={function () { ctx.handleFile(FIXTURE_TEXT, "fixture-a.jsonl"); }}>Load fixture A</button>
      <button type="button" onClick={function () { ctx.sessionB.handleFile(FIXTURE_TEXT, "fixture-b.jsonl"); }}>Load fixture B</button>
      <button type="button" onClick={function () { ctx.openCompareEntries([
        { id: "fixture-a", file: "fixture-a.jsonl" }, { id: "fixture-b", file: "fixture-b.jsonl" },
      ]); }}>Start compare</button>
      <button type="button" onClick={ctx.reset}>Close comparison</button>
      <button type="button" onClick={ctx.handleExportSession}>Export session</button>
      <button type="button" onClick={ctx.handleExportComparison}>Export compare</button>
      <button type="button" onClick={function () { ctx.openCompareEntries(ctx.allSessions.slice(0, 2)); }}>Open compare entries</button>
    </div>
  );
}

async function renderProvider(props) {
  var container = document.createElement("div");
  document.body.appendChild(container);
  var root = createRoot(container);

  await act(async function () {
    root.render(
      <SessionProvider>
        <Probe onContext={props && props.onContext} />
      </SessionProvider>
    );
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
  global.fetch = createInactiveFetch();
  global.localStorage = {
    getItem: function (key) { return Object.prototype.hasOwnProperty.call(storage, key) ? storage[key] : null; },
    setItem: function (key, value) { storage[key] = String(value); },
    removeItem: function (key) { delete storage[key]; },
    clear: function () { storage = {}; },
  };
  window.history.replaceState(null, "", "#/");
});

afterEach(function () {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
  window.history.replaceState(null, "", "#/");
});

describe("SessionProvider", function () {
  it("exports shared session APIs", function () {
    expect(typeof SessionProvider).toBe("function");
    expect(typeof useSessionContext).toBe("function");
    expect(typeof mergeSessionSources).toBe("function");
  });

  it("merges stored and discovered sessions while hiding internal continuation handoffs", function () {
    var merged = mergeSessionSources([
      {
        id: "copilot-cli:internal",
        file: "events.jsonl",
        format: "copilot-cli",
        sessionId: "internal",
        primaryPrompt: "Summarize the following conversation for context continuity. Preserve details.",
      },
      {
        id: "claude-code:stored",
        file: "stored.jsonl",
        format: "claude-code",
        sessionId: "stored",
      },
    ], [
      {
        id: "discovered-stored",
        path: "C:\\Users\\jayp\\.copilot\\stored.jsonl",
        sessionId: "stored",
        source: "discovered",
        size: 12000,
      },
      {
        id: "tiny",
        path: "C:\\Users\\jayp\\.copilot\\tiny.jsonl",
        source: "discovered",
        size: 100,
      },
      {
        id: "manifest-only",
        path: "https://example.com/session.jsonl",
        file: "manifest.jsonl",
        source: "manifest",
      },
    ]);

    expect(merged.map(function (entry) { return entry.id; })).toEqual([
      "claude-code:stored",
      "manifest-only",
    ]);
    expect(merged[0].discoveredPath).toBe("C:\\Users\\jayp\\.copilot\\stored.jsonl");
  });

  it("loads and resets the sample session through shared context", async function () {
    var app = await renderProvider();

    await act(async function () {
      app.container.querySelector("button").click();
    });

    await waitFor(function () {
      return app.container.querySelector("#file").textContent === "demo-session.jsonl";
    }, "expected sample session to load");

    expect(Number(app.container.querySelector("#event-count").textContent)).toBeGreaterThan(0);
    expect(app.container.querySelector("#source-path").textContent).toBe("none");
    expect(app.container.querySelector("#summary-label").textContent).toBe("Productive runtime");

    await act(async function () {
      app.container.querySelectorAll("button")[1].click();
    });

    await waitFor(function () {
      return app.container.querySelector("#file").textContent === "none";
    }, "expected reset to clear sample session");
    expect(app.container.querySelector("#file-b").textContent).toBe("none");

    await app.unmount();
  });

  it("opens stored sessions through the provider", async function () {
    var parsed = parseSessionText(FIXTURE_TEXT);
    persistSessionSnapshot("fixture.jsonl", parsed.result, FIXTURE_TEXT, global.localStorage);
    var app = await renderProvider();

    await waitFor(function () {
      return app.container.querySelector("#session-count").textContent === "1";
    }, "expected stored session to appear");

    await act(async function () {
      app.container.querySelectorAll("button")[2].click();
    });

    await waitFor(function () {
      return app.container.querySelector("#file").textContent === "fixture.jsonl";
    }, "expected stored session to load");

    expect(Number(app.container.querySelector("#event-count").textContent)).toBeGreaterThan(0);

    await app.unmount();
  });

  it("preserves discovered source path when opening a session", async function () {
    var parsed = parseSessionText(FIXTURE_TEXT);
    var persisted = persistSessionSnapshot("fixture.jsonl", parsed.result, FIXTURE_TEXT, global.localStorage);
    var sourcePath = "C:\\Users\\jayp\\.copilot\\session-state\\fixture\\events.jsonl";
    global.localStorage.setItem("agentviz:session-library:v1", JSON.stringify(persisted.entries.map(function (entry) {
      return Object.assign({}, entry, { discoveredPath: sourcePath });
    })));
    var app = await renderProvider();

    await waitFor(function () {
      return app.container.querySelector("#session-count").textContent === "1";
    }, "expected stored session to appear");

    await act(async function () {
      app.container.querySelectorAll("button")[2].click();
    });

    await waitFor(function () {
      return app.container.querySelector("#source-path").textContent === sourcePath;
    }, "expected source path to survive load");

    await app.unmount();
  });

  it("tracks compare readiness and closes both active sessions without deleting stored content", async function () {
    global.localStorage.setItem("agentviz:session-content:v1:fixture-a", FIXTURE_TEXT);
    global.localStorage.setItem("agentviz:session-content:v1:fixture-b", FIXTURE_TEXT);
    var app = await renderProvider();

    await act(async function () {
      var buttons = app.container.querySelectorAll("button");
      buttons[5].click();
    });

    await waitFor(function () {
      return app.container.querySelector("#compare-ready").textContent === "ready";
    }, "expected compare to become ready");

    await act(async function () {
      app.container.querySelectorAll("button")[6].click();
    });

    await waitFor(function () {
      return app.container.querySelector("#compare-ready").textContent === "not-ready";
    }, "expected compare to exit");
    expect(app.container.querySelector("#file").textContent).toBe("none");
    expect(app.container.querySelector("#file-b").textContent).toBe("none");
    expect(global.localStorage.getItem("agentviz:session-content:v1:fixture-a")).toBe(FIXTURE_TEXT);

    await app.unmount();
  });

  it("loads selected entries for comparison through shared context", async function () {
    global.localStorage.setItem("agentviz:session-library:v1", JSON.stringify([
      { id: "fixture-a", file: "fixture-a.jsonl", format: "copilot-cli", hasContent: true, importedAt: "2026-05-01T00:00:00.000Z", updatedAt: "2026-05-01T00:00:00.000Z" },
      { id: "fixture-b", file: "fixture-b.jsonl", format: "copilot-cli", hasContent: true, importedAt: "2026-05-02T00:00:00.000Z", updatedAt: "2026-05-02T00:00:00.000Z" },
    ]));
    global.localStorage.setItem("agentviz:session-content:v1:fixture-a", FIXTURE_TEXT);
    global.localStorage.setItem("agentviz:session-content:v1:fixture-b", FIXTURE_TEXT);
    var app = await renderProvider();

    await waitFor(function () {
      return app.container.querySelector("#session-count").textContent === "2";
    }, "expected two stored sessions");

    await act(async function () {
      app.container.querySelectorAll("button")[9].click();
    });

    await waitFor(function () {
      return app.container.querySelector("#compare-ready").textContent === "ready";
    }, "expected selected compare entries to be ready");

    expect(app.container.querySelector("#file").textContent).toBe("fixture-a.jsonl");
    expect(app.container.querySelector("#file-b").textContent).toBe("fixture-b.jsonl");

    await app.unmount();
  });

  it("runs single-session and comparison exports with raw session text", async function () {
    global.localStorage.setItem("agentviz:session-content:v1:fixture-a", FIXTURE_TEXT);
    global.localStorage.setItem("agentviz:session-content:v1:fixture-b", FIXTURE_TEXT);
    var app = await renderProvider();

    await act(async function () {
      var buttons = app.container.querySelectorAll("button");
      buttons[5].click();
    });

    await waitFor(function () {
      return app.container.querySelector("#file").textContent === "fixture-a.jsonl"
        && app.container.querySelector("#file-b").textContent === "fixture-b.jsonl";
    }, "expected fixtures to load");

    await act(async function () {
      var buttons = app.container.querySelectorAll("button");
      buttons[7].click();
      buttons[8].click();
    });

    await waitFor(function () {
      return exportMocks.exportSingleSession.mock.calls.length === 1
        && exportMocks.exportComparison.mock.calls.length === 1;
    }, "expected export helpers to run");

    expect(exportMocks.exportSingleSession).toHaveBeenCalledWith(FIXTURE_TEXT, "fixture-a.jsonl");
    expect(exportMocks.exportComparison).toHaveBeenCalledWith(
      FIXTURE_TEXT,
      "fixture-a.jsonl",
      FIXTURE_TEXT,
      "fixture-b.jsonl",
    );

    await app.unmount();
  });
});
