import { theme } from "./theme.js";

var REPLAY_META_LINE_HEIGHT = Math.ceil(theme.fontSize.sm * 1.3);
var REPLAY_CONTENT_LINE_HEIGHT = Math.ceil(theme.fontSize.md * 1.6);
var REPLAY_ROW_VERTICAL_PADDING = 16;
var REPLAY_ROW_HEADER_GAP = 2;
var REPLAY_ROW_BASE_HEIGHT = REPLAY_ROW_VERTICAL_PADDING + REPLAY_META_LINE_HEIGHT + REPLAY_ROW_HEADER_GAP + REPLAY_CONTENT_LINE_HEIGHT;
var REPLAY_TURN_HEADER_HEIGHT = 36;
var REPLAY_ITEM_GAP = 2;
var REPLAY_CHARS_PER_LINE = 72;

function estimateTextLines(text) {
  if (!text) return 1;

  var segments = text.split("\n");
  var lines = 0;

  for (var i = 0; i < segments.length; i++) {
    lines += Math.max(1, Math.ceil(segments[i].length / REPLAY_CHARS_PER_LINE));
  }

  return lines;
}

export function buildReplayLayout(entries, turnStartMap, measuredHeights) {
  var top = 0;
  var items = [];
  var measured = measuredHeights || {};

  for (var i = 0; i < entries.length; i++) {
    var entry = entries[i];
    var turn = turnStartMap[entry.index];
    var hasTurnHeader = Boolean(turn && turn.index > 0);
    var textLines = estimateTextLines(entry.event.text);
    var estimatedHeight = REPLAY_ROW_BASE_HEIGHT
      + ((textLines - 1) * REPLAY_CONTENT_LINE_HEIGHT)
      + (hasTurnHeader ? REPLAY_TURN_HEADER_HEIGHT : 0);
    var height = typeof measured[entry.index] === "number"
      ? measured[entry.index]
      : estimatedHeight;

    items.push({
      entry: entry,
      turn: turn,
      top: top,
      height: height,
      visibleIndex: i,
    });

    top += height + REPLAY_ITEM_GAP;
  }

  return { items: items, totalHeight: top };
}

function findStartIndex(items, targetTop) {
  var low = 0;
  var high = items.length - 1;
  var result = items.length;

  while (low <= high) {
    var mid = Math.floor((low + high) / 2);
    var itemBottom = items[mid].top + items[mid].height;

    if (itemBottom >= targetTop) {
      result = mid;
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }

  return result;
}

function findEndIndex(items, targetBottom) {
  var low = 0;
  var high = items.length - 1;
  var result = -1;

  while (low <= high) {
    var mid = Math.floor((low + high) / 2);

    if (items[mid].top <= targetBottom) {
      result = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return result;
}

export function getReplayWindow(items, scrollTop, viewportHeight, overscanPx) {
  if (!items || items.length === 0) return [];

  var startIndex = findStartIndex(items, Math.max(0, scrollTop - overscanPx));
  var endIndex = findEndIndex(items, scrollTop + viewportHeight + overscanPx);

  if (startIndex === items.length || endIndex < startIndex) return [];

  return items.slice(startIndex, endIndex + 1);
}
