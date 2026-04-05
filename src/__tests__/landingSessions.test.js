import { describe, expect, it } from "vitest";
import {
  filterLandingEntriesByQuery,
  formatLandingClientLabel,
  getLandingEntryDisplayTitle,
  getLandingEntrySecondaryText,
  isLowSignalDiscoveredEntry,
  isLandingSearchShortcut,
  settleLandingRefresh,
  sortDiscoveredLandingEntries,
  sortLandingEntries,
  sortLandingEntriesByDate,
} from "../lib/landingSessions.js";

describe("formatLandingClientLabel", function () {
  it("formats known clients", function () {
    expect(formatLandingClientLabel("claude-code")).toBe("Claude Code");
    expect(formatLandingClientLabel("copilot-cli")).toBe("Copilot CLI");
    expect(formatLandingClientLabel({ format: "vscode-chat", isInsiders: true })).toBe("VS Code Insiders");
  });

  it("uses a neutral fallback for unknown clients", function () {
    expect(formatLandingClientLabel({ format: "custom-client" })).toBe("custom-client");
    expect(formatLandingClientLabel(null)).toBe("Unknown client");
  });
});

describe("filterLandingEntriesByQuery", function () {
  var entries = [
    { file: "alpha.jsonl", filename: "alpha.jsonl", project: "alpha", primaryPrompt: "Ship dashboard polish", repository: "octo/alpha" },
    { file: "beta.jsonl", filename: "fallback-name.jsonl", project: "beta", primaryPrompt: "Fix accessibility", repository: "octo/beta" },
  ];

  it("returns all entries for an empty query", function () {
    expect(filterLandingEntriesByQuery(entries, "")).toEqual(entries);
    expect(filterLandingEntriesByQuery(entries, "   ")).toEqual(entries);
  });

  it("matches across file, filename, project, prompt, and repository", function () {
    expect(filterLandingEntriesByQuery(entries, "alpha")).toHaveLength(1);
    expect(filterLandingEntriesByQuery(entries, "fallback-name")).toHaveLength(1);
    expect(filterLandingEntriesByQuery(entries, "accessibility")).toHaveLength(1);
    expect(filterLandingEntriesByQuery(entries, "octo/beta")).toHaveLength(1);
  });
});

describe("landing display text", function () {
  it("prefers primary prompt over raw session filenames", function () {
    var entry = {
      file: "9d1afa0b-4697-447c-a8e8-171f03b2f0a2.jsonl",
      filename: "9d1afa0b-4697-447c-a8e8-171f03b2f0a2.jsonl",
      primaryPrompt: "Ship the npm release",
      project: "agentviz",
    };

    expect(getLandingEntryDisplayTitle(entry)).toBe("Ship the npm release");
    expect(getLandingEntrySecondaryText(entry, getLandingEntryDisplayTitle(entry))).toBe("9d1afa0b-4697-447c-a8e8-171f03b2f0a2.jsonl");
  });

  it("uses human summaries before opaque filenames for discovered sessions", function () {
    var entry = {
      file: "Fix Squashed Dashboard Cards",
      filename: "events.jsonl",
      project: "Fix Squashed Dashboard Cards",
      format: "copilot-cli",
    };

    expect(getLandingEntryDisplayTitle(entry)).toBe("Fix Squashed Dashboard Cards");
    expect(getLandingEntrySecondaryText(entry, getLandingEntryDisplayTitle(entry))).toBe("events.jsonl");
  });
});

