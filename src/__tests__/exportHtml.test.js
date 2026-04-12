import { describe, it, expect } from "vitest";

// exportHtml.js relies on browser APIs (document, fetch, URL, Blob).
// We test in the default node environment since jsdom is not configured;
// the module loads fine but DOM calls throw, which we validate.

describe("exportHtml module", function () {
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
});
