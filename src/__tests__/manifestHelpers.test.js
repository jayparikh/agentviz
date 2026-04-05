// @vitest-environment jsdom
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { filterByTags, collectAllTags, getInitialTagsFromURL } from "../components/InboxView.jsx";

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
