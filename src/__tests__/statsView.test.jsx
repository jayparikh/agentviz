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

function getCardValue(container, label) {
  return findExactText(container, label).parentElement.firstElementChild.textContent;
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
    var lightTextPrimary = normalizeCssColor(themeMod.getThemeTokensForMode("light", "dark").text.primary);
    var darkTextPrimary = normalizeCssColor(themeMod.getThemeTokensForMode("dark", "dark").text.primary);
    var lightTrackContext = normalizeCssColor(themeMod.getThemeTokensForMode("light", "dark").track.context);
    var darkTrackContext = normalizeCssColor(themeMod.getThemeTokensForMode("dark", "dark").track.context);
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

    var totalEventsCard = findExactText(container, "Total events").parentElement;
    expect(totalEventsCard.style.background).toBe(lightSurface);
    expect(totalEventsCard.firstElementChild.style.color).toBe(lightTextPrimary);
    var modelCard = findExactText(container, "Model").parentElement;
    expect(modelCard.firstElementChild.style.color).toBe(lightTrackContext);

    themeMod.syncThemeState("dark", "dark");
    await act(async function () {
      root.render(<StatsView {...props} />);
    });

    totalEventsCard = findExactText(container, "Total events").parentElement;
    expect(totalEventsCard.style.background).toBe(darkSurface);
    expect(totalEventsCard.firstElementChild.style.color).toBe(darkTextPrimary);
    modelCard = findExactText(container, "Model").parentElement;
    expect(modelCard.firstElementChild.style.color).toBe(darkTrackContext);

    await act(async function () {
      root.unmount();
    });
  }, 15000);

  it("updates memoized derived cards when events and metadata change", async function () {
    vi.resetModules();

    var React = await import("react");
    var ReactDOM = await import("react-dom/client");
    var StatsViewMod = await import("../components/StatsView.jsx");

    var act = React.act;
    var createRoot = ReactDOM.createRoot;
    var StatsView = StatsViewMod.default;
    var container = document.createElement("div");
    document.body.appendChild(container);
    var root = createRoot(container);
    var props = {
      events: [
        { agent: "assistant", track: "output", text: "Done", isError: false },
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

    expect(getCardValue(container, "Total events")).toBe("1");
    expect(getCardValue(container, "Tool calls")).toBe("0");
    expect(getCardValue(container, "Errors")).toBe("0");

    await act(async function () {
      root.render(
        <StatsView
          {...props}
          events={[
            props.events[0],
            { agent: "assistant", track: "tool_call", text: "Run command", isError: true },
          ]}
          metadata={Object.assign({}, props.metadata, { errorCount: 1 })}
        />,
      );
    });

    expect(getCardValue(container, "Total events")).toBe("2");
    expect(getCardValue(container, "Tool calls")).toBe("1");
    expect(getCardValue(container, "Errors")).toBe("1");

    await act(async function () {
      root.unmount();
    });
  }, 15000);
});
