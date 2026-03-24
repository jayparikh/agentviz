/**
 * Graph layout builder for the Graph view.
 *
 * Takes parsed session data (events, turns) and produces an ELKjs-compatible
 * graph structure, then runs layout to get positioned nodes and edges.
 */
import ELK from "elkjs/lib/elk.bundled.js";

var elk = new ELK();

// Build an ELK graph from turns and events
var MAX_GRAPH_TURNS = 80; // ELK gets very slow beyond ~100 nodes

export function buildGraphData(eventEntries, turns, expandedTurns) {
  var nodes = [];
  var edges = [];
  var nodeMap = {};

  if (!turns || turns.length === 0) return { nodes: [], edges: [], truncated: false };

  // Cap turns to avoid ELK timeout on large sessions
  var truncated = turns.length > MAX_GRAPH_TURNS;
  var visibleTurns = truncated ? turns.slice(0, MAX_GRAPH_TURNS) : turns;

  for (var i = 0; i < visibleTurns.length; i++) {
    var turn = visibleTurns[i];
    var turnId = "turn-" + turn.index;
    var turnEvents = getTurnEvents(eventEntries, turn);
    var toolCalls = turnEvents.filter(function (e) { return e.event.track === "tool_call"; });
    var hasError = turn.hasError || turnEvents.some(function (e) { return e.event.isError; });
    var isExpanded = expandedTurns && expandedTurns[turn.index];

    var dominantTrack = getDominantTrack(turnEvents);
    var snippet = buildTurnSnippet(turn, turnEvents);

    if (isExpanded && toolCalls.length > 0) {
      // Expanded turn: compound node containing tool call children
      var children = [];
      var childEdges = [];
      var toolCallMap = {};

      for (var j = 0; j < toolCalls.length; j++) {
        var tc = toolCalls[j];
        var childId = "tool-" + turn.index + "-" + j;
        toolCallMap[tc.index] = childId;
        children.push({
          id: childId,
          type: "tool_call",
          label: tc.event.toolName || "tool",
          isError: tc.event.isError,
          track: "tool_call",
          eventIndex: tc.index,
          event: tc.event,
          turnIndex: turn.index,
          width: 160,
          height: 36,
        });
      }

      // Edges between tool calls based on parentToolCallId
      for (var k = 0; k < toolCalls.length; k++) {
        var tcEvent = toolCalls[k].event;
        if (tcEvent.parentToolCallId) {
          // Find the parent in this turn's tool calls
          var parentIdx = toolCalls.findIndex(function (t) {
            return t.event.toolCallId === tcEvent.parentToolCallId ||
              t.event.id === tcEvent.parentToolCallId;
          });
          if (parentIdx >= 0) {
            var parentId = "tool-" + turn.index + "-" + parentIdx;
            var childNodeId = "tool-" + turn.index + "-" + k;
            childEdges.push({
              id: parentId + "->" + childNodeId,
              sources: [parentId],
              targets: [childNodeId],
            });
          }
        }
      }

      // Sequential edges for tool calls without explicit parent
      var rootTools = toolCalls.filter(function (tc) { return !tc.event.parentToolCallId; });
      for (var m = 1; m < rootTools.length; m++) {
        var prevIdx = toolCalls.indexOf(rootTools[m - 1]);
        var currIdx = toolCalls.indexOf(rootTools[m]);
        var prevId = "tool-" + turn.index + "-" + prevIdx;
        var currId = "tool-" + turn.index + "-" + currIdx;
        childEdges.push({
          id: prevId + "->" + currId,
          sources: [prevId],
          targets: [currId],
        });
      }

      nodes.push({
        id: turnId,
        type: "turn",
        label: "Turn " + turn.index,
        snippet: snippet,
        toolCount: toolCalls.length,
        hasError: hasError,
        track: dominantTrack,
        turnIndex: turn.index,
        startTime: turn.startTime,
        endTime: turn.endTime,
        isExpanded: true,
        children: children,
        edges: childEdges,
        layoutOptions: {
          "elk.algorithm": "layered",
          "elk.direction": "DOWN",
          "elk.spacing.nodeNode": "12",
          "elk.padding": "[top=40,left=12,bottom=12,right=12]",
        },
      });
    } else {
      // Collapsed turn node
      nodes.push({
        id: turnId,
        type: "turn",
        label: "Turn " + turn.index,
        snippet: snippet,
        toolCount: toolCalls.length,
        hasError: hasError,
        track: dominantTrack,
        turnIndex: turn.index,
        startTime: turn.startTime,
        endTime: turn.endTime,
        isExpanded: false,
        width: 180,
        height: 64,
      });
    }

    nodeMap[turnId] = turn;
  }

  // Edges between consecutive turns
  for (var n = 1; n < visibleTurns.length; n++) {
    var fromId = "turn-" + visibleTurns[n - 1].index;
    var toId = "turn-" + visibleTurns[n].index;
    edges.push({
      id: fromId + "->" + toId,
      sources: [fromId],
      targets: [toId],
    });
  }

  return { nodes: nodes, edges: edges, truncated: truncated, totalTurns: turns.length };
}

// Run ELK layout on the graph data
export function runLayout(graphData) {
  var elkGraph = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.spacing.nodeNode": "32",
      "elk.layered.spacing.nodeNodeBetweenLayers": "48",
      "elk.spacing.edgeNode": "16",
      "elk.layered.mergeEdges": "true",
    },
    children: graphData.nodes.map(function (node) {
      var elkNode = {
        id: node.id,
        width: node.width || 180,
        height: node.height || 64,
      };
      if (node.isExpanded && node.children) {
        elkNode.children = node.children.map(function (child) {
          return {
            id: child.id,
            width: child.width || 160,
            height: child.height || 36,
          };
        });
        elkNode.edges = node.edges || [];
        elkNode.layoutOptions = node.layoutOptions;
      }
      return elkNode;
    }),
    edges: graphData.edges,
  };

  return elk.layout(elkGraph);
}

