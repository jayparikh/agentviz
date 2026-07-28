import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { detectCodexJSONL, parseCodexJSONL } from "../lib/codexParser";
import { detectFormat, parseSession } from "../lib/parseSession";

const FIXTURE = readFileSync(join(__dirname, "fixtures/test-codex.jsonl"), "utf8");

function line(record: unknown): string {
  return JSON.stringify(record);
}

describe("detectCodexJSONL", function () {
  it("detects Codex rollout JSONL", function () {
    expect(detectCodexJSONL(FIXTURE)).toBe(true);
    expect(detectFormat(FIXTURE)).toBe("codex");
  });

  it("rejects generic response_item records without Codex evidence", function () {
    const text = line({ type: "response_item", payload: { type: "message", role: "assistant", content: [] } });
    expect(detectCodexJSONL(text)).toBe(false);
  });

  it("can detect truncated logs from Codex turn context and response items", function () {
    const text = [
      line({ type: "turn_context", payload: { turn_id: "turn-1", model: "gpt-5.3-codex", approval_policy: "never" } }),
      line({ type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Hi" }] } }),
    ].join("\n");
    expect(detectCodexJSONL(text)).toBe(true);
  });
});

describe("parseCodexJSONL", function () {
  it("normalizes Codex messages, reasoning, tools, outputs, turns, and metadata", function () {
    const result = parseCodexJSONL(FIXTURE);
    expect(result).not.toBeNull();
    expect(result?.metadata.format).toBe("codex");
    expect(result?.metadata.sessionId).toBe("codex-synthetic-session");
    expect(result?.metadata.primaryModel).toBe("gpt-5.3-codex");
    expect(result?.metadata.totalTurns).toBe(1);
    expect(result?.metadata.totalToolCalls).toBe(2);
    expect(result?.turns[0].userMessage).toBe("Build a parser for demo logs");
    expect(result?.events[0].t).toBe(0);
    expect(result?.events.some(function (event) { return event.track === "reasoning" && event.text.includes("Inspect the synthetic format"); })).toBe(true);
    expect(result?.events.some(function (event) { return event.track === "tool_call" && event.toolName === "read_file"; })).toBe(true);
    expect(result?.events.some(function (event) { return event.track === "tool_call" && event.toolName === "web_search"; })).toBe(true);
  });

  it("does not duplicate event_msg agent messages when response_item message exists", function () {
    const result = parseCodexJSONL(FIXTURE);
    const assistantMessages = result?.events.filter(function (event) {
      return event.agent === "assistant" && event.track === "output" && event.text === "I will inspect the synthetic format.";
    });
    expect(assistantMessages).toHaveLength(1);
  });

  it("uses cumulative token_count totals for metadata token usage", function () {
    const result = parseCodexJSONL(FIXTURE);
    expect(result?.metadata.tokenUsage).toMatchObject({
      inputTokens: 1000,
      cacheRead: 250,
      outputTokens: 120,
      cacheWrite: 0,
    });
    expect(result?.metadata.warnings).toContain("Codex token usage is based on cumulative token_count totals");
  });

  it("does not double-count reasoning tokens (they are a subset of output_tokens)", function () {
    const text = [
      line({ type: "session_meta", timestamp: "2026-05-25T12:00:00.000Z", payload: { id: "synthetic", originator: "codex-tui", source: "synthetic", model_provider: "openai" } }),
      line({ type: "response_item", timestamp: "2026-05-25T12:00:01.000Z", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] } }),
      line({ type: "event_msg", timestamp: "2026-05-25T12:00:02.000Z", payload: { type: "token_count", info: { total_token_usage: { input_tokens: 500, cached_input_tokens: 0, output_tokens: 200, reasoning_output_tokens: 80, total_tokens: 700 } } } }),
    ].join("\n");

    const result = parseCodexJSONL(text);
    // output_tokens (200) already includes the 80 reasoning tokens; the old code
    // added them again and over-reported 280.
    expect(result?.metadata.tokenUsage?.outputTokens).toBe(200);
  });

  it("pairs function call output with the matching tool call", function () {
    const result = parseSession(FIXTURE);
    const tool = result?.events.find(function (event) { return event.track === "tool_call" && event.toolCallId === "call-read"; });
    expect(tool?.toolOutput).toContain("Read 12 synthetic lines");
  });

  it("pairs web search calls without call_id to web_search_end output by query", function () {
    const result = parseSession(FIXTURE);
    const tool = result?.events.find(function (event) { return event.track === "tool_call" && event.toolName === "web_search"; });
    expect(tool?.toolCallId).toBe("call-search");
    expect(tool?.toolOutput).toContain("Web search completed: synthetic docs");
  });

  it("elides encrypted reasoning content from raw events", function () {
    const text = [
      line({ type: "session_meta", timestamp: "2026-05-25T12:00:00.000Z", payload: { id: "synthetic", originator: "codex-tui", source: "synthetic", model_provider: "openai" } }),
      line({ type: "event_msg", timestamp: "2026-05-25T12:00:01.000Z", payload: { type: "task_started", turn_id: "turn-1", started_at: "2026-05-25T12:00:01.000Z" } }),
      line({ type: "turn_context", timestamp: "2026-05-25T12:00:01.100Z", payload: { turn_id: "turn-1", model: "gpt-5.3-codex" } }),
      line({ type: "response_item", timestamp: "2026-05-25T12:00:02.000Z", payload: { type: "reasoning", summary: [{ type: "summary_text", text: "Synthetic summary" }], encrypted_content: "opaque-test-blob" } }),
    ].join("\n");
    const result = parseCodexJSONL(text);
    const reasoning = result?.events.find(function (event) { return event.track === "reasoning"; });
    expect(JSON.stringify(reasoning?.raw)).not.toContain("opaque-test-blob");
    expect(JSON.stringify(reasoning?.raw)).toContain("[elided]");
  });

  it("handles an interrupted function call without output", function () {
    const text = [
      line({ type: "session_meta", timestamp: "2026-05-25T12:00:00.000Z", payload: { id: "synthetic", originator: "codex-tui", source: "synthetic", model_provider: "openai" } }),
      line({ type: "event_msg", timestamp: "2026-05-25T12:00:01.000Z", payload: { type: "task_started", turn_id: "turn-1", started_at: "2026-05-25T12:00:01.000Z" } }),
      line({ type: "turn_context", timestamp: "2026-05-25T12:00:01.100Z", payload: { turn_id: "turn-1", model: "gpt-5.3-codex" } }),
      line({ type: "response_item", timestamp: "2026-05-25T12:00:02.000Z", payload: { type: "function_call", call_id: "call-open", name: "read_file", arguments: "{\"path\":\"/workspace/demo/missing.txt\"}" } }),
    ].join("\n");
    const result = parseCodexJSONL(text);
    expect(result?.metadata.totalToolCalls).toBe(1);
    expect(result?.metadata.errorCount).toBe(0);
  });

  it("uses the latest event end for metadata duration", function () {
    const text = [
      line({ type: "session_meta", timestamp: "2026-05-25T12:00:00.000Z", payload: { id: "synthetic", originator: "codex-tui", source: "synthetic", model_provider: "openai" } }),
      line({ type: "response_item", timestamp: "2026-05-25T12:00:01.000Z", payload: { type: "function_call", call_id: "call-long", name: "read_file", arguments: "{\"path\":\"/workspace/demo/file.txt\"}" } }),
      line({ type: "response_item", timestamp: "2026-05-25T12:00:01.100Z", payload: { type: "function_call_output", call_id: "call-long", output: "ok" } }),
    ].join("\n");

    const result = parseCodexJSONL(text);
    expect(result?.metadata.duration).toBeCloseTo(0.5, 5);
  });

  it("reindexes turns after dropping empty lifecycle turns", function () {
    const text = [
      line({ type: "session_meta", timestamp: "2026-05-25T12:00:00.000Z", payload: { id: "synthetic", originator: "codex-tui", source: "synthetic", model_provider: "openai" } }),
      line({ type: "event_msg", timestamp: "2026-05-25T12:00:01.000Z", payload: { type: "task_started", turn_id: "empty-turn", started_at: "2026-05-25T12:00:01.000Z" } }),
      line({ type: "event_msg", timestamp: "2026-05-25T12:00:02.000Z", payload: { type: "task_started", turn_id: "real-turn", started_at: "2026-05-25T12:00:02.000Z" } }),
      line({ type: "turn_context", timestamp: "2026-05-25T12:00:02.100Z", payload: { turn_id: "real-turn", model: "gpt-5.3-codex" } }),
      line({ type: "response_item", timestamp: "2026-05-25T12:00:03.000Z", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Run synthetic task" }] } }),
      line({ type: "response_item", timestamp: "2026-05-25T12:00:04.000Z", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "Synthetic task complete" }] } }),
    ].join("\n");

    const result = parseCodexJSONL(text);
    expect(result?.turns).toHaveLength(1);
    expect(result?.turns[0].index).toBe(0);
    expect(result?.events.map(function (event) { return event.turnIndex; })).toEqual([0, 0]);
  });
});
