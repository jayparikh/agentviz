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
  agent: theme.track.agent,
  fork: theme.track.agent,
  join: theme.track.agent,
};

function getTrackColor(track) {
  return NODE_COLORS[track] || theme.track.reasoning;
}

function getAgentTypeColor(agentName) {
  return theme.agentType[agentName] || theme.agentType.default;
}

function getNodeColor(node) {
  if (!node) return theme.track.reasoning;
  if (node.type === "agent_branch") return getAgentTypeColor(node.agentName);
  if (node.type === "fork" || node.type === "join") return theme.track.agent;
  return getTrackColor(node.track);
}

function getNodeTitle(node) {
  if (!node) return "";
  if (node.type === "agent_branch") return node.agentDisplayName || node.agentName || node.label;
  if (node.type === "fork") return "Fork";
  if (node.type === "join") return "Join";
  if (node.type === "turn") return "Turn " + node.turnIndex;
  return node.label || node.type;
}

function usePrefersReducedMotion() {
  var [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(function () {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    var media = window.matchMedia("(prefers-reduced-motion: reduce)");
    setPrefersReducedMotion(media.matches);

    function handleChange(e) {
      setPrefersReducedMotion(e.matches);
    }

    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", handleChange);
      return function () {
        media.removeEventListener("change", handleChange);
      };
    }

    media.addListener(handleChange);
    return function () {
      media.removeListener(handleChange);
    };
  }, []);

  return prefersReducedMotion;
}

// ── Edge rendering with animated flowing dots ──

function GraphEdge({ sections, parentOffset, isActive, prefersReducedMotion }) {
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
        {isActive && !prefersReducedMotion && (
          <circle r="3" fill={theme.accent.primary}>
            <animateMotion dur="1.5s" repeatCount="indefinite" path={d} />
          </circle>
        )}
      </g>
    );
  });

  return <g>{paths}</g>;
}

function getEdgeActive(edge, nodeById, currentTime) {
  if (!edge) return false;
  if (edge.activationTime != null) return currentTime >= edge.activationTime;
  var sourceNode = nodeById[edge.sources[0]];
  var targetNode = nodeById[edge.targets[0]];
  var threshold = Math.min(
    sourceNode && sourceNode.endTime != null ? sourceNode.endTime : Infinity,
    targetNode && targetNode.startTime != null ? targetNode.startTime : Infinity
  );
  if (!isFinite(threshold)) return false;
  return currentTime >= threshold;
}

// ── Turn node (collapsed) ──

function TurnNode({ node, isActive, isFuture, isSelected, onSelect, onExpand, prefersReducedMotion }) {
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
          {!prefersReducedMotion && (
            <animate
              attributeName="opacity"
              values="0.5;0.15;0.5"
              dur="2s"
              repeatCount="indefinite"
            />
          )}
        </rect>
      )}
    </g>
  );
}

// ── Tool call node (inside expanded turn) ──

function ToolCallNode({ node, isActive, isFuture, isSelected, onSelect, prefersReducedMotion }) {
  var isAgent = node.event && node.event.agentName && node.event.toolName === "task";
  var color = isAgent ? getAgentTypeColor(node.event.agentName) : getTrackColor("tool_call");
  var opacity = isFuture ? 0.25 : 1;
  var displayLabel = isAgent
    ? (node.event.agentDisplayName || node.event.agentName || node.label)
    : node.label;
  var nodeRx = isAgent ? theme.radius.xl : theme.radius.md;

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
        rx={nodeRx}
        ry={nodeRx}
        fill={isSelected ? alpha(color, 0.15) : (isAgent ? alpha(color, 0.06) : theme.bg.surface)}
        stroke={isActive ? color : isSelected ? color : (isAgent ? alpha(color, 0.4) : theme.border.default)}
        strokeWidth={isActive ? 1.5 : 1}
        strokeDasharray={isAgent ? "4 2" : "none"}
      />
      {node.isError && (
        <rect
          width={node.width}
          height={node.height}
          rx={nodeRx}
          ry={nodeRx}
          fill={alpha(theme.semantic.error, 0.08)}
          stroke={theme.semantic.errorBorder}
          strokeWidth={1}
        />
      )}
      {isAgent && (
        <circle
          cx={10}
          cy={node.height / 2}
          r={4}
          fill={color}
        />
      )}
      <text
        x={isAgent ? 20 : 12}
        y={22}
        fill={isActive ? color : (isAgent ? color : theme.text.secondary)}
        fontSize={theme.fontSize.xs}
        fontFamily={theme.font.mono}
        fontWeight={isAgent ? 600 : 500}
      >
        {displayLabel}
      </text>
      {isActive && (
        <rect
          width={node.width + 2}
          height={node.height + 2}
          x={-1}
          y={-1}
          rx={theme.radius.md + 1}
          ry={theme.radius.md + 1}
          fill="none"
          stroke={color}
          strokeWidth={1}
          opacity={0.4}
        >
          {!prefersReducedMotion && (
            <animate
              attributeName="opacity"
              values="0.4;0.1;0.4"
              dur="2s"
              repeatCount="indefinite"
            />
          )}
        </rect>
      )}
    </g>
  );
}

