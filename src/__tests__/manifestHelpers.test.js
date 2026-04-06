// @vitest-environment jsdom
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { filterByTags, collectAllTags, computeVisibleTags, getInitialTagsFromURL } from "../components/InboxView.jsx";

describe("filterByTags", function () {
  var entries = [
    { file: "a.jsonl", tags: ["nightly", "dotnet"] },
    { file: "b.jsonl", tags: ["nightly"] },
    { file: "c.jsonl", tags: ["dotnet", "build"] },
    { file: "d.jsonl", tags: [] },
    { file: "e.jsonl" },
  ];

  it("returns all entries when no tags are active", function () {
    expect(filterByTags(entries, [])).toEqual(entries);
  });

  it("returns all entries when activeTags is null/undefined", function () {
    expect(filterByTags(entries, null)).toEqual(entries);
    expect(filterByTags(entries, undefined)).toEqual(entries);
  });

  it("filters by a single tag", function () {
    var result = filterByTags(entries, ["nightly"]);
    expect(result.map(function (e) { return e.file; })).toEqual(["a.jsonl", "b.jsonl"]);
  });

  it("uses AND logic for multiple tags", function () {
    var result = filterByTags(entries, ["nightly", "dotnet"]);
    expect(result.map(function (e) { return e.file; })).toEqual(["a.jsonl"]);
  });

  it("returns empty when no entries match all tags", function () {
    var result = filterByTags(entries, ["nightly", "build"]);
    expect(result).toEqual([]);
  });
});

describe("collectAllTags", function () {
  it("collects and sorts unique tags from entries", function () {
    var entries = [
      { tags: ["beta", "alpha"] },
      { tags: ["gamma", "alpha"] },
      { tags: [] },
      {},
    ];
    expect(collectAllTags(entries)).toEqual(["alpha", "beta", "gamma"]);
  });

  it("returns empty array for entries with no tags", function () {
    expect(collectAllTags([{}, { tags: [] }])).toEqual([]);
  });

  it("handles null/undefined input", function () {
    expect(collectAllTags(null)).toEqual([]);
    expect(collectAllTags(undefined)).toEqual([]);
  });
});

describe("faceted tag co-occurrence (computeVisibleTags)", function () {
  var entries = [
    { file: "a.jsonl", tags: ["nightly", "dotnet", "msbuild"] },
    { file: "b.jsonl", tags: ["nightly", "dotnet"] },
    { file: "c.jsonl", tags: ["dotnet", "aspnet"] },
    { file: "d.jsonl", tags: ["nuget"] },
  ];

  it("shows all tags when nothing is selected", function () {
    expect(computeVisibleTags(entries, [])).toEqual(["aspnet", "dotnet", "msbuild", "nightly", "nuget"]);
  });

  it("narrows visible tags to co-occurring ones when a tag is selected", function () {
    // Only sessions with 'nightly' are a and b; their tags are nightly, dotnet, msbuild
    expect(computeVisibleTags(entries, ["nightly"])).toEqual(["dotnet", "msbuild", "nightly"]);
  });

  it("further narrows when multiple tags are selected", function () {
    // Only session a has both nightly+msbuild; its tags are nightly, dotnet, msbuild
    expect(computeVisibleTags(entries, ["nightly", "msbuild"])).toEqual(["dotnet", "msbuild", "nightly"]);
  });

  it("keeps active tags visible even when no sessions match (deselect safety)", function () {
    // No session has both nuget+nightly, but both tags must remain visible
    expect(computeVisibleTags(entries, ["nuget", "nightly"])).toEqual(["nightly", "nuget"]);
  });

  it("hides unrelated tags (nuget not shown when filtering by nightly)", function () {
    var visible = computeVisibleTags(entries, ["nightly"]);
    expect(visible.indexOf("nuget")).toBe(-1);
    expect(visible.indexOf("aspnet")).toBe(-1);
  });
});

describe("getInitialTagsFromURL", function () {
  var origLocation;

  beforeEach(function () {
    // Save and mock window.location.search in jsdom-like environments
    origLocation = window.location;
    delete window.location;
    window.location = { search: "" };
  });

  afterEach(function () {
    window.location = origLocation;
  });

  it("returns empty array when no tag params", function () {
    window.location.search = "";
    expect(getInitialTagsFromURL()).toEqual([]);
  });

  it("returns tags from URL query params", function () {
    window.location.search = "?tag=nightly&tag=dotnet";
    expect(getInitialTagsFromURL()).toEqual(["nightly", "dotnet"]);
  });

  it("returns single tag", function () {
    window.location.search = "?tag=build";
    expect(getInitialTagsFromURL()).toEqual(["build"]);
  });
});