// Merge ELK layout positions back onto our node data
export function mergeLayout(graphData, elkResult) {
  var positionMap = {};

  if (elkResult.children) {
    for (var i = 0; i < elkResult.children.length; i++) {
      var elkNode = elkResult.children[i];
      positionMap[elkNode.id] = {
        x: elkNode.x,
        y: elkNode.y,
        width: elkNode.width,
        height: elkNode.height,
      };
      if (elkNode.children) {
        for (var j = 0; j < elkNode.children.length; j++) {
          var elkChild = elkNode.children[j];
          positionMap[elkChild.id] = {
            x: elkNode.x + elkChild.x,
            y: elkNode.y + elkChild.y,
            width: elkChild.width,
            height: elkChild.height,
          };
        }
      }
    }
  }

  var positioned = graphData.nodes.map(function (node) {
    var pos = positionMap[node.id] || { x: 0, y: 0, width: node.width || 180, height: node.height || 64 };
    var result = Object.assign({}, node, pos);
    if (node.isExpanded && node.children) {
      result.children = node.children.map(function (child) {
        var childPos = positionMap[child.id] || { x: 0, y: 0, width: child.width || 160, height: child.height || 36 };
        return Object.assign({}, child, childPos);
      });
    }
    return result;
  });

  // Process edges with sections/bendpoints from ELK
  var positionedEdges = (graphData.edges || []).map(function (edge) {
    var elkEdge = findElkEdge(elkResult.edges || [], edge.id);
    return Object.assign({}, edge, { sections: elkEdge ? elkEdge.sections : null });
  });

  // Process compound node internal edges
  for (var k = 0; k < positioned.length; k++) {
    var pNode = positioned[k];
    if (pNode.isExpanded && pNode.edges) {
      var parentElk = elkResult.children && elkResult.children.find(function (c) { return c.id === pNode.id; });
      var parentPos = positionMap[pNode.id] || { x: pNode.x || 0, y: pNode.y || 0 };
      pNode.edges = pNode.edges.map(function (edge) {
        var elkEdge = parentElk && findElkEdge(parentElk.edges || [], edge.id);
        return Object.assign({}, edge, {
          sections: elkEdge ? elkEdge.sections : null,
          parentOffset: { x: parentPos.x, y: parentPos.y },
        });
      });
    }
  }

  return { nodes: positioned, edges: positionedEdges };
}

function findElkEdge(edges, id) {
  for (var i = 0; i < edges.length; i++) {
    if (edges[i].id === id) return edges[i];
  }
  return null;
}

function getTurnEvents(eventEntries, turn) {
  if (!turn.eventIndices) return [];
  return turn.eventIndices
    .map(function (idx) {
      return eventEntries.find(function (e) { return e.index === idx; });
    })
    .filter(Boolean);
}

function getDominantTrack(events) {
  var counts = {};
  for (var i = 0; i < events.length; i++) {
    var track = events[i].event.track;
    counts[track] = (counts[track] || 0) + 1;
  }
  var max = 0;
  var dominant = "reasoning";
  for (var key in counts) {
    if (counts[key] > max) {
      max = counts[key];
      dominant = key;
    }
  }
  return dominant;
}

// Build a useful snippet for a turn node.
// Priority: real user message > tool call summary > first reasoning text > fallback
export function buildTurnSnippet(turn, turnEvents) {
  var msg = turn.userMessage || "";

  // If there's a real user message (not a placeholder), use it
  if (msg && msg !== "(continuation)" && msg !== "(system)") {
    return msg.length > 60 ? msg.slice(0, 57) + "..." : msg;
  }

  // Summarize by tool calls used in this turn
  var toolNames = [];
  var seen = {};
  for (var i = 0; i < turnEvents.length; i++) {
    var ev = turnEvents[i].event;
    if (ev.track === "tool_call" && ev.toolName && !seen[ev.toolName]) {
      seen[ev.toolName] = true;
      toolNames.push(ev.toolName);
    }
  }
  if (toolNames.length > 0) {
    var summary = toolNames.slice(0, 4).join(", ");
    if (toolNames.length > 4) summary += " +" + (toolNames.length - 4);
    return summary;
  }

  // Fall back to first non-empty reasoning/output text
  for (var j = 0; j < turnEvents.length; j++) {
    var evt = turnEvents[j].event;
    if ((evt.track === "reasoning" || evt.track === "output") && evt.text) {
      var text = evt.text.replace(/\s+/g, " ").trim();
      if (text.length > 0) {
        return text.length > 60 ? text.slice(0, 57) + "..." : text;
      }
    }
  }

  return msg || "";
}

// Compute bounding box of all nodes for viewBox calculation
export function getGraphBounds(positionedNodes) {
  if (!positionedNodes || positionedNodes.length === 0) {
    return { x: 0, y: 0, width: 400, height: 300 };
  }
  var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (var i = 0; i < positionedNodes.length; i++) {
    var n = positionedNodes[i];
    if (n.x < minX) minX = n.x;
    if (n.y < minY) minY = n.y;
    if (n.x + n.width > maxX) maxX = n.x + n.width;
    if (n.y + n.height > maxY) maxY = n.y + n.height;
  }
  var pad = 40;
  return { x: minX - pad, y: minY - pad, width: maxX - minX + pad * 2, height: maxY - minY + pad * 2 };
}
