// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from "vitest";
import { act } from "react";
import { createElement } from "react";
import { createRoot } from "react-dom/client";

// Mock fetch for the /api/journal/git call
var mockGitData = {
  entries: [
    {
      type: "levelup",
      time: "2026-03-23T15:23:46-07:00",
      hash: "abc123",
      author: "jayparikh",
      steeringCommand: "add Graph view with interactive DAG",
      whatHappened: "feat: add Graph view with interactive DAG",
      levelUp: "New capability unlocked",
    },
    {
      type: "milestone",
      time: "2026-03-30T21:50:56-07:00",
      hash: "def456",
      author: "jayparikh",
      steeringCommand: "v0.3.0: multi-agent visualization",
      whatHappened: "v0.3.0: multi-agent visualization with fork/join DAG",
      levelUp: "Shipped v0.3.0",
    },
    {
      type: "mistake",
      time: "2026-03-25T19:25:18-07:00",
      hash: "ghi789",
      author: "James Montemagno",
      steeringCommand: "stabilize replay rendering",
      whatHappened: "fix: stabilize replay rendering and debug large sessions",
      levelUp: "Bug squashed",
    },
    {
      type: "pivot",
      time: "2026-03-29T23:00:28-07:00",
      hash: "jkl012",
      author: "jayparikh",
      steeringCommand: "4-phase refactoring initiative",
      whatHappened: "refactor: extract PlaybackContext (Phase 1) → split server (Phase 4)",
      levelUp: "Architecture leveled up",
      commitCount: 4,
    },
  ],
  repo: {
    name: "agentviz",
    totalCommits: 50,
    contributors: 5,
    releases: 2,
    features: 8,
    fixes: 12,
    firstCommit: "2026-03-21T18:57:40-07:00",
    latestCommit: "2026-04-01T13:01:48-07:00",
  },
};