describe("manifest URL resolution (new URL)", function () {
  it("resolves a relative session URL against manifest base", function () {
    var manifestUrl = "https://example.com/data/manifest.json";
    var sessionUrl = "session.jsonl";
    expect(new URL(sessionUrl, manifestUrl).href).toBe("https://example.com/data/session.jsonl");
  });

  it("handles absolute session URLs", function () {
    var manifestUrl = "https://example.com/data/manifest.json";
    var sessionUrl = "https://cdn.example.com/session.jsonl";
    expect(new URL(sessionUrl, manifestUrl).href).toBe("https://cdn.example.com/session.jsonl");
  });

  it("handles root-relative session URLs", function () {
    var manifestUrl = "https://example.com/data/manifest.json";
    var sessionUrl = "/assets/session.jsonl";
    expect(new URL(sessionUrl, manifestUrl).href).toBe("https://example.com/assets/session.jsonl");
  });

  it("handles protocol-relative session URLs", function () {
    var manifestUrl = "https://example.com/data/manifest.json";
    var sessionUrl = "//cdn.example.com/session.jsonl";
    expect(new URL(sessionUrl, manifestUrl).href).toBe("https://cdn.example.com/session.jsonl");
  });

  it("handles ../relative paths", function () {
    var manifestUrl = "https://example.com/data/v2/manifest.json";
    var sessionUrl = "../v1/session.jsonl";
    expect(new URL(sessionUrl, manifestUrl).href).toBe("https://example.com/data/v1/session.jsonl");
  });

  it("handles manifest URL with query strings", function () {
    var manifestUrl = "https://example.com/data/manifest.json?token=abc";
    var sessionUrl = "session.jsonl";
    expect(new URL(sessionUrl, manifestUrl).href).toBe("https://example.com/data/session.jsonl");
  });
});

describe("tag propagation after session open", function () {
  // Simulates the allSessions merge behavior: library entries that were opened
  // from manifest sessions should retain tags through filtering.

  it("library entry without tags is excluded by filterByTags", function () {
    // After opening a manifest session, the library entry has no tags.
    // Tag filtering must correctly exclude it.
    var libraryEntry = { file: "opened.jsonl", tags: [] };
    var manifestEntry = { file: "unopened.jsonl", tags: ["nightly", "bugfix"] };
    var result = filterByTags([libraryEntry, manifestEntry], ["bugfix"]);
    expect(result).toEqual([manifestEntry]);
  });

  it("library entry with patched tags is included by filterByTags", function () {
    // After the afterLoad fix, tags are patched onto the library entry.
    var patchedEntry = { file: "opened.jsonl", tags: ["nightly", "bugfix"] };
    var manifestEntry = { file: "unopened.jsonl", tags: ["nightly", "bugfix"] };
    var result = filterByTags([patchedEntry, manifestEntry], ["bugfix"]);
    expect(result).toEqual([patchedEntry, manifestEntry]);
  });

  it("patched tags work with AND logic across multiple active tags", function () {
    var entries = [
      { file: "a.jsonl", tags: ["nightly", "bugfix"] },
      { file: "b.jsonl", tags: ["nightly"] },
      { file: "c.jsonl", tags: ["bugfix"] },
    ];
    var result = filterByTags(entries, ["nightly", "bugfix"]);
    expect(result.map(function (e) { return e.file; })).toEqual(["a.jsonl"]);
  });
});

describe("dedup: enrichedLibrary vs discoveredOnly", function () {
  // Tests the dedup logic: library entries matched by discoveredPath should
  // prevent the same manifest session from appearing as a discovered entry.

  function simulateDedup(libraryEntries, discoveredSessions) {
    // Mirrors the allSessions merge logic in App.jsx
    var discoveredBySessionId = {};
    discoveredSessions.forEach(function (s) {
      if (s.sessionId) discoveredBySessionId[s.sessionId] = s;
    });

    var enrichedLibrary = libraryEntries.map(function (e) {
      if (e.discoveredPath) return e;
      var match = (e.sessionId && discoveredBySessionId[e.sessionId]);
      if (match) return Object.assign({}, e, { discoveredPath: match.path });
      return e;
    });

    var discoveredOnly = discoveredSessions.filter(function (s) {
      return !enrichedLibrary.some(function (e) {
        return e.discoveredPath === s.path || (e.sessionId && e.sessionId === s.sessionId);
      });
    });

    return { enrichedLibrary: enrichedLibrary, discoveredOnly: discoveredOnly };
  }

  it("removes discovered session that matches library by discoveredPath", function () {
    var lib = [{ id: "lib1", discoveredPath: "http://x.com/a.jsonl", tags: ["bugfix"] }];
    var disc = [{ path: "http://x.com/a.jsonl", tags: ["bugfix"], source: "manifest" }];
    var result = simulateDedup(lib, disc);
    expect(result.discoveredOnly).toEqual([]);
    expect(result.enrichedLibrary.length).toBe(1);
  });

  it("removes discovered session that matches library by sessionId", function () {
    var lib = [{ id: "lib1", sessionId: "sess-123" }];
    var disc = [{ path: "http://x.com/a.jsonl", sessionId: "sess-123", source: "manifest" }];
    var result = simulateDedup(lib, disc);
    expect(result.discoveredOnly).toEqual([]);
    expect(result.enrichedLibrary[0].discoveredPath).toBe("http://x.com/a.jsonl");
  });

  it("does not match when sessionId is null on both sides", function () {
    var lib = [{ id: "lib1", sessionId: null, discoveredPath: "http://x.com/other.jsonl" }];
    var disc = [{ path: "http://x.com/a.jsonl", sessionId: null, source: "manifest" }];
    var result = simulateDedup(lib, disc);
    expect(result.discoveredOnly.length).toBe(1);
  });

  it("keeps unmatched discovered sessions", function () {
    var lib = [{ id: "lib1", discoveredPath: "http://x.com/a.jsonl" }];
    var disc = [
      { path: "http://x.com/a.jsonl", tags: ["nightly"], source: "manifest" },
      { path: "http://x.com/b.jsonl", tags: ["bugfix"], source: "manifest" },
    ];
    var result = simulateDedup(lib, disc);
    expect(result.discoveredOnly.length).toBe(1);
    expect(result.discoveredOnly[0].path).toBe("http://x.com/b.jsonl");
  });
});
