// @vitest-environment jsdom

import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AppV2, {
  buildV2Hash,
  getV2DisabledZones,
  getV2AnalyzePanelFromHash,
  getV2ZoneForShortcut,
  getV2ZoneFromHash,
  isV2ZoneDisabled,
  shouldShowLiveCompletion,
} from "../AppV2.jsx";
import CommandPalette from "../components/CommandPalette.jsx";
import { PlaybackProvider } from "../contexts/PlaybackContext.jsx";
import AnalyzeShell, { ANALYZE_PANELS } from "../components/v2/AnalyzeShell.jsx";
import FlowRail, { V2_ZONES } from "../components/v2/FlowRail.jsx";
import FindPortfolio, {
  buildPortfolioStats,
  getFilteredPortfolioEntries,
} from "../components/v2/FindPortfolio.jsx";
import ReviewHub, {
  buildReviewInsights,
  buildReviewSummary,
} from "../components/v2/ReviewHub.jsx";
import InvestigateView from "../components/v2/InvestigateView.jsx";
import InlineCompare from "../components/v2/InlineCompare.jsx";
import ImproveView from "../components/v2/ImproveView.jsx";
import LiveSessionBanner, { buildLiveSessionStats } from "../components/v2/LiveSessionBanner.jsx";
import V2Header from "../components/v2/V2Header.jsx";
import QADrawer from "../components/QADrawer.jsx";

function createInactiveFetch() {
  return vi.fn(async function () {
    return { ok: false };
  });
}

function findExactText(container, text) {
  return Array.from(container.querySelectorAll("*")).find(function (node) {
    return node.textContent && node.textContent.trim() === text;
  }) || null;
}

function findExactButton(container, text) {
  return Array.from(container.querySelectorAll("button")).find(function (node) {
    return node.textContent && node.textContent.trim() === text;
  }) || null;
}

function findButtonContaining(container, text) {
  return Array.from(container.querySelectorAll("button")).find(function (node) {
    return node.textContent && node.textContent.indexOf(text) !== -1;
  }) || null;
}

function findAncestorRoleButton(node) {
  var current = node;
  while (current) {
    if (current.getAttribute && current.getAttribute("role") === "button") return current;
    current = current.parentElement;
  }
  return null;
}

async function changeInput(node, value) {
  await act(async function () {
    var descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(node), "value");
    descriptor.set.call(node, value);
    node.dispatchEvent(new Event("input", { bubbles: true }));
    node.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function renderNode(node) {
  var container = document.createElement("div");
  document.body.appendChild(container);
  var root = createRoot(container);

  await act(async function () {
    root.render(node);
  });

  return {
    container: container,
    unmount: async function () {
      await act(async function () {
        root.unmount();
      });
      container.remove();
    },
  };
}

async function sleep(ms) {
  await act(async function () {
    await new Promise(function (resolve) { setTimeout(resolve, ms); });
  });
}

async function waitFor(check, message) {
  var start = Date.now();
  while (Date.now() - start < 3000) {
    var result = check();
    if (result) return result;
    await sleep(20);
  }
  throw new Error(message || "Timed out waiting for condition");
}

beforeEach(function () {
  var storage = {};
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  global.fetch = createInactiveFetch();
  global.localStorage = {
    getItem: function (key) { return Object.prototype.hasOwnProperty.call(storage, key) ? storage[key] : null; },
    setItem: function (key, value) { storage[key] = String(value); },
    removeItem: function (key) { delete storage[key]; },
    clear: function () { storage = {}; },
  };
  Object.defineProperty(window.navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn(function () { return Promise.resolve(); }) },
  });
  window.history.replaceState(null, "", "#/");
});

afterEach(function () {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
  window.history.replaceState(null, "", "#/");
});

