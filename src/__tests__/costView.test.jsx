// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import CostView from "../components/CostView.jsx";
import { parseSession } from "../lib/parseSession";
import { formatCost } from "../lib/pricing.js";
import { copilotRateCards } from "./fixtures/copilotRateCards.js";

function findByText(container, text) {
  return Array.from(container.querySelectorAll("*")).find(function (node) {
    return node.textContent && node.textContent.includes(text);
  }) || null;
}

function buildEvent(index, usage, contextTotal) {
  return {
    t: index,
    agent: "assistant",
    track: "output",
    text: "Call " + (index + 1),
    duration: 1,
    intensity: 0.5,
    isError: false,
    model: "gpt-4.1",
    tokenUsage: usage,
    raw: {
      costPrompt: {
        toolNames: ["read_file"],
        contextBreakdown: {
          system: 100,
          tools: 200,
          history: Math.max(contextTotal - 350, 0),
          toolResults: 25,
          user: 25,
          total: contextTotal,
        },
      },
    },
  };
}

describe("CostView", function () {
  beforeEach(function () {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    document.body.innerHTML = "";
  });

  afterEach(function () {
    document.body.innerHTML = "";
  });

  it.each(copilotRateCards)("renders the verified estimate for a simulated %s trace", async function (model, input, cached, write, output) {
    const parsed = parseSession(JSON.stringify([{
      request: { model: "auto", messages: [{ role: "user", content: "Synthetic pricing example" }] },
      response: { model, usage: {
        input_tokens: 100000, output_tokens: 10000,
        input_tokens_details: { cached_tokens: 60000, cache_write_tokens: 20000 },
      } },
    }]));
    const expected = (20000 * input + 60000 * cached + 20000 * (write ?? input) + 10000 * output) / 1e6;
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async function () { root.render(<CostView events={parsed.events} metadata={parsed.metadata} />); });
    expect(container.textContent).toContain(model);
    expect(container.textContent).toContain(formatCost(expected));
    expect(container.textContent).toContain("$ ESTIMATE");
    expect(container.textContent).not.toContain("$ BILLED");
    expect(container.textContent).not.toContain("Pricing unavailable");
    await act(async function () { root.unmount(); });
  });

  it("renders empty state when no token usage exists", async function () {
    var container = document.createElement("div");
    document.body.appendChild(container);
    var root = createRoot(container);

    await act(async function () {
      root.render(<CostView events={[]} metadata={{}} />);
    });

    expect(findByText(container, "No token cost data found")).not.toBeNull();
    await act(async function () {
      root.unmount();
    });
  });

  it.each([
    ["anthropic.claude-sonnet-5-5", "standard", "$0.196"],
    ["claude-opus-5-5", "fast", "$0.784"],
  ])("renders Claude trace pricing for %s at %s speed", async function (model, speed, cost) {
    const parsed = parseSession(JSON.stringify({
      type: "assistant",
      message: {
        model, content: [{ type: "text", text: "Synthetic Claude response" }],
        usage: { input_tokens: 20000, output_tokens: 10000, cache_read_input_tokens: 60000, cache_creation_input_tokens: 20000, speed },
      },
    }));
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async function () { root.render(<CostView events={parsed.events} metadata={parsed.metadata} />); });
    expect(container.textContent).toContain(model);
    expect(container.textContent).toContain(cost);
    expect(container.textContent).toContain("$ ESTIMATE");
    expect(container.textContent).not.toContain("Standard service tier assumed");
    expect(container.textContent).not.toContain("Pricing unavailable");
    await act(async function () { root.unmount(); });
  });

  it("renders summaries and cache miss warnings for tokenized sessions", async function () {
    var container = document.createElement("div");
    document.body.appendChild(container);
    var root = createRoot(container);
    var events = [
      buildEvent(0, { inputTokens: 4000, outputTokens: 100, cacheRead: 3000, cacheWrite: 0 }, 4000),
      buildEvent(1, { inputTokens: 9000, outputTokens: 120, cacheRead: 200, cacheWrite: 0 }, 9000),
    ];

    await act(async function () {
      root.render(<CostView events={events} metadata={{ primaryModel: "gpt-4.1" }} />);
    });

    expect(findByText(container, "Token spend & context buildup")).not.toBeNull();
    expect(findByText(container, "Unexpected cache miss on call #2.")).not.toBeNull();
    expect(findByText(container, "Cache misses")).not.toBeNull();

    await act(async function () {
      root.unmount();
    });

  });

  it("labels token estimates and missing request evidence honestly", async function () {
    var container = document.createElement("div");
    document.body.appendChild(container);
    var root = createRoot(container);
    await act(async function () {
      root.render(<CostView events={[]} metadata={{ primaryModel: "gpt-5.6-sol", tokenUsage: { inputTokens: 400000, outputTokens: 20000 } }} />);
    });
    expect(container.textContent).toContain("Per-request usage required");
    expect(container.textContent).toContain("request sizes unavailable");
    expect(container.textContent).toContain("$ ESTIMATE");
    expect(container.textContent).not.toContain("$ BILLED");
    expect(container.textContent).not.toContain("$0.00");
    await act(async function () { root.unmount(); });
  });
});
