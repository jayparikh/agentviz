import { describe, it, expect, vi, afterEach } from "vitest";
import lazyImport, { clearChunkReloadFlag } from "../lib/lazyImport.js";

var RELOAD_KEY = "agentviz:chunk-reload";

function installBrowserStubs(initialValue, options) {
  var store = {};
  if (initialValue != null) store[RELOAD_KEY] = initialValue;
  var reload = vi.fn();
  vi.stubGlobal("window", {
    __AGENTVIZ_STANDALONE__: options && options.standalone,
    location: { reload: reload, protocol: options && options.protocol || "https:" },
  });
  vi.stubGlobal("sessionStorage", {
    getItem: vi.fn(function (key) { return store[key] || null; }),
    setItem: vi.fn(function (key, value) { store[key] = value; }),
    removeItem: vi.fn(function (key) { delete store[key]; }),
  });
  return { reload: reload, store: store };
}

describe("lazyImport", function () {
  afterEach(function () {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("rethrows non-stale import errors", async function () {
    var stubs = installBrowserStubs();
    var error = new Error("boom");

    await expect(lazyImport(function () { return Promise.reject(error); })).rejects.toThrow("boom");
    expect(stubs.reload).not.toHaveBeenCalled();
    expect(sessionStorage.setItem).not.toHaveBeenCalled();
  });

  it("reloads once for stale chunk errors", async function () {
    var stubs = installBrowserStubs();
    var error = new Error("Failed to fetch dynamically imported module");
    var result = lazyImport(function () { return Promise.reject(error); });

    await Promise.resolve();

    expect(sessionStorage.setItem).toHaveBeenCalledWith(RELOAD_KEY, "1");
    expect(stubs.reload).toHaveBeenCalledTimes(1);
    expect(result).toBeInstanceOf(Promise);
  });

  it("rethrows stale chunk errors when reload was already attempted", async function () {
    var stubs = installBrowserStubs("1");
    var error = new Error("ChunkLoadError");

    await expect(lazyImport(function () { return Promise.reject(error); })).rejects.toThrow("ChunkLoadError");
    expect(stubs.reload).not.toHaveBeenCalled();
  });

  it("does not reload standalone file exports for missing chunks", async function () {
    var stubs = installBrowserStubs(null, { standalone: true, protocol: "file:" });
    var error = new Error("Failed to fetch dynamically imported module");

    await expect(lazyImport(function () { return Promise.reject(error); })).rejects.toThrow(
      "Failed to fetch dynamically imported module"
    );
    expect(stubs.reload).not.toHaveBeenCalled();
  });

  it("clears the stale chunk reload flag", function () {
    installBrowserStubs("1");

    clearChunkReloadFlag();

    expect(sessionStorage.removeItem).toHaveBeenCalledWith(RELOAD_KEY);
  });
});