function BranchMarkerNode({ node, isActive, isFuture, isSelected, onSelect, prefersReducedMotion, parentOffset }) {
  var color = getNodeColor(node);
  var opacity = isFuture ? 0.25 : 1;
  var ox = parentOffset ? parentOffset.x : 0;
  var oy = parentOffset ? parentOffset.y : 0;
  var x = node.x + ox;
  var y = node.y + oy;
  var diamondPath = [
    "M", x + (node.width / 2), y,
    "L", x + node.width, y + (node.height / 2),
    "L", x + (node.width / 2), y + node.height,
    "L", x, y + (node.height / 2),
    "Z",
  ].join(" ");

  return (
    <g
      style={{ cursor: "pointer", opacity: opacity }}
      onClick={function (e) {
        e.stopPropagation();
        onSelect(node);
      }}
    >
      <path
        d={diamondPath}
        fill={isSelected ? alpha(color, 0.18) : alpha(theme.bg.raised, 0.92)}
        stroke={isActive ? color : isSelected ? color : alpha(color, 0.6)}
        strokeWidth={isActive ? 2 : 1.25}
      />
      <text
        x={x + (node.width / 2)}
        y={y + (node.height / 2) + 3}
        fill={isActive ? color : theme.text.secondary}
        fontSize={theme.fontSize.xs}
        fontFamily={theme.font.mono}
        textAnchor="middle"
        fontWeight={600}
      >
        {node.type === "fork" ? "\u2442" : "\u22C8"}
      </text>
      {node.branchCount > 1 && (
        <text
          x={x + (node.width / 2)}
          y={y + node.height + 11}
          fill={theme.text.dim}
          fontSize={9}
          fontFamily={theme.font.mono}
          textAnchor="middle"
        >
          {node.branchCount + " branches"}
        </text>
      )}
      {isActive && !prefersReducedMotion && (
        <path
          d={diamondPath}
          fill="none"
          stroke={color}
          strokeWidth={1}
          opacity={0.35}
        >
          <animate attributeName="opacity" values="0.35;0.1;0.35" dur="2s" repeatCount="indefinite" />
        </path>
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
        rx={theme.radius.xl}
        ry={theme.radius.xl}
        fill={alpha(theme.bg.surface, 0.5)}
        stroke={isActive ? color : theme.border.default}
        strokeWidth={isActive ? 2 : 1}
        strokeDasharray={isActive ? "none" : "4 2"}
      />
      {/* Header */}
      <text
        x={16}
        y={24}
        fill={color}
        fontSize={theme.fontSize.sm}
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
      {node.parallelAgentCount > 1 && (
        <g transform={"translate(" + (node.width - 128) + ", 10)"}>
          <rect
            width={112}
            height={18}
            rx={theme.radius.full}
            fill={alpha(theme.track.agent, 0.12)}
            stroke={alpha(theme.track.agent, 0.35)}
            strokeWidth={1}
          />
          <text
            x={56}
            y={12}
            fill={theme.track.agent}
            fontSize={9}
            fontFamily={theme.font.mono}
            textAnchor="middle"
            fontWeight={600}
          >
            {node.parallelAgentCount + " parallel agents"}
          </text>
        </g>
      )}
      {children}
    </g>
  );
}

function AgentBranchNode({ node, isActive, isFuture, isSelected, onSelect, children }) {
  var color = getAgentTypeColor(node.agentName);
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
        rx={theme.radius.xl}
        ry={theme.radius.xl}
        fill={isSelected ? alpha(color, 0.14) : alpha(color, 0.06)}
        stroke={isActive ? color : isSelected ? color : alpha(color, 0.4)}
        strokeWidth={isActive ? 2 : 1}
        strokeDasharray="4 2"
      />
      <circle cx={12} cy={20} r={4} fill={color} />
      <text
        x={22}
        y={24}
        fill={color}
        fontSize={theme.fontSize.sm}
        fontFamily={theme.font.mono}
        fontWeight={600}
      >
        {node.agentDisplayName || node.agentName || node.label}
        {node.hasError && <tspan fill={theme.semantic.error}>{" \u26A0"}</tspan>}
      </text>
      {node.toolCount > 0 && (
        <text
          x={node.width - 14}
          y={24}
          fill={theme.text.dim}
          fontSize={9}
          fontFamily={theme.font.mono}
          textAnchor="end"
        >
          {node.toolCount + " tools"}
        </text>
      )}
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
  var isBranch = selectedNode.type === "agent_branch";
  var isMarker = selectedNode.type === "fork" || selectedNode.type === "join";
  var event = selectedNode.event;
  var color = getNodeColor(selectedNode);

  return (
    <div style={{
      padding: theme.space.lg,
      fontFamily: theme.font.mono,
      fontSize: theme.fontSize.sm,
      color: theme.text.secondary,
      overflowY: "auto",
      height: "100%",
    }}>
      <div style={{
        fontSize: theme.fontSize.md,
        color: color,
        fontWeight: 600,
        marginBottom: theme.space.lg,
        display: "flex",
        alignItems: "center",
        gap: theme.space.sm,
      }}>
        <Icon
          name={isTurn ? "message-circle" : isBranch ? "agent" : isMarker ? "graph" : "tool_call"}
          size={14}
          style={{ color: color }}
        />
        {getNodeTitle(selectedNode)}
      </div>

      {isTurn && selectedNode.snippet && (
        <div style={{ marginBottom: theme.space.lg }}>
          <div style={{ color: theme.text.dim, fontSize: theme.fontSize.xs, textTransform: "uppercase", letterSpacing: 1, marginBottom: theme.space.sm }}>User message</div>
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
        <div style={{ display: "flex", gap: theme.space.xl, marginBottom: theme.space.lg }}>
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

      {isBranch && (
        <div style={{ marginBottom: theme.space.lg }}>
          <div style={{ display: "flex", gap: theme.space.xl, marginBottom: theme.space.lg }}>
            <div>
              <div style={{ color: theme.text.dim, fontSize: theme.fontSize.xs }}>Turn</div>
              <div style={{ color: theme.text.primary, fontSize: theme.fontSize.md }}>{selectedNode.turnIndex}</div>
            </div>
            <div>
              <div style={{ color: theme.text.dim, fontSize: theme.fontSize.xs }}>Agent</div>
              <div style={{ color: theme.text.primary, fontSize: theme.fontSize.md }}>{selectedNode.agentDisplayName || selectedNode.agentName || "Agent"}</div>
            </div>
            <div>
              <div style={{ color: theme.text.dim, fontSize: theme.fontSize.xs }}>Tools</div>
              <div style={{ color: theme.text.primary, fontSize: theme.fontSize.md }}>{selectedNode.toolCount || 0}</div>
            </div>
          </div>
          {selectedNode.snippet && (
            <div>
              <div style={{ color: theme.text.dim, fontSize: theme.fontSize.xs, textTransform: "uppercase", letterSpacing: 1, marginBottom: theme.space.sm }}>Launch</div>
              <div style={{
                background: theme.bg.surface,
                borderRadius: theme.radius.md,
                padding: "8px 10px",
                color: theme.text.primary,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}>
                {selectedNode.snippet}
              </div>
            </div>
          )}
        </div>
      )}

      {isMarker && (
        <div style={{ marginBottom: theme.space.lg }}>
          <div style={{ display: "flex", gap: theme.space.xl, marginBottom: theme.space.lg }}>
            <div>
              <div style={{ color: theme.text.dim, fontSize: theme.fontSize.xs }}>Turn</div>
              <div style={{ color: theme.text.primary, fontSize: theme.fontSize.md }}>{selectedNode.turnIndex}</div>
            </div>
            <div>
              <div style={{ color: theme.text.dim, fontSize: theme.fontSize.xs }}>Branches</div>
              <div style={{ color: theme.text.primary, fontSize: theme.fontSize.md }}>{selectedNode.branchCount || 0}</div>
            </div>
          </div>
          {selectedNode.agents && selectedNode.agents.length > 0 && (
            <div>
              <div style={{ color: theme.text.dim, fontSize: theme.fontSize.xs, textTransform: "uppercase", letterSpacing: 1, marginBottom: theme.space.sm }}>Agents</div>
              <div style={{ color: theme.text.primary, lineHeight: 1.5 }}>
                {selectedNode.agents.join(", ")}
              </div>
            </div>
          )}
        </div>
      )}

      {!isTurn && !isBranch && !isMarker && event && (
        <div>
          <div style={{ marginBottom: theme.space.lg }}>
            <div style={{ color: theme.text.dim, fontSize: theme.fontSize.xs, textTransform: "uppercase", letterSpacing: 1, marginBottom: theme.space.sm }}>Tool</div>
            <div style={{ color: theme.text.primary }}>{event.toolName || "unknown"}</div>
          </div>
          {event.duration > 0 && (
            <div style={{ marginBottom: theme.space.lg }}>
              <div style={{ color: theme.text.dim, fontSize: theme.fontSize.xs, textTransform: "uppercase", letterSpacing: 1, marginBottom: theme.space.sm }}>Duration</div>
              <div style={{ color: theme.text.primary }}>{event.duration.toFixed(1)}s</div>
            </div>
          )}
          {event.isError && (
            <div style={{ marginBottom: theme.space.lg }}>
              <div style={{ color: theme.semantic.error, fontSize: theme.fontSize.sm }}>
                <Icon name="alert-circle" size={12} /> Error
              </div>
            </div>
          )}
          {event.toolInput && (
            <div style={{ marginBottom: theme.space.lg }}>
              <div style={{ color: theme.text.dim, fontSize: theme.fontSize.xs, textTransform: "uppercase", letterSpacing: 1, marginBottom: theme.space.sm }}>Input</div>
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
            <div style={{ marginBottom: theme.space.lg }}>
              <div style={{ color: theme.text.dim, fontSize: theme.fontSize.xs, textTransform: "uppercase", letterSpacing: 1, marginBottom: theme.space.sm }}>Output</div>
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
  var prefersReducedMotion = usePrefersReducedMotion();
  var svgRef = useRef(null);
  var isPanning = useRef(false);
  var panStart = useRef({ x: 0, y: 0 });
  var viewBoxRef = useRef(null);

  // Build graph data from turns
  var graphData = useMemo(function () {
    return buildGraphData(eventEntries, turns, expandedTurns);
  }, [eventEntries, turns, expandedTurns]);

  var nodeById = useMemo(function () {
    var map = {};
    if (!layoutResult || !layoutResult.nodes) return map;
    for (var i = 0; i < layoutResult.nodes.length; i++) {
      var node = layoutResult.nodes[i];
      map[node.id] = node;
      if (node.children) {
        for (var j = 0; j < node.children.length; j++) {
          map[node.children[j].id] = node.children[j];
        }
      }
      if (node.inlineMarkers) {
        for (var k = 0; k < node.inlineMarkers.length; k++) {
          map[node.inlineMarkers[k].id] = node.inlineMarkers[k];
        }
      }
    }
    return map;
  }, [layoutResult]);

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
            userSelect: "none",
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
            var isActive = getEdgeActive(edge, nodeById, currentTime);
            return (
              <GraphEdge
                key={edge.id}
                sections={edge.sections}
                isActive={isActive}
                prefersReducedMotion={prefersReducedMotion}
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
                  isActive={getEdgeActive(edge, nodeById, currentTime)}
                  prefersReducedMotion={prefersReducedMotion}
                />
              );
            });
          })}

          {/* Nodes */}
          {layoutResult.nodes.map(function (node) {
            var isActive = currentTime >= (node.startTime || 0) && currentTime <= (node.endTime || node.startTime || 0);
            var isFuture = node.startTime > currentTime;
            var isSelected = selectedNode && selectedNode.id === node.id;

            if (node.type === "agent_branch") {
              return (
                <AgentBranchNode
                  key={node.id}
                  node={node}
                  isActive={isActive}
                  isFuture={isFuture}
                  isSelected={isSelected}
                  onSelect={handleSelectNode}
                >
                  {node.children && node.children.map(function (child) {
                    var childActive = child.event &&
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
                        prefersReducedMotion={prefersReducedMotion}
                      />
                    );
                  })}
                </AgentBranchNode>
              );
            }

            if (node.type === "fork" || node.type === "join") {
              return (
                <BranchMarkerNode
                  key={node.id}
                  node={node}
                  isActive={isActive}
                  isFuture={isFuture}
                  isSelected={isSelected}
                  onSelect={handleSelectNode}
                  prefersReducedMotion={prefersReducedMotion}
                />
              );
            }

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
                  {node.inlineMarkers && node.inlineMarkers.map(function (marker) {
                    var markerActive = currentTime >= (marker.startTime || 0) &&
                      currentTime <= (marker.endTime || marker.startTime || 0);
                    var markerFuture = marker.startTime > currentTime;
                    var markerSelected = selectedNode && selectedNode.id === marker.id;
                    return (
                      <BranchMarkerNode
                        key={marker.id}
                        node={marker}
                        isActive={markerActive}
                        isFuture={markerFuture}
                        isSelected={markerSelected}
                        onSelect={handleSelectNode}
                        prefersReducedMotion={prefersReducedMotion}
                        parentOffset={{ x: node.x, y: node.y }}
                      />
                    );
                  })}
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
                        prefersReducedMotion={prefersReducedMotion}
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
                prefersReducedMotion={prefersReducedMotion}
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
