import { theme, TRACK_TYPES } from "../lib/theme.js";
import Icon from "./Icon.jsx";

export default function StatsView({ events, totalTime, metadata, turns }) {
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

  var cards = [
    { label: "Total Events", value: events.length, color: theme.text.primary },
    { label: "Turns", value: metadata ? metadata.totalTurns : (turns ? turns.length : 0), color: theme.accent.primary },
    { label: "User Messages", value: userMsgs, color: theme.accent.primary },
    { label: "Tool Calls", value: (trackStats.tool_call || {}).count || 0, color: theme.track.tool_call },
    { label: "Errors", value: errorCount, color: errorCount > 0 ? theme.semantic.error : theme.text.ghost },
    { label: "Duration", value: totalTime.toFixed(0) + "s", color: theme.track.context },
  ];

  return (
    <div style={{ display: "flex", gap: 24, height: "100%", padding: "8px 0", overflow: "auto" }}>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 16 }}>
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
            <div style={{ fontSize: theme.fontSize.xs, color: theme.text.dim, textTransform: "uppercase", letterSpacing: 2, marginBottom: 12 }}>
              Turns
            </div>
            {turns.map(function (turn) {
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
                  <span style={{ fontSize: theme.fontSize.base, color: theme.text.dim, fontWeight: 600, minWidth: 20 }}>
                    {turn.index + 1}
                  </span>
                  <span style={{
                    fontSize: theme.fontSize.base,
                    color: theme.text.secondary,
                    flex: 1,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}>
                    {turn.userMessage}
                  </span>
                  {turn.toolCount > 0 && (
                    <span style={{ fontSize: theme.fontSize.xs, color: theme.track.tool_call }}>{turn.toolCount} tools</span>
                  )}
                  {turn.hasError && (
                    <span style={{ fontSize: theme.fontSize.xs, color: theme.semantic.error, display: "inline-flex", alignItems: "center" }}><Icon name="alert-circle" size={11} /></span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div style={{ width: 280, borderLeft: "1px solid " + theme.border.default, paddingLeft: 20 }}>
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
