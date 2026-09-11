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
import { FINDINGS_PREFIX, findingsSessionId, fingerprint } from "../lib/findings";

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
  delete window.__AGENTVIZ_STANDALONE__;
  delete window.__AGENTVIZ_COMPARE__;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
  window.history.replaceState(null, "", "#/");
});

describe("SessionProvider", function () {
  it("persists event findings independently, keeps drafts on failed loads, and restores renamed reimports", async function () {
    var ctx;
    var app = await renderProvider({ onContext: function (value) { ctx = value; } });
    await act(async function () { await ctx.handleFile(FIXTURE_TEXT, "first.jsonl"); });
    var entry = { index: 0, event: ctx.session.events[0] };
    await act(async function () { ctx.session.findings.save(entry, "Remember index zero"); });
    expect(ctx.session.findings.entries[0]).toMatchObject({ note: "Remember index zero", available: true, anchor: { index: 0 } });
    await act(async function () { ctx.session.findings.setDraft(entry, "Unfinished"); });
    await act(async function () { expect(await ctx.handleFile("bad", "invalid")).toBe(false); });
    expect(Object.values(ctx.session.findings.drafts)[0].note).toBe("Unfinished");
    expect(ctx.session.getRawText()).toBe(FIXTURE_TEXT);
    await act(async function () { ctx.reset(); });
    expect(ctx.session.findings.items).toEqual([]);
    expect(ctx.session.findings.drafts).toEqual({});
    await act(async function () { await ctx.handleFile(FIXTURE_TEXT, "renamed.jsonl", "foreign-path"); });
    expect(ctx.session.findings.entries[0]).toMatchObject({ note: "Remember index zero", available: true });
    expect(ctx.session.findings.drafts).toEqual({});
    await app.unmount();
    app = await renderProvider({ onContext: function (value) { ctx = value; } });
    await act(async function () { await ctx.openStoredSession(ctx.allSessions[0]); });
    expect(ctx.session.findings.items[0].note).toBe("Remember index zero");
    await app.unmount();
  });

  it("keeps quota-failed findings and note drafts, exports them, and retries without affecting transcript save", async function () {
    var ctx;
    var app = await renderProvider({ onContext: function (value) { ctx = value; } });
    await act(async function () { await ctx.handleFile(FIXTURE_TEXT, "first.jsonl"); });
    var entry = { index: 0, event: ctx.session.events[0] };
    var original = global.localStorage.setItem;
    var write = vi.spyOn(global.localStorage, "setItem").mockImplementation(function (key, value) {
      if (key.startsWith(FINDINGS_PREFIX)) throw new DOMException("Full", "QuotaExceededError");
      original(key, value);
    });
    await act(async function () {
      ctx.session.findings.setDraft(entry, "</script> unsaved");
      ctx.session.findings.save(entry, "</script> unsaved");
    });
    expect(ctx.session.findings.error.kind).toBe("quota");
    expect(ctx.session.findings.dirty).toBe(true);
    expect(Object.values(ctx.session.findings.drafts)[0].note).toBe("</script> unsaved");
    expect(ctx.session.storageStatus.saved).toBe(true);
    await act(async function () { ctx.handleExportSession(); });
    expect(exportMocks.exportSingleSession.mock.calls[0][2].items[0].note).toBe("</script> unsaved");
    expect(exportMocks.exportSingleSession.mock.calls[0][0]).toBe(FIXTURE_TEXT);
    write.mockRestore();
    await act(async function () { ctx.session.findings.retry(); });
    expect(ctx.session.findings.dirty).toBe(false);
    expect(ctx.session.findings.error).toBeNull();
    await app.unmount();
  });

  it("synchronizes identical A/B identities without crossing other sessions or binding different snapshots", async function () {
    var ctx;
    var app = await renderProvider({ onContext: function (value) { ctx = value; } });
    await act(async function () { await ctx.handleFile(FIXTURE_TEXT, "a.jsonl"); });
    await act(async function () { await ctx.sessionB.handleFile(FIXTURE_TEXT, "b.jsonl"); });
    await act(async function () { ctx.session.findings.save({ index: 0, event: ctx.session.events[0] }, "A"); });
    expect(ctx.sessionB.findings.items[0].note).toBe("A");
    await act(async function () { ctx.sessionB.findings.save({ index: 1, event: ctx.sessionB.events[1] }, "B"); });
    expect(ctx.session.findings.items).toHaveLength(2);
    await act(async function () { await ctx.sessionB.handleFile(FIXTURE_TEXT.replace("Can you add", "Would you add"), "changed.jsonl"); });
    expect(ctx.sessionB.findings.entries.every(function (item) { return !item.available; })).toBe(true);
    expect(ctx.session.findings.entries.every(function (item) { return item.available; })).toBe(true);
    await act(async function () { await ctx.sessionB.handleFile(FIXTURE_TEXT.replaceAll("aaaabbbb-1234-5678-abcd-000000000001", "another"), "other.jsonl"); });
    expect(ctx.sessionB.findings.items).toEqual([]);
    expect(ctx.session.findings.items).toHaveLength(2);
    await app.unmount();
  });

  it("preserves current A findings and drafts when loading a comparison", async function () {
    var ctx;
    var app = await renderProvider({ onContext: function (value) { ctx = value; } });
    await act(async function () { await ctx.handleFile(FIXTURE_TEXT, "a.jsonl"); });
    await act(async function () { ctx.session.findings.setDraft({ index: 0, event: ctx.session.events[0] }, "Still drafting"); });
    global.localStorage.setItem("agentviz:session-content:v1:b", FIXTURE_TEXT);
    await act(async function () { expect(await ctx.openCompareCurrentWithEntry({ id: "b", file: "b.jsonl" })).toBe(true); });
    expect(Object.values(ctx.session.findings.drafts)[0].note).toBe("Still drafting");
    expect(ctx.compareReady).toBe(true);
    await app.unmount();
  });

  it("retains stale A/B drafts as conflicts rather than silently overwriting a newer note", async function () {
    var ctx;
    var app = await renderProvider({ onContext: function (value) { ctx = value; } });
    await act(async function () { await ctx.handleFile(FIXTURE_TEXT, "a.jsonl"); });
    await act(async function () { await ctx.sessionB.handleFile(FIXTURE_TEXT, "b.jsonl"); });
    var entry = { index: 0, event: ctx.session.events[0] };
    await act(async function () { ctx.session.findings.save(entry, "Original"); });
    await act(async function () { ctx.session.findings.setDraft(entry, "A draft"); });
    await act(async function () { ctx.sessionB.findings.save(entry, "B saved"); });
    await act(async function () { ctx.session.findings.save(entry, "A draft"); });
    expect(ctx.session.findings.error.kind).toBe("conflict");
    expect(Object.values(ctx.session.findings.drafts)[0].note).toBe("A draft");
    expect(ctx.sessionB.findings.items[0].note).toBe("B saved");
    await act(async function () { ctx.session.findings.reload(); });
    expect(ctx.session.findings.items[0].note).toBe("B saved");
    expect(ctx.session.findings.drafts).toEqual({});
    await app.unmount();
  });

  it("restores explicit export findings and drafts, isolates local notes, and validates ownership", async function () {
    var ctx;
    var app = await renderProvider({ onContext: function (value) { ctx = value; } });
    await act(async function () { await ctx.handleFile(FIXTURE_TEXT, "local.jsonl"); });
    await act(async function () { ctx.session.findings.save({ index: 0, event: ctx.session.events[0] }, "Local private note"); });
    var payload = ctx.session.findings.payload(FIXTURE_TEXT);
    payload = { ...payload, items: payload.items.map(function (item) { return { ...item, note: "Shared note" }; }) };
    window.__AGENTVIZ_STANDALONE__ = true;
    await act(async function () { await ctx.handleFile(FIXTURE_TEXT, "offline.jsonl", null, payload); });
    expect(ctx.session.findings.items[0].note).toBe("Shared note");
    expect(ctx.session.findings.embedded).toBe(true);
    await act(async function () { ctx.session.findings.remove(payload.items[0].id); });
    await act(async function () { await ctx.handleFile(FIXTURE_TEXT, "offline.jsonl", null, payload); });
    expect(ctx.session.findings.items).toEqual([]);
    await act(async function () { await ctx.handleFile(FIXTURE_TEXT, "legacy.jsonl"); });
    expect(ctx.session.findings.items).toEqual([]);
    await act(async function () { await ctx.handleFile(FIXTURE_TEXT, "bad-export.jsonl", null, { ...payload, snapshot: fingerprint("other") }); });
    expect(ctx.session.findings.items).toEqual([]);
    expect(ctx.session.findings.error.kind).toBe("corrupt");
    expect(ctx.session.getRawText()).toBe(FIXTURE_TEXT);
    delete window.__AGENTVIZ_STANDALONE__;
    await act(async function () { await ctx.handleFile(FIXTURE_TEXT, "local.jsonl"); });
    expect(ctx.session.findings.items[0].note).toBe("Local private note");
    await app.unmount();
  });

  it("retains unavailable live findings through empty reset and never binds them after source reorder", async function () {
    var ctx;
    vi.stubGlobal("EventSource", class { close() {} });
    global.fetch = vi.fn(async function (url) {
      if (String(url).includes("/api/meta")) return { ok: true, json: async function () { return { filename: "live.jsonl", live: true }; } };
      if (String(url).includes("/api/file")) return { ok: true, text: async function () { return FIXTURE_TEXT; } };
      return { ok: false };
    });
    var app = await renderProvider({ onContext: function (value) { ctx = value; } });
    await waitFor(function () { return ctx?.session.events?.length; });
    await act(async function () { ctx.session.findings.save({ index: 0, event: ctx.session.events[0] }, "Live note"); });
    var newLine = JSON.stringify({ type: "user.message", id: "later", timestamp: "2026-01-15T10:03:00.000Z", data: { content: "Later" } });
    await act(async function () { ctx.session.appendLines(newLine, false); });
    expect(ctx.session.findings.entries[0].available).toBe(true);
    await act(async function () { ctx.session.appendLines("", true); });
    expect(ctx.session.findings.entries[0]).toMatchObject({ note: "Live note", available: false });
    await act(async function () { ctx.session.appendLines(FIXTURE_TEXT.replace("Can you add", "Changed prompt"), false); });
    expect(ctx.session.findings.entries[0].available).toBe(false);
    await act(async function () { ctx.session.appendLines(FIXTURE_TEXT, true); });
    expect(ctx.session.findings.entries[0].available).toBe(true);
    await app.unmount();
  });

  it("does not overwrite corrupt findings and recovers when storage is repaired", async function () {
    var ctx;
    var id = findingsSessionId(parseSessionText(FIXTURE_TEXT).result.metadata, FIXTURE_TEXT);
    global.localStorage.setItem(FINDINGS_PREFIX + id, "{corrupt");
    var app = await renderProvider({ onContext: function (value) { ctx = value; } });
    await act(async function () { await ctx.handleFile(FIXTURE_TEXT, "a.jsonl"); });
    expect(ctx.session.findings.error.kind).toBe("corrupt");
    await act(async function () { ctx.session.findings.save({ index: 0, event: ctx.session.events[0] }, "Memory"); });
    expect(global.localStorage.getItem(FINDINGS_PREFIX + id)).toBe("{corrupt");
    expect(ctx.session.storageStatus.saved).toBe(true);
    global.localStorage.removeItem(FINDINGS_PREFIX + id);
    await act(async function () { ctx.session.findings.retry(); });
    expect(ctx.session.findings.error).toBeNull();
    expect(ctx.session.findings.items[0].note).toBe("Memory");
    await app.unmount();
  });

  it("keeps a parsed import usable on storage failure, retries saving, and retains state on failed loads", async function () {
    var ctx;
    var app = await renderProvider({ onContext: function (value) { ctx = value; } });
    var write = vi.spyOn(global.localStorage, "setItem").mockImplementation(function () {
      throw new DOMException("Full", "QuotaExceededError");
    });
    var success;
    await act(async function () { success = await ctx.handleFile(FIXTURE_TEXT, "unsaved.jsonl"); });
    expect(success).toBe(true);
    expect(ctx.session.error).toBe(null);
    expect(ctx.session.events.length).toBeGreaterThan(0);
    expect(ctx.session.getRawText()).toBe(FIXTURE_TEXT);
    expect(ctx.session.storageStatus).toMatchObject({ saved: false, error: { kind: "quota" } });
    var status = ctx.session.storageStatus;
    var key = ctx.sessionLoadKey;
    await act(async function () { success = await ctx.handleFile("not a session", "invalid.jsonl"); });
    expect(success).toBe(false);
    expect(ctx.session.storageStatus).toBe(status);
    expect(ctx.session.getRawText()).toBe(FIXTURE_TEXT);
    write.mockRestore();
    await act(async function () { ctx.session.retrySave(); });
    expect(ctx.session.storageStatus.saved).toBe(true);
    expect(ctx.sessionLoadKey).toBe(key);
    expect(ctx.allSessions[0].hasContent).toBe(true);
    await act(async function () { ctx.loadSample(); });
    expect(ctx.session.storageStatus).toBe(null);
    expect(ctx.storageError).toBe(null);
    await act(async function () { ctx.reset(); });
    expect(ctx.session.storageStatus).toBe(null);
    expect(ctx.sessionB.storageStatus).toBe(null);
    await app.unmount();
  });

  it("survives a throwing storage getter at startup and during import", async function () {
    var descriptor = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", { configurable: true, get: function () {
      throw new DOMException("Blocked", "SecurityError");
    } });
    var app;
    try {
      var ctx;
      app = await renderProvider({ onContext: function (value) { ctx = value; } });
      expect(ctx.storageError.kind).toBe("access");
      await act(async function () { expect(await ctx.handleFile(FIXTURE_TEXT, "blocked.jsonl")).toBe(true); });
      expect(ctx.session.storageStatus.saved).toBe(false);
      expect(ctx.session.findings.error.kind).toBe("access");
      expect(ctx.session.getRawText()).toBe(FIXTURE_TEXT);
      await act(async function () { await ctx.refreshSessions(); });
      expect(ctx.storageError.kind).toBe("access");
    } finally {
      Object.defineProperty(window, "localStorage", descriptor);
      if (app) await app.unmount();
    }
  });

  it("keeps comparison A saved when B's metadata fails, and exposes retry for B", async function () {
    var ctx;
    var textB = FIXTURE_TEXT.replaceAll("aaaabbbb-1234-5678-abcd-000000000001", "session-b");
    global.localStorage.setItem("agentviz:session-content:v1:a", FIXTURE_TEXT);
    global.localStorage.setItem("agentviz:session-content:v1:b", textB);
    var app = await renderProvider({ onContext: function (value) { ctx = value; } });
    var originalWrite = global.localStorage.setItem;
    var write = vi.spyOn(global.localStorage, "setItem").mockImplementation(function (key, text) {
      if (key === "agentviz:session-library:v1" && text.includes("session-b")) {
        throw new DOMException("Index denied", "SecurityError");
      }
      originalWrite(key, text);
    });
    await act(async function () {
      expect(await ctx.openCompareEntries([{ id: "a", file: "a.jsonl" }, { id: "b", file: "b.jsonl" }])).toBe(true);
    });
    expect(ctx.compareReady).toBe(true);
    expect(ctx.session.storageStatus.saved).toBe(true);
    expect(ctx.sessionB.storageStatus).toMatchObject({ saved: false, error: { operation: "write index" } });
    expect(ctx.sessionB.getRawText()).toBe(textB);
    write.mockRestore();
    await act(async function () { ctx.sessionB.retrySave(); });
    expect(ctx.sessionB.storageStatus.saved).toBe(true);
    await act(async function () { ctx.reset(); });
    expect(ctx.session.storageStatus).toBe(null);
    expect(ctx.sessionB.storageStatus).toBe(null);
    expect(ctx.storageError).toBe(null);
    await app.unmount();
  });

  it("invalidates an active copy evicted by B and also detects external removal on refresh", async function () {
    var ctx;
    var app = await renderProvider({ onContext: function (value) { ctx = value; } });
    await act(async function () { await ctx.handleFile(FIXTURE_TEXT, "a.jsonl"); });
    var idA = ctx.session.storageStatus.id;
    var originalWrite = global.localStorage.setItem;
    var write = vi.spyOn(global.localStorage, "setItem").mockImplementation(function (key, text) {
      if (key.includes("session-content") && !key.endsWith(idA)
        && global.localStorage.getItem("agentviz:session-content:v1:" + idA)) {
        throw new DOMException("Full", "QuotaExceededError");
      }
      originalWrite(key, text);
    });
    await act(async function () {
      await ctx.sessionB.handleFile(FIXTURE_TEXT.replaceAll("aaaabbbb-1234-5678-abcd-000000000001", "session-b"), "b.jsonl");
    });
    expect(ctx.evictedIds).toEqual([idA]);
    expect(ctx.session.storageStatus.saved).toBe(false);
    expect(ctx.session.getRawText()).toBe(FIXTURE_TEXT);
    expect(ctx.sessionB.storageStatus.saved).toBe(true);
    write.mockRestore();
    global.localStorage.removeItem("agentviz:session-content:v1:" + ctx.sessionB.storageStatus.id);
    await act(async function () { await ctx.refreshSessions(); });
    expect(ctx.sessionB.storageStatus.saved).toBe(false);
    expect(ctx.allSessions).toEqual([]);
    await app.unmount();
  });

  it("invalidates a saved active copy on a cross-tab storage event and preserves it when comparison loading fails", async function () {
    var ctx;
    var app = await renderProvider({ onContext: function (value) { ctx = value; } });
    await act(async function () { await ctx.handleFile(FIXTURE_TEXT, "a.jsonl"); });
    var id = ctx.session.storageStatus.id;
    global.localStorage.removeItem("agentviz:session-content:v1:" + id);
    await act(async function () { window.dispatchEvent(new StorageEvent("storage", { key: "agentviz:session-content:v1:" + id })); });
    expect(ctx.session.storageStatus.saved).toBe(false);
    expect(ctx.allSessions[0].hasContent).toBe(false);
    var status = ctx.session.storageStatus;
    await act(async function () {
      expect(await ctx.openCompareCurrentWithEntry({ id: "missing", file: "missing.jsonl" })).toBe(false);
    });
    expect(ctx.session.getRawText()).toBe(FIXTURE_TEXT);
    expect(ctx.session.storageStatus).toBe(status);
    await app.unmount();
  });

  it("tracks unsaved live snapshots, preserves older metadata, and clears pending saves on live reset and close", async function () {
    var ctx;
    vi.stubGlobal("EventSource", class { close() {} });
    global.fetch = vi.fn(async function (url) {
      if (String(url).includes("/api/meta")) return { ok: true, json: async function () { return { filename: "live.jsonl", live: true }; } };
      if (String(url).includes("/api/file")) return { ok: true, text: async function () { return FIXTURE_TEXT; } };
      return { ok: false };
    });
    var app = await renderProvider({ onContext: function (value) { ctx = value; } });
    await waitFor(function () { return ctx.session.isLive && ctx.session.storageStatus; });
    var oldEntry = ctx.allSessions[0];
    var write = vi.spyOn(global.localStorage, "setItem").mockImplementation(function () { throw new DOMException("Full", "QuotaExceededError"); });
    var line = '{"type":"user.message","data":{"content":"new live prompt"},"timestamp":"2026-01-15T10:05:00.000Z","id":"live-new"}';
    await act(async function () { ctx.session.appendLines(line, false); });
    expect(ctx.session.storageStatus).toMatchObject({ saved: false, pending: true });
    await sleep(300);
    expect(ctx.session.storageStatus).toMatchObject({ saved: false, previousSaved: true, error: { kind: "quota" } });
    expect(ctx.storageError).toBe(null);
    expect(ctx.session.getRawText()).toContain("new live prompt");
    expect(ctx.allSessions[0]).toEqual(oldEntry);
    write.mockRestore();
    global.localStorage.removeItem("agentviz:session-content:v1:" + oldEntry.id);
    await act(async function () {
      window.dispatchEvent(new StorageEvent("storage", { key: "agentviz:session-content:v1:" + oldEntry.id }));
    });
    expect(ctx.session.storageStatus).toMatchObject({ saved: false, previousSaved: false });
    expect(ctx.session.getRawText()).toContain("new live prompt");
    await act(async function () { ctx.session.retrySave(); });
    expect(ctx.session.storageStatus.saved).toBe(true);
    await act(async function () { ctx.session.appendLines("", true); });
    expect(ctx.session.storageStatus).toBe(null);
    expect(ctx.session.getRawText()).toBe("");
    await sleep(300);
    expect(ctx.session.storageStatus).toBe(null);
    await act(async function () { ctx.session.appendLines(FIXTURE_TEXT, true); });
    await act(async function () { ctx.reset(); });
    await sleep(300);
    expect(ctx.session.storageStatus).toBe(null);
    expect(ctx.session.getRawText()).toBe("");
    await app.unmount();
  });

  it("makes a canceled live save retryable when a replacement fails to parse", async function () {
    var ctx;
    vi.stubGlobal("EventSource", class { close() {} });
    global.fetch = vi.fn(async function (url) {
      if (String(url).includes("/api/meta")) return { ok: true, json: async function () { return { filename: "live.jsonl", live: true }; } };
      if (String(url).includes("/api/file")) return { ok: true, text: async function () { return FIXTURE_TEXT; } };
      return { ok: false };
    });
    var app = await renderProvider({ onContext: function (value) { ctx = value; } });
    await waitFor(function () { return ctx.session.isLive && ctx.session.storageStatus; });
    await act(async function () {
      ctx.session.appendLines('{"type":"user.message","data":{"content":"pending prompt"},"timestamp":"2026-01-15T10:05:00.000Z","id":"pending"}', false);
    });
    expect(ctx.session.storageStatus.pending).toBe(true);
    await act(async function () { expect(await ctx.handleFile("invalid", "bad.jsonl")).toBe(false); });
    expect(ctx.session.storageStatus).toMatchObject({ saved: false, pending: false });
    expect(ctx.session.getRawText()).toContain("pending prompt");
    await sleep(300);
    expect(ctx.session.storageStatus.saved).toBe(false);
    await act(async function () { ctx.session.retrySave(); });
    expect(ctx.session.storageStatus.saved).toBe(true);
    await app.unmount();
  });

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

    expect(exportMocks.exportSingleSession).toHaveBeenCalledWith(FIXTURE_TEXT, "fixture-a.jsonl", expect.objectContaining({ version: 1, items: [] }));
    expect(exportMocks.exportComparison).toHaveBeenCalledWith(
      FIXTURE_TEXT,
      "fixture-a.jsonl",
      FIXTURE_TEXT,
      "fixture-b.jsonl",
      expect.objectContaining({ version: 1, items: [] }),
      expect.objectContaining({ version: 1, items: [] }),
    );

    await app.unmount();
  });
});
