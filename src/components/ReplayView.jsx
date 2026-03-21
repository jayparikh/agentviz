import { useState, useEffect, useRef, useMemo } from "react";
import { theme, AGENT_COLORS, TRACK_TYPES, alpha } from "../lib/theme.js";
import { buildReplayLayout, getReplayWindow } from "../lib/replayLayout.js";
import SyntaxHighlight from "./SyntaxHighlight.jsx";
import ResizablePanel from "./ResizablePanel.jsx";
import ErrorBoundary from "./ErrorBoundary.jsx";

var REPLAY_WINDOW_OVERSCAN = 600;
var REPLAY_BOTTOM_THRESHOLD = 80;

function highlightText(text, query) {
  if (!query || !query.trim()) return text;

  var lowerQuery = query.toLowerCase();
  var idx = text.toLowerCase().indexOf(lowerQuery);
  if (idx === -1) return text;

  return [
    text.substring(0, idx),
    <span
      key="hl"
      style={{
        background: alpha(theme.accent.cyan, 0.2),
        color: theme.accent.cyan,
        borderRadius: 2,
        padding: "0 1px",
      }}
    >
      {text.substring(idx, idx + query.length)}
    </span>,
    text.substring(idx + query.length),
  ];
}

function ReplayInspector({ selectedEntry, hasExplicitSelection, metadata, toolEntries }) {
  var selected = selectedEntry ? selectedEntry.event : null;

  return (
    <div style={{
      height: "100%",
      paddingLeft: 16,
      display: "flex",
      flexDirection: "column",
      gap: 14,
      overflowY: "auto",
    }}>
      {metadata && (
        <div>
          <div style={{ fontSize: theme.fontSize.sm, color: theme.text.dim, textTransform: "uppercase", letterSpacing: 2, marginBottom: 8 }}>
            Session Info
          </div>
          <div style={{ fontSize: theme.fontSize.md, color: theme.text.secondary, lineHeight: 2.2 }}>
            <div>Events: <span style={{ color: theme.text.primary }}>{metadata.totalEvents}</span></div>
            <div>Turns: <span style={{ color: theme.text.primary }}>{metadata.totalTurns}</span></div>
            <div>Tools: <span style={{ color: theme.accent.amber }}>{metadata.totalToolCalls}</span></div>
            {metadata.errorCount > 0 && (
              <div>Errors: <span style={{ color: theme.error }}>{metadata.errorCount}</span></div>
            )}
            {metadata.primaryModel && (
              <div>Model: <span style={{ color: theme.accent.purple }}>{metadata.primaryModel.split("-").slice(0, 3).join("-")}</span></div>
            )}
            {metadata.tokenUsage && (metadata.tokenUsage.inputTokens + metadata.tokenUsage.outputTokens) > 0 && (
              <div>Tokens: <span style={{ color: theme.accent.cyan }}>
                {(metadata.tokenUsage.inputTokens + metadata.tokenUsage.outputTokens).toLocaleString()}
              </span></div>
            )}
            {metadata.warnings && metadata.warnings.length > 0 && (
              <div style={{ color: theme.warning }}>
                Warnings: {metadata.warnings.length}
              </div>
            )}
          </div>
        </div>
      )}

      <div>
        <div style={{ fontSize: theme.fontSize.sm, color: theme.text.dim, textTransform: "uppercase", letterSpacing: 2, marginBottom: 8 }}>
          Tools Used
        </div>
        {toolEntries.length === 0 && (
          <div style={{ fontSize: theme.fontSize.base, color: theme.text.ghost }}>No tools visible</div>
        )}
        {toolEntries.map(function (pair) {
          return (
            <div key={pair[0]} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0" }}>
              <span style={{ fontSize: theme.fontSize.base, color: theme.accent.amber, fontFamily: theme.font }}>{pair[0]}</span>
              <span style={{ fontSize: theme.fontSize.base, color: theme.text.muted }}>{pair[1]}x</span>
            </div>
          );
        })}
      </div>

      {selected && (
        <div>
          <div style={{ fontSize: theme.fontSize.sm, color: theme.text.dim, textTransform: "uppercase", letterSpacing: 2, marginBottom: 8 }}>
            {hasExplicitSelection ? "Selected Event" : "Current Event"}
          </div>
          <div style={{
            background: theme.bg.surface,
            borderRadius: theme.radius.lg,
            padding: 10,
            border: "1px solid " + alpha(selected.isError ? theme.error : ((TRACK_TYPES[selected.track] || {}).color || theme.text.ghost), 0.2),
          }}>
            {TRACK_TYPES[selected.track] && (
              <div style={{ fontSize: theme.fontSize.base, color: selected.isError ? theme.error : TRACK_TYPES[selected.track].color, marginBottom: 4 }}>
                {TRACK_TYPES[selected.track].icon} {TRACK_TYPES[selected.track].label}
                {selected.isError && " (ERROR)"}
              </div>
            )}
            <div style={{ fontSize: theme.fontSize.base, color: theme.text.secondary }}>Agent: {selected.agent}</div>
            <div style={{ fontSize: theme.fontSize.base, color: theme.text.secondary }}>Time: {selected.t.toFixed(2)}s</div>
            <div style={{ fontSize: theme.fontSize.base, color: theme.text.secondary }}>Turn: {(selected.turnIndex || 0) + 1}</div>
            {selected.toolName && (
              <div style={{ fontSize: theme.fontSize.base, color: theme.accent.amber, marginTop: 4 }}>Tool: {selected.toolName}</div>
            )}
            {selected.model && (
              <div style={{ fontSize: theme.fontSize.base, color: theme.accent.purple, marginTop: 4 }}>Model: {selected.model}</div>
            )}
          </div>
        </div>
      )}

      {selected && selected.raw && (
        <div>
          <div style={{ fontSize: theme.fontSize.sm, color: theme.text.dim, textTransform: "uppercase", letterSpacing: 2, marginBottom: 8 }}>
            Raw Data
          </div>
          <SyntaxHighlight text={JSON.stringify(selected.raw, null, 2).substring(0, 2000)} maxLines={30} />
        </div>
      )}
    </div>
  );
}

