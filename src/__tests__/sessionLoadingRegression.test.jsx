// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, it, expect, vi, afterEach } from "vitest";
import useSessionLoader from "../hooks/useSessionLoader.js";
import useLiveStream from "../hooks/useLiveStream.js";
import { SessionProvider, useSessionContext } from "../contexts/SessionProvider.jsx";

const text = JSON.stringify({ type: "user", message: { content: "retained evidence" } });
afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });

async function renderProvider() {
  let state;
  function Probe() { state = useSessionContext(); return null; }
  const root = createRoot(document.createElement("div"));
  await act(async () => root.render(<SessionProvider enableHashRouter={false}><Probe /></SessionProvider>));
  return { get state() { return state; }, unmount: () => act(async () => root.unmount()) };
}

function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}

const response = value => ({ ok: true, text: async () => value });
const entry = name => ({ id: name, file: name, discoveredPath: name, isDiscovered: true });

describe("session load completion", () => {
  it("bootstraps an empty live snapshot and preserves one subscription across live renders and resets", async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    const sources = [];
    vi.stubGlobal("EventSource", class {
      constructor(url) { this.url = url; this.close = vi.fn(); sources.push(this); }
    });
    vi.stubGlobal("fetch", vi.fn(url => Promise.resolve(url === "/api/meta"
      ? { ok: true, json: async () => ({ live: true, filename: "live.jsonl" }) }
      : { ok: true, headers: { get: () => "0:cursor" }, text: async () => "" })));
    let loader;
    function Probe() {
      loader = useSessionLoader();
      useLiveStream({ enabled: loader.isLive, onLines: loader.appendLines, offset: loader.streamOffset });
      return null;
    }
    const root = createRoot(document.createElement("div"));
    try {
      await act(async () => root.render(<Probe />));
      expect(loader.isLive).toBe(true);
      expect(fetch).toHaveBeenCalledWith("/api/file?live=1");
      expect(sources).toHaveLength(1);
      expect(sources[0].url).toContain("cursor=0%3Acursor");
      await act(async () => {
        sources[0].onmessage({ data: JSON.stringify({ lines: text + "\n" }) });
        await vi.advanceTimersByTimeAsync(500);
      });
      expect(loader.events).toHaveLength(1);
      expect(sources).toHaveLength(1);
      await act(async () => {
        sources[0].onmessage({ data: JSON.stringify({ lines: text.replace("retained", "discarded") + "\n" }) });
        sources[0].onmessage({ data: JSON.stringify({ lines: "", reset: true }) });
        await vi.advanceTimersByTimeAsync(500);
      });
      expect(loader.events).toBeNull();
      expect(loader.getRawText()).toBe("");
      await act(async () => {
        sources[0].onmessage({ data: JSON.stringify({ lines: text.replace("retained", "replacement") + "\n" }) });
        await vi.advanceTimersByTimeAsync(500);
      });
      expect(loader.events[0].text).toBe("replacement evidence");
      expect(sources).toHaveLength(1);
      const vscode = JSON.stringify({ kind: 0, v: {
        version: 3, sessionId: "patch-delete", requests: [{ message: { text: "remove me" }, response: [] }],
      } });
      await act(async () => {
        sources[0].onmessage({ data: JSON.stringify({ lines: vscode, reset: true }) });
        await vi.advanceTimersByTimeAsync(500);
      });
      expect(loader.events).toHaveLength(1);
      await act(async () => {
        sources[0].onmessage({ data: JSON.stringify({ lines: JSON.stringify({ kind: 1, k: ["requests"], v: [] }) }) });
        await vi.advanceTimersByTimeAsync(500);
      });
      expect(loader.events).toBeNull();
      expect(loader.turns).toEqual([]);
      expect(loader.metadata).toBeNull();
    } finally {
      await act(async () => root.unmount());
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });
  it("ignores an older fetched selection and reports failures while retaining the successful session", async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const old = deferred();
    vi.stubGlobal("fetch", vi.fn(url => {
      if (url.includes("path=old")) return old.promise;
      if (url.includes("path=new")) return Promise.resolve(response(text));
      if (url.includes("path=bad")) return Promise.resolve(response("{}"));
      return Promise.resolve({ ok: false });
    }));
    const view = await renderProvider();
    try {
      let older;
      await act(async () => { older = view.state.openStoredSession(entry("old")); });
      expect(view.state.session.loading).toBe(true);
      let success;
      await act(async () => { success = await view.state.openStoredSession(entry("new")); });
      expect(success).toBe(true);
      const key = view.state.sessionLoadKey;
      await act(async () => { old.resolve(response(text.replace("retained", "stale"))); await older; });
      expect(view.state.session.file).toBe("new");
      expect(view.state.session.getRawText()).toBe(text);
      await act(async () => { success = await view.state.openStoredSession(entry("bad")); });
      expect(success).toBe(false);
      expect(view.state.sessionLoadKey).toBe(key);
      expect(view.state.session.getRawText()).toBe(text);
      expect(view.state.session.error).toBeTruthy();
      await act(async () => { success = await view.state.openStoredSession(entry("missing")); });
      expect(success).toBe(false);
      expect(view.state.loadError).toContain("Retry");
      expect(view.state.retryLoad).toBeTypeOf("function");
      expect(view.state.session.loading).toBe(false);
    } finally { await view.unmount(); vi.unstubAllGlobals(); }
  });

  it("waits for both compare parses and rejects malformed replacements without changing either side", async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal("fetch", vi.fn(url => Promise.resolve(url.startsWith("/api/session")
      ? response(url.includes("bad") ? "{}" : text)
      : { ok: false })));
    const view = await renderProvider();
    try {
      await act(async () => { expect(await view.state.openCompareEntries([entry("a"), entry("b")])).toBe(true); });
      expect(view.state.compareReady).toBe(true);
      await act(async () => { expect(await view.state.openCompareEntries([entry("c"), entry("bad")])).toBe(false); });
      expect(view.state.session.file).toBe("a");
      expect(view.state.sessionB.file).toBe("b");
      expect(view.state.compareReady).toBe(false);
    } finally { await view.unmount(); vi.unstubAllGlobals(); }
  });

  it("settles superseded deferred parsing as false", async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    let loader;
    function Probe() { loader = useSessionLoader({ autoBootstrap: false }); return null; }
    const root = createRoot(document.createElement("div"));
    try {
      await act(async () => root.render(<Probe />));
      let first;
      let second;
      await act(async () => {
        first = loader.handleFile("{}", "bad");
        second = loader.handleFile(text, "good");
        expect(await first).toBe(false);
        expect(await second).toBe(true);
      });
      expect(loader.file).toBe("good");
    } finally { await act(async () => root.unmount()); }
  });
  it("returns success only after parsing and retains previous raw evidence on failure", async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    let loader;
    function Probe() { loader = useSessionLoader({ autoBootstrap: false }); return null; }
    const root = createRoot(document.createElement("div"));
    try {
      await act(async () => { root.render(<Probe />); });
      let completion;
      await act(async () => { completion = loader.handleFile(text, "good.jsonl"); });
      expect(loader.loading).toBe(true);
      await act(async () => { await vi.runAllTimersAsync(); });
      expect(await completion).toBe(true);
      const previous = loader.events;
      await act(async () => { completion = loader.handleFile("{}", "bad.jsonl"); });
      await act(async () => { await vi.runAllTimersAsync(); });
      expect(await completion).toBe(false);
      expect(loader.events).toBe(previous);
      expect(loader.getRawText()).toBe(text);
      expect(loader.file).toBe("good.jsonl");
      expect(loader.error).toBeTruthy();
    } finally {
      await act(async () => root.unmount());
      vi.useRealTimers();
    }
  });
});
