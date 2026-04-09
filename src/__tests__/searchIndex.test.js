import { describe, it, expect } from "vitest";
import SearchIndex from "../lib/searchIndex.js";

function makeEntry(index, overrides) {
  return {
    index: index,
    event: Object.assign({ t: 0, text: "", toolName: "", agent: "" }, overrides),
  };
}

describe("SearchIndex", function () {
  it("returns empty for empty entries", function () {
    var idx = new SearchIndex([]);
    expect(idx.search("foo")).toEqual([]);
  });

  it("returns empty for empty query", function () {
    var entries = [makeEntry(0, { text: "hello" })];
    var idx = new SearchIndex(entries);
    expect(idx.search("")).toEqual([]);
  });

  it("matches event text", function () {
    var entries = [
      makeEntry(0, { text: "Created file utils.js" }),
      makeEntry(1, { text: "Ran tests" }),
    ];
    var idx = new SearchIndex(entries);
    var results = idx.search("utils");
    expect(results).toHaveLength(1);
    expect(results[0].index).toBe(0);
  });

  it("matches tool name", function () {
    var entries = [
      makeEntry(0, { toolName: "Read" }),
      makeEntry(1, { toolName: "Write" }),
    ];
    var idx = new SearchIndex(entries);
    var results = idx.search("write");
    expect(results).toHaveLength(1);
    expect(results[0].index).toBe(1);
  });

  it("matches agent name", function () {
    var entries = [
      makeEntry(0, { agent: "assistant" }),
      makeEntry(1, { agent: "user" }),
    ];
    var idx = new SearchIndex(entries);
    var results = idx.search("assistant");
    expect(results).toHaveLength(1);
    expect(results[0].index).toBe(0);
  });

  it("is case insensitive", function () {
    var entries = [makeEntry(0, { text: "Hello World" })];
    var idx = new SearchIndex(entries);
    expect(idx.search("HELLO")).toHaveLength(1);
    expect(idx.search("hello")).toHaveLength(1);
    expect(idx.search("Hello")).toHaveLength(1);
  });

  it("supports partial matches", function () {
    var entries = [makeEntry(0, { text: "debugging the parser" })];
    var idx = new SearchIndex(entries);
    expect(idx.search("bug")).toHaveLength(1);
    expect(idx.search("pars")).toHaveLength(1);
  });

  it("returns multiple matches", function () {
    var entries = [
      makeEntry(0, { text: "error in module A" }),
      makeEntry(1, { text: "no issues here" }),
      makeEntry(2, { text: "another error found" }),
    ];
    var idx = new SearchIndex(entries);
    var results = idx.search("error");
    expect(results).toHaveLength(2);
    expect(results[0].index).toBe(0);
    expect(results[1].index).toBe(2);
  });

  it("handles large dataset without error", function () {
    var entries = [];
    for (var i = 0; i < 1000; i++) {
      entries.push(makeEntry(i, { text: "event number " + i, toolName: "tool" + (i % 10) }));
    }
    var idx = new SearchIndex(entries);
    var results = idx.search("event number 999");
    expect(results).toHaveLength(1);
    expect(results[0].index).toBe(999);

    var toolResults = idx.search("tool5");
    expect(toolResults).toHaveLength(100);
  });
});
