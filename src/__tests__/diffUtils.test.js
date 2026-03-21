import { describe, it, expect } from "vitest";
import {
  isFileEditEvent,
  isFileCreateEvent,
  isDiffViewable,
  extractDiffData,
  computeDiff,
} from "../lib/diffUtils.js";

// ── Detection helpers ──

describe("isFileEditEvent", function () {
  it("detects str_replace_editor with old_str/new_str", function () {
    var event = {
      track: "tool_call",
      toolName: "str_replace_editor",
      toolInput: { command: "str_replace", path: "src/app.js", old_str: "a", new_str: "b" },
    };
    expect(isFileEditEvent(event)).toBe(true);
  });

  it("detects edit tool with old_str/new_str", function () {
    var event = {
      track: "tool_call",
      toolName: "edit",
      toolInput: { path: "src/app.js", old_str: "a", new_str: "b" },
    };
    expect(isFileEditEvent(event)).toBe(true);
  });

  it("detects by command field even if toolName differs", function () {
    var event = {
      track: "tool_call",
      toolName: "some_editor",
      toolInput: { command: "str_replace", old_str: "x", new_str: "y" },
    };
    expect(isFileEditEvent(event)).toBe(true);
  });

  it("rejects events without old_str", function () {
    var event = {
      track: "tool_call",
      toolName: "str_replace_editor",
      toolInput: { command: "view", path: "src/app.js" },
    };
    expect(isFileEditEvent(event)).toBe(false);
  });

  it("rejects non-tool_call tracks", function () {
    var event = {
      track: "reasoning",
      toolName: "str_replace_editor",
      toolInput: { old_str: "a", new_str: "b" },
    };
    expect(isFileEditEvent(event)).toBe(false);
  });

  it("rejects null/undefined events", function () {
    expect(isFileEditEvent(null)).toBe(false);
    expect(isFileEditEvent(undefined)).toBe(false);
  });

  it("rejects events without toolInput", function () {
    var event = { track: "tool_call", toolName: "edit" };
    expect(isFileEditEvent(event)).toBe(false);
  });
});

describe("isFileCreateEvent", function () {
  it("detects create tool", function () {
    var event = {
      track: "tool_call",
      toolName: "create",
      toolInput: { path: "src/new.js", file_text: "hello" },
    };
    expect(isFileCreateEvent(event)).toBe(true);
  });

  it("detects str_replace_editor with command=create", function () {
    var event = {
      track: "tool_call",
      toolName: "str_replace_editor",
      toolInput: { command: "create", path: "src/new.js", file_text: "content" },
    };
    expect(isFileCreateEvent(event)).toBe(true);
  });

  it("detects file_text + path without old_str", function () {
    var event = {
      track: "tool_call",
      toolName: "write_file",
      toolInput: { path: "src/new.js", file_text: "data" },
    };
    expect(isFileCreateEvent(event)).toBe(true);
  });

  it("rejects events with old_str (those are edits)", function () {
    var event = {
      track: "tool_call",
      toolName: "write_file",
      toolInput: { path: "src/new.js", file_text: "data", old_str: "old" },
    };
    expect(isFileCreateEvent(event)).toBe(false);
  });

  it("rejects non-tool_call tracks", function () {
    var event = {
      track: "output",
      toolName: "create",
      toolInput: { path: "f", file_text: "x" },
    };
    expect(isFileCreateEvent(event)).toBe(false);
  });

  it("rejects null events", function () {
    expect(isFileCreateEvent(null)).toBe(false);
  });
});

describe("isDiffViewable", function () {
  it("returns true for edit events", function () {
    var event = {
      track: "tool_call",
      toolName: "edit",
      toolInput: { old_str: "a", new_str: "b" },
    };
    expect(isDiffViewable(event)).toBe(true);
  });

  it("returns true for create events", function () {
    var event = {
      track: "tool_call",
      toolName: "create",
      toolInput: { path: "f.js", file_text: "x" },
    };
    expect(isDiffViewable(event)).toBe(true);
  });

  it("returns false for bash tool calls", function () {
    var event = {
      track: "tool_call",
      toolName: "bash",
      toolInput: { command: "ls" },
    };
    expect(isDiffViewable(event)).toBe(false);
  });
});

// ── extractDiffData ──

describe("extractDiffData", function () {
  it("extracts edit data", function () {
    var event = {
      track: "tool_call",
      toolName: "str_replace_editor",
      toolInput: { command: "str_replace", path: "src/app.js", old_str: "old code", new_str: "new code" },
    };
    var data = extractDiffData(event);
    expect(data).toEqual({
      filePath: "src/app.js",
      type: "edit",
      oldStr: "old code",
      newStr: "new code",
    });
  });

  it("extracts create data", function () {
    var event = {
      track: "tool_call",
      toolName: "create",
      toolInput: { path: "src/new.js", file_text: "hello world" },
    };
    var data = extractDiffData(event);
    expect(data).toEqual({
      filePath: "src/new.js",
      type: "create",
      oldStr: "",
      newStr: "hello world",
    });
  });

  it("returns null for non-diff events", function () {
    var event = {
      track: "tool_call",
      toolName: "bash",
      toolInput: { command: "ls" },
    };
    expect(extractDiffData(event)).toBe(null);
  });

  it("returns null for null event", function () {
    expect(extractDiffData(null)).toBe(null);
  });

  it("defaults path to unknown", function () {
    var event = {
      track: "tool_call",
      toolName: "edit",
      toolInput: { old_str: "a", new_str: "b" },
    };
    var data = extractDiffData(event);
    expect(data.filePath).toBe("unknown");
  });
});

