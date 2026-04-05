// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function createLocalStorage() {
  var storage = {};
  return {
    getItem: function (key) {
      return Object.prototype.hasOwnProperty.call(storage, key) ? storage[key] : null;
    },
    setItem: function (key, value) {
      storage[key] = String(value);
    },
    removeItem: function (key) {
      delete storage[key];
    },
    clear: function () {
      storage = {};
    },
  };
}

function findExactText(container, text) {
  return Array.from(container.querySelectorAll("*")).find(function (node) {
    return node.textContent && node.textContent.trim() === text;
  }) || null;
}

function normalizeCssColor(value) {
  var node = document.createElement("div");
  node.style.background = value;
  return node.style.background;
}

describe("StatsView theme updates", function () {
  beforeEach(function () {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    window.localStorage = createLocalStorage();
    document.body.innerHTML = "";
  });

  afterEach(function () {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("updates card surfaces when switching from light to dark", async function () {
    window.localStorage.setItem("agentviz:theme-mode", "light");
    vi.resetModules();

    var React = await import("react");
    var ReactDOM = await import("react-dom/client");
    var themeMod = await import("../lib/theme.js");
    var StatsViewMod = await import("../components/StatsView.jsx");

    var act = React.act;
    var createRoot = ReactDOM.createRoot;
    var StatsView = StatsViewMod.default;
    var lightSurface = normalizeCssColor(themeMod.getThemeTokensForMode("light", "dark").bg.surface);
    var darkSurface = normalizeCssColor(themeMod.getThemeTokensForMode("dark", "dark").bg.surface);
    var container = document.createElement("div");
    document.body.appendChild(container);
    var root = createRoot(container);
    var props = {
      events: [
        { agent: "assistant", track: "output", text: "Done" },
      ],
      totalTime: 12,
      metadata: {
        totalTurns: 1,
        errorCount: 0,
        primaryModel: "claude-haiku-4.5",
        tokenUsage: { inputTokens: 10, outputTokens: 20, cacheRead: 0, cacheWrite: 0 },
        models: { "claude-haiku-4.5": 1 },
      },
      turns: [
        { index: 0, userMessage: "Summarize", toolCount: 0, hasError: false },
      ],
      autonomyMetrics: null,
    };

    await act(async function () {
      root.render(<StatsView {...props} />);
    });

    var totalEventsCard = findExactText(container, "Total Events").parentElement;
    expect(totalEventsCard.style.background).toBe(lightSurface);

    themeMod.syncThemeState("dark", "dark");
    await act(async function () {
      root.render(<StatsView {...props} />);
    });

    totalEventsCard = findExactText(container, "Total Events").parentElement;
    expect(totalEventsCard.style.background).toBe(darkSurface);

    await act(async function () {
      root.unmount();
    });
  });
});
