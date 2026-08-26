import { theme } from "./theme.js";

var REPLAY_META_LINE_HEIGHT = Math.ceil(theme.fontSize.sm * 1.3);
var REPLAY_CONTENT_LINE_HEIGHT = Math.ceil(theme.fontSize.base * 1.6);
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

var _estimateCache = new Map();
var MAX_CACHE_SIZE = 50000;

function cachedEstimateTextLines(text) {
  if (!text) return 1;
  var cached = _estimateCache.get(text);
  if (cached !== undefined) return cached;
  var result = estimateTextLines(text);
  if (_estimateCache.size < MAX_CACHE_SIZE) {
    _estimateCache.set(text, result);
  }
  return result;
}

export function clearEstimateCache() {
  _estimateCache.clear();
}

export function buildReplayLayout(entries, turnStartMap, measuredHeights) {
  var top = 0;
  var items = [];
  var measured = measuredHeights || {};
  var entryIndexes = {};
  var visibleTurnStartMap = {};

  for (var entryIndex = 0; entryIndex < entries.length; entryIndex += 1) {
    entryIndexes[entries[entryIndex].index] = true;
  }

  var map = turnStartMap || {};
  Object.keys(map).forEach(function (key) {
    var turn = map[key];
    var eventIndices = turn && Array.isArray(turn.eventIndices) ? turn.eventIndices : [Number(key)];
    for (var eventIndex = 0; eventIndex < eventIndices.length; eventIndex += 1) {
      var index = eventIndices[eventIndex];
      if (entryIndexes[index]) {
        visibleTurnStartMap[index] = turn;
        break;
      }
    }
  });

  for (var i = 0; i < entries.length; i++) {
    var entry = entries[i];
    var turn = visibleTurnStartMap[entry.index];
    var hasTurnHeader = Boolean(turn && turn.index > 0);
    var textLines = cachedEstimateTextLines(entry.event.text);
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

/**
 * Builds a sorted array of the entries' event.t values for visibility lookups.
 *
 * ReplayView needs the count of events whose t is <= the playhead on every 100ms
 * tick. Doing that with a filter re-scans and re-allocates O(n) every tick; a
 * binary search is O(log n) but requires a sorted array. Parser output is NOT
 * guaranteed to be nondecreasing by event.t (the Claude parser bumps a record's
 * text/tool events by fractional offsets, so a later record with an earlier real
 * timestamp can produce out-of-order times), so we sort a copy of just the times
 * here -- once per entries array -- and never assume the entries themselves are
 * ordered. Callers memoize this on `entries` so the sort runs only when the
 * session or filter changes, not per tick.
 */
export function buildVisibilityIndex(entries) {
  if (!entries || entries.length === 0) return [];

  var times = new Array(entries.length);
  for (var i = 0; i < entries.length; i += 1) {
    times[i] = entries[i].event.t;
  }
  times.sort(function (a, b) { return a - b; });
  return times;
}

/**
 * Counts how many events are visible at a given playback time.
 *
 * `sortedTimes` comes from buildVisibilityIndex (ascending). This upper-bound
 * binary search returns the number of times that are <= currentTime, which is
 * exactly `entries.filter(entry => entry.event.t <= currentTime).length` --
 * independent of the original entry order. The count only changes when the
 * playhead crosses an event, so ReplayView memos keyed on it stay stable
 * between crossings while still being correct for out-of-order input.
 */
export function countVisibleAtTime(sortedTimes, currentTime) {
  if (!sortedTimes || sortedTimes.length === 0) return 0;

  var low = 0;
  var high = sortedTimes.length;

  while (low < high) {
    var mid = (low + high) >> 1;
    if (sortedTimes[mid] <= currentTime) low = mid + 1;
    else high = mid;
  }

  return low;
}

export function getReplayWindow(items, scrollTop, viewportHeight, overscanPx) {
  if (!items || items.length === 0) return [];

  var startIndex = findStartIndex(items, Math.max(0, scrollTop - overscanPx));
  var endIndex = findEndIndex(items, scrollTop + viewportHeight + overscanPx);

  if (startIndex === items.length || endIndex < startIndex) return [];

  return items.slice(startIndex, endIndex + 1);
}