// ── computeDiff ──

describe("computeDiff", function () {
  it("returns empty for identical strings", function () {
    var hunks = computeDiff("hello\nworld", "hello\nworld");
    expect(hunks).toEqual([]);
  });

  it("returns empty for both empty", function () {
    var hunks = computeDiff("", "");
    expect(hunks).toEqual([]);
  });

  it("handles single line change", function () {
    var hunks = computeDiff("hello", "goodbye");
    expect(hunks.length).toBe(1);
    var lines = hunks[0].lines;
    var deletes = lines.filter(function (l) { return l.type === "delete"; });
    var inserts = lines.filter(function (l) { return l.type === "insert"; });
    expect(deletes.length).toBe(1);
    expect(deletes[0].text).toBe("hello");
    expect(inserts.length).toBe(1);
    expect(inserts[0].text).toBe("goodbye");
  });

  it("handles pure insertion (empty old)", function () {
    var hunks = computeDiff("", "line1\nline2\nline3");
    expect(hunks.length).toBe(1);
    var inserts = hunks[0].lines.filter(function (l) { return l.type === "insert"; });
    expect(inserts.length).toBe(3);
    expect(inserts[0].text).toBe("line1");
    expect(inserts[1].text).toBe("line2");
    expect(inserts[2].text).toBe("line3");
  });

  it("handles pure deletion (empty new)", function () {
    var hunks = computeDiff("line1\nline2", "");
    expect(hunks.length).toBe(1);
    var deletes = hunks[0].lines.filter(function (l) { return l.type === "delete"; });
    expect(deletes.length).toBe(2);
  });

  it("handles multi-line change with context", function () {
    var old = "line1\nline2\nline3\nline4\nline5";
    var neu = "line1\nline2\nLINE3\nline4\nline5";
    var hunks = computeDiff(old, neu);
    expect(hunks.length).toBe(1);

    var lines = hunks[0].lines;
    var del = lines.filter(function (l) { return l.type === "delete"; });
    var ins = lines.filter(function (l) { return l.type === "insert"; });
    var ctx = lines.filter(function (l) { return l.type === "context"; });

    expect(del.length).toBe(1);
    expect(del[0].text).toBe("line3");
    expect(ins.length).toBe(1);
    expect(ins[0].text).toBe("LINE3");
    expect(ctx.length).toBeGreaterThan(0);
  });

  it("handles insertion in the middle", function () {
    var old = "a\nc";
    var neu = "a\nb\nc";
    var hunks = computeDiff(old, neu);
    expect(hunks.length).toBe(1);
    var ins = hunks[0].lines.filter(function (l) { return l.type === "insert"; });
    expect(ins.length).toBe(1);
    expect(ins[0].text).toBe("b");
  });

  it("handles deletion from the middle", function () {
    var old = "a\nb\nc";
    var neu = "a\nc";
    var hunks = computeDiff(old, neu);
    expect(hunks.length).toBe(1);
    var del = hunks[0].lines.filter(function (l) { return l.type === "delete"; });
    expect(del.length).toBe(1);
    expect(del[0].text).toBe("b");
  });

  it("produces correct line numbers", function () {
    var old = "a\nb\nc";
    var neu = "a\nB\nc";
    var hunks = computeDiff(old, neu);
    var del = hunks[0].lines.filter(function (l) { return l.type === "delete"; });
    var ins = hunks[0].lines.filter(function (l) { return l.type === "insert"; });
    expect(del[0].oldNum).toBe(2);
    expect(ins[0].newNum).toBe(2);
  });

  it("creates separate hunks for distant changes", function () {
    var lines = [];
    for (var i = 0; i < 20; i++) lines.push("line" + i);
    var oldStr = lines.join("\n");

    var newLines = lines.slice();
    newLines[2] = "CHANGED2";
    newLines[17] = "CHANGED17";
    var newStr = newLines.join("\n");

    var hunks = computeDiff(oldStr, newStr);
    // With context=3, changes at line 2 and 17 should be in separate hunks
    expect(hunks.length).toBe(2);
  });

  it("handles completely different content", function () {
    var hunks = computeDiff("alpha\nbeta\ngamma", "one\ntwo\nthree");
    expect(hunks.length).toBeGreaterThan(0);
    var del = [];
    var ins = [];
    for (var h = 0; h < hunks.length; h++) {
      for (var l = 0; l < hunks[h].lines.length; l++) {
        if (hunks[h].lines[l].type === "delete") del.push(hunks[h].lines[l]);
        if (hunks[h].lines[l].type === "insert") ins.push(hunks[h].lines[l]);
      }
    }
    expect(del.length).toBe(3);
    expect(ins.length).toBe(3);
  });

  it("handles trailing newlines gracefully", function () {
    var hunks = computeDiff("a\nb\n", "a\nB\n");
    expect(hunks.length).toBe(1);
    var del = hunks[0].lines.filter(function (l) { return l.type === "delete"; });
    expect(del.length).toBe(1);
    expect(del[0].text).toBe("b");
  });
});