describe("V2 shell routing", function () {
  function makePortfolioEntries() {
    return [
      {
        id: "stored-a",
        file: "session-a.jsonl",
        primaryPrompt: "Fix authentication flow",
        format: "copilot-cli",
        importedAt: "2026-05-01T00:00:00.000Z",
        updatedAt: "2026-05-03T00:00:00.000Z",
        reviewScore: 8.5,
        totalCost: 0.24,
        errorCount: 2,
        totalEvents: 30,
        hasContent: true,
        tags: ["backend", "auth"],
      },
      {
        id: "stored-b",
        file: "session-b.jsonl",
        primaryPrompt: "Polish landing page",
        format: "claude-code",
        importedAt: "2026-05-02T00:00:00.000Z",
        updatedAt: "2026-05-02T00:00:00.000Z",
        reviewScore: 2,
        totalCost: 0.1,
        errorCount: 0,
        totalEvents: 12,
        hasContent: true,
        tags: ["frontend"],
      },
      {
        id: "discovered-c",
        file: "session-c.jsonl",
        filename: "session-c.jsonl",
        format: "vscode-chat",
        importedAt: "2026-05-04T00:00:00.000Z",
        updatedAt: "2026-05-04T00:00:00.000Z",
        isDiscovered: true,
        discoveredPath: "C:\\Users\\jayp\\session-c.jsonl",
        size: 30000,
        tags: ["backend"],
      },
    ];
  }

  function makeReviewSession() {
    return {
      file: "review-session.jsonl",
      events: [
        { t: 0, duration: 1, agent: "assistant", track: "reasoning", text: "Plan work", isError: false },
        { t: 1, duration: 8, agent: "assistant", track: "tool_call", toolName: "bash", text: "Run tests", isError: false },
        { t: 10, duration: 1, agent: "assistant", track: "tool_call", toolName: "tsc", text: "typecheck failed", isError: true },
      ],
      turns: [
        { index: 0, eventIndices: [0, 1], userMessage: "Fix auth", toolCount: 1, hasError: false },
        { index: 1, eventIndices: [2], userMessage: "Fix typecheck", toolCount: 1, hasError: true },
      ],
      metadata: {
        totalEvents: 3,
        totalTurns: 2,
        totalToolCalls: 2,
        errorCount: 1,
        duration: 12,
        totalCost: 0.12,
        primaryModel: "gpt-5.5",
        tokenUsage: { inputTokens: 100, outputTokens: 50, cacheRead: 0, cacheWrite: 0 },
        models: { "gpt-5.5": 1 },
      },
    };
  }

  function makeAnalyzeSession() {
    var session = makeReviewSession();
    return Object.assign({}, session, {
      total: 12,
      isLive: false,
    });
  }

  function makeLiveSession() {
    return Object.assign({}, makeAnalyzeSession(), { isLive: true });
  }

  function makeAutonomyMetrics() {
    return {
      interventionCount: 1,
      babysittingTime: 12,
      idleTime: 0,
      autonomyEfficiency: 0.74,
      totalDuration: 12,
      topTools: [],
    };
  }

  it("normalizes v2 hashes", function () {
    expect(buildV2Hash("review")).toBe("#/v2/review");
    expect(buildV2Hash("analyze", { panelId: "cost" })).toBe("#/v2/analyze/cost");
    expect(buildV2Hash("unknown")).toBe("#/v2/find");
    expect(getV2ZoneFromHash("#/v2/analyze")).toBe("analyze");
    expect(getV2ZoneFromHash("#/v2/analyze/cost")).toBe("analyze");
    expect(getV2AnalyzePanelFromHash("#/v2/analyze/cost")).toBe("cost");
    expect(getV2ZoneFromHash("#/session")).toBe("find");
    expect(getV2ZoneForShortcut("1")).toBe("find");
    expect(getV2ZoneForShortcut("6")).toBe("improve");
    expect(getV2ZoneForShortcut("7")).toBe(null);
  });

  it("only shows live completion for the same loaded session", function () {
    expect(shouldShowLiveCompletion(true, 1, 1, [{ t: 0 }])).toBe(true);
    expect(shouldShowLiveCompletion(true, 1, 2, [{ t: 0 }])).toBe(false);
    expect(shouldShowLiveCompletion(false, 1, 1, [{ t: 0 }])).toBe(false);
    expect(shouldShowLiveCompletion(true, 1, 1, null)).toBe(false);
  });

  it("locks Compare and Improve while a session is live", function () {
    var liveSession = makeLiveSession();
    expect(getV2DisabledZones(liveSession)).toEqual(["compare", "improve"]);
    expect(isV2ZoneDisabled("compare", liveSession)).toBe(true);
    expect(isV2ZoneDisabled("improve", liveSession)).toBe(true);
    expect(isV2ZoneDisabled("review", liveSession)).toBe(false);
    expect(getV2DisabledZones(makeAnalyzeSession())).toEqual([]);
  });

  it("renders the six-zone FlowRail and respects disabled zones", async function () {
    var onNavigate = vi.fn();
    var app = await renderNode(
      <FlowRail activeZone="review" onNavigate={onNavigate} disabledZones={["compare"]} />,
    );

    expect(V2_ZONES).toHaveLength(6);
    expect(findExactButton(app.container, "ReviewSession health").getAttribute("aria-current")).toBe("page");

    await act(async function () {
      findExactButton(app.container, "AnalyzeDeep panels").click();
      findExactButton(app.container, "CompareA/B sessions").click();
    });

    expect(onNavigate).toHaveBeenCalledWith("analyze");
    expect(onNavigate).not.toHaveBeenCalledWith("compare");

    await app.unmount();
  });

  it("renders compact FlowRail with accessible disabled explanations", async function () {
    var onNavigate = vi.fn();
    var app = await renderNode(
      <FlowRail activeZone="review" onNavigate={onNavigate} disabledZones={["compare"]} compact={true} />,
    );

    var compare = app.container.querySelector('button[aria-label="Compare, A/B sessions, unavailable while a live session is streaming"]');
    expect(compare).toBeTruthy();
    expect(compare.getAttribute("aria-disabled")).toBe("true");

    await act(async function () {
      compare.focus();
    });
    expect(findExactText(app.container, "Unavailable while a live session is streaming.")).toBeTruthy();

    await act(async function () {
      compare.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      compare.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    });
    expect(onNavigate).not.toHaveBeenCalled();

    await app.unmount();
  });

  it("renders compact session status in V2Header", async function () {
    var onOpenCommandPalette = vi.fn();
    var onSetThemeMode = vi.fn();
    var session = {
      file: "demo-session.jsonl",
      sourcePath: "C:\\Users\\jayp\\sessions\\demo-session.jsonl",
      events: [{ t: 0 }],
      metadata: { totalEvents: 1 },
      isLive: false,
    };
    var app = await renderNode(
      <V2Header
        session={session}
        activeZone="review"
        currentThemeMode="dark"
        onSetThemeMode={onSetThemeMode}
        onOpenCommandPalette={onOpenCommandPalette}
      />,
    );

    expect(findExactText(app.container, "demo-session.jsonl")).toBeTruthy();
    expect(app.container.querySelector('button[aria-label="Copy session source path"]').title).toBe("C:\\Users\\jayp\\sessions\\demo-session.jsonl");
    expect(findExactText(app.container, "Ready")).toBeTruthy();
    expect(findExactText(app.container, "Review · 1 events")).toBeTruthy();

    await act(async function () {
      findExactButton(app.container, "Cmd+K").click();
    });
    expect(onOpenCommandPalette).toHaveBeenCalledTimes(1);

    await act(async function () {
      app.container.querySelector('button[aria-label="Copy session source path"]').click();
    });
    expect(window.navigator.clipboard.writeText).toHaveBeenCalledWith("C:\\Users\\jayp\\sessions\\demo-session.jsonl");

    await act(async function () {
      app.container.querySelector('button[aria-label="Theme selector"]').click();
    });
    await act(async function () {
      findExactButton(app.container, "Light").click();
    });
    expect(onSetThemeMode).toHaveBeenCalledWith("light");

    await app.unmount();
  });

  it("exposes V2Header theme menu state and closes it with Escape", async function () {
    var app = await renderNode(
      <V2Header
        session={{ file: "demo.jsonl", metadata: { totalEvents: 3 } }}
        activeZone="review"
        currentThemeMode="dark"
        onSetThemeMode={vi.fn()}
        onOpenCommandPalette={vi.fn()}
        onExitV2={vi.fn()}
      />,
    );

    var themeButton = Array.from(app.container.querySelectorAll("button")).find(function (button) {
      return button.getAttribute("aria-label") === "Theme selector";
    });
    expect(themeButton.getAttribute("aria-expanded")).toBe("false");

    await act(async function () {
      themeButton.click();
    });
    expect(themeButton.getAttribute("aria-expanded")).toBe("true");
    expect(app.container.querySelector('[role="menu"][aria-label="Theme mode"]')).toBeTruthy();

    await act(async function () {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(themeButton.getAttribute("aria-expanded")).toBe("false");

    await app.unmount();
  });

  it("restores focus to the command palette trigger on Escape", async function () {
    function Harness() {
      var [open, setOpen] = React.useState(false);
      return (
        <>
          <button type="button" onClick={function () { setOpen(true); }}>
            Open palette
          </button>
          {open && (
            <CommandPalette
              events={[]}
              turns={[]}
              extraItems={[{ type: "zone", zoneId: "review", label: "Go to Review zone", iconName: "alert-circle" }]}
              indexOptions={{ includeLegacyViews: false, includeDefaultActions: false }}
              onNavigateZone={vi.fn()}
              onClose={function () { setOpen(false); }}
            />
          )}
        </>
      );
    }

    var app = await renderNode(<Harness />);
    var trigger = findExactButton(app.container, "Open palette");
    await act(async function () {
      trigger.focus();
      trigger.click();
    });
    await waitFor(function () {
      return app.container.querySelector('input[aria-label="Search command palette"]') === document.activeElement;
    }, "expected palette input focus");

    await act(async function () {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    await waitFor(function () {
      return trigger === document.activeElement;
    }, "expected focus restored to palette trigger");

    await app.unmount();
  });

  it("mounts AppV2 without legacy hash rewriting and navigates between zones", async function () {
    window.history.replaceState(null, "", "#/v2/review");
    var app = await renderNode(<AppV2 />);

    await waitFor(function () {
      return findExactText(app.container, "Open a session to review it");
    }, "expected initial review zone");
    expect(window.location.hash).toBe("#/v2/review");

    await act(async function () {
      findExactButton(app.container, "CompareA/B sessions").click();
    });

    await waitFor(function () {
      return findExactText(app.container, "Select two sessions to compare");
    }, "expected compare zone");
    expect(window.location.hash).toBe("#/v2/compare");

    await act(async function () {
      findExactButton(app.container, "Cmd+K").click();
    });

    expect(app.container.querySelector('input[placeholder="Search workflow, events, turns..."]')).toBeTruthy();

    await act(async function () {
      app.container.querySelector('input[placeholder="Search workflow, events, turns..."]').dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(app.container.querySelector('input[placeholder="Search workflow, events, turns..."]')).toBeFalsy();

    await app.unmount();
  });

  it("loads demo data in AppV2 and carries it across all workflow zones", async function () {
    window.history.replaceState(null, "", "#/v2/find");
    var app = await renderNode(<AppV2 />);

    await waitFor(function () {
      return findExactText(app.container, "No sessions available yet.");
    }, "expected empty find portfolio");

    await act(async function () {
      findExactButton(app.container, "Demo").click();
    });

    await waitFor(function () {
      return findExactText(app.container, "Review health");
    }, "expected demo session to open in Review");
    expect(window.location.hash).toBe("#/v2/review");

    await act(async function () {
      findExactButton(app.container, "InvestigateEvidence stream").click();
    });
    await waitFor(function () {
      return findExactText(app.container, "Evidence stream");
    }, "expected Investigate zone");

    await act(async function () {
      findExactButton(app.container, "AnalyzeDeep panels").click();
    });
    await waitFor(function () {
      return findExactText(app.container, "Analysis panels");
    }, "expected Analyze zone");

    await act(async function () {
      findExactButton(app.container, "CompareA/B sessions").click();
    });
    await waitFor(function () {
      return findExactText(app.container, "Select two sessions to compare");
    }, "expected Compare zone");

    await act(async function () {
      findExactButton(app.container, "ImproveCoach & Q&A").click();
    });
    await waitFor(function () {
      return findExactText(app.container, "Coach and Q&A");
    }, "expected Improve zone");

    await app.unmount();
  });

  it("uses flow-aware command palette commands in AppV2", async function () {
    window.history.replaceState(null, "", "#/v2/find");
    var app = await renderNode(<AppV2 />);

    await act(async function () {
      findExactButton(app.container, "Demo").click();
    });

    await waitFor(function () {
      return findExactText(app.container, "Review health");
    }, "expected demo session");

    await act(async function () {
      findExactButton(app.container, "Cmd+K").click();
    });

    await waitFor(function () {
      return app.container.querySelector('input[placeholder="Search workflow, events, turns..."]');
    }, "expected v2 command palette");

    var investigateCommand = await waitFor(function () {
      return findButtonContaining(app.container, "Go to Investigate");
    }, "expected Investigate command");

    await act(async function () {
      investigateCommand.click();
    });

    await waitFor(function () {
      return findExactText(app.container, "Evidence stream");
    }, "expected command to navigate to Investigate");
    expect(window.location.hash).toBe("#/v2/investigate");

    await app.unmount();
  });

  it("supports v2 keyboard navigation and old shortcut migration notice", async function () {
    window.history.replaceState(null, "", "#/v2/find");
    var app = await renderNode(<AppV2 />);

    await act(async function () {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "4", bubbles: true }));
    });
    await waitFor(function () {
      return findExactText(app.container, "Deep visualizations");
    }, "expected 4 to navigate to Analyze");
    expect(window.location.hash).toBe("#/v2/analyze");

    await act(async function () {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "7", bubbles: true }));
    });

    await waitFor(function () {
      return findExactText(app.container, "Coach is now Improve. Use 6 for Improve.");
    }, "expected migration notice");
    expect(window.location.hash).toBe("#/v2/improve");

    await app.unmount();
  });

  it("filters portfolio entries and builds stats", function () {
    var entries = makePortfolioEntries();
    var stats = buildPortfolioStats(entries);
    var filtered = getFilteredPortfolioEntries(entries, "auth", "all", "needs-review");
    var tagFiltered = getFilteredPortfolioEntries(entries, "", "all", "needs-review", ["backend"]);

    expect(stats.total).toBe(3);
    expect(stats.analyzed).toBe(2);
    expect(stats.discovered).toBe(1);
    expect(stats.totalErrors).toBe(2);
    expect(filtered.map(function (entry) { return entry.id; })).toEqual(["stored-a"]);
    expect(tagFiltered.map(function (entry) { return entry.id; })).toEqual(["stored-a", "discovered-c"]);
  });

  it("sorts Find portfolio entries by global recent activity across sources", function () {
    var entries = makePortfolioEntries();
    var sorted = getFilteredPortfolioEntries(entries, "", "all", "most-recent");

    expect(sorted.map(function (entry) { return entry.id; })).toEqual([
      "discovered-c",
      "stored-a",
      "stored-b",
    ]);
  });

  it("renders FindPortfolio with layout toggle and multi-select compare", async function () {
    var onOpenSession = vi.fn();
    var onCompareSelected = vi.fn();
    var onRefresh = vi.fn(function () { return Promise.resolve(); });
    var app = await renderNode(
      <FindPortfolio
        entries={makePortfolioEntries()}
        onOpenSession={onOpenSession}
        onCompareSelected={onCompareSelected}
        onRefresh={onRefresh}
      />,
    );

    expect(findExactText(app.container, "sessions")).toBeTruthy();
    expect(findExactText(app.container, "avg review")).toBeTruthy();
    expect(findExactButton(app.container, "Grid").getAttribute("aria-pressed")).toBe("true");
    expect(findExactButton(app.container, "backend")).toBeTruthy();

    await act(async function () {
      findExactButton(app.container, "List").click();
    });
    expect(findExactButton(app.container, "List").getAttribute("aria-pressed")).toBe("true");

    await changeInput(app.container.querySelector('input[aria-label="Search v2 sessions"]'), "auth");
    expect(findExactText(app.container, "Fix authentication flow")).toBeTruthy();
    expect(findExactText(app.container, "Polish landing page")).toBeFalsy();

    await changeInput(app.container.querySelector('input[aria-label="Search v2 sessions"]'), "");

    await act(async function () {
      findExactButton(app.container, "frontend").click();
    });
    expect(findExactText(app.container, "Polish landing page")).toBeTruthy();
    expect(findExactText(app.container, "Fix authentication flow")).toBeFalsy();

    await act(async function () {
      findExactButton(app.container, "Clear tags").click();
    });

    var checkboxes = app.container.querySelectorAll('input[type="checkbox"]');
    await act(async function () {
      checkboxes[0].click();
      checkboxes[1].click();
    });

    expect(findExactText(app.container, "2 selected")).toBeTruthy();
    await act(async function () {
      findExactButton(app.container, "Compare selected").click();
    });
    expect(onCompareSelected).toHaveBeenCalledTimes(1);

    await act(async function () {
      findExactButton(app.container, "Open").click();
    });
    expect(onOpenSession).toHaveBeenCalledTimes(1);

    await app.unmount();
  });

  it("renders manifest source and manifest errors in FindPortfolio", async function () {
    var app = await renderNode(
      <FindPortfolio
        entries={[]}
        manifestError="Could not load manifest"
        isManifestMode={true}
      />,
    );

    expect(findExactText(app.container, "Manifest source")).toBeTruthy();
    expect(findExactText(app.container, "Could not load manifest")).toBeTruthy();

    await app.unmount();
  });

  it("builds ReviewHub summary and evidence-linked insights", function () {
    var summary = buildReviewSummary(makeReviewSession(), makeAutonomyMetrics());
    var insights = buildReviewInsights(makeReviewSession(), makeAutonomyMetrics());

    expect(summary.errorCount).toBe(1);
    expect(summary.totalToolCalls).toBe(2);
    expect(summary.cost).toBe(0.12);
    expect(insights.map(function (item) { return item.id; })).toContain("first-error");
    expect(insights.map(function (item) { return item.targetZone; })).toContain("investigate");
    expect(insights.find(function (item) { return item.id === "token-usage"; }).targetPanelId).toBe("cost");
  });

  it("renders ReviewHub and follows evidence links", async function () {
    var onNavigate = vi.fn();
    var app = await renderNode(
      <ReviewHub
        session={makeReviewSession()}
        autonomyMetrics={makeAutonomyMetrics()}
        onNavigate={onNavigate}
      />,
    );

    expect(findExactText(app.container, "Review health")).toBeTruthy();
    expect(findExactText(app.container, "Evidence-linked insights")).toBeTruthy();
    expect(findExactText(app.container, "First error needs attention")).toBeTruthy();
    expect(findExactText(app.container, "Data readiness")).toBeTruthy();
    expect(findExactText(app.container, "Token data")).toBeTruthy();
    expect(findExactText(app.container, "Cost data")).toBeTruthy();
    expect(findExactText(app.container, "Human wait")).toBeTruthy();

    await act(async function () {
      findExactButton(app.container, "Jump to event 3").click();
    });
    expect(onNavigate).toHaveBeenCalledWith("investigate", { eventIndex: 2, panelId: undefined });

    await act(async function () {
      findExactButton(app.container, "Open Cost analysis").click();
    });
    expect(onNavigate).toHaveBeenCalledWith("analyze", { eventIndex: undefined, panelId: "cost" });

    await app.unmount();
  });

  it("renders Review data gaps when tokens and cost are missing", async function () {
    var session = makeReviewSession();
    session.metadata = Object.assign({}, session.metadata, { tokenUsage: null, totalCost: null });
    var app = await renderNode(
      <ReviewHub
        session={session}
        autonomyMetrics={makeAutonomyMetrics()}
        onNavigate={vi.fn()}
      />,
    );

    expect(findExactText(app.container, "not logged")).toBeTruthy();
    expect(findExactText(app.container, "not available")).toBeTruthy();

    await app.unmount();
  });

  it("renders AnalyzeShell with existing panel components", async function () {
    var onNavigate = vi.fn();
    var session = makeAnalyzeSession();
    var app = await renderNode(
      <PlaybackProvider session={session}>
        <AnalyzeShell
          session={session}
          autonomyMetrics={makeAutonomyMetrics()}
          onNavigate={onNavigate}
        />
      </PlaybackProvider>,
    );

    expect(ANALYZE_PANELS.map(function (panel) { return panel.id; })).toEqual([
      "stats",
      "tracks",
      "waterfall",
      "graph",
      "cost",
    ]);
    expect(findExactText(app.container, "Analysis panels")).toBeTruthy();
    expect(findExactText(app.container, "Session Overview")).toBeTruthy();
    expect(findExactText(app.container, "Events")).toBeTruthy();
    expect(findExactText(app.container, "Review token spend")).toBeTruthy();
    expect(findExactButton(app.container, "Stats").getAttribute("aria-pressed")).toBe("true");

    await act(async function () {
      findExactButton(app.container, "Tracks").click();
    });
    expect(findExactButton(app.container, "Tracks").getAttribute("aria-pressed")).toBe("true");
    expect(findExactText(app.container, "Tool Calls")).toBeTruthy();

    await act(async function () {
      findExactButton(app.container, "Review token spend").click();
    });
    expect(onNavigate).toHaveBeenCalledWith("analyze", { panelId: "cost" });

    await act(async function () {
      findExactButton(app.container, "Back to Review").click();
    });
    expect(onNavigate).toHaveBeenCalledWith("review");

    await app.unmount();
  });

  it("opens a targeted Analyze sub-panel", async function () {
    var session = makeAnalyzeSession();
    var app = await renderNode(
      <PlaybackProvider session={session}>
        <AnalyzeShell
          session={session}
          autonomyMetrics={makeAutonomyMetrics()}
          targetPanelId="cost"
          onNavigate={vi.fn()}
        />
      </PlaybackProvider>,
    );

    await waitFor(function () {
      return findExactButton(app.container, "Cost").getAttribute("aria-pressed") === "true";
    }, "expected Cost panel to be active");

    await app.unmount();
  });

  it("updates the URL when selecting an Analyze sub-panel in AppV2", async function () {
    window.history.replaceState(null, "", "#/v2/find");
    var app = await renderNode(<AppV2 />);

    await act(async function () {
      findExactButton(app.container, "Demo").click();
    });
    await act(async function () {
      findExactButton(app.container, "AnalyzeDeep panels").click();
    });
    await waitFor(function () {
      return findExactText(app.container, "Analysis panels");
    }, "expected Analyze zone");
    await act(async function () {
      findExactButton(app.container, "Cost").click();
    });
    expect(window.location.hash).toBe("#/v2/analyze/cost");

    await app.unmount();
  });

  it("renders InvestigateView and exposes contextual event actions", async function () {
    var onNavigate = vi.fn();
    var session = makeAnalyzeSession();
    var app = await renderNode(
      <PlaybackProvider session={session}>
        <InvestigateView
          session={session}
          onNavigate={onNavigate}
        />
      </PlaybackProvider>,
    );

    await waitFor(function () {
      return findExactText(app.container, "Evidence stream");
    }, "expected investigate header");

    await waitFor(function () {
      return findExactText(app.container, "typecheck failed");
    }, "expected error event to render");

    await act(async function () {
      findAncestorRoleButton(findExactText(app.container, "typecheck failed")).click();
    });

    await waitFor(function () {
      return findExactButton(app.container, "Coach in Improve");
    }, "expected contextual actions");
    expect(findExactButton(app.container, "See in Waterfall")).toBeTruthy();
    expect(findExactButton(app.container, "Compare sessions")).toBeTruthy();
    expect(findExactButton(app.container, "Copy payload")).toBeTruthy();
    expect(findExactButton(app.container, "Errors only (1)")).toBeTruthy();
    expect(app.container.querySelector('input[aria-label="Search evidence events"]')).toBeTruthy();

    await act(async function () {
      findExactButton(app.container, "See in Waterfall").click();
    });
    expect(onNavigate).toHaveBeenCalledWith("analyze", { panelId: "waterfall" });

    await act(async function () {
      findExactButton(app.container, "Coach in Improve").click();
    });

    expect(onNavigate).toHaveBeenCalledWith("improve", { eventIndex: 2 });

    await app.unmount();
  });

  it("filters Investigate to errors and searches evidence", async function () {
    var session = makeAnalyzeSession();
    var app = await renderNode(
      <PlaybackProvider session={session}>
        <InvestigateView
          session={session}
          onNavigate={vi.fn()}
        />
      </PlaybackProvider>,
    );

    expect(findExactText(app.container, "Plan work")).toBeTruthy();
    await act(async function () {
      findExactButton(app.container, "Errors only (1)").click();
    });
    expect(findExactText(app.container, "typecheck failed")).toBeTruthy();
    expect(findExactText(app.container, "Plan work")).toBeFalsy();

    await changeInput(app.container.querySelector('input[aria-label="Search evidence events"]'), "typecheck");
    await waitFor(function () {
      return findExactText(app.container, "1 match");
    }, "expected search match count");

    await app.unmount();
  });

  it("selects a targeted Investigate event from evidence navigation", async function () {
    var session = makeAnalyzeSession();
    var app = await renderNode(
      <PlaybackProvider session={session}>
        <InvestigateView
          session={session}
          targetEventIndex={2}
          onNavigate={vi.fn()}
        />
      </PlaybackProvider>,
    );

    await waitFor(function () {
      return findExactText(app.container, "Selected Event");
    }, "expected targeted event selection");
    expect(findExactButton(app.container, "Coach in Improve")).toBeTruthy();

    await app.unmount();
  });

  it("renders InlineCompare when both sessions are ready", async function () {
    var onNavigate = vi.fn();
    var onOpenSessionA = vi.fn();
    var sessionA = makeAnalyzeSession();
    var sessionB = Object.assign({}, makeAnalyzeSession(), { file: "other-session.jsonl" });
    var app = await renderNode(
      <InlineCompare
        sessionA={sessionA}
        sessionB={sessionB}
        compareReady={true}
        onNavigate={onNavigate}
        onOpenSessionA={onOpenSessionA}
        onOpenSessionB={vi.fn()}
        exportState="idle"
      />,
    );

    expect(findExactText(app.container, "Compare")).toBeTruthy();
    expect(findExactText(app.container, "Scorecard")).toBeTruthy();
    expect(findExactText(app.container, "Coach session A")).toBeTruthy();

    await act(async function () {
      findExactButton(app.container, "Coach session A").click();
    });
    expect(onOpenSessionA).toHaveBeenCalledTimes(1);

    await act(async function () {
      findExactButton(app.container, "Back to Review").click();
    });
    expect(onNavigate).toHaveBeenCalledWith("review");

    await app.unmount();
  });

  it("renders InlineCompare empty state with selected seeds", async function () {
    var onNavigate = vi.fn();
    var app = await renderNode(
      <InlineCompare
        seedEntries={makePortfolioEntries().slice(0, 2)}
        compareReady={false}
        onNavigate={onNavigate}
      />,
    );

    expect(findExactText(app.container, "Select two sessions to compare")).toBeTruthy();
    expect(findExactText(app.container, "Session A")).toBeTruthy();
    expect(findExactText(app.container, "Session B")).toBeTruthy();

    await act(async function () {
      findExactButton(app.container, "Go to Find").click();
    });
    expect(onNavigate).toHaveBeenCalledWith("find");

    await app.unmount();
  });

  it("offers recent sessions as Compare targets for the current run", async function () {
    var onCompareWithEntry = vi.fn();
    var candidates = makePortfolioEntries();
    var app = await renderNode(
      <InlineCompare
        sessionA={{ events: null, metadata: null, total: 0, file: "" }}
        sessionB={{ events: null, metadata: null, total: 0, file: "" }}
        seedEntries={[]}
        candidateEntries={candidates}
        canCompareCurrent={true}
        compareContext={{ eventIndex: 1 }}
        compareReady={false}
        onNavigate={vi.fn()}
        onCompareWithEntry={onCompareWithEntry}
      />,
    );

    expect(findExactText(app.container, "Compare request came from event 2. Pick a comparison session to continue.")).toBeTruthy();
    expect(findExactText(app.container, "Compare current run with")).toBeTruthy();

    await act(async function () {
      findButtonContaining(app.container, "Fix authentication flow").click();
    });
    expect(onCompareWithEntry).toHaveBeenCalledWith(candidates[0]);

    await app.unmount();
  });

  it("renders ImproveView empty state without a session", async function () {
    var onNavigate = vi.fn();
    var emptySession = { events: null, turns: [], metadata: null, total: 0, isLive: false };
    var app = await renderNode(
      <PlaybackProvider session={emptySession}>
        <ImproveView
          session={emptySession}
          autonomyMetrics={makeAutonomyMetrics()}
          debrief={{ summary: [] }}
          onNavigate={onNavigate}
        />
      </PlaybackProvider>,
    );

    expect(findExactText(app.container, "Open a session to improve it")).toBeTruthy();
    await act(async function () {
      findExactButton(app.container, "Go to Find").click();
    });
    expect(onNavigate).toHaveBeenCalledWith("find");

    await app.unmount();
  });

  it("renders ImproveView checklist and contextual Q&A prefill", async function () {
    var session = makeAnalyzeSession();
    var app = await renderNode(
      <PlaybackProvider session={session}>
        <ImproveView
          session={session}
          autonomyMetrics={makeAutonomyMetrics()}
          debrief={{ summary: [{ label: "Score", value: "74%" }] }}
          openQARequest={{ openQA: true, eventIndex: 2, nonce: 1 }}
          onNavigate={vi.fn()}
        />
      </PlaybackProvider>,
    );

    await waitFor(function () {
      return findExactText(app.container, "Next-run checklist");
    }, "expected improve checklist");
    expect(findExactText(app.container, "Focused on event 2: tsc")).toBeTruthy();
    expect(findExactButton(app.container, "Copy next-run prompt")).toBeTruthy();
    expect(app.container.querySelector('input[aria-label="Ask about this session"]').value).toContain("event 2");
    expect(app.container.textContent).toContain("typecheck failed");

    await app.unmount();
  });

  it("preserves Q&A draft input when contextual prefill changes while open", async function () {
    var qa = {
      messages: [],
      isStreaming: false,
      streamingStatus: null,
      error: null,
      ask: vi.fn(),
      abort: vi.fn(),
      clear: vi.fn(),
    };

    function Harness() {
      var [question, setQuestion] = React.useState("Initial context question");
      return (
        <>
          <button type="button" onClick={function () { setQuestion("Updated event question"); }}>
            Change context
          </button>
          <QADrawer
            open={true}
            onClose={vi.fn()}
            onDisable={vi.fn()}
            sessionData={{ events: [], turns: [], metadata: {} }}
            onSeek={vi.fn()}
            turns={[]}
            qa={qa}
            initialQuestion={question}
          />
        </>
      );
    }

    var app = await renderNode(<Harness />);
    var input = app.container.querySelector('input[aria-label="Ask about this session"]');
    expect(input.value).toBe("Initial context question");

    await changeInput(input, "my typed draft");
    await act(async function () {
      findExactButton(app.container, "Change context").click();
    });

    expect(app.container.querySelector('input[aria-label="Ask about this session"]').value).toBe("my typed draft");

    await app.unmount();
  });

  it("builds and renders live session metrics", async function () {
    var stats = buildLiveSessionStats(makeLiveSession());
    expect(stats.events).toBe(3);
    expect(stats.turns).toBe(2);
    expect(stats.errors).toBe(1);

    var app = await renderNode(
      <LiveSessionBanner
        session={makeLiveSession()}
        completed={false}
      />,
    );

    expect(findExactText(app.container, "Live session streaming")).toBeTruthy();
    expect(app.container.textContent).toContain("Compare and Improve stay locked while events are still arriving.");
    expect(findExactText(app.container, "Go to Review")).toBeFalsy();

    await app.unmount();
  });

  it("renders live completion actions", async function () {
    var onCompare = vi.fn();
    var onImprove = vi.fn();
    var onDismiss = vi.fn();
    var app = await renderNode(
      <LiveSessionBanner
        session={makeAnalyzeSession()}
        completed={true}
        onReview={vi.fn()}
        onCompare={onCompare}
        onImprove={onImprove}
        onDismiss={onDismiss}
      />,
    );

    expect(findExactText(app.container, "Session complete")).toBeTruthy();
    await act(async function () {
      findExactButton(app.container, "Compare").click();
      findExactButton(app.container, "Improve").click();
      findExactButton(app.container, "Dismiss").click();
    });

    expect(onCompare).toHaveBeenCalledTimes(1);
    expect(onImprove).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);

    await app.unmount();
  });
});