beforeEach(function () {
  global.localStorage = (function () {
    var store = {};
    return {
      getItem: function (key) { return store[key] || null; },
      setItem: function (key, value) { store[key] = String(value); },
      removeItem: function (key) { delete store[key]; },
      clear: function () { store = {}; },
    };
  })();

  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };

  global.fetch = vi.fn(function () {
    return Promise.resolve({
      ok: true,
      json: function () { return Promise.resolve(mockGitData); },
    });
  });

  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

function waitFor(fn, timeout) {
  timeout = timeout || 3000;
  return new Promise(function (resolve, reject) {
    var start = Date.now();
    function poll() {
      try {
        var result = fn();
        if (result) { resolve(result); return; }
      } catch (e) {}
      if (Date.now() - start > timeout) {
        reject(new Error("waitFor timed out"));
        return;
      }
      setTimeout(poll, 20);
    }
    poll();
  });
}

describe("JournalView component", function () {
  it("renders without crashing (catches missing variable references)", async function () {
    var JournalView = (await import("../components/JournalView.jsx")).default;
    var container = document.createElement("div");
    document.body.appendChild(container);
    var root = createRoot(container);

    await act(async function () {
      root.render(createElement(JournalView, {
        events: [],
        turns: [],
        metadata: {},
        onSeek: function () {},
      }));
    });

    // Wait for fetch to resolve and component to re-render
    await act(async function () {
      await new Promise(function (r) { setTimeout(r, 50); });
    });

    // Should not crash — if GIT_COLORS or any variable is undefined, this test fails
    expect(container.innerHTML.length).toBeGreaterThan(0);
    expect(container.innerHTML).not.toContain("is not defined");

    await act(async function () {
      root.unmount();
    });
    container.remove();
  });

  it("renders repo summary header with correct data", async function () {
    var JournalView = (await import("../components/JournalView.jsx")).default;
    var container = document.createElement("div");
    document.body.appendChild(container);
    var root = createRoot(container);

    await act(async function () {
      root.render(createElement(JournalView, {
        events: [],
        turns: [],
        metadata: {},
        onSeek: function () {},
      }));
    });

    await act(async function () {
      await new Promise(function (r) { setTimeout(r, 50); });
    });

    var html = container.innerHTML;
    expect(html).toContain("agentviz");
    expect(html).toContain("releases");
    expect(html).toContain("features");
    expect(html).toContain("fixes");

    await act(async function () {
      root.unmount();
    });
    container.remove();
  });

  it("renders journal rows from git data", async function () {
    var JournalView = (await import("../components/JournalView.jsx")).default;
    var container = document.createElement("div");
    document.body.appendChild(container);
    var root = createRoot(container);

    await act(async function () {
      root.render(createElement(JournalView, {
        events: [],
        turns: [],
        metadata: {},
        onSeek: function () {},
      }));
    });

    await act(async function () {
      await new Promise(function (r) { setTimeout(r, 50); });
    });

    var html = container.innerHTML;
    // Should contain steering commands from mock data
    expect(html).toContain("add Graph view");
    expect(html).toContain("v0.3.0");
    expect(html).toContain("stabilize replay");
    expect(html).toContain("refactoring initiative");

    await act(async function () {
      root.unmount();
    });
    container.remove();
  });

  it("renders filter badges for all entry types present", async function () {
    var JournalView = (await import("../components/JournalView.jsx")).default;
    var container = document.createElement("div");
    document.body.appendChild(container);
    var root = createRoot(container);

    await act(async function () {
      root.render(createElement(JournalView, {
        events: [],
        turns: [],
        metadata: {},
        onSeek: function () {},
      }));
    });

    await act(async function () {
      await new Promise(function (r) { setTimeout(r, 50); });
    });

    var html = container.innerHTML;
    expect(html).toContain("Release");
    expect(html).toContain("Level-Up");
    expect(html).toContain("Fix");
    expect(html).toContain("Pivot");

    await act(async function () {
      root.unmount();
    });
    container.remove();
  });

  it("renders session entries alongside git entries", async function () {
    var JournalView = (await import("../components/JournalView.jsx")).default;
    var container = document.createElement("div");
    document.body.appendChild(container);
    var root = createRoot(container);

    // Provide session data with a steering moment
    var events = [
      { t: 0, agent: "user", track: "user", text: "Build the API", isError: false, turnIndex: 0 },
      { t: 10, agent: "user", track: "user", text: "Actually switch to GraphQL instead", isError: false, turnIndex: 1 },
    ];
    var turns = [
      { index: 0, startTime: 0, endTime: 5, eventIndices: [0], userMessage: "Build the API", toolCount: 0, hasError: false },
      { index: 1, startTime: 10, endTime: 15, eventIndices: [1], userMessage: "Actually switch to GraphQL instead", toolCount: 2, hasError: false },
    ];

    await act(async function () {
      root.render(createElement(JournalView, {
        events: events,
        turns: turns,
        metadata: {},
        onSeek: function () {},
      }));
    });

    await act(async function () {
      await new Promise(function (r) { setTimeout(r, 50); });
    });

    var html = container.innerHTML;
    // Git entries
    expect(html).toContain("add Graph view");
    // Session entries should render with source badge
    expect(html).toContain("session");

    await act(async function () {
      root.unmount();
    });
    container.remove();
  });

  it("shows empty state when fetch fails and no session data", async function () {
    global.fetch = vi.fn(function () {
      return Promise.reject(new Error("network error"));
    });

    var JournalView = (await import("../components/JournalView.jsx")).default;
    var container = document.createElement("div");
    document.body.appendChild(container);
    var root = createRoot(container);

    await act(async function () {
      root.render(createElement(JournalView, {
        events: [],
        turns: [],
        metadata: {},
        onSeek: function () {},
      }));
    });

    await act(async function () {
      await new Promise(function (r) { setTimeout(r, 50); });
    });

    var html = container.innerHTML;
    expect(html).toContain("No journal entries found");

    await act(async function () {
      root.unmount();
    });
    container.remove();
  });
});
