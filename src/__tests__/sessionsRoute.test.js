import fs from "fs";
import os from "os";
import { join } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { extractVSCodeCustomTitle, extractVSCodeSessionId, clipToLength, filterSessionFiles, findCodexSessionFiles, isAllowedSessionPath, isAllowedSharedPath, readCodexSessionPreview, readCopilotCliSessionPreview, readVSCodeCustomTitle, readVSCodeSessionPreview } from "../../routes/sessions.js";

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

describe("Copilot CLI session discovery helpers", function () {
  it("reads the first user message as a preview title", function () {
    withTempFile(
      "events.jsonl",
      [
        JSON.stringify({ type: "session.start", data: { sessionId: "abc" } }),
        JSON.stringify({ type: "user.message", data: { content: "Tell me what this project does" } }),
        JSON.stringify({ type: "assistant.message", data: { content: "It does X" } }),
      ].join("\n"),
      function (filePath) {
        expect(readCopilotCliSessionPreview(filePath, fs.statSync(filePath).size)).toEqual({
          title: "Tell me what this project does",
          isContinuationSummary: false,
        });
      }
    );
  });

  it("detects continuation summary sessions so discovery can skip them", function () {
    withTempFile(
      "events.jsonl",
      [
        JSON.stringify({ type: "session.start", data: { sessionId: "abc" } }),
        JSON.stringify({ type: "user.message", data: { content: "Summarize the following conversation for context continuity. Preserve the important details." } }),
      ].join("\n"),
      function (filePath) {
        expect(readCopilotCliSessionPreview(filePath, fs.statSync(filePath).size)).toEqual({
          title: "Summarize the following conversation for context continuity. Preserve the important details.",
          isContinuationSummary: true,
        });
      }
    );
  });
});

