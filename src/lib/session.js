export function getSessionTotal(events) {
  if (!events || events.length === 0) return 0;

  var maxTime = 0;
  for (var i = 0; i < events.length; i++) {
    var eventEnd = events[i].t + events[i].duration;
    if (eventEnd > maxTime) maxTime = eventEnd;
  }

  return maxTime;
}

export function buildFilteredEventEntries(events, hiddenTracks) {
  if (!events) return [];

  var entries = [];
  for (var i = 0; i < events.length; i++) {
    if (!hiddenTracks[events[i].track]) {
      entries.push({ index: i, event: events[i] });
    }
  }

  return entries;
}

export function buildTurnStartMap(turns) {
  var map = {};

  for (var i = 0; i < turns.length; i++) {
    if (turns[i].eventIndices.length > 0) {
      map[turns[i].eventIndices[0]] = turns[i];
    }
  }

  return map;
}

/**
 * Build a time map that compresses large idle gaps for display purposes.
 * Playback stays in real time; this only affects visual positioning in
 * Timeline and SessionHero sparkline.
 *
 * Returns { toPosition(t), toTime(pos), displayTotal, hasCompression }.
 */
export function buildTimeMap(events) {
  var sessionTotal = getSessionTotal(events);

  function identity() {
    return {
      toPosition: function (t) { return sessionTotal > 0 ? Math.max(0, Math.min(1, t / sessionTotal)) : 0; },
      toTime: function (pos) { return pos * sessionTotal; },
      displayTotal: sessionTotal,
      hasCompression: false,
    };
  }

  if (!events || events.length === 0 || sessionTotal <= 0) {
    return identity();
  }

  // Collect sorted unique event times, anchored at 0 and sessionTotal
  var raw = [0];
  for (var i = 0; i < events.length; i++) raw.push(events[i].t);
  raw.push(sessionTotal);
  raw.sort(function (a, b) { return a - b; });

  var unique = [raw[0]];
  for (var i = 1; i < raw.length; i++) {
    if (raw[i] > unique[unique.length - 1]) unique.push(raw[i]);
  }

  if (unique.length <= 2) return identity();

  // Compute inter-event gaps
  var gaps = [];
  for (var i = 1; i < unique.length; i++) {
    gaps.push(unique[i] - unique[i - 1]);
  }

  var sorted = gaps.slice().sort(function (a, b) { return a - b; });
  var median = sorted[Math.floor(sorted.length / 2)];
  var maxGap = sorted[sorted.length - 1];
  var threshold = Math.max(60, median * 10);

  if (maxGap <= threshold) return identity();

  // Build compressed breakpoints: [realTime, displayTime]
  var compressedSize = Math.max(5, Math.min(30, median * 3));
  var bp = [[unique[0], 0]];
  var dt = 0;

  for (var i = 1; i < unique.length; i++) {
    var gap = unique[i] - unique[i - 1];
    dt += gap > threshold ? compressedSize : gap;
    bp.push([unique[i], dt]);
  }

  var displayTotal = dt;

  function findSegment(arr, val, field) {
    var lo = 0;
    var hi = arr.length - 1;
    while (lo < hi - 1) {
      var mid = (lo + hi) >> 1;
      if (arr[mid][field] <= val) lo = mid;
      else hi = mid;
    }
    return lo;
  }

  function toPosition(t) {
    if (displayTotal <= 0) return 0;
    if (t <= bp[0][0]) return 0;
    if (t >= bp[bp.length - 1][0]) return 1;

    var lo = findSegment(bp, t, 0);
    var hi = lo + 1;
    var realLen = bp[hi][0] - bp[lo][0];
    var frac = realLen > 0 ? (t - bp[lo][0]) / realLen : 0;
    var dispVal = bp[lo][1] + frac * (bp[hi][1] - bp[lo][1]);
    return Math.max(0, Math.min(1, dispVal / displayTotal));
  }

  function toTime(pos) {
    var target = pos * displayTotal;
    if (target <= 0) return 0;
    if (target >= displayTotal) return sessionTotal;

    var lo = findSegment(bp, target, 1);
    var hi = lo + 1;
    var dispLen = bp[hi][1] - bp[lo][1];
    var frac = dispLen > 0 ? (target - bp[lo][1]) / dispLen : 0;
    return bp[lo][0] + frac * (bp[hi][0] - bp[lo][0]);
  }

  return {
    toPosition: toPosition,
    toTime: toTime,
    displayTotal: displayTotal,
    hasCompression: true,
  };
}
