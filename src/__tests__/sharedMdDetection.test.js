import { describe, it, expect } from "vitest";
import { detectFormat } from "../lib/parseSession";

describe("detectFormat with shared-md", function () {
  it("detects shared markdown format", function () {
    var text = "# \uD83E\uDD16 Copilot CLI Session\n\n> **Session ID:** `abc-123`\n> **Started:** 1/1/2026";
    expect(detectFormat(text)).toBe("shared-md");
  });

  it("does not detect shared-md for regular markdown", function () {
    var text = "# My Project\n\nSome documentation about the project.";
    expect(detectFormat(text)).not.toBe("shared-md");
  });

  it("does not detect shared-md for JSONL", function () {
    var text = '{"type":"user.message","data":{"content":"hello"}}';
    expect(detectFormat(text)).not.toBe("shared-md");
  });

  it("still detects copilot-cli format", function () {
    var text = '{"type":"session.start","data":{"producer":"copilot-agent"}}\n{"type":"user.message"}';
    expect(detectFormat(text)).toBe("copilot-cli");
  });
});
