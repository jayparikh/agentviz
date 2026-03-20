import { useState, useRef, useMemo, useCallback, useEffect } from "react";
import { theme, alpha } from "../lib/theme.js";
import {
  buildWaterfallItems,
  getWaterfallStats,
  buildWaterfallLayout,
  getWaterfallWindow,
  getToolColor,
  WATERFALL_ROW_HEIGHT,
} from "../lib/waterfall.js";
import ResizablePanel from "./ResizablePanel.jsx";
import SyntaxHighlight from "./SyntaxHighlight.jsx";

var OVERSCAN_PX = 400;
var INDENT_PX = 20;
var LABEL_WIDTH = 180;
var MIN_BAR_WIDTH_PX = 4;
var TIME_AXIS_HEIGHT = 28;

function formatDuration(seconds) {
  if (seconds < 0.01) return "<10ms";
  if (seconds < 1) return (seconds * 1000).toFixed(0) + "ms";
  if (seconds < 60) return seconds.toFixed(1) + "s";
  return (seconds / 60).toFixed(1) + "m";
}

function formatTime(seconds) {
  if (seconds < 60) return seconds.toFixed(1) + "s";
  var m = Math.floor(seconds / 60);
  var s = (seconds % 60).toFixed(0);
  return m + ":" + (s < 10 ? "0" : "") + s;
}

