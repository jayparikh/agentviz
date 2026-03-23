import { describe, it, expect } from "vitest";
import { getCompleteJsonlLines, getJsonlStreamChunk } from "../../server.js";

describe("server live JSONL helpers", function () {
  it("ignores a trailing partial Claude record until it is newline-terminated", function () {
    var firstChunk = getJsonlStreamChunk(
      '{"type":"user","message":{"content":"hello"}}\n'
      + '{"type":"assistant","message":{"content":[{"type":"text","text":"partial"}}',
      0
    );

    expect(firstChunk.lines).toEqual([
      '{"type":"user","message":{"content":"hello"}}',
    ]);
    expect(firstChunk.nextLineIdx).toBe(1);

    var secondChunk = getJsonlStreamChunk(
      '{"type":"user","message":{"content":"hello"}}\n'
      + '{"type":"assistant","message":{"content":[{"type":"text","text":"partial"}]}}\n',
      firstChunk.nextLineIdx
    );

    expect(secondChunk.lines).toEqual([
      '{"type":"assistant","message":{"content":[{"type":"text","text":"partial"}]}}',
    ]);
    expect(secondChunk.nextLineIdx).toBe(2);
  });

  it("counts only complete newline-terminated records during initialization", function () {
    var lines = getCompleteJsonlLines(
      '{"type":"user","message":{"content":"hello"}}\n'
      + '{"type":"assistant","message":{"content":[{"type":"text","text":"partial"}}'
    );

    expect(lines).toEqual([
      '{"type":"user","message":{"content":"hello"}}',
    ]);
  });
});