describe("Codex session discovery helpers", function () {
  it("finds rollout JSONL files in the bounded Codex date tree", function () {
    var tempDir = fs.mkdtempSync(join(os.tmpdir(), "agentviz-codex-"));
    try {
      var root = join(tempDir, ".codex", "sessions");
      var dayDir = join(root, "2026", "05", "25");
      fs.mkdirSync(dayDir, { recursive: true });
      var good = join(dayDir, "rollout-2026-05-25T12-00-00-synthetic.jsonl");
      fs.writeFileSync(good, "{}\n", "utf8");
      fs.writeFileSync(join(dayDir, "notes.jsonl"), "{}\n", "utf8");
      fs.mkdirSync(join(root, "cache"), { recursive: true });
      fs.writeFileSync(join(root, "cache", "rollout-hidden.jsonl"), "{}\n", "utf8");

      expect(findCodexSessionFiles(root)).toEqual([good]);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("reads Codex previews from synthetic rollout records", function () {
    withTempFile(
      "rollout-2026-05-25T12-00-00-synthetic.jsonl",
      [
        JSON.stringify({ type: "session_meta", payload: { id: "codex-synthetic", cwd: "/workspace/demo", originator: "codex-tui", cli_version: "0.0.0-test" } }),
        JSON.stringify({ type: "turn_context", payload: { turn_id: "turn-1", model: "gpt-5.3-codex", summary: "Build demo support", cwd: "/workspace/demo" } }),
        JSON.stringify({ type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Build demo support" }] } }),
      ].join("\n"),
      function (filePath) {
        expect(readCodexSessionPreview(filePath, fs.statSync(filePath).size)).toEqual({
          sessionId: "codex-synthetic",
          title: "Build demo support",
          summary: "Build demo support",
          model: "gpt-5.3-codex",
          cwd: "/workspace/demo",
          originator: "codex-tui",
          cliVersion: "0.0.0-test",
        });
      }
    );
  });
});

describe("session path restrictions", function () {
  it("allows VS Code chatSessions files", function () {
    var homeDir;
    var sessionPath;
    if (process.platform === "win32") {
      homeDir = "C:\\Users\\tester";
      var appData = join(homeDir, "AppData", "Roaming");
      vi.stubEnv("APPDATA", appData);
      sessionPath = join(appData, "Code", "User", "workspaceStorage", "ws1", "chatSessions", "session.json");
    } else if (process.platform === "darwin") {
      homeDir = "/Users/tester";
      sessionPath = "/Users/tester/Library/Application Support/Code/User/workspaceStorage/ws1/chatSessions/session.json";
    } else {
      vi.stubEnv("XDG_CONFIG_HOME", "");
      homeDir = "/home/tester";
      sessionPath = "/home/tester/.config/Code/User/workspaceStorage/ws1/chatSessions/session.json";
    }
    expect(isAllowedSessionPath(sessionPath, homeDir)).toBe(true);
  });

  it("rejects non-chatSessions files under VS Code workspaceStorage", function () {
    var homeDir;
    var sessionPath;
    if (process.platform === "win32") {
      homeDir = "C:\\Users\\tester";
      var appData = join(homeDir, "AppData", "Roaming");
      vi.stubEnv("APPDATA", appData);
      sessionPath = join(appData, "Code", "User", "workspaceStorage", "ws1", "workspace.json");
    } else if (process.platform === "darwin") {
      homeDir = "/Users/tester";
      sessionPath = "/Users/tester/Library/Application Support/Code/User/workspaceStorage/ws1/workspace.json";
    } else {
      vi.stubEnv("XDG_CONFIG_HOME", "");
      homeDir = "/home/tester";
      sessionPath = "/home/tester/.config/Code/User/workspaceStorage/ws1/workspace.json";
    }
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

  it("allows Codex rollout session files", function () {
    var homeDir = "/home/tester";
    var sessionPath = "/home/tester/.codex/sessions/2026/05/25/rollout-2026-05-25T12-00-00-synthetic.jsonl";
    expect(isAllowedSessionPath(sessionPath, homeDir)).toBe(true);
  });

  it("rejects non-rollout files under Codex sessions", function () {
    var homeDir = "/home/tester";
    expect(isAllowedSessionPath("/home/tester/.codex/sessions/history.jsonl", homeDir)).toBe(false);
    expect(isAllowedSessionPath("/home/tester/.codex/sessions/2026/05/25/notes.jsonl", homeDir)).toBe(false);
    expect(isAllowedSessionPath("/home/tester/.codex/sessions/2026/05/25/rollout.txt", homeDir)).toBe(false);
  });

  it("rejects paths outside known roots", function () {
    var homeDir = "/home/tester";
    expect(isAllowedSessionPath("/etc/passwd", homeDir)).toBe(false);
    expect(isAllowedSessionPath("/home/tester/Desktop/secrets.json", homeDir)).toBe(false);
  });

  it("rejects traversal attempts via .. segments", function () {
    var homeDir;
    var sessionPath;
    if (process.platform === "win32") {
      homeDir = "C:\\Users\\tester";
      var appData = join(homeDir, "AppData", "Roaming");
      vi.stubEnv("APPDATA", appData);
      sessionPath = join(appData, "Code", "User", "workspaceStorage", "secrets.json");
    } else {
      vi.stubEnv("XDG_CONFIG_HOME", "");
      homeDir = "/home/tester";
      sessionPath = join("/home/tester/.config/Code/User/workspaceStorage", "secrets.json");
    }
    expect(isAllowedSessionPath(sessionPath, homeDir)).toBe(false);
  });

  it("returns false when homeDir is null or empty", function () {
    expect(isAllowedSessionPath("/some/path", null)).toBe(false);
    expect(isAllowedSessionPath("/some/path", "")).toBe(false);
  });
});

describe("isAllowedSharedPath (shared session file restriction)", function () {
  it("allows a file inside cwd", function () {
    var cwd = process.platform === "win32" ? "C:\\Users\\tester\\project" : "/home/tester/project";
    var filePath = process.platform === "win32"
      ? "C:\\Users\\tester\\project\\copilot-session-abc.md"
      : "/home/tester/project/copilot-session-abc.md";
    expect(isAllowedSharedPath(filePath, cwd)).toBe(true);
  });

  it("rejects a file outside cwd", function () {
    var cwd = process.platform === "win32" ? "C:\\Users\\tester\\project" : "/home/tester/project";
    var outsidePath = process.platform === "win32"
      ? "C:\\Windows\\System32\\secret.md"
      : "/etc/secret.md";
    expect(isAllowedSharedPath(outsidePath, cwd)).toBe(false);
  });

  it("rejects a sibling directory that shares a common prefix with cwd", function () {
    var cwd = "/home/tester/project";
    expect(isAllowedSharedPath("/home/tester/project-evil/session.md", cwd)).toBe(false);
  });

  it("returns false when cwd is null or empty", function () {
    expect(isAllowedSharedPath("/home/tester/project/session.md", null)).toBe(false);
    expect(isAllowedSharedPath("/home/tester/project/session.md", "")).toBe(false);
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

describe("clipToLength", function () {
  it("returns null for empty or falsy input", function () {
    expect(clipToLength("", 10)).toBeNull();
    expect(clipToLength(null, 10)).toBeNull();
    expect(clipToLength(undefined, 10)).toBeNull();
  });

  it("returns null for whitespace-only input", function () {
    expect(clipToLength("   \n\t  ", 10)).toBeNull();
  });

  it("normalizes internal whitespace", function () {
    expect(clipToLength("hello   world\nnewline", 50)).toBe("hello world newline");
  });

  it("clips text to maxLength including the ellipsis", function () {
    var result = clipToLength("This is a long sentence that exceeds the limit", 20);
    expect(result.length).toBe(20);
    expect(result).toBe("This is a long se...");
  });

  it("returns text unchanged when within maxLength", function () {
    expect(clipToLength("short", 10)).toBe("short");
  });

  it("handles exact boundary length", function () {
    expect(clipToLength("exact", 5)).toBe("exact");
    expect(clipToLength("exceed", 5)).toBe("ex...");
  });
});

describe("Copilot CLI preview edge cases", function () {
  it("uses transformedContent when content is missing", function () {
    withTempFile(
      "events.jsonl",
      [
        JSON.stringify({ type: "session.start", data: { sessionId: "abc" } }),
        JSON.stringify({ type: "user.message", data: { transformedContent: "Transformed prompt text" } }),
      ].join("\n"),
      function (filePath) {
        expect(readCopilotCliSessionPreview(filePath, fs.statSync(filePath).size)).toEqual({
          title: "Transformed prompt text",
          isContinuationSummary: false,
        });
      }
    );
  });

  it("returns null title for user message with only whitespace", function () {
    withTempFile(
      "events.jsonl",
      [
        JSON.stringify({ type: "session.start", data: {} }),
        JSON.stringify({ type: "user.message", data: { content: "   \n  " } }),
      ].join("\n"),
      function (filePath) {
        expect(readCopilotCliSessionPreview(filePath, fs.statSync(filePath).size)).toEqual({
          title: null,
          isContinuationSummary: false,
        });
      }
    );
  });

  it("skips malformed JSON lines and reads valid ones", function () {
    withTempFile(
      "events.jsonl",
      [
        "not valid json {{{",
        JSON.stringify({ type: "user.message", data: { content: "Valid message" } }),
      ].join("\n"),
      function (filePath) {
        expect(readCopilotCliSessionPreview(filePath, fs.statSync(filePath).size)).toEqual({
          title: "Valid message",
          isContinuationSummary: false,
        });
      }
    );
  });
});
