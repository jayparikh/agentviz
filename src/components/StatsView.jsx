import { theme, TRACK_TYPES } from "../lib/theme.js";
import Icon from "./Icon.jsx";
import { estimateCost, formatCost } from "../lib/pricing.js";
import { formatDurationLong } from "../lib/formatTime.js";
import ToolbarButton from "./ui/ToolbarButton.jsx";
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
      <div style={{ fontSize: theme.fontSize.lg, color: color, fontFamily: theme.font.ui, fontWeight: 700 }}>{value}</div>
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
          zIndex: 100,
          pointerEvents: "none",
          boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
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

  var userMsgs = events.filter(function (e) { return e.agent === "user"; }).length;
  var errorCount = metadata ? metadata.errorCount : events.filter(function (e) { return e.isError; }).length;

  // Aggregate token usage per turn
  var turnTokenMap = {};
  events.forEach(function (e) {
    if (e.tokenUsage && e.turnIndex !== undefined) {
      var t = turnTokenMap[e.turnIndex] || { inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheWrite: 0 };
      t.inputTokens += e.tokenUsage.inputTokens || 0;
      t.outputTokens += e.tokenUsage.outputTokens || 0;
      t.cacheRead += e.tokenUsage.cacheRead || 0;
      t.cacheWrite += e.tokenUsage.cacheWrite || 0;
      turnTokenMap[e.turnIndex] = t;
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
    <div style={{ display: "flex", gap: 24, height: "100%", padding: "8px 0", overflow: "hidden" }}>
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 16, overflowY: "auto", overflowX: "hidden" }}>
        <div style={{ fontSize: theme.fontSize.xs, color: theme.text.dim, textTransform: "uppercase", letterSpacing: 2 }}>
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
                <div style={{ fontSize: 22, fontWeight: 700, color: card.color, fontFamily: theme.font.ui }}>
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
                <div style={{ fontSize: theme.fontSize.xs, color: theme.text.dim, textTransform: "uppercase", letterSpacing: 2 }}>
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
          <div style={{
            background: theme.bg.surface,
            borderRadius: theme.radius.xl,
            padding: "12px 16px",
            border: "1px solid " + theme.border.default,
            display: "flex",
            gap: 20,
            alignItems: "center",
          }}>
            <div>
              <div style={{ fontSize: theme.fontSize.xs, color: theme.text.dim, textTransform: "uppercase", letterSpacing: 2, marginBottom: 4 }}>
                Model
              </div>
              <div style={{ fontSize: theme.fontSize.lg, color: theme.track.context, fontFamily: theme.font.mono }}>
                {metadata.primaryModel}
              </div>
            </div>
            {metadata.tokenUsage && (metadata.tokenUsage.inputTokens + metadata.tokenUsage.outputTokens) > 0 && (
              <div style={{ borderLeft: "1px solid " + theme.border.default, paddingLeft: 20 }}>
                <div style={{ fontSize: theme.fontSize.xs, color: theme.text.dim, textTransform: "uppercase", letterSpacing: 2, marginBottom: 4 }}>
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
            {metadata.tokenUsage && (metadata.tokenUsage.inputTokens + metadata.tokenUsage.outputTokens) > 0 && (
              <div style={{ borderLeft: "1px solid " + theme.border.default, paddingLeft: 20 }}>
                <div style={{ fontSize: theme.fontSize.xs, color: theme.text.dim, textTransform: "uppercase", letterSpacing: 2, marginBottom: 4 }}>
                  Est. Cost
                </div>
                <div style={{ fontSize: theme.fontSize.lg, color: theme.semantic.success, fontFamily: theme.font.mono, fontWeight: 600 }}>
                  {formatCost(estimateCost(metadata.tokenUsage, metadata.primaryModel))}
                </div>
                <div style={{ fontSize: theme.fontSize.xs, color: theme.text.muted, marginTop: 2 }}>
                  based on {metadata.primaryModel ? metadata.primaryModel.split("-").slice(0, 3).join("-") : "default"} pricing
                </div>
              </div>
            )}
            {Object.keys(metadata.models).length > 1 && (
              <div style={{ borderLeft: "1px solid " + theme.border.default, paddingLeft: 20 }}>
                <div style={{ fontSize: theme.fontSize.xs, color: theme.text.dim, textTransform: "uppercase", letterSpacing: 2, marginBottom: 4 }}>
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
        )}

        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: theme.fontSize.xs, color: theme.text.dim, textTransform: "uppercase", letterSpacing: 2, marginBottom: 12 }}>
            Event Distribution
          </div>
          {Object.entries(TRACK_TYPES).map(function (entry) {
            var key = entry[0];
            var info = entry[1];
            var count = (trackStats[key] || {}).count || 0;
            var pct = events.length > 0 ? (count / events.length) * 100 : 0;
            return (
              <div key={key} style={{ marginBottom: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ fontSize: theme.fontSize.base, color: info.color, display: "flex", alignItems: "center", gap: 5 }}>
                    <Icon name={key} size={13} /> {info.label}
                  </span>
                  <span style={{ fontSize: theme.fontSize.base, color: theme.text.muted }}>{count} ({pct.toFixed(0)}%)</span>
                </div>
                <div style={{ height: 6, background: theme.bg.base, borderRadius: 3 }}>
                  <div style={{
                    height: "100%",
                    width: pct + "%",
                    background: info.color,
                    borderRadius: 3,
                    transition: "width 0.4s",
                  }} />
                </div>
              </div>
            );
          })}
        </div>

        {turns && turns.length > 0 && (
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <div style={{ fontSize: theme.fontSize.xs, color: theme.text.dim, textTransform: "uppercase", letterSpacing: 2 }}>
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

      <div style={{ width: 240, flexShrink: 0, borderLeft: "1px solid " + theme.border.default, paddingLeft: 20, overflowY: "auto" }}>
        <div style={{ fontSize: theme.fontSize.xs, color: theme.text.dim, textTransform: "uppercase", letterSpacing: 2, marginBottom: 12 }}>
          Tool Usage Ranking
        </div>
        {sortedTools.length === 0 && (
          <div style={{ fontSize: theme.fontSize.md, color: theme.text.dim, fontStyle: "italic" }}>No tool calls detected</div>
        )}
        {sortedTools.map(function (pair, i) {
          var name = pair[0];
          var count = pair[1];
          var maxCount = sortedTools[0][1];
          var pct = (count / maxCount) * 100;
          return (
            <div key={name} style={{ marginBottom: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                <span style={{ fontSize: theme.fontSize.base, color: theme.track.tool_call, fontFamily: theme.font.mono }}>
                  {i + 1}. {name}
                </span>
                <span style={{ fontSize: theme.fontSize.base, color: theme.text.muted }}>{count}x</span>
              </div>
              <div style={{ height: 4, background: theme.bg.base, borderRadius: 2 }}>
                <div style={{
                  height: "100%",
                  width: pct + "%",
                  background: theme.track.tool_call,
                  borderRadius: 2,
                }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
