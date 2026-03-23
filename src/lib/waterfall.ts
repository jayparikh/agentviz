import type { NormalizedEvent, WaterfallItem, WaterfallLayoutItem, WaterfallStats } from "./sessionTypes";

export const WATERFALL_ROW_HEIGHT = 32;
export const WATERFALL_ROW_GAP = 2;

const TOOL_PALETTE = [
  "#3b9eff",
  "#a78bfa",
  "#22d3ee",
  "#6475e8",
  "#10d97a",
  "#818cf8",
  "#60c5ff",
  "#2dd4bf",
  "#c084fc",
  "#94a3b8",
];

function hashToolName(name: string | undefined): number {
  if (!name) return 0;
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

export function getToolColor(toolName: string | undefined): string {
  return TOOL_PALETTE[hashToolName(toolName) % TOOL_PALETTE.length];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getRawToolCallId(raw: unknown): string | null {
  if (!isObject(raw) || !isObject(raw.data) || typeof raw.data.toolCallId !== "string") return null;
  return raw.data.toolCallId;
}

/**
 * Builds a stable tool-call list from normalized events.
 *
 * Copilot traces can encode parent-child nesting through `toolCallId` and
 * `parentToolCallId`. We first collect every visible tool call, then build
 * parent links, then memoize a recursive depth lookup. The cycle guard seeds
 * depth before recursion so malformed traces cannot recurse forever.
 */
export function buildWaterfallItems(events: NormalizedEvent[] | null | undefined): WaterfallItem[] {
  if (!events || events.length === 0) return [];

  const toolEvents: Array<{ event: NormalizedEvent; originalIndex: number }> = [];
  for (let i = 0; i < events.length; i += 1) {
    if (events[i].track === "tool_call") {
      toolEvents.push({ event: events[i], originalIndex: i });
    }
  }

  if (toolEvents.length === 0) return [];

  const parentMap: Record<string, string> = {};
  const idToItem: Record<string, { event: NormalizedEvent; originalIndex: number }> = {};

  for (let i = 0; i < toolEvents.length; i += 1) {
    const event = toolEvents[i].event;
    const toolCallId = getRawToolCallId(event.raw);
    const parentId = event.parentToolCallId || null;

    if (toolCallId) {
      idToItem[toolCallId] = toolEvents[i];
      if (parentId) {
        parentMap[toolCallId] = parentId;
      }
    }
  }

  const depthCache: Record<string, number> = {};

  function getDepth(toolCallId: string | null): number {
    if (!toolCallId) return 0;
    if (depthCache[toolCallId] !== undefined) return depthCache[toolCallId];

    const parentId = parentMap[toolCallId];
    if (!parentId || !idToItem[parentId]) {
      depthCache[toolCallId] = 0;
      return 0;
    }

    depthCache[toolCallId] = 0;
    depthCache[toolCallId] = getDepth(parentId) + 1;
    return depthCache[toolCallId];
  }

  const items: WaterfallItem[] = [];
  for (let i = 0; i < toolEvents.length; i += 1) {
    const event = toolEvents[i].event;
    const toolCallId = getRawToolCallId(event.raw);
    items.push({
      event,
      originalIndex: toolEvents[i].originalIndex,
      depth: toolCallId ? getDepth(toolCallId) : 0,
      parentToolCallId: event.parentToolCallId || null,
    });
  }

  items.sort(function (a, b) { return a.event.t - b.event.t; });
  return items;
}

export function getWaterfallStats(items: WaterfallItem[] | null | undefined): WaterfallStats {
  if (!items || items.length === 0) {
    return {
      totalCalls: 0,
      maxConcurrency: 0,
      maxDepth: 0,
      longestTool: null,
      toolFrequency: {},
    };
  }

  let maxDepth = 0;
  let longestDuration = 0;
  let longestTool: string | null = null;
  const toolFrequency: Record<string, number> = {};
  const timeline: Array<{ time: number; delta: number }> = [];

  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    const event = item.event;

    if (item.depth > maxDepth) maxDepth = item.depth;
    if (event.duration > longestDuration) {
      longestDuration = event.duration;
      longestTool = event.toolName || "unknown";
    }

    const toolName = event.toolName || "unknown";
    toolFrequency[toolName] = (toolFrequency[toolName] || 0) + 1;

    timeline.push({ time: event.t, delta: 1 });
    timeline.push({ time: event.t + event.duration, delta: -1 });
  }

  timeline.sort(function (a, b) {
    return a.time !== b.time ? a.time - b.time : a.delta - b.delta;
  });

  let concurrent = 0;
  let maxConcurrency = 0;
  for (let i = 0; i < timeline.length; i += 1) {
    concurrent += timeline[i].delta;
    if (concurrent > maxConcurrency) maxConcurrency = concurrent;
  }

  return {
    totalCalls: items.length,
    maxConcurrency,
    maxDepth,
    longestTool,
    toolFrequency,
  };
}

export function buildWaterfallLayout(
  items: WaterfallItem[] | null | undefined,
): { layoutItems: WaterfallLayoutItem[]; totalHeight: number } {
  if (!items || items.length === 0) return { layoutItems: [], totalHeight: 0 };

  let top = 0;
  const layoutItems: WaterfallLayoutItem[] = [];

  for (let i = 0; i < items.length; i += 1) {
    layoutItems.push({
      item: items[i],
      top,
      height: WATERFALL_ROW_HEIGHT,
    });
    top += WATERFALL_ROW_HEIGHT + WATERFALL_ROW_GAP;
  }

  return { layoutItems, totalHeight: top };
}

export function getWaterfallWindow(
  layoutItems: WaterfallLayoutItem[] | null | undefined,
  scrollTop: number,
  viewportHeight: number,
  overscanPx = 200,
): WaterfallLayoutItem[] {
  if (!layoutItems || layoutItems.length === 0) return [];

  const targetTop = Math.max(0, scrollTop - overscanPx);
  const targetBottom = scrollTop + viewportHeight + overscanPx;

  let low = 0;
  let high = layoutItems.length - 1;
  let startIdx = layoutItems.length;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (layoutItems[mid].top + layoutItems[mid].height >= targetTop) {
      startIdx = mid;
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }

  low = startIdx;
  high = layoutItems.length - 1;
  let endIdx = -1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (layoutItems[mid].top <= targetBottom) {
      endIdx = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  if (startIdx >= layoutItems.length || endIdx < startIdx) return [];
  return layoutItems.slice(startIdx, endIdx + 1);
}
