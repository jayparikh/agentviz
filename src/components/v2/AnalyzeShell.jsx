import React, { useEffect } from "react";
import { theme } from "../../lib/theme.js";
import usePersistentState from "../../hooks/usePersistentState.js";
import useBreakpoint from "../../hooks/useBreakpoint.js";
import lazyImport from "../../lib/lazyImport.js";
import { usePlaybackContext } from "../../contexts/PlaybackContext.jsx";
import Icon from "../Icon.jsx";
import TracksView from "../TracksView.jsx";
import WaterfallView from "../WaterfallView.jsx";
import StatsView from "../StatsView.jsx";
import ToolbarButton from "../ui/ToolbarButton.jsx";
import { V2ZoneHeader } from "./V2ShellPrimitives.jsx";
import { buildCostAnalysis, formatTokens } from "../../lib/costAnalysis.js";
import { formatCostValue } from "../../lib/pricing.js";

var GraphView = React.lazy(function () { return lazyImport(function () { return import("../GraphView.jsx"); }); });
var CostView = React.lazy(function () { return lazyImport(function () { return import("../CostView.jsx"); }); });

export var ANALYZE_PANELS = [
  { id: "stats", label: "Stats", icon: "stats", description: "Overview, autonomy, turns, and model usage" },
  { id: "tracks", label: "Tracks", icon: "tracks", description: "DAW-style event lanes by track" },
  { id: "waterfall", label: "Waterfall", icon: "waterfall", description: "Tool execution timing and nesting" },
  { id: "graph", label: "Graph", icon: "graph", description: "Turn and tool-call dependency graph" },
  { id: "cost", label: "Cost", icon: "coins", description: "Token spend and context composition" },
];

function isValidPanel(panelId) {
  return ANALYZE_PANELS.some(function (panel) { return panel.id === panelId; });
}

function getPanel(panelId) {
  return ANALYZE_PANELS.find(function (panel) { return panel.id === panelId; }) || ANALYZE_PANELS[0];
}

function LoadingPanel({ label }) {
  return (
    <div style={{
      height: "100%",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      color: theme.text.dim,
      fontSize: theme.fontSize.md,
    }}>
      Loading {label}...
    </div>
  );
}

function renderPanel(panelId, session, pb, autonomyMetrics, onNavigate) {
  if (panelId === "tracks") {
    return (
      <TracksView
        currentTime={pb.playback.time}
        eventEntries={pb.filteredEventEntries}
        totalTime={session.total}
        timeMap={pb.timeMap}
        turns={session.turns}
      />
    );
  }

  if (panelId === "waterfall") {
    return (
      <WaterfallView
        currentTime={pb.playback.time}
        eventEntries={pb.filteredEventEntries}
        totalTime={session.total}
        timeMap={pb.timeMap}
        turns={session.turns}
      />
    );
  }

  if (panelId === "graph") {
    return (
      <React.Suspense fallback={<LoadingPanel label="Graph" />}>
        <GraphView
          currentTime={pb.playback.time}
          eventEntries={pb.filteredEventEntries}
          totalTime={session.total}
          timeMap={pb.timeMap}
          turns={session.turns}
        />
      </React.Suspense>
    );
  }

  if (panelId === "cost") {
    return (
      <React.Suspense fallback={<LoadingPanel label="Cost" />}>
        <CostView
          events={pb.filteredEvents}
          metadata={session.metadata}
        />
      </React.Suspense>
    );
  }

  return (
    <StatsView
      events={pb.filteredEvents}
      totalTime={session.total}
      metadata={session.metadata}
      turns={session.turns}
      autonomyMetrics={autonomyMetrics}
      onOpenCoach={function () { if (onNavigate) onNavigate("improve"); }}
    />
  );
}

function getAnalyzeSummary(session, pb) {
  var events = pb.filteredEvents || [];
  var metadata = session.metadata || {};
  var cost = buildCostAnalysis(events, metadata);
  return [
    { label: "Events", value: events.length },
    { label: "Tools", value: metadata.totalToolCalls || events.filter(function (event) { return event.track === "tool_call"; }).length },
    { label: "Tokens", value: metadata.tokenUsage ? formatTokens(metadata.tokenUsage.inputTokens || 0) + " in" : "--" },
    { label: cost.totals && cost.totals.costUnit === "ai_credits" ? "Credits" : "Cost", value: cost.totals && cost.totals.cost > 0 ? formatCostValue(cost.totals.cost, cost.totals.costUnit) : "--" },
  ];
}

