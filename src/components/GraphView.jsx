/**
 * GraphView: Interactive directed graph of session turns and tool calls.
 *
 * Renders an SVG DAG with ELKjs layout. Turns are nodes, edges show flow.
 * Click a turn to expand into individual tool call nodes.
 * Nodes animate with playback -- current turn glows, future nodes dim.
 */
import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { theme, alpha, TRACK_TYPES } from "../lib/theme.js";
import { buildGraphData, runLayout, mergeLayout, getGraphBounds } from "../lib/graphLayout.js";
import ResizablePanel from "./ResizablePanel.jsx";
import Icon from "./Icon.jsx";

var NODE_COLORS = {
  reasoning: theme.track.reasoning,
  tool_call: theme.track.tool_call,
  context: theme.track.context,
  output: theme.track.output,
};

function getTrackColor(track) {
  return NODE_COLORS[track] || theme.track.reasoning;
}

// ── Edge rendering with animated flowing dots ──

function GraphEdge({ sections, parentOffset, isActive }) {
  if (!sections || sections.length === 0) return null;

  var paths = sections.map(function (section, si) {
    var ox = parentOffset ? parentOffset.x : 0;
    var oy = parentOffset ? parentOffset.y : 0;
    var start = section.startPoint;
    var end = section.endPoint;
    var bends = section.bendPoints || [];

    var d = "M " + (start.x + ox) + " " + (start.y + oy);
    for (var b = 0; b < bends.length; b++) {
      d += " L " + (bends[b].x + ox) + " " + (bends[b].y + oy);
    }
    d += " L " + (end.x + ox) + " " + (end.y + oy);

    return (
      <g key={si}>
        <path
          d={d}
          fill="none"
          stroke={isActive ? theme.accent.primary : theme.border.strong}
          strokeWidth={isActive ? 2 : 1.5}
          strokeOpacity={isActive ? 0.9 : 0.4}
          strokeLinecap="round"
        />
        {isActive && (
          <circle r="3" fill={theme.accent.primary}>
            <animateMotion dur="1.5s" repeatCount="indefinite" path={d} />
          </circle>
        )}
      </g>
    );
  });

  return <g>{paths}</g>;
}

// ── Turn node (collapsed) ──

function TurnNode({ node, isActive, isFuture, isSelected, onSelect, onExpand }) {
  var color = getTrackColor(node.track);
  var opacity = isFuture ? 0.25 : 1;
  var glowFilter = isActive ? "url(#activeGlow)" : "none";

  return (
    <g
      transform={"translate(" + node.x + "," + node.y + ")"}
      style={{ cursor: "pointer", opacity: opacity }}
      onClick={function (e) {
        e.stopPropagation();
        onSelect(node);
      }}
      onDoubleClick={function (e) {
        e.stopPropagation();
        if (node.toolCount > 0) onExpand(node.turnIndex);
      }}
    >
      {/* Background rect */}
      <rect
        width={node.width}
        height={node.height}
        rx={8}
        ry={8}
        fill={isSelected ? alpha(color, 0.15) : theme.bg.raised}
        stroke={isActive ? color : isSelected ? color : theme.border.default}
        strokeWidth={isActive ? 2 : 1}
        filter={glowFilter}
      />

      {/* Turn label */}
      <text
        x={12}
        y={18}
        fill={color}
        fontSize={11}
        fontFamily={theme.font.mono}
        fontWeight={600}
      >
        {"Turn " + node.turnIndex}
        {node.hasError && (
          <tspan fill={theme.semantic.error}>{" \u26A0"}</tspan>
        )}
      </text>

      {/* User message snippet */}
      <text
        x={12}
        y={35}
        fill={theme.text.secondary}
        fontSize={10}
        fontFamily={theme.font.mono}
      >
        {node.snippet ? truncateSVGText(node.snippet, node.width - 24) : ""}
      </text>

      {/* Tool count badge */}
      {node.toolCount > 0 && (
        <g transform={"translate(" + (node.width - 36) + ", 4)"}>
          <rect
            width={28}
            height={16}
            rx={8}
            fill={alpha(theme.track.tool_call, 0.2)}
          />
          <text
            x={14}
            y={11}
            fill={theme.track.tool_call}
            fontSize={9}
            fontFamily={theme.font.mono}
            textAnchor="middle"
          >
            {node.toolCount + "\u00D7"}
          </text>
        </g>
      )}

      {/* Active pulse ring */}
      {isActive && (
        <rect
          width={node.width + 4}
          height={node.height + 4}
          x={-2}
          y={-2}
          rx={10}
          ry={10}
          fill="none"
          stroke={color}
          strokeWidth={1.5}
          opacity={0.5}
        >
          <animate
            attributeName="opacity"
            values="0.5;0.15;0.5"
            dur="2s"
            repeatCount="indefinite"
          />
        </rect>
      )}
    </g>
  );
}

