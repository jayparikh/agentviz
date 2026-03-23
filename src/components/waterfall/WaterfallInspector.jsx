import { useState } from "react";
import { theme } from "../../lib/theme.js";
import DataInspector from "../DataInspector.jsx";
import DiffViewer from "../DiffViewer.jsx";
import { isDiffViewable } from "../../lib/diffUtils.js";
import { formatDuration, formatTime } from "../../lib/formatTime.js";
import { getToolColor } from "../../lib/waterfall";

export default function WaterfallInspector({ selectedItem, stats }) {
  var selected = selectedItem ? selectedItem.event : null;
  var [showRaw, setShowRaw] = useState(false);
  var hasDiff = selected && isDiffViewable(selected);

  return (
    <div style={{
      height: "100%",
      overflow: "auto",
      background: theme.bg.surface,
      padding: theme.space.lg,
      display: "flex",
      flexDirection: "column",
      gap: theme.space.lg,
    }}>
      <div>
        <div style={{
          fontSize: theme.fontSize.xs,
          color: theme.text.dim,
          textTransform: "uppercase",
          letterSpacing: 1,
          marginBottom: theme.space.md,
        }}>
          Waterfall Stats
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: theme.space.sm }}>
          {[
            ["Total calls", stats.totalCalls],
            ["Max concurrency", stats.maxConcurrency],
            ["Max depth", stats.maxDepth],
            ["Longest tool", stats.longestTool || "n/a"],
          ].map(function (pair) {
            return (
              <div key={pair[0]} style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: theme.fontSize.sm,
              }}>
                <span style={{ color: theme.text.muted }}>{pair[0]}</span>
                <span style={{ color: theme.text.primary }}>{pair[1]}</span>
              </div>
            );
          })}
        </div>
      </div>

      {stats.totalCalls > 0 && (
        <div>
          <div style={{
            fontSize: theme.fontSize.xs,
            color: theme.text.dim,
            textTransform: "uppercase",
            letterSpacing: 1,
            marginBottom: theme.space.md,
          }}>
            Tool Frequency
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: theme.space.xs }}>
            {Object.entries(stats.toolFrequency)
              .sort(function (a, b) { return b[1] - a[1]; })
              .slice(0, 15)
              .map(function (entry) {
                var name = entry[0];
                var count = entry[1];
                var pct = stats.totalCalls > 0 ? (count / stats.totalCalls) * 100 : 0;
                var color = getToolColor(name);

                return (
                  <div key={name} style={{
                    display: "flex",
                    alignItems: "center",
                    gap: theme.space.sm,
                    fontSize: theme.fontSize.sm,
                  }}>
                    <div style={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: color,
                      flexShrink: 0,
                    }} />
                    <span style={{
                      color: theme.text.secondary,
                      flex: 1,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}>
                      {name}
                    </span>
                    <span style={{ color: theme.text.dim, flexShrink: 0 }}>
                      {count}
                    </span>
                    <div style={{
                      width: 40,
                      height: 3,
                      background: theme.bg.raised,
                      borderRadius: 2,
                      flexShrink: 0,
                      overflow: "hidden",
                    }}>
                      <div style={{
                        width: pct + "%",
                        height: "100%",
                        background: color,
                        borderRadius: 2,
                      }} />
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {selected && (
        <div>
          <div style={{
            fontSize: theme.fontSize.xs,
            color: theme.text.dim,
            textTransform: "uppercase",
            letterSpacing: 1,
            marginBottom: theme.space.md,
          }}>
            Selected Tool
          </div>
          <div style={{
            background: theme.bg.raised,
            borderRadius: theme.radius.lg,
            padding: theme.space.lg,
            border: "1px solid " + theme.border.default,
          }}>
            <div style={{
              fontSize: theme.fontSize.md,
              color: getToolColor(selected.toolName),
              fontWeight: 600,
              marginBottom: theme.space.md,
            }}>
              {selected.toolName || "Unknown Tool"}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: theme.space.sm }}>
              {[
                ["Time", formatTime(selected.t)],
                ["Duration", formatDuration(selected.duration)],
                ["Turn", selected.turnIndex !== undefined ? selected.turnIndex + 1 : "n/a"],
                ["Agent", selected.agent],
                selected.model ? ["Model", selected.model] : null,
                selectedItem && selectedItem.depth > 0 ? ["Depth", selectedItem.depth] : null,
                selected.isError ? ["Status", "ERROR"] : null,
              ].filter(Boolean).map(function (pair) {
                var isError = pair[0] === "Status";
                return (
                  <div key={pair[0]} style={{
                    display: "flex",
                    justifyContent: "space-between",
                    fontSize: theme.fontSize.sm,
                  }}>
                    <span style={{ color: theme.text.muted }}>{pair[0]}</span>
                    <span style={{ color: isError ? theme.semantic.error : theme.text.primary }}>{pair[1]}</span>
                  </div>
                );
              })}
            </div>

            {hasDiff && !showRaw && (
              <div style={{ marginTop: theme.space.lg }}>
                <div style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: theme.space.sm,
                }}>
                  <div style={{
                    fontSize: theme.fontSize.xs,
                    color: theme.text.dim,
                  }}>
                    Diff
                  </div>
                  <div
                    onClick={function () { setShowRaw(true); }}
                    style={{
                      fontSize: theme.fontSize.xs,
                      color: theme.accent.primary,
                      cursor: "pointer",
                    }}
                  >
                    Show Raw
                  </div>
                </div>
                <DiffViewer event={selected} />
              </div>
            )}

            {selected.toolInput && (!hasDiff || showRaw) && (
              <div style={{ marginTop: theme.space.lg }}>
                {hasDiff && (
                  <div style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "flex-end",
                    marginBottom: theme.space.sm,
                  }}>
                    <div
                      onClick={function () { setShowRaw(false); }}
                      style={{
                        fontSize: theme.fontSize.xs,
                        color: theme.accent.primary,
                        cursor: "pointer",
                      }}
                    >
                      Show Diff
                    </div>
                  </div>
                )}
                <DataInspector title="Input" value={selected.toolInput} maxLines={24} maxChars={20000} />
              </div>
            )}

            {selected.raw && selected.raw.data && (
              <div style={{ marginTop: theme.space.lg }}>
                <DataInspector title="Raw Result" value={selected.raw.data} maxLines={20} maxChars={20000} />
              </div>
            )}
          </div>
        </div>
      )}

      {!selected && stats.totalCalls > 0 && (
        <div style={{
          fontSize: theme.fontSize.sm,
          color: theme.text.dim,
          fontStyle: "italic",
          marginTop: theme.space.md,
        }}>
          Click a tool bar to inspect details
        </div>
      )}
    </div>
  );
}