function AnalyzeSummaryBar({ summary, activePanelId, onSelectPanel }) {
  var suggestions = [
    { id: "cost", label: "Review token spend", show: summary.some(function (item) { return item.label === "Tokens" && item.value !== "--"; }) },
    { id: "waterfall", label: "Inspect tool timing", show: summary.some(function (item) { return item.label === "Tools" && item.value > 0; }) },
    { id: "graph", label: "Map turn flow", show: true },
  ].filter(function (item) { return item.show && item.id !== activePanelId; });

  return (
    <div style={{
      flexShrink: 0,
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: theme.space.lg,
      padding: theme.space.md + "px " + theme.space.xl + "px",
      borderBottom: "1px solid " + theme.border.default,
      background: theme.bg.surface,
      minWidth: 0,
    }}>
      <div style={{ display: "flex", gap: theme.space.md, flexWrap: "wrap", minWidth: 0 }}>
        {summary.map(function (item) {
          return (
            <div key={item.label} style={{
              border: "1px solid " + theme.border.default,
              borderRadius: theme.radius.md,
              background: theme.bg.base,
              padding: "5px 8px",
              minWidth: 86,
            }}>
              <div style={{ color: theme.text.primary, fontFamily: theme.font.mono, fontSize: theme.fontSize.sm, fontWeight: 700 }}>
                {item.value}
              </div>
              <div style={{ color: theme.text.dim, fontSize: theme.fontSize.xs, marginTop: 2 }}>
                {item.label}
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: theme.space.sm, flexWrap: "wrap", justifyContent: "flex-end", flexShrink: 0 }}>
        {suggestions.map(function (item) {
          return (
            <ToolbarButton key={item.id} onClick={function () { onSelectPanel(item.id); }}>
              {item.label}
            </ToolbarButton>
          );
        })}
      </div>
    </div>
  );
}

export default function AnalyzeShell({ session, autonomyMetrics, targetPanelId, onNavigate }) {
  var pb = usePlaybackContext();
  var breakpoint = useBreakpoint();
  var [panelId, setPanelId] = usePersistentState("agentviz:v2:analyze-panel", "stats");
  var activePanelId = isValidPanel(panelId) ? panelId : "stats";
  var activePanel = getPanel(activePanelId);

  useEffect(function () {
    if (isValidPanel(targetPanelId)) setPanelId(targetPanelId);
  }, [targetPanelId, setPanelId]);

  var summary = getAnalyzeSummary(session, pb);

  function selectPanel(nextPanelId) {
    if (!isValidPanel(nextPanelId)) return;
    setPanelId(nextPanelId);
    if (onNavigate) onNavigate("analyze", { panelId: nextPanelId });
  }

  return (
    <main style={{
      flex: 1,
      minWidth: 0,
      minHeight: 0,
      display: "flex",
      flexDirection: "column",
      background: theme.bg.base,
      overflow: "hidden",
    }}>
      <V2ZoneHeader
        eyebrow="Analyze"
        title="Analysis panels"
        description={activePanel.description}
        actions={(
          <ToolbarButton onClick={function () { if (onNavigate) onNavigate("review"); }}>
            Back to Review
          </ToolbarButton>
        )}
      />

      <AnalyzeSummaryBar summary={summary} activePanelId={activePanelId} onSelectPanel={selectPanel} />

      <div style={{
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        gap: theme.space.sm,
        padding: theme.space.md + "px " + theme.space.xl + "px",
        borderBottom: "1px solid " + theme.border.default,
        background: theme.bg.base,
        overflowX: "auto",
      }}
      role="tablist"
      aria-label="Analysis panels"
      >
        {ANALYZE_PANELS.map(function (panel) {
          var active = activePanelId === panel.id;
          return (
            <button
              key={panel.id}
              type="button"
              className="av-btn"
              role="tab"
              aria-pressed={active}
              aria-selected={active}
              onClick={function () { selectPanel(panel.id); }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: theme.space.sm,
                border: "1px solid " + (active ? theme.accent.primary : theme.border.default),
                borderRadius: theme.radius.md,
                background: active ? theme.accent.muted : theme.bg.surface,
                color: active ? theme.accent.primary : theme.text.muted,
                padding: "6px 10px",
                cursor: "pointer",
                fontFamily: theme.font.mono,
                fontSize: theme.fontSize.sm,
                whiteSpace: "nowrap",
              }}
            >
              <Icon name={panel.icon} size={12} />
              {panel.label}
            </button>
          );
        })}
      </div>

      <section style={{
        flex: 1,
        minHeight: 0,
        overflow: "hidden",
        padding: theme.space.lg + "px " + (breakpoint.isCompact ? theme.space.lg : theme.space.xl) + "px " + (breakpoint.isCompact ? theme.space.lg : theme.space.xl) + "px",
      }}>
        <div style={{
          height: "100%",
          minHeight: 0,
          border: "1px solid " + theme.border.default,
          borderRadius: theme.radius.xxl,
          background: theme.bg.surface,
          overflow: "hidden",
          padding: activePanelId === "stats" || activePanelId === "cost" ? theme.space.md : 0,
        }}>
          {renderPanel(activePanelId, session, pb, autonomyMetrics, onNavigate)}
        </div>
      </section>
    </main>
  );
}
