import { FONT, TRACK_TYPES, ERROR_COLOR } from "../lib/constants.js";

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
  var assistOut = events.filter(function (e) { return e.agent === "assistant" && e.track === "output"; }).length;
  var errorCount = metadata ? metadata.errorCount : events.filter(function (e) { return e.isError; }).length;

  var cards = [
    { label: "Total Events", value: events.length, color: "#e2e8f0" },
    { label: "Turns", value: metadata ? metadata.totalTurns : (turns ? turns.length : 0), color: "#22d3ee" },
    { label: "User Messages", value: userMsgs, color: "#60a5fa" },
    { label: "Tool Calls", value: (trackStats.tool_call || {}).count || 0, color: "#f59e0b" },
    { label: "Errors", value: errorCount, color: errorCount > 0 ? ERROR_COLOR : "#334155" },
    { label: "Duration", value: totalTime.toFixed(0) + "s", color: "#a78bfa" },
  ];

  return (
    <div style={{ display: "flex", gap: 24, height: "100%", padding: "8px 0", overflow: "auto" }}>
      {/* Left column */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ fontSize: 10, color: "#475569", textTransform: "uppercase", letterSpacing: 2 }}>
          Session Overview
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
          {cards.map(function (c) {
            return (
              <div key={c.label} style={{
                background: "#0f172a", borderRadius: 8, padding: "14px 16px",
                border: "1px solid #1e293b",
              }}>
                <div style={{ fontSize: 22, fontWeight: 700, color: c.color, fontFamily: FONT }}>
                  {c.value}
                </div>
                <div style={{ fontSize: 10, color: "#64748b", marginTop: 4 }}>{c.label}</div>
              </div>
            );
          })}
        </div>

        {/* Model info */}
        {metadata && metadata.primaryModel && (
          <div style={{
            background: "#0f172a", borderRadius: 8, padding: "12px 16px",
            border: "1px solid #1e293b", display: "flex", gap: 20, alignItems: "center",
          }}>
            <div>
              <div style={{ fontSize: 10, color: "#475569", textTransform: "uppercase", letterSpacing: 2, marginBottom: 4 }}>
                Model
              </div>
              <div style={{ fontSize: 13, color: "#a78bfa", fontFamily: FONT }}>
                {metadata.primaryModel}
              </div>
            </div>
            {metadata.tokenUsage && (
              <div style={{ borderLeft: "1px solid #1e293b", paddingLeft: 20 }}>
                <div style={{ fontSize: 10, color: "#475569", textTransform: "uppercase", letterSpacing: 2, marginBottom: 4 }}>
                  Tokens
                </div>
                <div style={{ fontSize: 12, color: "#94a3b8", fontFamily: FONT }}>
                  <span style={{ color: "#22d3ee" }}>{metadata.tokenUsage.inputTokens.toLocaleString()}</span>
                  {" in / "}
                  <span style={{ color: "#34d399" }}>{metadata.tokenUsage.outputTokens.toLocaleString()}</span>
                  {" out"}
                </div>
              </div>
            )}
            {Object.keys(metadata.models).length > 1 && (
              <div style={{ borderLeft: "1px solid #1e293b", paddingLeft: 20 }}>
                <div style={{ fontSize: 10, color: "#475569", textTransform: "uppercase", letterSpacing: 2, marginBottom: 4 }}>
                  All Models
                </div>
                <div style={{ fontSize: 11, color: "#64748b" }}>
                  {Object.entries(metadata.models).map(function (e) { return e[0].split("-").slice(0,3).join("-") + " (" + e[1] + ")"; }).join(", ")}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Track distribution bars */}
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 10, color: "#475569", textTransform: "uppercase", letterSpacing: 2, marginBottom: 12 }}>
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
                  <span style={{ fontSize: 11, color: info.color, display: "flex", alignItems: "center", gap: 5 }}>
                    {info.icon} {info.label}
                  </span>
                  <span style={{ fontSize: 11, color: "#64748b" }}>{count} ({pct.toFixed(0)}%)</span>
                </div>
                <div style={{ height: 6, background: "#0a0f1e", borderRadius: 3 }}>
                  <div style={{
                    height: "100%", width: pct + "%", background: info.color,
                    borderRadius: 3, transition: "width 0.4s",
                  }} />
                </div>
              </div>
            );
          })}
        </div>

        {/* Turn summary */}
        {turns && turns.length > 0 && (
          <div>
            <div style={{ fontSize: 10, color: "#475569", textTransform: "uppercase", letterSpacing: 2, marginBottom: 12 }}>
              Turns
            </div>
            {turns.map(function (turn) {
              return (
                <div key={turn.index} style={{
                  display: "flex", gap: 10, padding: "6px 10px", borderRadius: 6,
                  background: turn.hasError ? ERROR_COLOR + "08" : "#0f172a",
                  border: "1px solid " + (turn.hasError ? ERROR_COLOR + "30" : "#1e293b"),
                  marginBottom: 6, alignItems: "center",
                }}>
                  <span style={{ fontSize: 11, color: "#475569", fontWeight: 600, minWidth: 20 }}>
                    {turn.index + 1}
                  </span>
                  <span style={{
                    fontSize: 11, color: "#94a3b8", flex: 1,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>
                    {turn.userMessage}
                  </span>
                  {turn.toolCount > 0 && (
                    <span style={{ fontSize: 10, color: "#f59e0b" }}>{turn.toolCount} tools</span>
                  )}
                  {turn.hasError && (
                    <span style={{ fontSize: 10, color: ERROR_COLOR }}>{"\u25CF"}</span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Right column - tool ranking */}
      <div style={{ width: 280, borderLeft: "1px solid #1e293b", paddingLeft: 20 }}>
        <div style={{ fontSize: 10, color: "#475569", textTransform: "uppercase", letterSpacing: 2, marginBottom: 12 }}>
          Tool Usage Ranking
        </div>
        {sortedTools.length === 0 && (
          <div style={{ fontSize: 12, color: "#475569", fontStyle: "italic" }}>No tool calls detected</div>
        )}
        {sortedTools.map(function (pair, i) {
          var name = pair[0];
          var count = pair[1];
          var maxCount = sortedTools[0][1];
          var pct = (count / maxCount) * 100;
          return (
            <div key={name} style={{ marginBottom: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                <span style={{ fontSize: 11, color: "#f59e0b", fontFamily: FONT }}>
                  {i + 1}. {name}
                </span>
                <span style={{ fontSize: 11, color: "#64748b" }}>{count}x</span>
              </div>
              <div style={{ height: 4, background: "#0a0f1e", borderRadius: 2 }}>
                <div style={{
                  height: "100%", width: pct + "%",
                  background: "linear-gradient(90deg, #f59e0b, #f59e0b80)",
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
