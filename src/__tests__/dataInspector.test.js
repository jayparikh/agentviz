import { describe, it, expect } from "vitest";
import { getInspectorDisplay, serializeInspectorValue, summarizeInspectorValue } from "../lib/dataInspector.js";
import { highlightSyntaxToHtml } from "../components/SyntaxHighlight.jsx";

describe("data inspector helpers", function () {
  it("preserves JSON keys and values in highlighted output", function () {
    var html = highlightSyntaxToHtml('{\n  "type": "assistant",\n  "count": 2\n}');

    expect(html).toContain('"type"');
    expect(html).toContain('"assistant"');
    expect(html).toContain("2");
    expect(html).not.toContain("\x00");
  });

  it("summarizes object payloads with keys and truncates preview lines", function () {
    var display = getInspectorDisplay({
      type: "assistant",
      timestamp: "2026-03-23T04:30:02.000Z",
      message: {
        content: [{ type: "text", text: "hello" }],
      },
    }, {
      maxChars: 20000,
      maxLines: 3,
      expanded: false,
    });

    expect(display.typeLabel).toBe("object");
    expect(display.countLabel).toBe("3 keys");
    expect(display.keysPreview).toEqual(["type", "timestamp", "message"]);
    expect(display.truncatedByLines).toBe(true);
    expect(display.visibleText.split("\n").length).toBe(3);
  });

  it("treats plain strings as text payloads", function () {
    var display = getInspectorDisplay("echo hello\npwd", {
      maxChars: 20000,
      maxLines: 20,
      expanded: false,
    });

    expect(display.typeLabel).toBe("text");
    expect(display.countLabel).toBeNull();
    expect(display.lineCount).toBe(2);
    expect(display.visibleText).toContain("echo hello");
  });
});

describe("serializeInspectorValue", function () {
  it("returns empty string for undefined", function () {
    expect(serializeInspectorValue(undefined)).toBe("");
  });

  it("returns string values as-is", function () {
    expect(serializeInspectorValue("hello")).toBe("hello");
  });

  it("JSON-stringifies numbers, booleans, null", function () {
    expect(serializeInspectorValue(42)).toBe("42");
    expect(serializeInspectorValue(true)).toBe("true");
    expect(serializeInspectorValue(null)).toBe("null");
  });

  it("pretty-prints objects and arrays", function () {
    var result = serializeInspectorValue({ a: 1 });
    expect(result).toContain('"a"');
    expect(result).toContain("1");
  });
});

describe("summarizeInspectorValue", function () {
  it("summarizes arrays with item count", function () {
    var summary = summarizeInspectorValue([1, 2, 3]);
    expect(summary.typeLabel).toBe("array");
    expect(summary.countLabel).toBe("3 items");
  });

  it("uses singular for single-item array", function () {
    var summary = summarizeInspectorValue([1]);
    expect(summary.countLabel).toBe("1 item");
  });

  it("summarizes objects with key count and preview", function () {
    var summary = summarizeInspectorValue({ name: "test", value: 42 });
    expect(summary.typeLabel).toBe("object");
    expect(summary.countLabel).toBe("2 keys");
    expect(summary.keysPreview).toEqual(["name", "value"]);
  });

  it("treats strings as text type", function () {
    var summary = summarizeInspectorValue("hello world");
    expect(summary.typeLabel).toBe("text");
    expect(summary.countLabel).toBeNull();
  });

  it("limits keys preview to 6", function () {
    var obj = { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8 };
    var summary = summarizeInspectorValue(obj);
    expect(summary.keysPreview).toHaveLength(6);
  });
});