function TimeAxis({ totalTime, chartWidth }) {
  if (totalTime <= 0 || chartWidth <= 0) return null;

  // Compute tick interval: aim for ticks every ~80-120px
  var rawInterval = (totalTime / chartWidth) * 100;
  var niceIntervals = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
  var interval = niceIntervals[0];
  for (var i = 0; i < niceIntervals.length; i++) {
    if (niceIntervals[i] >= rawInterval) {
      interval = niceIntervals[i];
      break;
    }
  }

  var ticks = [];
  for (var t = 0; t <= totalTime; t += interval) {
    ticks.push(t);
  }

  return (
    <div style={{
      height: TIME_AXIS_HEIGHT,
      position: "relative",
      borderBottom: "1px solid " + theme.border.default,
      flexShrink: 0,
    }}>
      {ticks.map(function (tick) {
        var left = (tick / totalTime) * 100;
        return (
          <div key={tick} style={{
            position: "absolute",
            left: left + "%",
            top: 0,
            bottom: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
          }}>
            <div style={{
              width: 1,
              flex: 1,
              background: theme.border.subtle,
            }} />
            <span style={{
              fontSize: theme.fontSize.xs,
              color: theme.text.dim,
              padding: "0 2px",
              whiteSpace: "nowrap",
            }}>
              {formatTime(tick)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function WaterfallInspector({ selectedItem, stats }) {
  var selected = selectedItem ? selectedItem.event : null;

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
      {/* Stats section */}
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

      {/* Tool frequency ranking */}
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

      {/* Selected tool details */}
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
                    <span style={{ color: isError ? theme.error : theme.text.primary }}>{pair[1]}</span>
                  </div>
                );
              })}
            </div>

            {selected.toolInput && (
              <div style={{ marginTop: theme.space.lg }}>
                <div style={{
                  fontSize: theme.fontSize.xs,
                  color: theme.text.dim,
                  marginBottom: theme.space.sm,
                }}>
                  Input
                </div>
                <SyntaxHighlight
                  text={typeof selected.toolInput === "string"
                    ? selected.toolInput
                    : JSON.stringify(selected.toolInput, null, 2)}
                  maxLines={30}
                />
              </div>
            )}

            {selected.raw && selected.raw.data && (
              <div style={{ marginTop: theme.space.lg }}>
                <div style={{
                  fontSize: theme.fontSize.xs,
                  color: theme.text.dim,
                  marginBottom: theme.space.sm,
                }}>
                  Raw
                </div>
                <SyntaxHighlight
                  text={JSON.stringify(selected.raw.data, null, 2)}
                  maxLines={20}
                />
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

export default function WaterfallView({ currentTime, eventEntries, totalTime, turns, metadata, onSeek }) {
  var [selectedIdx, setSelectedIdx] = useState(null);
  var [hoveredIdx, setHoveredIdx] = useState(null);
  var scrollRef = useRef(null);
  var chartRef = useRef(null);
  var [scrollTop, setScrollTop] = useState(0);
  var [viewportHeight, setViewportHeight] = useState(600);

  // Extract all events from entries
  var allEvents = useMemo(function () {
    return eventEntries.map(function (entry) { return entry.event; });
  }, [eventEntries]);

  var items = useMemo(function () {
    return buildWaterfallItems(allEvents);
  }, [allEvents]);

  var stats = useMemo(function () {
    return getWaterfallStats(items);
  }, [items]);

  var layout = useMemo(function () {
    return buildWaterfallLayout(items);
  }, [items]);

  var visibleItems = useMemo(function () {
    return getWaterfallWindow(layout.layoutItems, scrollTop, viewportHeight, OVERSCAN_PX);
  }, [layout.layoutItems, scrollTop, viewportHeight]);

  var selectedItem = useMemo(function () {
    if (selectedIdx === null || !items[selectedIdx]) return null;
    return items[selectedIdx];
  }, [selectedIdx, items]);

  var handleScroll = useCallback(function () {
    if (scrollRef.current) {
      setScrollTop(scrollRef.current.scrollTop);
    }
  }, []);

  useEffect(function () {
    if (!scrollRef.current) return;
    var observer = new ResizeObserver(function (entries) {
      if (entries[0]) {
        setViewportHeight(entries[0].contentRect.height);
      }
    });
    observer.observe(scrollRef.current);
    return function () { observer.disconnect(); };
  }, []);

  var playPct = totalTime > 0 ? (currentTime / totalTime) * 100 : 0;

  if (items.length === 0) {
    return (
      <div style={{
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: theme.text.dim,
        fontSize: theme.fontSize.md,
        fontStyle: "italic",
      }}>
        No tool calls to display
      </div>
    );
  }

  return (
    <ResizablePanel
      initialSplit={0.72}
      minPx={200}
      direction="horizontal"
      storageKey="agentviz:waterfall-panel-split"
    >
      {/* Left panel: waterfall chart */}
      <div style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: theme.bg.base,
        borderRadius: theme.radius.lg,
        border: "1px solid " + theme.border.default,
        overflow: "hidden",
      }}>
        <TimeAxis
          totalTime={totalTime}
          chartWidth={800}
        />

        <div
          ref={scrollRef}
          onScroll={handleScroll}
          style={{
            flex: 1,
            overflow: "auto",
            position: "relative",
          }}
        >
          <div style={{
            height: layout.totalHeight,
            position: "relative",
            minHeight: "100%",
          }}>
            {/* Turn boundary vertical lines */}
            {turns && turns.map(function (turn, ti) {
              if (ti === 0) return null;
              var left = totalTime > 0 ? (turn.startTime / totalTime) * 100 : 0;
              return (
                <div key={"tb-" + ti} style={{
                  position: "absolute",
                  left: "calc(" + LABEL_WIDTH + "px + " + left + "% * (100% - " + LABEL_WIDTH + "px) / 100)",
                  top: 0,
                  bottom: 0,
                  width: 1,
                  background: theme.border.subtle,
                  zIndex: 0,
                  pointerEvents: "none",
                }} />
              );
            })}

            {/* Playhead */}
            <div style={{
              position: "absolute",
              left: "calc(" + LABEL_WIDTH + "px + " + playPct + "% * (100% - " + LABEL_WIDTH + "px) / 100)",
              top: 0,
              bottom: 0,
              width: 2,
              background: theme.accent.cyan,
              boxShadow: "0 0 6px " + theme.accent.cyan,
              zIndex: theme.z.playhead,
              transition: "left 0.08s linear",
              pointerEvents: "none",
            }} />

            {/* Waterfall rows */}
            {visibleItems.map(function (layoutItem, vi) {
              var item = layoutItem.item;
              var ev = item.event;
              var idx = items.indexOf(item);
              var isSelected = selectedIdx === idx;
              var isHovered = hoveredIdx === idx;
              var isActive = currentTime >= ev.t && currentTime <= ev.t + ev.duration;
              var barColor = ev.isError ? theme.error : getToolColor(ev.toolName);
              var indent = item.depth * INDENT_PX;

              var barLeft = totalTime > 0 ? (ev.t / totalTime) * 100 : 0;
              var barWidth = totalTime > 0 ? (ev.duration / totalTime) * 100 : 0;

              return (
                <div
                  key={item.originalIndex}
                  onClick={function () { setSelectedIdx(isSelected ? null : idx); }}
                  onMouseEnter={function () { setHoveredIdx(idx); }}
                  onMouseLeave={function () { setHoveredIdx(null); }}
                  style={{
                    position: "absolute",
                    top: layoutItem.top,
                    left: 0,
                    right: 0,
                    height: WATERFALL_ROW_HEIGHT,
                    display: "flex",
                    alignItems: "center",
                    cursor: "pointer",
                    background: isSelected
                      ? alpha(barColor, 0.08)
                      : isHovered
                        ? theme.bg.hover
                        : "transparent",
                    borderLeft: isSelected ? "2px solid " + barColor : "2px solid transparent",
                    transition: "background " + theme.transition.fast,
                  }}
                >
                  {/* Tool name label */}
                  <div style={{
                    width: LABEL_WIDTH,
                    flexShrink: 0,
                    paddingLeft: theme.space.md + indent,
                    paddingRight: theme.space.sm,
                    display: "flex",
                    alignItems: "center",
                    gap: theme.space.sm,
                    overflow: "hidden",
                    borderRight: "1px solid " + theme.border.subtle,
                  }}>
                    <div style={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: barColor,
                      flexShrink: 0,
                    }} />
                    <span style={{
                      fontSize: theme.fontSize.sm,
                      color: ev.isError ? theme.errorText : theme.text.secondary,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      fontWeight: isSelected ? 600 : 400,
                    }}>
                      {ev.toolName || "tool"}
                    </span>
                  </div>

                  {/* Bar area */}
                  <div ref={vi === 0 ? chartRef : undefined} style={{
                    flex: 1,
                    position: "relative",
                    height: "100%",
                  }}>
                    <div style={{
                      position: "absolute",
                      left: barLeft + "%",
                      width: "max(" + MIN_BAR_WIDTH_PX + "px, " + barWidth + "%)",
                      top: 4,
                      bottom: 4,
                      borderRadius: theme.radius.sm,
                      background: "linear-gradient(90deg, " + alpha(barColor, 0.7) + ", " + alpha(barColor, 0.45) + ")",
                      border: "1px solid " + (isActive || isSelected
                        ? barColor
                        : alpha(barColor, 0.3)),
                      boxShadow: isActive
                        ? "0 0 8px " + alpha(barColor, 0.3)
                        : isSelected
                          ? "0 0 6px " + alpha(barColor, 0.2)
                          : "none",
                      display: "flex",
                      alignItems: "center",
                      padding: "0 4px",
                      overflow: "hidden",
                      transition: "border-color " + theme.transition.fast + ", box-shadow " + theme.transition.fast,
                    }}>
                      {ev.isError && (
                        <span style={{ fontSize: 8, marginRight: 2, color: theme.error }}>{"\u25CF"}</span>
                      )}
                      <span style={{
                        fontSize: theme.fontSize.xs,
                        color: theme.text.primary,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        opacity: 0.85,
                      }}>
                        {formatDuration(ev.duration)}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Right panel: inspector */}
      <WaterfallInspector
        selectedItem={selectedItem}
        stats={stats}
      />
    </ResizablePanel>
  );
}