// ── Tool call node (inside expanded turn) ──

function ToolCallNode({ node, isActive, isFuture, isSelected, onSelect }) {
  var color = getTrackColor("tool_call");
  var opacity = isFuture ? 0.25 : 1;

  return (
    <g
      transform={"translate(" + node.x + "," + node.y + ")"}
      style={{ cursor: "pointer", opacity: opacity }}
      onClick={function (e) {
        e.stopPropagation();
        onSelect(node);
      }}
    >
      <rect
        width={node.width}
        height={node.height}
        rx={6}
        ry={6}
        fill={isSelected ? alpha(color, 0.15) : theme.bg.surface}
        stroke={isActive ? color : isSelected ? color : theme.border.default}
        strokeWidth={isActive ? 1.5 : 1}
      />
      {node.isError && (
        <rect
          width={node.width}
          height={node.height}
          rx={6}
          ry={6}
          fill={alpha(theme.semantic.error, 0.08)}
          stroke={theme.semantic.errorBorder}
          strokeWidth={1}
        />
      )}
      <text
        x={10}
        y={22}
        fill={isActive ? color : theme.text.secondary}
        fontSize={10}
        fontFamily={theme.font.mono}
        fontWeight={500}
      >
        {node.label}
      </text>
      {isActive && (
        <rect
          width={node.width + 2}
          height={node.height + 2}
          x={-1}
          y={-1}
          rx={7}
          ry={7}
          fill="none"
          stroke={color}
          strokeWidth={1}
          opacity={0.4}
        >
          <animate
            attributeName="opacity"
            values="0.4;0.1;0.4"
            dur="2s"
            repeatCount="indefinite"
          />
        </rect>
      )}
    </g>
  );
}

// ── Expanded turn container ──

function ExpandedTurnNode({ node, isActive, isFuture, isSelected, onSelect, onCollapse, currentTime, children }) {
  var color = getTrackColor(node.track);
  var opacity = isFuture ? 0.25 : 1;

  return (
    <g
      transform={"translate(" + node.x + "," + node.y + ")"}
      style={{ opacity: opacity }}
    >
      <rect
        width={node.width}
        height={node.height}
        rx={10}
        ry={10}
        fill={alpha(theme.bg.surface, 0.5)}
        stroke={isActive ? color : theme.border.default}
        strokeWidth={isActive ? 2 : 1}
        strokeDasharray={isActive ? "none" : "4 2"}
      />
      {/* Header */}
      <text
        x={12}
        y={22}
        fill={color}
        fontSize={11}
        fontFamily={theme.font.mono}
        fontWeight={600}
        style={{ cursor: "pointer" }}
        onClick={function (e) {
          e.stopPropagation();
          onCollapse(node.turnIndex);
        }}
      >
        {"Turn " + node.turnIndex + " \u25B4"}
        {node.hasError && <tspan fill={theme.semantic.error}>{" \u26A0"}</tspan>}
      </text>
      {children}
    </g>
  );
}

// ── Inspector sidebar ──

