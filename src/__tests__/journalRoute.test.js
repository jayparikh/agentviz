import { describe, it, expect } from "vitest";

// Test the commit classification and narrative synthesis logic
// by importing directly from the route module.
// The route exports `handle()` but the internal helpers are not exported,
// so we test them indirectly via the API behavior.

// Since the route runs `git log` on the current repo, and we ARE in a git repo,
// we can test the actual API handler with a mock req/res.

function createMockRes() {
  var res = {
    statusCode: null,
    headers: {},
    body: "",
    writeHead: function (code, headers) {
      res.statusCode = code;
      if (headers) Object.assign(res.headers, headers);
    },
    end: function (data) {
      res.body = data || "";
    },
  };
  return res;
}

describe("journal git route", function () {
  // Dynamically import to avoid ESM issues with top-level
  var handle;

  it("can import the route handler", async function () {
    var mod = await import("../../routes/journal.js");
    handle = mod.handle;
    expect(typeof handle).toBe("function");
  });

  it("returns false for non-matching paths", async function () {
    var mod = await import("../../routes/journal.js");
    var res = createMockRes();
    var result = mod.handle("/api/sessions", { method: "GET" }, res, {});
    expect(result).toBe(false);
  });

  it("returns 405 for POST requests", async function () {
    var mod = await import("../../routes/journal.js");
    var res = createMockRes();
    var result = mod.handle("/api/journal/git", { method: "POST" }, res, {});
    expect(result).toBe(true);
    expect(res.statusCode).toBe(405);
  });

  it("returns valid JSON with entries and repo metadata", async function () {
    var mod = await import("../../routes/journal.js");
    var res = createMockRes();
    mod.handle("/api/journal/git", { method: "GET" }, res, {});
    expect(res.statusCode).toBe(200);

    var data = JSON.parse(res.body);
    expect(data).toHaveProperty("entries");
    expect(data).toHaveProperty("repo");
    expect(Array.isArray(data.entries)).toBe(true);
  });

  it("repo metadata has expected fields", async function () {
    var mod = await import("../../routes/journal.js");
    var res = createMockRes();
    mod.handle("/api/journal/git", { method: "GET" }, res, {});
    var data = JSON.parse(res.body);

    expect(data.repo).toHaveProperty("name");
    expect(data.repo).toHaveProperty("totalCommits");
    expect(data.repo).toHaveProperty("contributors");
    expect(data.repo).toHaveProperty("releases");
    expect(data.repo).toHaveProperty("features");
    expect(data.repo).toHaveProperty("fixes");
    expect(data.repo.totalCommits).toBeGreaterThan(0);
  });

  it("entries have the scribe timeline shape", async function () {
    var mod = await import("../../routes/journal.js");
    var res = createMockRes();
    mod.handle("/api/journal/git", { method: "GET" }, res, {});
    var data = JSON.parse(res.body);

    expect(data.entries.length).toBeGreaterThan(0);
    var entry = data.entries[0];
    expect(entry).toHaveProperty("type");
    expect(entry).toHaveProperty("time");
    expect(entry).toHaveProperty("hash");
    expect(entry).toHaveProperty("author");
    expect(entry).toHaveProperty("steeringCommand");
    expect(entry).toHaveProperty("whatHappened");
    expect(entry).toHaveProperty("levelUp");
  });

  it("entries use valid journal types", async function () {
    var mod = await import("../../routes/journal.js");
    var res = createMockRes();
    mod.handle("/api/journal/git", { method: "GET" }, res, {});
    var data = JSON.parse(res.body);

    var validTypes = ["milestone", "levelup", "pivot", "mistake"];
    data.entries.forEach(function (entry) {
      expect(validTypes).toContain(entry.type);
    });
  });

  it("entries are in chronological order", async function () {
    var mod = await import("../../routes/journal.js");
    var res = createMockRes();
    mod.handle("/api/journal/git", { method: "GET" }, res, {});
    var data = JSON.parse(res.body);

    for (var i = 1; i < data.entries.length; i++) {
      var prev = new Date(data.entries[i - 1].time).getTime();
      var curr = new Date(data.entries[i].time).getTime();
      expect(curr).toBeGreaterThanOrEqual(prev);
    }
  });

  it("collapses consecutive refactors into pivot arcs", async function () {
    var mod = await import("../../routes/journal.js");
    var res = createMockRes();
    mod.handle("/api/journal/git", { method: "GET" }, res, {});
    var data = JSON.parse(res.body);

    var pivots = data.entries.filter(function (e) { return e.type === "pivot"; });
    var arcs = pivots.filter(function (e) { return e.commitCount && e.commitCount >= 3; });
    // The agentviz repo has a 4-phase refactoring arc
    expect(arcs.length).toBeGreaterThanOrEqual(1);
    expect(arcs[0].steeringCommand).toContain("refactoring");
  });

  it("includes our own Journal commits as level-ups", async function () {
    var mod = await import("../../routes/journal.js");
    var res = createMockRes();
    mod.handle("/api/journal/git", { method: "GET" }, res, {});
    var data = JSON.parse(res.body);

    var journalEntries = data.entries.filter(function (e) {
      return e.whatHappened && e.whatHappened.toLowerCase().indexOf("journal") !== -1;
    });
    expect(journalEntries.length).toBeGreaterThanOrEqual(1);
  });
});

describe("journal steering route", function () {
  it("returns false for non-matching paths", async function () {
    var mod = await import("../../routes/journal.js");
    var res = createMockRes();
    var result = mod.handle("/api/other", { method: "GET" }, res, {});
    expect(result).toBe(false);
  });

  it("GET /api/journal/steering returns entries array", async function () {
    var mod = await import("../../routes/journal.js");
    var res = createMockRes();
    mod.handle("/api/journal/steering", { method: "GET" }, res, {});
    expect(res.statusCode).toBe(200);
    var data = JSON.parse(res.body);
    expect(data).toHaveProperty("entries");
    expect(Array.isArray(data.entries)).toBe(true);
  });

  it("POST /api/journal/steering redacts secrets from entries", async function () {
    var mod = await import("../../routes/journal.js");
    var fs = await import("fs");

    // POST an entry with a fake GitHub token
    var res = createMockRes();
    var body = JSON.stringify({
      type: "steering",
      time: new Date().toISOString(),
      steeringCommand: "Use token ghp_1234567890abcdef1234567890abcdef12345678 for auth",
      whatHappened: "Set password=hunter2 and secret=mysecretkey123",
      levelUp: "Learned about auth with sk-1234567890abcdef1234567890abcdef",
    });

    await new Promise(function (resolve) {
      var mockReq = {
        method: "POST",
        on: function (event, cb) {
          if (event === "data") cb(body);
          if (event === "end") {
            setTimeout(function () { cb(); resolve(); }, 10);
          }
        },
      };
      mod.handle("/api/journal/steering", mockReq, res, {});
    });

    // Read back and verify redaction
    var getRes = createMockRes();
    mod.handle("/api/journal/steering", { method: "GET" }, getRes, {});
    var data = JSON.parse(getRes.body);
    var latest = data.entries[data.entries.length - 1];

    expect(latest.steeringCommand).toContain("[REDACTED]");
    expect(latest.steeringCommand).not.toContain("ghp_");
    expect(latest.whatHappened).toContain("[REDACTED]");
    expect(latest.whatHappened).not.toContain("hunter2");
    expect(latest.levelUp).toContain("[REDACTED]");
    expect(latest.levelUp).not.toContain("sk-");
  });
});
