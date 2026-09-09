import { describe, expect, it } from "vitest";
import { detectFormat, parseSession } from "../lib/parseSession";
import { detectCopilotPrompts, parseCopilotPromptsJSON } from "../lib/copilotCostParser";
import { buildCostAnalysis } from "../lib/costAnalysis.js";

function fixture() {
  return JSON.stringify([
    {
      request: {
        model: "gpt-4.1",
        messages: [
          { role: "system", content: "You are a coding assistant." },
          { role: "user", content: "Build a parser" },
        ],
        tools: [{ type: "function", function: { name: "read_file", parameters: { type: "object" } } }],
      },
      response: {
        usage: {
          prompt_tokens: 1000,
          completion_tokens: 120,
          prompt_tokens_details: { cached_tokens: 200 },
          cache_creation_input_tokens: 50,
        },
      },
    },
    {
      request: {
        model: "gpt-4.1",
        messages: [
          { role: "system", content: "You are a coding assistant." },
          { role: "assistant", content: "I can do that." },
          { role: "user", content: "Now build the UI" },
        ],
        tools: [{ type: "function", function: { name: "read_file", parameters: { type: "object" } } }],
      },
      response: {
        usage: {
          input_tokens: 1800,
          output_tokens: 240,
          input_tokens_details: { cached_tokens: 900 },
          cache_write_input_tokens: 20,
        },
      },
    },
  ]);
}

describe("detectCopilotPrompts", function () {
  it("detects copilot_all_prompts style exports", function () {
    expect(detectCopilotPrompts(fixture())).toBe(true);
    expect(detectFormat(fixture())).toBe("copilot-prompts");
  });

  it("rejects unrelated JSON", function () {
    expect(detectCopilotPrompts(JSON.stringify({ version: 1, requests: [] }))).toBe(false);
  });
});

describe("parseCopilotPromptsJSON", function () {
  it("normalizes prompt calls into events and turns", function () {
    const parsed = parseCopilotPromptsJSON(fixture());
    expect(parsed).not.toBeNull();
    expect(parsed!.events).toHaveLength(2);
    expect(parsed!.turns).toHaveLength(2);
    expect(parsed!.events[0].text).toBe("Build a parser");
    expect(parsed!.events[0].agent).toBe("user");
    expect(parsed!.events[1].text).toBe("Now build the UI");
    expect(parsed!.metadata.format).toBe("copilot-prompts");
  });

  it("extracts token usage, model usage, tools, and context breakdown", function () {
    const parsed = parseSession(fixture());
    expect(parsed).not.toBeNull();
    expect(parsed!.metadata.primaryModel).toBe("gpt-4.1");
    expect(parsed!.metadata.tokenUsage).toMatchObject({
      inputTokens: 2800,
      outputTokens: 360,
      cacheRead: 1100,
      cacheWrite: 70,
    });
    expect(parsed!.metadata.totalCost).toBeUndefined();
    expect(buildCostAnalysis(parsed!.events, parsed!.metadata).totals.estimatedUsdCost).toBeGreaterThan(0);
    expect((parsed!.events[0].raw as any).costPrompt.toolNames).toEqual(["read_file"]);
    expect((parsed!.events[1].raw as any).costPrompt.contextBreakdown.history).toBeGreaterThan(0);
  });

  it("supports wrapper objects with prompts arrays", function () {
    const wrapped = JSON.stringify({ prompts: JSON.parse(fixture()) });
    const parsed = parseCopilotPromptsJSON(wrapped);
    expect(parsed!.metadata.promptCallCount).toBe(2);
  });

  it.each(["responses", "chat"])("reads official %s write counters and actual response tier", function (schema) {
    const usage = schema === "responses"
      ? { input_tokens: 100000, output_tokens: 10000, input_tokens_details: { cached_tokens: 60000, cache_write_tokens: 20000 }, output_tokens_details: { reasoning_tokens: 5000 } }
      : { prompt_tokens: 100000, completion_tokens: 10000, prompt_tokens_details: { cached_tokens: 60000, cache_write_tokens: 20000 }, completion_tokens_details: { reasoning_tokens: 5000 } };
    const parsed = parseCopilotPromptsJSON(JSON.stringify([{
      request: { model: "gpt-5.6-unknown", service_tier: "auto", messages: [{ role: "user", content: "Test" }] },
      response: { model: "gpt-5.6-sol", service_tier: "priority", usage },
    }]))!;
    expect(parsed.events[0].tokenUsage).toMatchObject({ inputTokens: 100000, cacheWrite: 20000, cacheWriteReported: true, outputTokens: 10000 });
    expect(parsed.events[0].model).toBe("gpt-5.6-sol");
    expect(parsed.events[0].pricingContext).toEqual({ provider: "copilot", serviceTier: "priority" });
    expect(buildCostAnalysis(parsed.events, parsed.metadata).totals.cost).toBeCloseTo(0.808, 8);
    expect(parsed.metadata.totalCost).toBeUndefined();
  });

  it("truncates prompt text exceeding MAX_DISPLAY_TEXT_LENGTH", function () {
    const longPrompt = JSON.stringify([
      {
        request: {
          model: "gpt-4.1",
          messages: [
            { role: "user", content: "x".repeat(5000) },
          ],
        },
        response: {
          usage: {
            prompt_tokens: 1000,
            completion_tokens: 100,
          },
        },
      },
    ]);
    const parsed = parseCopilotPromptsJSON(longPrompt);
    expect(parsed).not.toBeNull();
    expect(parsed!.events[0].text.length).toBe(4000);
    expect(parsed!.events[0].text.endsWith("…")).toBe(true);
  });
});
