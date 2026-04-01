import fs from "fs";
import os from "os";
import { join } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { extractVSCodeCustomTitle, extractVSCodeSessionId, filterSessionFiles, isAllowedSessionPath, readVSCodeCustomTitle, readVSCodeSessionPreview } from "../../routes/sessions.js";

function withTempFile(name, content, fn) {
  var tempDir = fs.mkdtempSync(join(os.tmpdir(), "agentviz-routes-"));
  var filePath = join(tempDir, name);
  fs.writeFileSync(filePath, content, "utf8");
  try {
    return fn(filePath);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

afterEach(function () {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("VS Code session discovery helpers", function () {
  it("extracts customTitle values with escaped quotes", function () {
    var snippet = '{"customTitle":"Refactor \\"auth\\" module"}';
    expect(extractVSCodeCustomTitle(snippet)).toBe('Refactor "auth" module');
  });

  it("returns null when no customTitle is present", function () {
    expect(extractVSCodeCustomTitle('{"sessionId":"abc"}')).toBeNull();
  });

  it("extracts sessionId values", function () {
    expect(extractVSCodeSessionId('{"sessionId":"abc-123"}')).toBe("abc-123");
  });

  it("reads title from file tail and closes the file on read errors", function () {
    withTempFile(
      "session.json",
      JSON.stringify({ sessionId: "abc", customTitle: 'Refactor "auth" module' }),
      function (filePath) {
        var closeSpy = vi.spyOn(fs, "closeSync");
        vi.spyOn(fs, "readSync").mockImplementation(function () {
          throw new Error("boom");
        });

        expect(readVSCodeCustomTitle(filePath, fs.statSync(filePath).size)).toBeNull();
        expect(closeSpy).toHaveBeenCalledTimes(1);
      }
    );
  });

  it("reads title from file tail", function () {
    withTempFile(
      "session.json",
      JSON.stringify({ sessionId: "abc", customTitle: 'Refactor "auth" module' }),
      function (filePath) {
        expect(readVSCodeCustomTitle(filePath, fs.statSync(filePath).size)).toBe('Refactor "auth" module');
      }
    );
  });

  it("reads title and sessionId from a session preview", function () {
    withTempFile(
      "session.json",
      JSON.stringify({ sessionId: "abc", customTitle: 'Refactor "auth" module' }),
      function (filePath) {
        expect(readVSCodeSessionPreview(filePath, fs.statSync(filePath).size)).toEqual({
          sessionId: "abc",
          title: 'Refactor "auth" module',
        });
      }
    );
  });

  it("extracts top-level sessionId and ignores nested ones", function () {
    var session = {
      version: 3,
      sessionId: "real-top-level",
      requests: [{ requestId: "r1", message: { text: "hi" }, response: [{ value: "hello" }], result: { timings: { totalElapsed: 100 } } }],
    };
    withTempFile("nested.json", JSON.stringify(session), function (filePath) {
      var preview = readVSCodeSessionPreview(filePath, fs.statSync(filePath).size);
      expect(preview.sessionId).toBe("real-top-level");
    });
  });

  it("does not match sessionId from a nested request when it appears after 512 bytes", function () {
    var padding = "A".repeat(600);
    var content = '{"version":3,"sessionId":"top-level","customTitle":"' + padding + '","requests":[{"sessionId":"nested-fake"}]}';
    withTempFile("spoofed.json", content, function (filePath) {
      var preview = readVSCodeSessionPreview(filePath, fs.statSync(filePath).size);
      expect(preview.sessionId).toBe("top-level");
    });
  });

  it("ignores sessionId nested inside requests even when it appears early", function () {
    // Crafted file where a nested sessionId appears before the top-level one
    var content = '{"version":3,"requests":[{"sessionId":"nested-spoof"}],"sessionId":"real-top-level"}';
    withTempFile("early-spoof.json", content, function (filePath) {
      var preview = readVSCodeSessionPreview(filePath, fs.statSync(filePath).size);
      // Should return null since the top-level sessionId is after "requests"
      expect(preview.sessionId).toBeNull();
    });
  });
});

describe("session path restrictions", function () {
  it("allows VS Code chatSessions files", function () {
    vi.stubEnv("XDG_CONFIG_HOME", "");
    var homeDir = "/home/tester";
    var sessionPath = "/home/tester/.config/Code/User/workspaceStorage/ws1/chatSessions/session.json";
    expect(isAllowedSessionPath(sessionPath, homeDir)).toBe(true);
  });

  it("rejects non-chatSessions files under VS Code workspaceStorage", function () {
    vi.stubEnv("XDG_CONFIG_HOME", "");
    var homeDir = "/home/tester";
    var sessionPath = "/home/tester/.config/Code/User/workspaceStorage/ws1/workspace.json";
    expect(isAllowedSessionPath(sessionPath, homeDir)).toBe(false);
  });

  it("allows Claude Code project files", function () {
    var homeDir = "/home/tester";
    var sessionPath = "/home/tester/.claude/projects/my-project/abc-123.jsonl";
    expect(isAllowedSessionPath(sessionPath, homeDir)).toBe(true);
  });

  it("allows Copilot CLI session files", function () {
    var homeDir = "/home/tester";
    var sessionPath = "/home/tester/.copilot/session-state/abc-uuid/events.jsonl";
    expect(isAllowedSessionPath(sessionPath, homeDir)).toBe(true);
  });

  it("rejects paths outside known roots", function () {
    var homeDir = "/home/tester";
    expect(isAllowedSessionPath("/etc/passwd", homeDir)).toBe(false);
    expect(isAllowedSessionPath("/home/tester/Desktop/secrets.json", homeDir)).toBe(false);
  });

  it("rejects traversal attempts via .. segments", function () {
    vi.stubEnv("XDG_CONFIG_HOME", "");
    var homeDir = "/home/tester";
    var sessionPath = "/home/tester/.config/Code/User/workspaceStorage/ws1/chatSessions/../../secrets.json";
    expect(isAllowedSessionPath(join("/home/tester/.config/Code/User/workspaceStorage", "secrets.json"), homeDir)).toBe(false);
  });

  it("returns false when homeDir is null or empty", function () {
    expect(isAllowedSessionPath("/some/path", null)).toBe(false);
    expect(isAllowedSessionPath("/some/path", "")).toBe(false);
  });
});

describe("filterSessionFiles", function () {
  it("returns .json and .jsonl files, filtering non-session files", function () {
    var files = ["readme.txt", "session.json", "data.csv", "events.jsonl"];
    expect(filterSessionFiles(files)).toEqual(["session.json", "events.jsonl"]);
  });

  it("prefers .json over .jsonl when both share the same basename", function () {
    var files = ["session-a.json", "session-a.jsonl", "session-b.jsonl"];
    expect(filterSessionFiles(files)).toEqual(["session-a.json", "session-b.jsonl"]);
  });

  it("returns empty array when no session files exist", function () {
    expect(filterSessionFiles(["readme.md", "config.yaml"])).toEqual([]);
  });

  it("handles empty input", function () {
    expect(filterSessionFiles([])).toEqual([]);
  });
});

describe("extractJSONFieldValue edge cases", function () {
  it("returns null for empty snippet", function () {
    expect(extractVSCodeCustomTitle("")).toBeNull();
    expect(extractVSCodeCustomTitle(null)).toBeNull();
  });

  it("truncates values exceeding max length", function () {
    var longTitle = "A".repeat(200);
    var snippet = '{"customTitle":"' + longTitle + '"}';
    // customTitle maxLength is 120 -- value should not match
    expect(extractVSCodeCustomTitle(snippet)).toBeNull();
  });

  it("handles snippet with no string value for field", function () {
    expect(extractVSCodeCustomTitle('{"customTitle": 42}')).toBeNull();
    expect(extractVSCodeSessionId('{"sessionId": true}')).toBeNull();
  });
});
