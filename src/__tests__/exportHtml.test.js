import { describe, it, expect, vi, afterEach } from "vitest";
import zlib from "node:zlib";

// exportHtml.js relies on browser APIs (document, fetch, URL, Blob).
// We test in the default node environment since jsdom is not configured;
// the module loads fine but DOM calls throw, which we validate.

var ENTRY_URL = "https://example.test/assets/index-abc.js";
var CHUNK_URL = "https://example.test/assets/GraphView-def.js";
var SIDE_EFFECT_URL = "https://example.test/assets/setup-jkl.js";
var WORKER_URL = "https://example.test/assets/elk-worker-ghi.js";

function buildResponses(overrides) {
  var responses = {};
  responses[ENTRY_URL] = new Response(
    'import"./setup-jkl.js";import("./GraphView-def.js");'
  );
  responses[CHUNK_URL] = new Response(
    'import{a}from"./index-abc.js";new URL("elk-worker-ghi.js",import.meta.url);'
  );
  responses[SIDE_EFFECT_URL] = new Response("globalThis.__setup=true;");
  responses[WORKER_URL] = new Response("self.onmessage=function(){};", {
    headers: { "Content-Type": "text/javascript" },
  });
  Object.keys(overrides || {}).forEach(function (key) {
    responses[key] = overrides[key];
  });
  return responses;
}

function stubBrowser(responses) {
  var captured = { blob: null };
  var anchor = { click: vi.fn() };
  vi.stubGlobal("document", {
    querySelector: vi.fn(function () { return { src: ENTRY_URL }; }),
    createElement: vi.fn(function () { return anchor; }),
    body: { appendChild: vi.fn(), removeChild: vi.fn() },
  });
  vi.stubGlobal("fetch", vi.fn(function (url) {
    if (!responses[url]) return Promise.reject(new Error("unexpected fetch: " + url));
    return Promise.resolve(responses[url].clone());
  }));
  vi.stubGlobal("URL", Object.assign(URL, {
    createObjectURL: vi.fn(function (blob) {
      captured.blob = blob;
      return "blob:export";
    }),
    revokeObjectURL: vi.fn(),
  }));
  vi.stubGlobal("btoa", function (value) {
    return Buffer.from(value, "binary").toString("base64");
  });
  return captured;
}

// The boot script embeds the payload as a single string literal; decode it the
// same way the exported file does at runtime.
function readPayload(html) {
  var compressed = /var COMPRESSED = (true|false);/.exec(html);
  var raw = /var PAYLOAD = "([^"]*)";/.exec(html);
  expect(compressed).toBeTruthy();
  expect(raw).toBeTruthy();
  if (compressed[1] === "true") {
    return JSON.parse(zlib.gunzipSync(Buffer.from(raw[1], "base64")).toString("utf8"));
  }
  return JSON.parse(raw[1]);
}

