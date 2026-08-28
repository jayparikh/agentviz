// @vitest-environment jsdom

import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/costAnalysis.js", async function (importOriginal) {
  var original = await importOriginal();
  return Object.assign({}, original, {
    buildCostAnalysis: vi.fn(original.buildCostAnalysis),
  });
});

import AnalyzeShell from "../components/v2/AnalyzeShell.jsx";
import { PlaybackProvider, usePlaybackTime } from "../contexts/PlaybackContext.jsx";
import { buildCostAnalysis } from "../lib/costAnalysis.js";

function SeekButton() {
  var playbackContext = usePlaybackTime();
  return (
    <button type="button" onClick={function () { playbackContext.playback.seek(5); }}>
      Seek
    </button>
  );
}

function makeSession(events, metadata) {
  return {
    events: events,
    turns: [],
    total: 10,
    isLive: false,
    metadata: metadata,
  };
}

function renderApp(root, session) {
  root.render(
    <PlaybackProvider session={session}>
      <SeekButton />
      <AnalyzeShell session={session} autonomyMetrics={{}} onNavigate={vi.fn()} />
    </PlaybackProvider>,
  );
}

describe("AnalyzeShell summary performance", function () {
  beforeEach(function () {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    window.localStorage.clear();
  });

  afterEach(function () {
    vi.clearAllMocks();
    document.body.innerHTML = "";
  });

  it("reuses the summary across playback ticks and recomputes when its inputs change", async function () {
    var events = [{
      t: 0,
      duration: 1,
      agent: "assistant",
      track: "output",
      text: "Response",
      model: "gpt-4o",
      tokenUsage: { inputTokens: 1000, outputTokens: 100, cacheRead: 0, cacheWrite: 0 },
    }];
    var metadata = {
      totalEvents: 1,
      totalTurns: 0,
      totalToolCalls: 0,
      errorCount: 0,
      duration: 10,
      primaryModel: "gpt-4o",
      models: { "gpt-4o": 1 },
      tokenUsage: { inputTokens: 1000, outputTokens: 100, cacheRead: 0, cacheWrite: 0 },
    };
    var session = makeSession(events, metadata);
    var container = document.createElement("div");
    document.body.appendChild(container);
    var root = createRoot(container);

    await act(async function () {
      renderApp(root, session);
    });
    expect(buildCostAnalysis).toHaveBeenCalledTimes(1);

    await act(async function () {
      Array.from(container.querySelectorAll("button")).find(function (button) {
        return button.textContent === "Seek";
      }).click();
    });
    expect(buildCostAnalysis).toHaveBeenCalledTimes(1);

    var nextEvents = events.concat({
      t: 1,
      duration: 0,
      agent: "assistant",
      track: "tool_call",
      text: "Run tool",
      toolName: "grep",
    });
    session = makeSession(nextEvents, metadata);
    await act(async function () {
      renderApp(root, session);
    });
    expect(buildCostAnalysis).toHaveBeenCalledTimes(2);

    session = makeSession(nextEvents, Object.assign({}, metadata, { totalToolCalls: 1 }));
    await act(async function () {
      renderApp(root, session);
    });
    expect(buildCostAnalysis).toHaveBeenCalledTimes(3);

    await act(async function () {
      root.unmount();
    });
  });
});
