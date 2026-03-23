import { describe, it, expect } from "vitest";
import { getInspectorDisplay } from "../lib/dataInspector.js";
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
