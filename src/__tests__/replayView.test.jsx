// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import ReplayView from "../components/ReplayView.jsx";

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

function makeEntry(index, event) {
  return {
    index: index,
    event: Object.assign({
      t: index,
      duration: 1,
      intensity: 0.5,
      isError: false,
      raw: {},
    }, event),
  };
}

function findExactText(container, text) {
  return Array.from(container.querySelectorAll("*")).find(function (node) {
    return node.textContent && node.textContent.trim() === text;
  }) || null;
}

describe("ReplayView", function () {
  it("keeps session pricing based on unfiltered requests", async function () {
    var container = document.createElement("div");
    document.body.appendChild(container);
    var root = createRoot(container);
    var entries = [0, 1].map(index => makeEntry(index, {
      agent: "assistant", track: "output", text: "Synthetic request", model: "gpt-5.6-sol",
      tokenUsage: { inputTokens: 200000, outputTokens: 10000, cacheRead: 60000, cacheWrite: 20000 },
    }));
    await act(async function () {
      root.render(<ReplayView currentTime={10} events={entries.map(entry => entry.event)} eventEntries={entries.slice(0, 1)} turnStartMap={{}}
        metadata={{ primaryModel: "gpt-5.6-sol", models: { "gpt-5.6-sol": 2 }, tokenUsage: { inputTokens: 400000, outputTokens: 20000, cacheRead: 120000, cacheWrite: 40000 } }} />);
    });
    expect(findExactText(container, "$1.61")).not.toBeNull();
    await act(async function () { root.unmount(); });
    container.remove();
  });

  beforeEach(function () {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    window.localStorage = createLocalStorage();
    document.body.innerHTML = "";
  });

  afterEach(function () {
    document.body.innerHTML = "";
  });

  it("renders a turn header when the first visible turn event is not the user event", async function () {
    var container = document.createElement("div");
    document.body.appendChild(container);
    var root = createRoot(container);
    var eventEntries = [
      makeEntry(2, { agent: "assistant", track: "output", text: "visible assistant reply" }),
    ];
    var turnStartMap = {
      1: {
        index: 1,
        eventIndices: [1, 2],
        toolCount: 0,
        hasError: false,
      },
    };

    await act(async function () {
      root.render(
        <ReplayView
          currentTime={10}
          eventEntries={eventEntries}
          turnStartMap={turnStartMap}
          searchQuery=""
          matchSet={new Set()}
          metadata={{}}
        />
      );
    });

    expect(findExactText(container, "Turn 2")).not.toBeNull();

    await act(async function () {
      root.unmount();
    });
  });
});
