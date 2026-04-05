/**
 * Graph layout builder for the Graph view.
 *
 * Takes parsed session data (events, turns) and produces an ELKjs-compatible
 * graph structure, then runs layout to get positioned nodes and edges.
 */
import ELK from "elkjs/lib/elk-api.js";

var elk = new ELK({
  workerUrl: new URL("elkjs/lib/elk-worker.min.js", import.meta.url),
});

/**
 * Group tool call entries into concurrency groups based on temporal overlap.
 * Tools whose time ranges overlap are placed in the same group (parallel).
 * Sequential tools (no overlap) start a new group.
 * Returns an array of groups, where each group is an array of tool entries.
 */
export function buildConcurrencyGroups(toolEntries) {
  if (toolEntries.length === 0) return [];

  var groups = [[toolEntries[0]]];

  for (var i = 1; i < toolEntries.length; i++) {
    var curr = toolEntries[i];
    var currStart = curr.event.t;
    var currentGroup = groups[groups.length - 1];

    // Check if this tool overlaps with ANY tool in the current group
    var overlaps = false;
    for (var j = 0; j < currentGroup.length; j++) {
      var prev = currentGroup[j];
      var prevEnd = prev.event.t + (prev.event.duration || 0);
      if (currStart < prevEnd) {
        overlaps = true;
        break;
      }
    }

    if (overlaps) {
      currentGroup.push(curr);
    } else {
      groups.push([curr]);
    }
  }

  return groups;
}

// Build an ELK graph from turns and events
var MAX_GRAPH_TURNS = 80; // ELK gets very slow beyond ~100 nodes

