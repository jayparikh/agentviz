import { describe, it, expect, vi, afterEach } from "vitest";

// exportHtml.js relies on browser APIs (document, fetch, URL, Blob).
// We test in the default node environment since jsdom is not configured;
// the module loads fine but DOM calls throw, which we validate.

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

  it("embeds lazy chunks and worker assets in single-session exports", async function () {
    var entryUrl = "https://example.test/assets/index-abc.js";
    var chunkUrl = "https://example.test/assets/GraphView-def.js";
    var sideEffectUrl = "https://example.test/assets/setup-jkl.js";
    var workerUrl = "https://example.test/assets/elk-worker-ghi.js";
    var responses = {};
    responses[entryUrl] = new Response(
      'import"./setup-jkl.js";import("./GraphView-def.js");'
    );
    responses[chunkUrl] = new Response(
      'import{a}from"./index-abc.js";new URL("elk-worker-ghi.js",import.meta.url);'
    );
    responses[sideEffectUrl] = new Response('globalThis.__setup=true;');
    responses[workerUrl] = new Response("self.onmessage=function(){};", {
      headers: { "Content-Type": "text/javascript" },
    });

    var downloadedBlob = null;
    var anchor = { click: vi.fn() };
    vi.stubGlobal("document", {
      querySelector: vi.fn(function () { return { src: entryUrl }; }),
      createElement: vi.fn(function () { return anchor; }),
      body: { appendChild: vi.fn(), removeChild: vi.fn() },
    });
    vi.stubGlobal("fetch", vi.fn(function (url) {
      return Promise.resolve(responses[url].clone());
    }));
    vi.stubGlobal("URL", Object.assign(URL, {
      createObjectURL: vi.fn(function (blob) {
        downloadedBlob = blob;
        return "blob:export";
      }),
      revokeObjectURL: vi.fn(),
    }));
    vi.stubGlobal("btoa", function (value) {
      return Buffer.from(value, "binary").toString("base64");
    });

    var mod = await import("../lib/exportHtml.js");
    await mod.exportSingleSession('{"type":"session.start"}', "trace.jsonl");
    var html = await downloadedBlob.text();

    expect(fetch).toHaveBeenCalledWith(entryUrl);
    expect(fetch).toHaveBeenCalledWith(chunkUrl);
    expect(fetch).toHaveBeenCalledWith(sideEffectUrl);
    expect(fetch).toHaveBeenCalledWith(workerUrl);
    expect(html).toContain('<script type="importmap">');
    expect(html).toContain("window.__AGENTVIZ_STANDALONE__ = true");
    expect(html).not.toContain('import("./GraphView-def.js")');

    var importMapText = html.match(/<script type="importmap">(.*?)<\/script>/)[1];
    var importMap = JSON.parse(importMapText);
    expect(importMap.imports[entryUrl]).toMatch(/^data:text\/javascript;base64,/);
    expect(importMap.imports[chunkUrl]).toMatch(/^data:text\/javascript;base64,/);
    expect(importMap.imports[sideEffectUrl]).toMatch(/^data:text\/javascript;base64,/);

    var chunkSource = Buffer.from(
      importMap.imports[chunkUrl].split(",")[1],
      "base64"
    ).toString("utf8");
    expect(chunkSource).toContain("data:text/javascript;base64,");
    expect(chunkSource).not.toContain("elk-worker-ghi.js");
  });
});