describe("exportHtml module", function () {
  afterEach(function () {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("exports exportSingleSession and exportComparison as async functions", async function () {
    var mod = await import("../lib/exportHtml.js");
    expect(typeof mod.exportSingleSession).toBe("function");
    expect(typeof mod.exportComparison).toBe("function");
  });

  it("exportSingleSession rejects without DOM", async function () {
    var mod = await import("../lib/exportHtml.js");
    await expect(mod.exportSingleSession("raw text", "test.jsonl")).rejects.toThrow();
  });

  it("exportComparison rejects without DOM", async function () {
    var mod = await import("../lib/exportHtml.js");
    await expect(
      mod.exportComparison("text-a", "a.jsonl", "text-b", "b.jsonl")
    ).rejects.toThrow();
  });

  it("embeds lazy chunks and worker assets without data: URL modules", async function () {
    var captured = stubBrowser(buildResponses());
    var mod = await import("../lib/exportHtml.js");
    await mod.exportSingleSession('{"type":"session.start"}', "trace.jsonl");
    var html = await captured.blob.text();

    expect(fetch).toHaveBeenCalledWith(ENTRY_URL);
    expect(fetch).toHaveBeenCalledWith(CHUNK_URL);
    expect(fetch).toHaveBeenCalledWith(SIDE_EFFECT_URL);
    expect(fetch).toHaveBeenCalledWith(WORKER_URL);

    // WebKit refuses module scripts from data: URLs, and import maps keyed by
    // the exporting server's URLs only resolve on the author's machine.
    expect(html).not.toContain('<script type="importmap">');
    expect(html).not.toContain("data:text/javascript");
    expect(html).toContain("window.__AGENTVIZ_STANDALONE__ = true");
  });

  it("never references the exporting origin in the generated file", async function () {
    var captured = stubBrowser(buildResponses());
    var mod = await import("../lib/exportHtml.js");
    await mod.exportSingleSession('{"type":"session.start"}', "trace.jsonl");
    var html = await captured.blob.text();
    var payload = readPayload(html);

    expect(html).not.toContain("https://example.test");
    expect(JSON.stringify(payload.modules)).not.toContain("https://example.test");
    expect(JSON.stringify(payload.assets)).not.toContain("https://example.test");
  });

  it("rewrites static imports to tokens and dynamic imports to a runtime lookup", async function () {
    var captured = stubBrowser(buildResponses());
    var mod = await import("../lib/exportHtml.js");
    await mod.exportSingleSession('{"type":"session.start"}', "trace.jsonl");
    var payload = readPayload(await captured.blob.text());

    var moduleIds = Object.keys(payload.modules);
    expect(moduleIds).toHaveLength(3);
    expect(payload.order).toHaveLength(3);

    var entrySource = payload.modules[payload.entry];
    expect(entrySource).toContain('import(window.__AGENTVIZ_MODULE_URLS__[');
    expect(entrySource).not.toContain('import("./GraphView-def.js")');
    expect(entrySource).toMatch(/import"__AGENTVIZ_MODULE_m\d+__"/);

    var chunkId = payload.order.filter(function (id) {
      return payload.modules[id].indexOf("import.meta.url") !== -1;
    })[0];
    expect(payload.modules[chunkId]).toMatch(/from"__AGENTVIZ_MODULE_m\d+__"/);
    expect(payload.modules[chunkId]).toMatch(/new URL\("__AGENTVIZ_ASSET_a\d+__",import\.meta\.url\)/);
    expect(payload.modules[chunkId]).not.toContain("elk-worker-ghi.js");

    // Text assets are embedded as text so gzip can compress them.
    var assetIds = Object.keys(payload.assets);
    expect(assetIds).toHaveLength(1);
    expect(payload.assets[assetIds[0]].text).toBe("self.onmessage=function(){};");
  });

  it("orders modules so static dependencies are created first", async function () {
    var captured = stubBrowser(buildResponses());
    var mod = await import("../lib/exportHtml.js");
    await mod.exportSingleSession('{"type":"session.start"}', "trace.jsonl");
    var payload = readPayload(await captured.blob.text());

    var chunkId = payload.order.filter(function (id) {
      return payload.modules[id].indexOf("import.meta.url") !== -1;
    })[0];
    expect(payload.order.indexOf(payload.entry)).toBeLessThan(payload.order.indexOf(chunkId));
  });

  it("embeds the session payload for the offline /api shim", async function () {
    var captured = stubBrowser(buildResponses());
    var mod = await import("../lib/exportHtml.js");
    await mod.exportSingleSession('{"type":"session.start"}', "trace.jsonl");
    var html = await captured.blob.text();
    var payload = readPayload(html);

    expect(payload.session).toEqual({ filename: "trace.jsonl", text: '{"type":"session.start"}' });
    expect(html).toContain("/api/meta");
    expect(html).toContain("/api/file");
    expect(html).toContain("/api/sessions");
    expect(html).toContain("/api/config");
    expect(html).toContain("Not available in exported view");
  });

  it("embeds both sessions for a comparison export", async function () {
    var captured = stubBrowser(buildResponses());
    var mod = await import("../lib/exportHtml.js");
    await mod.exportComparison("text-a", "a.jsonl", "text-b", "b.jsonl");
    var payload = readPayload(await captured.blob.text());

    expect(payload.compare).toEqual({
      a: { name: "a.jsonl", text: "text-a" },
      b: { name: "b.jsonl", text: "text-b" },
    });
    expect(payload.session).toBeUndefined();
  });

  it("renders a boot-failure fallback and no webfont request", async function () {
    var captured = stubBrowser(buildResponses());
    var mod = await import("../lib/exportHtml.js");
    await mod.exportSingleSession('{"type":"session.start"}', "trace.jsonl");
    var html = await captured.blob.text();

    expect(html).toContain("This AGENTVIZ export failed to load");
    expect(html).toContain('window.addEventListener("error"');
    expect(html).toContain('window.addEventListener("unhandledrejection"');
    expect(html).toContain("<noscript>");
    expect(html).not.toContain("fonts.googleapis.com");
    expect(html).toContain('--av-bg-base');
    expect(html).toContain('data-theme="light"');
  });

  it("fails loudly when a bundle source still references the exporting origin", async function () {
    var responses = buildResponses();
    responses[SIDE_EFFECT_URL] = new Response('globalThis.__api="https://example.test/api";');
    var captured = stubBrowser(responses);
    vi.stubGlobal("window", {
      location: { origin: "https://example.test", host: "example.test" },
    });

    var mod = await import("../lib/exportHtml.js");
    await expect(
      mod.exportSingleSession('{"type":"session.start"}', "trace.jsonl")
    ).rejects.toThrow(/only work on this machine/);
    expect(captured.blob).toBeNull();
  });

  it("fails loudly when the bundle has a static import cycle", async function () {
    var responses = buildResponses({});
    responses[ENTRY_URL] = new Response('import"./setup-jkl.js";');
    responses[SIDE_EFFECT_URL] = new Response('import"./index-abc.js";');
    stubBrowser(responses);

    var mod = await import("../lib/exportHtml.js");
    await expect(
      mod.exportSingleSession('{"type":"session.start"}', "trace.jsonl")
    ).rejects.toThrow(/static import cycle/);
  });
});