export function buildGraphData(eventEntries, turns, expandedTurns) {
  var nodes = [];
  var edges = [];
  var previousTailId = null;

  if (!turns || turns.length === 0) return { nodes: [], edges: [], truncated: false };

  // Build index for O(1) event lookup by index
  var eventByIndex = {};
  for (var ei = 0; ei < eventEntries.length; ei++) {
    eventByIndex[eventEntries[ei].index] = eventEntries[ei];
  }

  // Cap turns to avoid ELK timeout on large sessions
  var truncated = turns.length > MAX_GRAPH_TURNS;
  var visibleTurns = truncated ? turns.slice(0, MAX_GRAPH_TURNS) : turns;

  for (var i = 0; i < visibleTurns.length; i++) {
    var turn = visibleTurns[i];
    var turnId = "turn-" + turn.index;
    var turnEvents = getTurnEvents(eventByIndex, turn);
    var toolCalls = turnEvents.filter(function (e) { return e.event.track === "tool_call"; });
    var hasError = turn.hasError || turnEvents.some(function (e) { return e.event.isError; });
    var dominantTrack = getDominantTrack(turnEvents);
    var snippet = buildTurnSnippet(turn, turnEvents);
    var parallelTaskGroup = findParallelTaskGroup(toolCalls);
    var shouldAutoExpand = !!parallelTaskGroup;
    var canRenderDag = shouldAutoExpand && parallelTaskGroup.every(function (entry) {
      return !!entry.event.toolCallId;
    });
    var explicitExpanded = expandedTurns && expandedTurns[turn.index];

    if (canRenderDag) {
      var dag = buildParallelAgentTurnGraph(turn, turnEvents, toolCalls, {
        dominantTrack: dominantTrack,
        hasError: hasError,
        snippet: snippet,
      });
      if (previousTailId) {
        edges.push(makeGraphEdge(previousTailId + "->" + dag.entryId, previousTailId, dag.entryId, dag.entryStartTime));
      }
      nodes = nodes.concat(dag.nodes);
      edges = edges.concat(dag.edges);
      previousTailId = dag.exitId;
      continue;
    }

    var isExpanded = !!(explicitExpanded || (shouldAutoExpand && toolCalls.length > 0));
    var node = isExpanded
      ? buildExpandedTurnNode(turn, toolCalls, {
        dominantTrack: dominantTrack,
        hasError: hasError,
        snippet: snippet,
        parallelTaskGroup: parallelTaskGroup,
        autoExpanded: shouldAutoExpand && !explicitExpanded,
      })
      : buildCollapsedTurnNode(turn, toolCalls, {
        dominantTrack: dominantTrack,
        hasError: hasError,
        snippet: snippet,
        parallelTaskGroup: parallelTaskGroup,
      });

    if (previousTailId) {
      edges.push(makeGraphEdge(previousTailId + "->" + node.id, previousTailId, node.id, node.startTime));
    }
    nodes.push(node);
    previousTailId = node.id;
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
      "elk.layered.considerModelOrder": "NODES_AND_EDGES",
      "elk.layered.crossingMinimization.forceNodeModelOrder": "true",
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
            x: elkChild.x,
            y: elkChild.y,
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

      // Build concurrency groups from root-level children
      var rootChildTools = node.children.filter(function (c) { return c.event && !c.event.parentToolCallId; });
      var hasConcurrency = false;
      var concGroups = [];
      if (rootChildTools.length > 1) {
        concGroups = buildConcurrencyGroups(rootChildTools.map(function (c) { return { event: c.event, index: c.eventIndex, id: c.id }; }));
        hasConcurrency = concGroups.some(function (g) { return g.length > 1; });
      }

      if (hasConcurrency) {
        // Manually lay out concurrent groups as side-by-side columns
        // Each column contains a root tool + its parentToolCallId children
        var childById = {};
        var childrenByParent = {};
        for (var ri = 0; ri < result.children.length; ri++) {
          var rc = result.children[ri];
          childById[rc.id] = rc;
          if (rc.event && rc.event.parentToolCallId) {
            if (!childrenByParent[rc.event.parentToolCallId]) childrenByParent[rc.event.parentToolCallId] = [];
            childrenByParent[rc.event.parentToolCallId].push(rc);
          }
        }

        // Find the concurrent group (the one with >1 items)
        var concGroup = concGroups.find(function (g) { return g.length > 1; });
        if (concGroup) {
          var COL_GAP = 32;
          var ROW_GAP = 12;
          var FORK_JOIN_GAP = 24;
          var showInlineForkJoin = node.type === "turn" && node.parallelAgentCount > 1;
          var forkMarkerHeight = showInlineForkJoin ? 36 : 0;
          var joinMarkerHeight = showInlineForkJoin ? 36 : 0;
          var HEADER_Y = showInlineForkJoin ? 40 + forkMarkerHeight + FORK_JOIN_GAP : 40;
          var colX = 20;
          var minColumnX = null;
          var maxColumnRight = 0;

          for (var ci = 0; ci < concGroup.length; ci++) {
            var rootEntry = concGroup[ci];
            var rootNode = childById[rootEntry.id];
            if (!rootNode) continue;

            // O(1) lookup for children of this root
            var childNodes = (rootNode.event && rootNode.event.toolCallId)
              ? (childrenByParent[rootNode.event.toolCallId] || [])
              : [];

            // Calculate column width
            var colW = rootNode.width;
            for (var ki = 0; ki < childNodes.length; ki++) {
              if (childNodes[ki].width > colW) colW = childNodes[ki].width;
            }

            // Position root at top of column
            rootNode.x = colX;
            rootNode.y = HEADER_Y;

            // Stack children vertically below root
            var childY = HEADER_Y + rootNode.height + ROW_GAP;
            for (var cni = 0; cni < childNodes.length; cni++) {
              childNodes[cni].x = colX;
              childNodes[cni].y = childY;
              childY += childNodes[cni].height + ROW_GAP;
            }

            if (minColumnX == null || colX < minColumnX) minColumnX = colX;
            if (colX + colW > maxColumnRight) maxColumnRight = colX + colW;
            colX += colW + COL_GAP;
          }

          // Position non-concurrent/non-child nodes as a final column
          var handledIds = {};
          for (var qi = 0; qi < concGroup.length; qi++) {
            var rn = childById[concGroup[qi].id];
            handledIds[concGroup[qi].id] = true;
            if (rn && rn.event && rn.event.toolCallId) {
              result.children.forEach(function (c) {
                if (c.event && c.event.parentToolCallId === rn.event.toolCallId) {
                  handledIds[c.id] = true;
                }
              });
            }
          }
          var remaining = result.children.filter(function (c) { return !handledIds[c.id]; });
          if (remaining.length > 0) {
            var seqY = HEADER_Y;
            for (var si = 0; si < remaining.length; si++) {
              remaining[si].x = colX;
              remaining[si].y = seqY;
              seqY += remaining[si].height + ROW_GAP;
            }
            if (minColumnX == null) minColumnX = colX;
            if (seqY > 0) {
              var remRight = colX + remaining[0].width;
              if (remRight > maxColumnRight) maxColumnRight = remRight;
            }
          }

          // Resize compound node to fit
          var maxRight = 0;
          var maxBottom = 0;
          for (var fi = 0; fi < result.children.length; fi++) {
            var cr = result.children[fi];
            var right = cr.x + cr.width;
            var bottom = cr.y + cr.height;
            if (right > maxRight) maxRight = right;
            if (bottom > maxBottom) maxBottom = bottom;
          }
          if (showInlineForkJoin && minColumnX != null) {
            var markerWidth = 60;
            var centerX = minColumnX + ((maxColumnRight - minColumnX) / 2) - (markerWidth / 2);
            var forkMarkerY = 40;
            var joinMarkerY = maxBottom + FORK_JOIN_GAP;
            result.inlineMarkers = [
              {
                id: "inline-fork-" + node.turnIndex,
                type: "fork",
                label: "Fork",
                x: centerX,
                y: forkMarkerY,
                width: markerWidth,
                height: forkMarkerHeight,
                turnIndex: node.turnIndex,
                startTime: node.startTime,
                endTime: node.startTime,
                branchCount: node.parallelAgentCount,
                agents: node.parallelAgentNames || [],
              },
              {
                id: "inline-join-" + node.turnIndex,
                type: "join",
                label: "Join",
                x: centerX,
                y: joinMarkerY,
                width: markerWidth,
                height: joinMarkerHeight,
                turnIndex: node.turnIndex,
                startTime: node.endTime,
                endTime: node.endTime,
                branchCount: node.parallelAgentCount,
                agents: node.parallelAgentNames || [],
                hasError: node.hasError,
              },
            ];
          }
          result.width = Math.max(result.width, maxRight + 20);
          result.height = Math.max(
            result.height,
            maxBottom + 16 + (showInlineForkJoin ? joinMarkerHeight + FORK_JOIN_GAP : 0)
          );
        }
      } else if (result.children.length > 0) {
        // No concurrency: center all children at the same x
        var childW = result.children[0].width;
        var centeredX = (pos.width - childW) / 2;
        for (var ci2 = 0; ci2 < result.children.length; ci2++) {
          result.children[ci2] = Object.assign({}, result.children[ci2], { x: centeredX });
        }
      }
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

      // Build a lookup from child id to positioned child
      var childPosMap = {};
      if (pNode.children) {
        for (var cp = 0; cp < pNode.children.length; cp++) {
          childPosMap[pNode.children[cp].id] = pNode.children[cp];
        }
      }

      pNode.edges = pNode.edges.map(function (edge) {
        // Recompute edge sections from actual child positions
        var sourceNode = childPosMap[edge.sources[0]];
        var targetNode = childPosMap[edge.targets[0]];
        var sections = null;

        if (sourceNode && targetNode) {
          // Simple straight-line edge from bottom-center of source to top-center of target
          var startX = sourceNode.x + sourceNode.width / 2;
          var startY = sourceNode.y + sourceNode.height;
          var endX = targetNode.x + targetNode.width / 2;
          var endY = targetNode.y;
          sections = [{
            startPoint: { x: startX, y: startY },
            endPoint: { x: endX, y: endY },
          }];
        } else {
          // Fall back to ELK sections
          var elkEdge = parentElk && findElkEdge(parentElk.edges || [], edge.id);
          sections = elkEdge ? elkEdge.sections : null;
        }

        return Object.assign({}, edge, {
          sections: sections,
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

function makeGraphEdge(id, sourceId, targetId, activationTime, extra) {
  return Object.assign({
    id: id,
    sources: [sourceId],
    targets: [targetId],
    activationTime: activationTime == null ? 0 : activationTime,
  }, extra || {});
}

function getEventEndTime(event) {
  if (!event) return 0;
  return (event.t || 0) + (event.duration || 0);
}

function normalizeIdPart(value, index) {
  var base = String(value || "unknown").replace(/[^a-zA-Z0-9_-]+/g, "-");
  // Append index when provided to guarantee uniqueness even if normalization collides
  return index != null ? base + "--" + index : base;
}

function findParallelTaskGroup(toolCalls) {
  var rootTools = toolCalls.filter(function (tc) { return !tc.event.parentToolCallId; });
  if (rootTools.length < 2) return null;
  var groups = buildConcurrencyGroups(rootTools);
  for (var i = 0; i < groups.length; i++) {
    // Extract only task tools from each concurrent group (handles mixed groups)
    var tasks = groups[i].filter(function (entry) { return entry.event.toolName === "task"; });
    if (tasks.length > 1) return tasks;
  }
  return null;
}

function getCompoundLayoutOptions(type) {
  return {
    "elk.algorithm": "layered",
    "elk.direction": "DOWN",
    "elk.spacing.nodeNode": "16",
    "elk.padding": type === "agent_branch"
      ? "[top=36,left=16,bottom=16,right=16]"
      : "[top=40,left=20,bottom=16,right=20]",
    "elk.separateConnectedComponents": "true",
    "elk.layered.compaction.connectedComponents": "true",
  };
}

function buildCompoundChildren(turnIndex, toolEntries, idPrefix) {
  var children = [];
  var childIdByEntryIndex = {};
  var childIdByToolCallId = {};

  for (var j = 0; j < toolEntries.length; j++) {
    var tc = toolEntries[j];
    var childId = idPrefix + j;
    childIdByEntryIndex[tc.index] = childId;
    if (tc.event.toolCallId) childIdByToolCallId[tc.event.toolCallId] = childId;
    children.push({
      id: childId,
      type: "tool_call",
      label: tc.event.toolName || "tool",
      isError: tc.event.isError,
      track: "tool_call",
      eventIndex: tc.index,
      event: tc.event,
      turnIndex: turnIndex,
      width: 160,
      height: 36,
    });
  }

  var childEdges = [];
  for (var k = 0; k < toolEntries.length; k++) {
    var tcEvent = toolEntries[k].event;
    var childNodeId = childIdByEntryIndex[toolEntries[k].index];
    if (tcEvent.parentToolCallId && childIdByToolCallId[tcEvent.parentToolCallId]) {
      var parentId = childIdByToolCallId[tcEvent.parentToolCallId];
      childEdges.push(makeGraphEdge(parentId + "->" + childNodeId, parentId, childNodeId, tcEvent.t));
    }
  }

  var rootEntries = toolEntries.filter(function (entry) {
    return !entry.event.parentToolCallId || !childIdByToolCallId[entry.event.parentToolCallId];
  }).map(function (entry) {
    return {
      event: entry.event,
      index: entry.index,
      id: childIdByEntryIndex[entry.index],
    };
  });
  var concurrencyGroups = buildConcurrencyGroups(rootEntries);

  for (var g = 1; g < concurrencyGroups.length; g++) {
    var prevGroup = concurrencyGroups[g - 1];
    var currGroup = concurrencyGroups[g];
    var lastOfPrev = prevGroup[prevGroup.length - 1];
    var firstOfCurr = currGroup[0];
    childEdges.push(makeGraphEdge(
      lastOfPrev.id + "->" + firstOfCurr.id,
      lastOfPrev.id,
      firstOfCurr.id,
      firstOfCurr.event.t
    ));
  }

  return { children: children, childEdges: childEdges };
}

function buildExpandedTurnNode(turn, toolCalls, options) {
  var compound = buildCompoundChildren(turn.index, toolCalls, "tool-" + turn.index + "-");
  return {
    id: "turn-" + turn.index,
    type: "turn",
    label: "Turn " + turn.index,
    snippet: options.snippet,
    toolCount: toolCalls.length,
    hasError: options.hasError,
    track: options.dominantTrack,
    turnIndex: turn.index,
    startTime: turn.startTime,
    endTime: turn.endTime,
    isExpanded: true,
    canExpand: true,
    autoExpanded: !!options.autoExpanded,
    parallelAgentCount: options.parallelTaskGroup ? options.parallelTaskGroup.length : 0,
    parallelAgentNames: options.parallelTaskGroup
      ? options.parallelTaskGroup.map(function (entry) { return entry.event.agentDisplayName || entry.event.agentName || "Agent"; })
      : [],
    children: compound.children,
    edges: compound.childEdges,
    layoutOptions: getCompoundLayoutOptions("turn"),
  };
}

function buildCollapsedTurnNode(turn, toolCalls, options) {
  return {
    id: "turn-" + turn.index,
    type: "turn",
    label: "Turn " + turn.index,
    snippet: options.snippet,
    toolCount: toolCalls.length,
    hasError: options.hasError,
    track: options.dominantTrack,
    turnIndex: turn.index,
    startTime: turn.startTime,
    endTime: turn.endTime,
    isExpanded: false,
    canExpand: toolCalls.length > 0,
    parallelAgentCount: options.parallelTaskGroup ? options.parallelTaskGroup.length : 0,
    parallelAgentNames: options.parallelTaskGroup
      ? options.parallelTaskGroup.map(function (entry) { return entry.event.agentDisplayName || entry.event.agentName || "Agent"; })
      : [],
    width: 180,
    height: 64,
  };
}

/**
 * Collect all transitive descendants of a root toolCallId.
 * Walks the full parentToolCallId chain so nested agents are included.
 * Bounded to toolCalls.length iterations to prevent cycles.
 */
function collectDescendants(toolCalls, rootToolCallId) {
  var descendants = [];
  var knownIds = {};
  knownIds[rootToolCallId] = true;
  var maxIterations = toolCalls.length;
  var changed = true;
  while (changed && maxIterations-- > 0) {
    changed = false;
    for (var i = 0; i < toolCalls.length; i++) {
      var entry = toolCalls[i];
      var entryKey = entry.event.toolCallId || ("idx-" + entry.index);
      if (entry.event.parentToolCallId && knownIds[entry.event.parentToolCallId] && !knownIds[entryKey]) {
        descendants.push(entry);
        knownIds[entryKey] = true;
        changed = true;
      }
    }
  }
  return descendants;
}

function buildParallelAgentTurnGraph(turn, turnEvents, toolCalls, options) {
  var turnId = "turn-" + turn.index;
  var taskGroup = (findParallelTaskGroup(toolCalls) || []).slice().sort(function (a, b) {
    if (a.event.t !== b.event.t) return a.event.t - b.event.t;
    var aLabel = a.event.agentDisplayName || a.event.agentName || a.event.toolCallId || "";
    var bLabel = b.event.agentDisplayName || b.event.agentName || b.event.toolCallId || "";
    return aLabel.localeCompare(bLabel);
  });
  var forkTime = taskGroup.length > 0 ? taskGroup[0].event.t : turn.startTime;
  var branchNodes = [];
  var branchNames = [];
  var branchEndTimes = [];
  var edges = [];
  var claimedIndices = {};

  // Mark all task group root entries as claimed
  for (var tg = 0; tg < taskGroup.length; tg++) {
    claimedIndices[taskGroup[tg].index] = true;
  }

  for (var i = 0; i < taskGroup.length; i++) {
    var rootTask = taskGroup[i];
    var branchId = "agent-" + turn.index + "-" + normalizeIdPart(rootTask.event.toolCallId, i);
    // Collect ALL transitive descendants, not just direct children
    var descendantTools = collectDescendants(toolCalls, rootTask.event.toolCallId);
    var idSuffix = normalizeIdPart(rootTask.event.toolCallId, i);
    var compound = buildCompoundChildren(
      turn.index,
      descendantTools,
      "agent-tool-" + turn.index + "-" + idSuffix + "-"
    );

    // Mark descendants as claimed
    for (var di = 0; di < descendantTools.length; di++) {
      claimedIndices[descendantTools[di].index] = true;
    }

    var branchError = !!rootTask.event.isError;
    var branchEnd = getEventEndTime(rootTask.event);
    for (var te = 0; te < turnEvents.length; te++) {
      var evt = turnEvents[te].event;
      // Check if event belongs to this branch (root or any descendant)
      var belongsToBranch = evt.toolCallId === rootTask.event.toolCallId;
      if (!belongsToBranch && evt.parentToolCallId) {
        for (var dd = 0; dd < descendantTools.length; dd++) {
          if (evt.toolCallId === descendantTools[dd].event.toolCallId || evt.parentToolCallId === descendantTools[dd].event.toolCallId) {
            belongsToBranch = true;
            break;
          }
        }
        if (!belongsToBranch) belongsToBranch = evt.parentToolCallId === rootTask.event.toolCallId;
      }
      if (!belongsToBranch) continue;
      if (evt.isError) branchError = true;
      if (evt.toolCallId === rootTask.event.toolCallId && evt.track === "agent") {
        branchEnd = Math.max(branchEnd, evt.t);
      } else {
        branchEnd = Math.max(branchEnd, getEventEndTime(evt));
      }
    }
    branchEndTimes.push(branchEnd);
    branchNames.push(rootTask.event.agentDisplayName || rootTask.event.agentName || "Agent");
    branchNodes.push({
      id: branchId,
      type: "agent_branch",
      label: rootTask.event.agentDisplayName || rootTask.event.agentName || rootTask.event.toolName || "Agent",
      snippet: rootTask.event.text,
      toolCount: descendantTools.length,
      hasError: branchError,
      track: "agent",
      turnIndex: turn.index,
      startTime: rootTask.event.t,
      endTime: branchEnd,
      isExpanded: true,
      canExpand: false,
      width: 220,
      height: 100,
      agentName: rootTask.event.agentName,
      agentDisplayName: rootTask.event.agentDisplayName,
      branchToolCallId: rootTask.event.toolCallId,
      rootEvent: rootTask.event,
      children: compound.children,
      edges: compound.childEdges,
      layoutOptions: getCompoundLayoutOptions("agent_branch"),
    });
  }

  var joinTime = branchEndTimes.length > 0 ? Math.max.apply(Math, branchEndTimes) : turn.endTime;
  var forkId = "fork-" + turn.index;
  var joinId = "join-" + turn.index;

  // Collect unclaimed tools (pre-fork or post-join, including descendants of non-task roots)
  var preForkTools = [];
  var postJoinTools = [];
  for (var ui = 0; ui < toolCalls.length; ui++) {
    if (claimedIndices[toolCalls[ui].index]) continue;
    var toolTime = toolCalls[ui].event.t;
    if (toolTime < forkTime) {
      preForkTools.push(toolCalls[ui]);
    } else if (toolTime >= joinTime) {
      postJoinTools.push(toolCalls[ui]);
    }
    // Tools during the fork window that aren't claimed belong nowhere — skip
  }

  var turnNode = {
    id: turnId,
    type: "turn",
    label: "Turn " + turn.index,
    snippet: options.snippet,
    toolCount: toolCalls.length,
    hasError: options.hasError,
    track: options.dominantTrack,
    turnIndex: turn.index,
    startTime: turn.startTime,
    endTime: forkTime,
    isExpanded: preForkTools.length > 0,
    canExpand: preForkTools.length > 0,
    isBranchHost: true,
    parallelAgentCount: taskGroup.length,
    parallelAgentNames: branchNames,
    width: 180,
    height: 64,
  };

  // Add pre-fork tools as children of the turn node
  if (preForkTools.length > 0) {
    var preForkCompound = buildCompoundChildren(turn.index, preForkTools, "prefork-" + turn.index + "-");
    turnNode.children = preForkCompound.children;
    turnNode.edges = preForkCompound.childEdges;
    turnNode.layoutOptions = getCompoundLayoutOptions("turn");
  }

  var forkNode = {
    id: forkId,
    type: "fork",
    label: "Fork",
    branchCount: taskGroup.length,
    track: "agent",
    turnIndex: turn.index,
    startTime: forkTime,
    endTime: joinTime,
    width: 64,
    height: 60,
    agents: branchNames,
  };
  var joinNode = {
    id: joinId,
    type: "join",
    label: "Join",
    branchCount: taskGroup.length,
    track: "agent",
    turnIndex: turn.index,
    startTime: joinTime,
    endTime: turn.endTime,
    width: 64,
    height: 60,
    agents: branchNames,
    hasError: options.hasError,
  };

  var allNodes = [turnNode, forkNode].concat(branchNodes, [joinNode]);
  edges.push(makeGraphEdge(turnId + "->" + forkId, turnId, forkId, forkTime));
  for (var bi = 0; bi < branchNodes.length; bi++) {
    edges.push(makeGraphEdge(forkId + "->" + branchNodes[bi].id, forkId, branchNodes[bi].id, branchNodes[bi].startTime));
    edges.push(makeGraphEdge(branchNodes[bi].id + "->" + joinId, branchNodes[bi].id, joinId, joinTime));
  }

  // Add post-join tools as a compound turn node after the join
  var lastId = joinId;
  if (postJoinTools.length > 0) {
    var postJoinId = "postjoin-" + turn.index;
    var postJoinCompound = buildCompoundChildren(turn.index, postJoinTools, "postjoin-tool-" + turn.index + "-");
    var postJoinNode = {
      id: postJoinId,
      type: "turn",
      label: "Post-join",
      toolCount: postJoinTools.length,
      hasError: postJoinTools.some(function (t) { return t.event.isError; }),
      track: "tool_call",
      turnIndex: turn.index,
      startTime: postJoinTools[0].event.t,
      endTime: Math.max.apply(Math, postJoinTools.map(function (t) { return getEventEndTime(t.event); })),
      isExpanded: true,
      canExpand: true,
      width: 200,
      height: 80,
      children: postJoinCompound.children,
      edges: postJoinCompound.childEdges,
      layoutOptions: getCompoundLayoutOptions("turn"),
    };
    allNodes.push(postJoinNode);
    edges.push(makeGraphEdge(joinId + "->" + postJoinId, joinId, postJoinId, postJoinNode.startTime));
    lastId = postJoinId;
  }

  return {
    nodes: allNodes,
    edges: edges,
    entryId: turnId,
    entryStartTime: turn.startTime,
    exitId: lastId,
  };
}

function getTurnEvents(eventByIndex, turn) {
  if (!turn.eventIndices) return [];
  var results = [];
  for (var i = 0; i < turn.eventIndices.length; i++) {
    var entry = eventByIndex[turn.eventIndices[i]];
    if (entry) results.push(entry);
  }
  return results;
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
  var w = maxX - minX + pad * 2;
  var h = maxY - minY + pad * 2;
  // Enforce minimum viewBox so small graphs don't blow up to fill the viewport
  var minW = 1200;
  var minH = 700;
  if (w < minW) { minX -= (minW - w) / 2; w = minW; }
  if (h < minH) { minY -= (minH - h) / 2; h = minH; }
  return { x: minX - pad, y: minY - pad, width: w, height: h };
}
