/**
 * Waterfall view data helpers.
 *
 * Transforms normalized events into a flat list of tool-call items
 * with nesting depth (from parentToolCallId), plus summary stats
 * and binary-search windowing for virtualized rendering.
 */

var WATERFALL_ROW_HEIGHT = 32;
var WATERFALL_ROW_GAP = 2;

// Stable color palette for tool names (rotates through theme accents)
var TOOL_PALETTE = [
  "#f59e0b", // amber
  "#22d3ee", // cyan
  "#a78bfa", // purple
  "#34d399", // green
  "#60a5fa", // blue
  "#f472b6", // pink
  "#fb923c", // orange
  "#818cf8", // indigo
  "#fbbf24", // yellow
  "#2dd4bf", // teal
];

function hashToolName(name) {
  if (!name) return 0;
  var h = 0;
  for (var i = 0; i < name.length; i++) {
    h = ((h << 5) - h + name.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export function getToolColor(toolName) {
  return TOOL_PALETTE[hashToolName(toolName) % TOOL_PALETTE.length];
}

/**
 * Build waterfall items from normalized events.
 * Filters to track === "tool_call", computes nesting depth from
 * parentToolCallId chains, and returns items sorted by start time.
 *
 * Each item: { event, originalIndex, depth, parentToolCallId }
 */
export function buildWaterfallItems(events) {
  if (!events || events.length === 0) return [];

  // First pass: collect all tool_call events with their original index
  var toolEvents = [];
  for (var i = 0; i < events.length; i++) {
    if (events[i].track === "tool_call") {
      toolEvents.push({ event: events[i], originalIndex: i });
    }
  }

  if (toolEvents.length === 0) return [];

  // Build a lookup from toolCallId to its parent for depth computation.
  // toolCallId lives in raw.data.toolCallId for Copilot CLI events.
  var parentMap = {};
  var idToItem = {};

  for (var j = 0; j < toolEvents.length; j++) {
    var ev = toolEvents[j].event;
    var raw = ev.raw;
    var toolCallId = raw && raw.data ? raw.data.toolCallId : null;
    var parentId = ev.parentToolCallId || null;

    if (toolCallId) {
      idToItem[toolCallId] = toolEvents[j];
      if (parentId) {
        parentMap[toolCallId] = parentId;
      }
    }
  }

  // Compute depth by walking parent chain
  var depthCache = {};
  function getDepth(toolCallId) {
    if (!toolCallId) return 0;
    if (depthCache[toolCallId] !== undefined) return depthCache[toolCallId];

    var parent = parentMap[toolCallId];
    if (!parent || !idToItem[parent]) {
      depthCache[toolCallId] = 0;
      return 0;
    }
    // Guard against cycles
    depthCache[toolCallId] = 0;
    depthCache[toolCallId] = getDepth(parent) + 1;
    return depthCache[toolCallId];
  }

  // Build final items
  var items = [];
  for (var k = 0; k < toolEvents.length; k++) {
    var te = toolEvents[k];
    var r = te.event.raw;
    var tcId = r && r.data ? r.data.toolCallId : null;
    var depth = tcId ? getDepth(tcId) : 0;

    items.push({
      event: te.event,
      originalIndex: te.originalIndex,
      depth: depth,
      parentToolCallId: te.event.parentToolCallId || null,
    });
  }

  // Sort by start time (should already be sorted, but be safe)
  items.sort(function (a, b) { return a.event.t - b.event.t; });

  return items;
}

/**
 * Compute summary stats for waterfall items.
 */
export function getWaterfallStats(items) {
  if (!items || items.length === 0) {
    return {
      totalCalls: 0,
      maxConcurrency: 0,
      maxDepth: 0,
      longestTool: null,
      toolFrequency: {},
    };
  }

  var maxDepth = 0;
  var longestDuration = 0;
  var longestTool = null;
  var toolFrequency = {};

  // Build timeline events for concurrency calculation
  var timeline = [];

  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    var ev = item.event;

    if (item.depth > maxDepth) maxDepth = item.depth;

    if (ev.duration > longestDuration) {
      longestDuration = ev.duration;
      longestTool = ev.toolName || "unknown";
    }

    var name = ev.toolName || "unknown";
    toolFrequency[name] = (toolFrequency[name] || 0) + 1;

    timeline.push({ time: ev.t, delta: 1 });
    timeline.push({ time: ev.t + ev.duration, delta: -1 });
  }

  // Sort timeline events and sweep for max concurrency
  timeline.sort(function (a, b) {
    return a.time !== b.time ? a.time - b.time : a.delta - b.delta;
  });

  var concurrent = 0;
  var maxConcurrency = 0;
  for (var j = 0; j < timeline.length; j++) {
    concurrent += timeline[j].delta;
    if (concurrent > maxConcurrency) maxConcurrency = concurrent;
  }

  return {
    totalCalls: items.length,
    maxConcurrency: maxConcurrency,
    maxDepth: maxDepth,
    longestTool: longestTool,
    toolFrequency: toolFrequency,
  };
}

/**
 * Build layout positions for waterfall items (for virtualized rendering).
 * Returns { layoutItems, totalHeight } where each layoutItem has { item, top, height }.
 */
export function buildWaterfallLayout(items) {
  if (!items || items.length === 0) return { layoutItems: [], totalHeight: 0 };

  var top = 0;
  var layoutItems = [];

  for (var i = 0; i < items.length; i++) {
    layoutItems.push({
      item: items[i],
      top: top,
      height: WATERFALL_ROW_HEIGHT,
    });
    top += WATERFALL_ROW_HEIGHT + WATERFALL_ROW_GAP;
  }

  return { layoutItems: layoutItems, totalHeight: top };
}

/**
 * Binary search windowing for waterfall layout items.
 * Returns only items visible within scrollTop..scrollTop+viewportHeight + overscan.
 */
export function getWaterfallWindow(layoutItems, scrollTop, viewportHeight, overscanPx) {
  if (!layoutItems || layoutItems.length === 0) return [];
  if (overscanPx === undefined || overscanPx === null) overscanPx = 200;

  var targetTop = Math.max(0, scrollTop - overscanPx);
  var targetBottom = scrollTop + viewportHeight + overscanPx;

  // Binary search for first visible item
  var low = 0;
  var high = layoutItems.length - 1;
  var startIdx = layoutItems.length;

  while (low <= high) {
    var mid = Math.floor((low + high) / 2);
    if (layoutItems[mid].top + layoutItems[mid].height >= targetTop) {
      startIdx = mid;
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }

  // Binary search for last visible item
  low = startIdx;
  high = layoutItems.length - 1;
  var endIdx = -1;

  while (low <= high) {
    var mid2 = Math.floor((low + high) / 2);
    if (layoutItems[mid2].top <= targetBottom) {
      endIdx = mid2;
      low = mid2 + 1;
    } else {
      high = mid2 - 1;
    }
  }

  if (startIdx >= layoutItems.length || endIdx < startIdx) return [];

  return layoutItems.slice(startIdx, endIdx + 1);
}

export { WATERFALL_ROW_HEIGHT, WATERFALL_ROW_GAP };
