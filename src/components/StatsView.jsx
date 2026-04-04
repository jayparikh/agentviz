import { theme, TRACK_TYPES, alpha } from "../lib/theme.js";
import Icon from "./Icon.jsx";
import { estimateCost, estimateMultiModelCost, formatCost, hasModelPricing } from "../lib/pricing.js";
import { formatDurationLong } from "../lib/formatTime.js";
import ToolbarButton from "./ui/ToolbarButton.jsx";
import ResizablePanel from "./ResizablePanel.jsx";
import { buildAutonomySummary } from "../lib/autonomyMetrics.js";
import { useState } from "react";

function MetricCard({ value, label, tooltip, color }) {
  var [hovered, setHovered] = useState(false);
  return (
    <div
      style={{ border: "1px solid " + theme.border.default, borderRadius: theme.radius.lg, padding: "12px 14px", background: theme.bg.base, cursor: "default", position: "relative" }}
      onMouseEnter={function () { setHovered(true); }}
      onMouseLeave={function () { setHovered(false); }}
    >
      <div style={{ fontSize: theme.fontSize.lg, color: color, fontFamily: theme.font.mono, fontWeight: 700 }}>{value}</div>
      <div style={{ fontSize: theme.fontSize.xs, color: theme.text.muted, marginTop: 4 }}>{label}</div>
      {hovered && tooltip && (
        <div style={{
          position: "absolute",
          bottom: "calc(100% + 8px)",
          left: "50%",
          transform: "translateX(-50%)",
          background: theme.bg.overlay || theme.bg.surface,
          border: "1px solid " + theme.border.default,
          borderRadius: theme.radius.lg,
          padding: "8px 12px",
          fontSize: theme.fontSize.xs,
          color: theme.text.secondary,
          whiteSpace: "normal",
          width: 220,
          lineHeight: 1.5,
          zIndex: theme.z.modal,
          pointerEvents: "none",
          boxShadow: theme.shadow.md,
        }}>
          {tooltip}
        </div>
      )}
    </div>
  );
}