export default function ReplayView({ currentTime, eventEntries, turnStartMap, searchQuery, matchSet, metadata }) {
  var containerRef = useRef(null);
  var [selectedIndex, setSelectedIndex] = useState(null);
  var [scrollTop, setScrollTop] = useState(0);
  var [viewportHeight, setViewportHeight] = useState(0);
  var shouldFollowRef = useRef(true);
  var prevCount = useRef(0);

  var visibleEntries = useMemo(function () {
    return eventEntries.filter(function (entry) { return entry.event.t <= currentTime; });
  }, [currentTime, eventEntries]);

  var layout = useMemo(function () {
    return buildReplayLayout(visibleEntries, turnStartMap);
  }, [turnStartMap, visibleEntries]);

  var windowedItems = useMemo(function () {
    return getReplayWindow(layout.items, scrollTop, viewportHeight, REPLAY_WINDOW_OVERSCAN);
  }, [layout.items, scrollTop, viewportHeight]);

  useEffect(function () {
    if (containerRef.current && visibleEntries.length > prevCount.current && shouldFollowRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
    prevCount.current = visibleEntries.length;
  }, [visibleEntries.length]);

  useEffect(function () {
    function updateViewportHeight() {
      if (containerRef.current) {
        setViewportHeight(containerRef.current.clientHeight);
      }
    }

    updateViewportHeight();
    window.addEventListener("resize", updateViewportHeight);

    return function () {
      window.removeEventListener("resize", updateViewportHeight);
    };
  }, []);

  function handleScroll(e) {
    var nextTop = e.currentTarget.scrollTop;
    var nearBottom = nextTop + e.currentTarget.clientHeight >= e.currentTarget.scrollHeight - REPLAY_BOTTOM_THRESHOLD;
    setScrollTop(nextTop);
    shouldFollowRef.current = nearBottom;
  }

  // Clear selection when the selected entry is filtered out (track filter change)
  useEffect(function () {
    if (selectedIndex === null) return;
    var found = false;
    for (var i = 0; i < eventEntries.length; i++) {
      if (eventEntries[i].index === selectedIndex) { found = true; break; }
    }
    if (!found) setSelectedIndex(null);
  }, [selectedIndex, eventEntries]);

  var selectedEntry = useMemo(function () {
    if (selectedIndex !== null) {
      for (var i = 0; i < visibleEntries.length; i++) {
        if (visibleEntries[i].index === selectedIndex) return visibleEntries[i];
      }
    }
    return visibleEntries[visibleEntries.length - 1] || null;
  }, [selectedIndex, visibleEntries]);

  var hasExplicitSelection = selectedIndex !== null
    && selectedEntry
    && selectedEntry.index === selectedIndex;

  var toolEntries = useMemo(function () {
    var tools = {};

    for (var i = 0; i < visibleEntries.length; i++) {
      var toolName = visibleEntries[i].event.toolName;
      if (toolName) tools[toolName] = (tools[toolName] || 0) + 1;
    }

    return Object.entries(tools).sort(function (a, b) { return b[1] - a[1]; });
  }, [visibleEntries]);

  return (
    <ResizablePanel initialSplit={0.72} minPx={200} direction="horizontal" storageKey="agentviz:replay-panel-split">
      <div ref={containerRef} onScroll={handleScroll} style={{
        height: "100%",
        overflowY: "auto",
        padding: "4px 0",
      }}>
        <div style={{ position: "relative", height: layout.totalHeight }}>
          {windowedItems.map(function (item) {
            var entry = item.entry;
            var ev = entry.event;
            var info = TRACK_TYPES[ev.track];
            var agentColor = AGENT_COLORS[ev.agent] || theme.text.secondary;
            var isCurrent = item.visibleIndex === visibleEntries.length - 1;
            var isSelected = entry.index === selectedIndex;
            var isError = ev.isError;
            var isMatch = matchSet && matchSet.has(entry.index);
            var isNew = item.visibleIndex >= prevCount.current - 1;
            var turnHeader = null;

            if (item.turn && item.turn.index > 0 && ev.agent === "user") {
              turnHeader = (
                <div style={{
                  padding: "8px 12px 4px",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  borderTop: "1px solid " + theme.border.default,
                  marginTop: 8,
                }}>
                  <span style={{ fontSize: theme.fontSize.xs, color: theme.text.dim, textTransform: "uppercase", letterSpacing: 2 }}>
                    Turn {item.turn.index + 1}
                  </span>
                  <div style={{ flex: 1, height: 1, background: theme.border.default }} />
                  {item.turn.toolCount > 0 && (
                    <span style={{ fontSize: theme.fontSize.xs, color: theme.accent.amber }}>{item.turn.toolCount} tools</span>
                  )}
                  {item.turn.hasError && (
                    <span style={{ fontSize: theme.fontSize.xs, color: theme.error }}>{"\u25CF"} error</span>
                  )}
                </div>
              );
            }

            var borderColor = isError
              ? theme.error
              : (isSelected ? theme.accent.cyan : (isCurrent ? alpha(agentColor, 0.5) : "transparent"));

            return (
              <div key={entry.index} style={{ position: "absolute", top: item.top, left: 0, right: 0 }}>
                {turnHeader}
                <div
                  onClick={function () { setSelectedIndex(entry.index === selectedIndex ? null : entry.index); }}
                  style={{
                    display: "flex",
                    gap: 10,
                    padding: "7px 12px",
                    borderRadius: theme.radius.lg,
                    background: isMatch ? alpha(theme.accent.cyan, 0.03) : (isSelected ? theme.bg.raised : (isCurrent ? theme.bg.overlay : "transparent")),
                    borderLeft: "3px solid " + borderColor,
                    opacity: isCurrent || isSelected || isMatch ? 1 : 0.55,
                    cursor: "pointer",
                    transition: "all " + theme.transition.base,
                    animation: (isCurrent && isNew) ? "slideIn 0.2s ease" : "none",
                  }}
                >
                  <div style={{ minWidth: 40, fontFamily: theme.font, fontSize: theme.fontSize.sm, color: theme.text.dim, paddingTop: 3 }}>
                    {ev.t.toFixed(1)}s
                  </div>
                  <div style={{
                    minWidth: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: isError ? theme.error : agentColor,
                    marginTop: 5,
                    boxShadow: isCurrent ? theme.shadow.glowSm(isError ? theme.error : agentColor) : "none",
                    animation: isCurrent ? "pulse 2s ease-in-out infinite" : "none",
                  }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2, flexWrap: "wrap" }}>
                      <span style={{ fontSize: theme.fontSize.sm, fontWeight: 600, color: agentColor, textTransform: "uppercase", letterSpacing: 1 }}>
                        {ev.agent}
                      </span>
                      {info && (
                        <span style={{
                          fontSize: theme.fontSize.xs,
                          color: isError ? theme.error : info.color,
                          background: alpha(isError ? theme.error : info.color, 0.08),
                          padding: "1px 5px",
                          borderRadius: theme.radius.sm,
                        }}>
                          {info.icon} {info.label}
                        </span>
                      )}
                      {ev.toolName && (
                        <span style={{ fontSize: theme.fontSize.xs, color: theme.accent.amber, background: alpha(theme.accent.amber, 0.06), padding: "1px 5px", borderRadius: theme.radius.sm }}>
                          {ev.toolName}
                        </span>
                      )}
                      {isError && (
                        <span style={{ fontSize: theme.fontSize.xs, color: theme.error, fontWeight: 600 }}>ERROR</span>
                      )}
                      {ev.model && isSelected && (
                        <span style={{ fontSize: theme.fontSize.xs, color: theme.text.muted }}>{ev.model}</span>
                      )}
                    </div>
                    <div style={{
                      fontSize: theme.fontSize.md,
                      color: isError ? theme.errorText : theme.text.primary,
                      lineHeight: 1.5,
                      fontFamily: theme.font,
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                    }}>
                      {highlightText(ev.text, searchQuery)}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <ErrorBoundary resetKey={selectedEntry ? selectedEntry.index : "none"}>
        <ReplayInspector
          selectedEntry={selectedEntry}
          hasExplicitSelection={hasExplicitSelection}
          metadata={metadata}
          toolEntries={toolEntries}
        />
      </ErrorBoundary>
    </ResizablePanel>
  );
}
