// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import CostView from "../components/CostView.jsx";

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