export default function StatsView({ events, totalTime, metadata, turns, autonomyMetrics, onOpenCoach }) {
  var [showAllTurns, setShowAllTurns] = useState(false);
  var TURNS_PREVIEW = 15;

  var trackStats = {};
  events.forEach(function (e) {
    if (!trackStats[e.track]) trackStats[e.track] = { count: 0 };
    trackStats[e.track].count++;
  });

  var toolStats = {};
  events.forEach(function (e) {
    if (e.toolName) toolStats[e.toolName] = (toolStats[e.toolName] || 0) + 1;
  });
  var sortedTools = Object.entries(toolStats).sort(function (a, b) { return b[1] - a[1]; });

  // Compute subagent stats
  var agentStats = {};
  events.forEach(function (e) {
    if (e.agentName) {
      if (!agentStats[e.agentName]) {
        agentStats[e.agentName] = { count: 0, totalDuration: 0, displayName: e.agentDisplayName || e.agentName, errors: 0 };
      }
      agentStats[e.agentName].count++;
      if (e.track === "agent" && e.duration > 0) agentStats[e.agentName].totalDuration += e.duration;
      if (e.isError) agentStats[e.agentName].errors++;
    }
  });
  var agentEntries = Object.entries(agentStats).sort(function (a, b) { return b[1].count - a[1].count; });
  var totalAgentEvents = agentEntries.reduce(function (sum, e) { return sum + e[1].count; }, 0);

  var userMsgs = events.filter(function (e) { return e.agent === "user"; }).length;
  var errorCount = metadata ? metadata.errorCount : events.filter(function (e) { return e.isError; }).length;

  // Aggregate token usage per turn
  var turnTokenMap = {};
  var modelTokenMap = {};
  events.forEach(function (e) {
    if (e.tokenUsage) {
      if (e.turnIndex !== undefined) {
        var t = turnTokenMap[e.turnIndex] || { inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheWrite: 0 };
        t.inputTokens += e.tokenUsage.inputTokens || 0;
        t.outputTokens += e.tokenUsage.outputTokens || 0;
        t.cacheRead += e.tokenUsage.cacheRead || 0;
        t.cacheWrite += e.tokenUsage.cacheWrite || 0;
        turnTokenMap[e.turnIndex] = t;
      }
      // Bucket by model; fall back to primaryModel for events without a model field
      var modelKey = e.model || (metadata && metadata.primaryModel) || "__unknown__";
      var m = modelTokenMap[modelKey] || { inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheWrite: 0 };
      m.inputTokens += e.tokenUsage.inputTokens || 0;
      m.outputTokens += e.tokenUsage.outputTokens || 0;
      m.cacheRead += e.tokenUsage.cacheRead || 0;
      m.cacheWrite += e.tokenUsage.cacheWrite || 0;
      modelTokenMap[modelKey] = m;
    }
  });

  var cards = [
    { label: "Total Events", value: events.length, color: theme.text.primary },
    { label: "Turns", value: metadata ? metadata.totalTurns : (turns ? turns.length : 0), color: theme.accent.primary },
    { label: "User Messages", value: userMsgs, color: theme.accent.primary },
    { label: "Tool Calls", value: (trackStats.tool_call || {}).count || 0, color: theme.track.tool_call },
    { label: "Errors", value: errorCount, color: errorCount > 0 ? theme.semantic.error : theme.text.ghost },
    { label: "Duration", value: formatDurationLong(totalTime), color: theme.track.context },
  ];
  var autonomySummary = buildAutonomySummary(autonomyMetrics);

  function getAutonomyItemColor(label) {
    if (!autonomyMetrics) return theme.accent.primary;

    if (label === "Autonomy efficiency") {
      var eff = autonomyMetrics.autonomyEfficiency;
      if (eff == null) return theme.accent.primary;
      if (eff >= 0.7) return theme.semantic.success;
      if (eff >= 0.4) return theme.accent.primary;
      return theme.semantic.error;
    }

    if (label === "Human response time") {
      var bt = autonomyMetrics.babysittingTime || 0;
      if (bt > 60) return theme.semantic.error;
      if (bt > 15) return theme.accent.primary;
      return theme.semantic.success;
    }

    if (label === "Idle time") {
      var it = autonomyMetrics.idleTime || 0;
      if (it > 90) return theme.semantic.error;
      if (it > 30) return theme.accent.primary;
      return theme.semantic.success;
    }

    return theme.accent.primary;
  }

  return (
    <ResizablePanel initialSplit={0.72} minPx={200} direction="horizontal">
      <div style={{ height: "100%", display: "flex", flexDirection: "column", gap: theme.space.xl, overflowY: "auto", overflowX: "hidden", padding: theme.space.md + "px 0" }}>
        <div style={{ fontSize: theme.fontSize.xs, color: theme.text.dim, textTransform: "uppercase", letterSpacing: 1 }}>
          Session Overview
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
          {cards.map(function (card) {
            return (
              <div key={card.label} style={{
                background: theme.bg.surface,
                borderRadius: theme.radius.xl,
                padding: "14px 16px",
                border: "1px solid " + theme.border.default,
              }}>
                <div style={{ fontSize: theme.fontSize.xxl, fontWeight: 700, color: card.color, fontFamily: theme.font.mono }}>
                  {card.value}
                </div>
                <div style={{ fontSize: theme.fontSize.xs, color: theme.text.muted, marginTop: 4 }}>{card.label}</div>
              </div>
            );
          })}
        </div>

        {autonomySummary.length > 0 && (
          <div style={{
            background: theme.bg.surface,
            borderRadius: theme.radius.xl,
            padding: "14px 16px",
            border: "1px solid " + theme.border.default,
          }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: theme.fontSize.xs, color: theme.text.dim, textTransform: "uppercase", letterSpacing: 1 }}>
                  Autonomy Metrics
                </div>
                <div style={{ fontSize: theme.fontSize.md, color: theme.text.secondary, marginTop: 6 }}>
                  Get improvement recommendations
                </div>
              </div>
              {onOpenCoach && (
                <ToolbarButton
                  onClick={onOpenCoach}
                  style={{
                    color: theme.accent.primary,
                    borderColor: theme.accent.primary,
                    background: theme.accent.muted,
                    flexShrink: 0,
                  }}
                >
                  Coach this session
                </ToolbarButton>
              )}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: 10 }}>
              {autonomySummary.map(function (item) {
                return (
                  <MetricCard
                    key={item.label}
                    value={item.value}
                    label={item.label}
                    tooltip={item.tooltip}
                    color={getAutonomyItemColor(item.label)}
                  />
                );
              })}
            </div>
          </div>
        )}

        {metadata && metadata.primaryModel && (
          <div>
          <div style={{ fontSize: theme.fontSize.xs, color: theme.text.dim, textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>
            Model &amp; Usage
          </div>
          <div style={{
            background: theme.bg.surface,
            borderRadius: theme.radius.xl,
            padding: "12px 16px",
            border: "1px solid " + theme.border.default,
            display: "flex",
            gap: 20,
            alignItems: "flex-start",
          }}>
            <div>
              <div style={{ fontSize: theme.fontSize.xs, color: theme.text.dim, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>
                Model
              </div>
              <div style={{ fontSize: theme.fontSize.lg, color: theme.track.context, fontFamily: theme.font.mono }}>
                {metadata.primaryModel}
              </div>
            </div>
            {metadata.tokenUsage && (metadata.tokenUsage.inputTokens + metadata.tokenUsage.outputTokens) > 0 && (
              <div style={{ borderLeft: "1px solid " + theme.border.default, paddingLeft: 20 }}>
                <div style={{ fontSize: theme.fontSize.xs, color: theme.text.dim, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>
                  Tokens
                </div>
                <div style={{ fontSize: theme.fontSize.base, color: theme.text.secondary, fontFamily: theme.font.mono }}>
                  <span style={{ color: theme.accent.primary }}>{metadata.tokenUsage.inputTokens.toLocaleString()}</span>
                  {" in / "}
                  <span style={{ color: theme.semantic.success }}>{metadata.tokenUsage.outputTokens.toLocaleString()}</span>
                  {" out"}
                </div>
                {metadata.tokenUsage.cacheRead > 0 && (
                  <div style={{ fontSize: theme.fontSize.xs, color: theme.text.muted, fontFamily: theme.font.mono, marginTop: 2 }}>
                    {metadata.tokenUsage.cacheRead.toLocaleString()} cache read
                  </div>
                )}
              </div>
            )}
            {(function () {
              var hasTokens = metadata.tokenUsage && (metadata.tokenUsage.inputTokens + metadata.tokenUsage.outputTokens) > 0;
              var hasApiCost = metadata.totalCost != null;
              if (!hasTokens && !hasApiCost) return null;
              // Prefer per-model breakdown from parser (accurate); fall back to event-level aggregation
              var perModelData = metadata.modelTokenUsage || (Object.keys(modelTokenMap).length > 0 ? modelTokenMap : null);
              var modelKeys = perModelData ? Object.keys(perModelData) : [];
              var modelCount = modelKeys.length;
              var pricedCount = modelKeys.filter(function (k) { return hasModelPricing(k); }).length;
              // Use per-model pricing when available (works for single and multi-model)
              var estimated = perModelData
                ? estimateMultiModelCost(perModelData)
                : estimateCost(metadata.tokenUsage, metadata.primaryModel);
              var modelLabel;
              if (modelCount > 1) {
                modelLabel = pricedCount < modelCount
                  ? pricedCount + " of " + modelCount + " models"
                  : modelCount + " models";
              } else if (modelCount === 1) {
                modelLabel = modelKeys[0].split("-").slice(0, 3).join("-") + " pricing";
              } else {
                modelLabel = (metadata.primaryModel ? metadata.primaryModel.split("-").slice(0, 3).join("-") : "default") + " pricing";
              }
              return (
              <>
              {hasApiCost && (
              <div style={{ borderLeft: "1px solid " + theme.border.default, paddingLeft: 20 }}>
                <div style={{ fontSize: theme.fontSize.xs, color: theme.text.dim, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>
                  Cost
                </div>
                <div style={{ fontSize: theme.fontSize.lg, color: theme.semantic.success, fontFamily: theme.font.mono, fontWeight: 600 }}>
                  {formatCost(metadata.totalCost)}
                </div>
                <div style={{ fontSize: theme.fontSize.xs, color: theme.text.muted, marginTop: 2 }}>
                  reported by API
                </div>
              </div>
              )}
              {estimated > 0 && (
              <div style={{ borderLeft: "1px solid " + theme.border.default, paddingLeft: 20 }}>
                <div style={{ fontSize: theme.fontSize.xs, color: theme.text.dim, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>
                  Est. Cost
                </div>
                <div style={{ fontSize: theme.fontSize.lg, color: hasApiCost ? theme.text.muted : theme.semantic.success, fontFamily: theme.font.mono, fontWeight: 600 }}>
                  {formatCost(estimated)}
                </div>
                <div style={{ fontSize: theme.fontSize.xs, color: theme.text.muted, marginTop: 2 }}>
                  based on {modelLabel}
                </div>
              </div>
              )}
              </>
              );
            })()}
            {Object.keys(metadata.models).length > 1 && (
              <div style={{ borderLeft: "1px solid " + theme.border.default, paddingLeft: 20 }}>
                <div style={{ fontSize: theme.fontSize.xs, color: theme.text.dim, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>
                  All Models
                </div>
                <div style={{ fontSize: theme.fontSize.sm, color: theme.text.muted }}>
                  {Object.entries(metadata.models).map(function (entry) {
                    return entry[0].split("-").slice(0, 3).join("-") + " (" + entry[1] + ")";
                  }).join(", ")}
                </div>
              </div>
            )}
          </div>
          </div>
        )}

        {agentEntries.length > 0 && (
          <div>
            <div style={{ fontSize: theme.fontSize.xs, color: theme.text.dim, textTransform: "uppercase", letterSpacing: 1, marginBottom: theme.space.lg }}>
              Subagents ({agentEntries.length})
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: theme.space.md }}>
              {agentEntries.map(function (entry) {
                var name = entry[0];
                var stats = entry[1];
                var agentColor = theme.agentType[name] || theme.agentType.default;
                return (
                  <div key={name} style={{
                    border: "1px solid " + alpha(agentColor, 0.3),
                    borderRadius: theme.radius.lg,
                    padding: theme.space.lg + "px " + theme.space.lg + "px",
                    background: alpha(agentColor, 0.04),
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: theme.space.sm, marginBottom: theme.space.sm }}>
                      <div style={{ width: 8, height: 8, borderRadius: theme.radius.full, background: agentColor }} />
                      <span style={{ fontSize: theme.fontSize.base, color: agentColor, fontWeight: 600, fontFamily: theme.font.mono }}>{stats.displayName}</span>
                    </div>
                    <div style={{ fontSize: theme.fontSize.xs, color: theme.text.muted, display: "flex", gap: theme.space.lg }}>
                      <span>{stats.count} events</span>
                      {stats.totalDuration > 0 && <span>{formatDurationLong(stats.totalDuration)}</span>}
                      {stats.errors > 0 && <span style={{ color: theme.semantic.error }}>{stats.errors} errors</span>}
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{ fontSize: theme.fontSize.xs, color: theme.text.dim, marginTop: theme.space.md }}>
              {totalAgentEvents} events across {agentEntries.length} agent type{agentEntries.length !== 1 ? "s" : ""}
            </div>
          </div>
        )}

        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: theme.fontSize.xs, color: theme.text.dim, textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>
            Event Distribution
          </div>
          {Object.entries(TRACK_TYPES).map(function (entry) {
            var key = entry[0];
            var info = entry[1];
            var count = (trackStats[key] || {}).count || 0;
            if (count === 0) return null;
            var pct = events.length > 0 ? (count / events.length) * 100 : 0;
            return (
              <div key={key} style={{ marginBottom: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ fontSize: theme.fontSize.base, color: info.color, display: "flex", alignItems: "center", gap: 5 }}>
                    <Icon name={key} size={13} /> {info.label}
                  </span>
                  <span style={{ fontSize: theme.fontSize.base, color: theme.text.muted }}>{count} ({pct.toFixed(0)}%)</span>
                </div>
                <div style={{ height: 6, background: theme.bg.base, borderRadius: theme.radius.sm }}>
                  <div style={{
                    height: "100%",
                    width: pct + "%",
                    background: info.color,
                    borderRadius: theme.radius.sm,
                    transition: "width " + theme.transition.smooth,
                  }} />
                </div>
              </div>
            );
          })}
        </div>

        {turns && turns.length > 0 && (
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <div style={{ fontSize: theme.fontSize.xs, color: theme.text.dim, textTransform: "uppercase", letterSpacing: 1 }}>
                Turns ({turns.length})
              </div>
              {turns.length > TURNS_PREVIEW && (
                <button className="av-btn" onClick={function () { setShowAllTurns(function (v) { return !v; }); }} style={{ fontSize: theme.fontSize.xs, color: theme.accent.primary, background: "transparent", border: "none", cursor: "pointer", padding: 0 }}>
                  {showAllTurns ? "Show less" : "Show all " + turns.length}
                </button>
              )}
            </div>
            {(showAllTurns ? turns : turns.slice(0, TURNS_PREVIEW)).map(function (turn) {
              return (
                <div key={turn.index} style={{
                  display: "flex",
                  gap: 10,
                  padding: "6px 10px",
                  borderRadius: theme.radius.lg,
                  background: turn.hasError ? theme.semantic.errorBg : theme.bg.surface,
                  border: "1px solid " + (turn.hasError ? theme.semantic.errorBorder : theme.border.default),
                  marginBottom: 6,
                  alignItems: "center",
                }}>
                  <span style={{ fontSize: theme.fontSize.base, color: theme.text.dim, fontWeight: 600, minWidth: 20, flexShrink: 0 }}>
                    {turn.index + 1}
                  </span>
                  <span style={{
                    fontSize: theme.fontSize.base,
                    color: theme.text.secondary,
                    flex: 1,
                    minWidth: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}>
                    {turn.userMessage || "(no message)"}
                  </span>
                  {turn.toolCount > 0 && (
                    <span style={{ fontSize: theme.fontSize.xs, color: theme.track.tool_call, flexShrink: 0 }}>{turn.toolCount} tools</span>
                  )}
                  {turnTokenMap[turn.index] && (
                    <span style={{ fontSize: theme.fontSize.xs, color: theme.text.muted, fontFamily: theme.font.mono, flexShrink: 0 }}>
                      {formatCost(estimateCost(turnTokenMap[turn.index], metadata && metadata.primaryModel))}
                    </span>
                  )}
                  {turn.hasError && (
                    <span style={{ fontSize: theme.fontSize.xs, color: theme.semantic.error, display: "inline-flex", alignItems: "center", flexShrink: 0 }}><Icon name="alert-circle" size={11} /></span>
                  )}
                </div>
              );
            })}
            {!showAllTurns && turns.length > TURNS_PREVIEW && (
              <div style={{ fontSize: theme.fontSize.xs, color: theme.text.dim, textAlign: "center", padding: "6px 0" }}>
                {turns.length - TURNS_PREVIEW} more turns hidden
              </div>
            )}
          </div>
        )}
      </div>

      <div style={{ height: "100%", overflowY: "auto", padding: theme.space.lg }}>
        <div style={{ fontSize: theme.fontSize.xs, color: theme.text.dim, textTransform: "uppercase", letterSpacing: 1, marginBottom: theme.space.md }}>
          Tools Used
        </div>
        {sortedTools.length === 0 && (
          <div style={{ fontSize: theme.fontSize.sm, color: theme.text.dim, fontStyle: "italic" }}>No tool calls detected</div>
        )}
        {sortedTools.map(function (pair, i) {
          var name = pair[0];
          var count = pair[1];
          var maxCount = sortedTools[0][1];
          var pct = (count / maxCount) * 100;
          return (
            <div key={name} style={{ marginBottom: theme.space.md }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: theme.space.sm }}>
                <span style={{ fontSize: theme.fontSize.sm, color: theme.track.tool_call, fontFamily: theme.font.mono }}>
                  {i + 1}. {name}
                </span>
                <span style={{ fontSize: theme.fontSize.sm, color: theme.text.muted }}>{count}x</span>
              </div>
              <div style={{ height: 4, background: theme.bg.base, borderRadius: theme.radius.sm }}>
                <div style={{
                  height: "100%",
                  width: pct + "%",
                  background: theme.track.tool_call,
                  borderRadius: theme.radius.sm,
                }} />
              </div>
            </div>
          );
        })}
      </div>
    </ResizablePanel>
  );
}