function GraphInspector({ selectedNode }) {
  if (!selectedNode) {
    return (
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        color: theme.text.ghost,
        fontFamily: theme.font.mono,
        fontSize: theme.fontSize.sm,
      }}>
        Click a node to inspect
      </div>
    );
  }

  var isTurn = selectedNode.type === "turn";
  var event = selectedNode.event;
  var color = getTrackColor(selectedNode.track);

  return (
    <div style={{
      padding: 16,
      fontFamily: theme.font.mono,
      fontSize: theme.fontSize.base,
      color: theme.text.secondary,
      overflowY: "auto",
      height: "100%",
    }}>
      <div style={{
        fontSize: theme.fontSize.md,
        color: color,
        fontWeight: 600,
        marginBottom: 12,
        display: "flex",
        alignItems: "center",
        gap: 6,
      }}>
        <Icon name={isTurn ? "message-circle" : "tool_call"} size={14} style={{ color: color }} />
        {isTurn ? "Turn " + selectedNode.turnIndex : selectedNode.label}
      </div>

      {isTurn && selectedNode.snippet && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ color: theme.text.dim, fontSize: theme.fontSize.sm, marginBottom: 4 }}>User message</div>
          <div style={{
            background: theme.bg.surface,
            borderRadius: theme.radius.md,
            padding: "8px 10px",
            color: theme.text.primary,
            fontSize: theme.fontSize.sm,
            lineHeight: 1.5,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}>
            {selectedNode.snippet}
          </div>
        </div>
      )}

      {isTurn && (
        <div style={{ display: "flex", gap: 16, marginBottom: 12 }}>
          <div>
            <div style={{ color: theme.text.dim, fontSize: theme.fontSize.xs }}>Tools</div>
            <div style={{ color: theme.text.primary, fontSize: theme.fontSize.md }}>{selectedNode.toolCount || 0}</div>
          </div>
          <div>
            <div style={{ color: theme.text.dim, fontSize: theme.fontSize.xs }}>Error</div>
            <div style={{ color: selectedNode.hasError ? theme.semantic.error : theme.text.primary, fontSize: theme.fontSize.md }}>
              {selectedNode.hasError ? "Yes" : "No"}
            </div>
          </div>
          <div>
            <div style={{ color: theme.text.dim, fontSize: theme.fontSize.xs }}>Time</div>
            <div style={{ color: theme.text.primary, fontSize: theme.fontSize.md }}>
              {formatTime(selectedNode.startTime)}
            </div>
          </div>
        </div>
      )}

      {!isTurn && event && (
        <div>
          <div style={{ marginBottom: 12 }}>
            <div style={{ color: theme.text.dim, fontSize: theme.fontSize.xs, marginBottom: 4 }}>Tool</div>
            <div style={{ color: theme.text.primary }}>{event.toolName || "unknown"}</div>
          </div>
          {event.duration > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ color: theme.text.dim, fontSize: theme.fontSize.xs, marginBottom: 4 }}>Duration</div>
              <div style={{ color: theme.text.primary }}>{event.duration.toFixed(1)}s</div>
            </div>
          )}
          {event.isError && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ color: theme.semantic.error, fontSize: theme.fontSize.sm }}>
                <Icon name="alert-circle" size={12} /> Error
              </div>
            </div>
          )}
          {event.toolInput && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ color: theme.text.dim, fontSize: theme.fontSize.xs, marginBottom: 4 }}>Input</div>
              <pre style={{
                background: theme.bg.surface,
                borderRadius: theme.radius.md,
                padding: "8px 10px",
                color: theme.text.primary,
                fontSize: theme.fontSize.xs,
                lineHeight: 1.4,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                maxHeight: 200,
                overflowY: "auto",
                margin: 0,
              }}>
                {typeof event.toolInput === "string"
                  ? event.toolInput
                  : JSON.stringify(event.toolInput, null, 2)}
              </pre>
            </div>
          )}
          {event.text && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ color: theme.text.dim, fontSize: theme.fontSize.xs, marginBottom: 4 }}>Output</div>
              <pre style={{
                background: theme.bg.surface,
                borderRadius: theme.radius.md,
                padding: "8px 10px",
                color: theme.text.primary,
                fontSize: theme.fontSize.xs,
                lineHeight: 1.4,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                maxHeight: 300,
                overflowY: "auto",
                margin: 0,
              }}>
                {event.text}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main GraphView ──