describe("sortLandingEntries", function () {
  var entries = [
    { id: "a", updatedAt: "2026-04-03T00:00:00.000Z", totalCost: 0.12, totalEvents: 8, reviewScore: 4.5 },
    { id: "b", updatedAt: "2026-04-05T00:00:00.000Z", totalCost: 0.45, totalEvents: 3, reviewScore: 9.1 },
    { id: "c", updatedAt: "2026-04-04T00:00:00.000Z", totalCost: 0.08, totalEvents: 18, reviewScore: 1.2 },
  ];

  it("sorts by review score by default", function () {
    expect(sortLandingEntries(entries, "needs-review").map(function (entry) { return entry.id; })).toEqual(["b", "a", "c"]);
  });

  it("sorts by recent, expensive, and active", function () {
    expect(sortLandingEntries(entries, "most-recent").map(function (entry) { return entry.id; })).toEqual(["b", "c", "a"]);
    expect(sortLandingEntries(entries, "most-expensive").map(function (entry) { return entry.id; })).toEqual(["b", "a", "c"]);
    expect(sortLandingEntries(entries, "most-active").map(function (entry) { return entry.id; })).toEqual(["c", "a", "b"]);
  });

  it("falls back to importedAt when updatedAt is missing", function () {
    var importedOnlyEntries = [
      { id: "a", importedAt: "2026-04-03T00:00:00.000Z", reviewScore: 1 },
      { id: "b", importedAt: "2026-04-05T00:00:00.000Z", reviewScore: 1 },
      { id: "c", importedAt: "2026-04-04T00:00:00.000Z", reviewScore: 1 },
    ];

    expect(sortLandingEntries(importedOnlyEntries, "most-recent").map(function (entry) { return entry.id; })).toEqual(["b", "c", "a"]);
    expect(sortLandingEntries(importedOnlyEntries, "needs-review").map(function (entry) { return entry.id; })).toEqual(["b", "c", "a"]);
  });

  it("sorts by date helper", function () {
    expect(sortLandingEntriesByDate(entries).map(function (entry) { return entry.id; })).toEqual(["b", "c", "a"]);
  });
});

describe("low-signal discovered sessions", function () {
  it("flags generic session metadata titles", function () {
    expect(isLowSignalDiscoveredEntry({
      isDiscovered: true,
      file: "## Session metadata",
      size: 429 * 1024,
    })).toBe(true);
  });

  it("flags very small discovered sessions", function () {
    expect(isLowSignalDiscoveredEntry({
      isDiscovered: true,
      file: "Fix dashboard polish",
      size: 9 * 1024,
    })).toBe(true);
  });

  it("keeps normal discovered sessions above low-signal ones", function () {
    var entries = [
      { id: "small", isDiscovered: true, file: "## Session metadata", size: 9 * 1024, updatedAt: "2026-04-05T00:00:00.000Z" },
      { id: "good", isDiscovered: true, file: "Fix Squashed Dashboard Cards", size: 120 * 1024, updatedAt: "2026-04-04T00:00:00.000Z" },
      { id: "generic", isDiscovered: true, file: "## Session metadata", size: 429 * 1024, updatedAt: "2026-04-06T00:00:00.000Z" },
    ];

    expect(sortDiscoveredLandingEntries(entries).map(function (entry) { return entry.id; })).toEqual(["good", "generic", "small"]);
  });
});

describe("isLandingSearchShortcut", function () {
  it("matches slash outside text inputs", function () {
    expect(isLandingSearchShortcut({
      key: "/",
      metaKey: false,
      ctrlKey: false,
      target: { tagName: "DIV" },
    })).toBe(true);
  });

  it("ignores slash inside inputs and modified shortcuts", function () {
    expect(isLandingSearchShortcut({
      key: "/",
      metaKey: false,
      ctrlKey: false,
      target: { tagName: "INPUT" },
    })).toBe(false);
    expect(isLandingSearchShortcut({
      key: "/",
      metaKey: true,
      ctrlKey: false,
      target: { tagName: "DIV" },
    })).toBe(false);
  });
});

describe("settleLandingRefresh", function () {
  it("settles synchronous refreshes immediately", function () {
    var settled = 0;

    settleLandingRefresh(undefined, function () {
      settled += 1;
    });

    expect(settled).toBe(1);
  });

  it("settles async refreshes after the promise completes", async function () {
    var settled = 0;

    await new Promise(function (resolve) {
      settleLandingRefresh(Promise.resolve(), function () {
        settled += 1;
        resolve();
      });
    });

    expect(settled).toBe(1);
  });
});