export default function GraphView({ currentTime, eventEntries, totalTime, timeMap, turns }) {
  var [expandedTurns, setExpandedTurns] = useState({});
  var [selectedNode, setSelectedNode] = useState(null);
  var [layoutResult, setLayoutResult] = useState(null);
  var [viewBox, setViewBox] = useState(null);
  var svgRef = useRef(null);
  var isPanning = useRef(false);
  var panStart = useRef({ x: 0, y: 0 });
  var viewBoxRef = useRef(null);

  // Build graph data from turns
  var graphData = useMemo(function () {
    return buildGraphData(eventEntries, turns, expandedTurns);
  }, [eventEntries, turns, expandedTurns]);

  // Run ELK layout (async)
  useEffect(function () {
    if (!graphData.nodes.length) {
      setLayoutResult(null);
      return;
    }
    var cancelled = false;
    runLayout(graphData).then(function (elkResult) {
      if (cancelled) return;
      var result = mergeLayout(graphData, elkResult);
      setLayoutResult(result);
      var bounds = getGraphBounds(result.nodes);
      if (!viewBoxRef.current) {
        setViewBox(bounds);
        viewBoxRef.current = bounds;
      }
    }).catch(function (err) {
      console.warn("ELK layout failed:", err);
    });
    return function () { cancelled = true; };
  }, [graphData]);

  // Determine active turn based on currentTime
  var activeTurnIndex = useMemo(function () {
    if (!turns) return -1;
    for (var i = turns.length - 1; i >= 0; i--) {
      if (currentTime >= turns[i].startTime) return turns[i].index;
    }
    return -1;
  }, [turns, currentTime]);

  var handleExpand = useCallback(function (turnIndex) {
    setExpandedTurns(function (prev) {
      var next = Object.assign({}, prev);
      next[turnIndex] = true;
      return next;
    });
  }, []);

  var handleCollapse = useCallback(function (turnIndex) {
    setExpandedTurns(function (prev) {
      var next = Object.assign({}, prev);
      delete next[turnIndex];
      return next;
    });
  }, []);

  var handleSelectNode = useCallback(function (node) {
    setSelectedNode(node);
  }, []);

  // Pan handlers
  var handleMouseDown = useCallback(function (e) {
    if (e.target.closest("g[style]")) return; // clicked a node
    isPanning.current = true;
    panStart.current = { x: e.clientX, y: e.clientY };
  }, []);

  var handleMouseMove = useCallback(function (e) {
    if (!isPanning.current || !viewBox) return;
    var dx = (e.clientX - panStart.current.x) * (viewBox.width / (svgRef.current?.clientWidth || 800));
    var dy = (e.clientY - panStart.current.y) * (viewBox.height / (svgRef.current?.clientHeight || 600));
    var newVB = {
      x: viewBox.x - dx,
      y: viewBox.y - dy,
      width: viewBox.width,
      height: viewBox.height,
    };
    setViewBox(newVB);
    viewBoxRef.current = newVB;
    panStart.current = { x: e.clientX, y: e.clientY };
  }, [viewBox]);

  var handleMouseUp = useCallback(function () {
    isPanning.current = false;
  }, []);

  // Zoom handler
  var handleWheel = useCallback(function (e) {
    e.preventDefault();
    if (!viewBox) return;
    var factor = e.deltaY > 0 ? 1.1 : 0.9;
    var cx = viewBox.x + viewBox.width / 2;
    var cy = viewBox.y + viewBox.height / 2;
    var newW = viewBox.width * factor;
    var newH = viewBox.height * factor;
    var newVB = {
      x: cx - newW / 2,
      y: cy - newH / 2,
      width: newW,
      height: newH,
    };
    setViewBox(newVB);
    viewBoxRef.current = newVB;
  }, [viewBox]);

  // Fit-to-view reset
  var handleFitView = useCallback(function () {
    if (!layoutResult) return;
    var bounds = getGraphBounds(layoutResult.nodes);
    setViewBox(bounds);
    viewBoxRef.current = bounds;
  }, [layoutResult]);

  if (!layoutResult) {
    return (
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        color: theme.text.muted,
        fontFamily: theme.font.mono,
      }}>
        Computing layout...
      </div>
    );
  }

  var vb = viewBox || getGraphBounds(layoutResult.nodes);

  return (
    <ResizablePanel
      initialSplit={0.72}
      minPx={200}
      direction="horizontal"
      storageKey="agentviz:graph-panel-split"
    >
      <div style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden" }}>
        <svg
          ref={svgRef}
          width="100%"
          height="100%"
          viewBox={vb.x + " " + vb.y + " " + vb.width + " " + vb.height}
          style={{
            background: theme.bg.base,
            cursor: isPanning.current ? "grabbing" : "grab",
          }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onWheel={handleWheel}
        >
          <defs>
            <filter id="activeGlow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur in="SourceGraphic" stdDeviation="4" result="blur" />
              <feColorMatrix in="blur" type="matrix"
                values={"0 0 0 0 " + (100/255) + " 0 0 0 0 " + (117/255) + " 0 0 0 0 " + (232/255) + " 0 0 0 0.4 0"}
              />
              <feMerge>
                <feMergeNode />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Edges */}
          {layoutResult.edges.map(function (edge) {
            var fromTurnIdx = parseInt((edge.sources[0] || "").replace("turn-", ""), 10);
            var toTurnIdx = parseInt((edge.targets[0] || "").replace("turn-", ""), 10);
            var isActive = activeTurnIndex >= fromTurnIdx && activeTurnIndex >= toTurnIdx;
            return (
              <GraphEdge
                key={edge.id}
                sections={edge.sections}
                isActive={isActive}
              />
            );
          })}

          {/* Internal edges of expanded turns */}
          {layoutResult.nodes.map(function (node) {
            if (!node.isExpanded || !node.edges) return null;
            return node.edges.map(function (edge) {
              return (
                <GraphEdge
                  key={edge.id}
                  sections={edge.sections}
                  parentOffset={edge.parentOffset}
                  isActive={activeTurnIndex === node.turnIndex}
                />
              );
            });
          })}

          {/* Nodes */}
          {layoutResult.nodes.map(function (node) {
            var isActive = activeTurnIndex === node.turnIndex;
            var isFuture = node.startTime > currentTime;
            var isSelected = selectedNode && selectedNode.id === node.id;

            if (node.isExpanded) {
              return (
                <ExpandedTurnNode
                  key={node.id}
                  node={node}
                  isActive={isActive}
                  isFuture={isFuture}
                  isSelected={isSelected}
                  onSelect={handleSelectNode}
                  onCollapse={handleCollapse}
                  currentTime={currentTime}
                >
                  {node.children && node.children.map(function (child) {
                    var childActive = isActive && child.event &&
                      currentTime >= child.event.t &&
                      currentTime <= child.event.t + (child.event.duration || 0);
                    var childFuture = child.event && child.event.t > currentTime;
                    var childSelected = selectedNode && selectedNode.id === child.id;
                    return (
                      <ToolCallNode
                        key={child.id}
                        node={child}
                        isActive={childActive}
                        isFuture={childFuture}
                        isSelected={childSelected}
                        onSelect={handleSelectNode}
                      />
                    );
                  })}
                </ExpandedTurnNode>
              );
            }

            return (
              <TurnNode
                key={node.id}
                node={node}
                isActive={isActive}
                isFuture={isFuture}
                isSelected={isSelected}
                onSelect={handleSelectNode}
                onExpand={handleExpand}
              />
            );
          })}
        </svg>

        {/* Controls overlay */}
        <div style={{
          position: "absolute",
          bottom: 12,
          right: 12,
          display: "flex",
          gap: 4,
        }}>
          <button
            className="av-btn"
            onClick={handleFitView}
            style={{
              background: theme.bg.raised,
              border: "1px solid " + theme.border.default,
              borderRadius: theme.radius.md,
              color: theme.text.muted,
              padding: "4px 8px",
              fontSize: theme.fontSize.sm,
              fontFamily: theme.font.mono,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            <Icon name="arrow-up-down" size={11} /> Fit
          </button>
        </div>

        {graphData.truncated && (
          <div style={{
            position: "absolute",
            top: 10,
            left: "50%",
            transform: "translateX(-50%)",
            background: alpha(theme.bg.surface, 0.9),
            border: "1px solid " + theme.border.default,
            borderRadius: theme.radius.lg,
            padding: "4px 12px",
            fontSize: theme.fontSize.xs,
            color: theme.text.dim,
            fontFamily: theme.font.mono,
            pointerEvents: "none",
          }}>
            Showing first 80 of {graphData.totalTurns} turns
          </div>
        )}

        {/* Legend */}
        <div style={{
          position: "absolute",
          bottom: 12,
          left: 12,
          display: "flex",
          gap: 12,
          fontSize: theme.fontSize.xs,
          color: theme.text.dim,
          fontFamily: theme.font.mono,
        }}>
          <span>Click: select</span>
          <span>Double-click: expand turn</span>
          <span>Drag: pan</span>
          <span>Scroll: zoom</span>
        </div>
      </div>

      <GraphInspector selectedNode={selectedNode} />
    </ResizablePanel>
  );
}

function truncateSVGText(text, maxWidth) {
  // Approximate: ~6px per character at 10px font
  var maxChars = Math.floor(maxWidth / 6);
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars - 3) + "...";
}

function formatTime(seconds) {
  if (seconds == null || isNaN(seconds)) return "--";
  var m = Math.floor(seconds / 60);
  var s = Math.floor(seconds % 60);
  return m + ":" + (s < 10 ? "0" : "") + s;
}
