var DEFAULT_TURN_LIMIT = 8;
var MAX_RESULTS = 24;
var TYPE_CAPS = {
  view: 4,
  turn: 8,
  event: 12,
};

function normalize(text) {
  return (text || "").toLowerCase();
}

function buildViewItems() {
  return [
    { id: "view-replay", type: "view", label: "Replay View", iconName: "play", viewId: "replay", searchText: "replay view timeline stream", priority: 40 },
    { id: "view-tracks", type: "view", label: "Tracks View", iconName: "tracks", viewId: "tracks", searchText: "tracks view lanes daw", priority: 40 },
    { id: "view-waterfall", type: "view", label: "Waterfall View", iconName: "waterfall", viewId: "waterfall", searchText: "waterfall view tools timeline execution", priority: 40 },
    { id: "view-stats", type: "view", label: "Stats View", iconName: "stats", viewId: "stats", searchText: "stats view metrics summary", priority: 40 },
  ];
}

export function buildCommandPaletteIndex(events, turns) {
  var viewItems = buildViewItems();
  var turnItems = [];
  var eventItems = [];
  var seenEvents = {};

  if (turns) {
    for (var i = 0; i < turns.length; i++) {
      var turn = turns[i];
      turnItems.push({
        id: "turn-" + turn.index,
        type: "turn",
        label: "Turn " + (turn.index + 1) + ": " + (turn.userMessage || "").substring(0, 80),
        iconName: "message-circle",
        seekTime: turn.startTime,
        hasError: turn.hasError,
        searchText: normalize("turn " + (turn.index + 1) + " " + (turn.userMessage || "")),
        priority: turn.hasError ? 12 : 8,
      });
    }
  }

  if (events) {
    for (var j = 0; j < events.length; j++) {
      var ev = events[j];
      var dedupeKey = (ev.toolName || ev.text.substring(0, 50)) + ":" + ev.track + ":" + ev.t;
      if (seenEvents[dedupeKey]) continue;
      seenEvents[dedupeKey] = true;

      eventItems.push({
        id: "event-" + j,
        type: "event",
        label: ev.toolName || ev.text.substring(0, 80),
        iconName: ev.isError ? "alert-circle" : null,
        track: ev.track,
        agent: ev.agent,
        toolName: ev.toolName,
        time: ev.t,
        seekTime: ev.t,
        isError: ev.isError,
        searchText: normalize([
          ev.toolName || "",
          ev.text || "",
          ev.agent || "",
          ev.track || "",
        ].join(" ")),
        priority: ev.isError ? 14 : (ev.toolName ? 10 : 4),
      });
    }
  }

  return {
    views: viewItems,
    defaults: viewItems.concat(turnItems.slice(0, DEFAULT_TURN_LIMIT)),
    items: viewItems.concat(turnItems, eventItems),
  };
}

function scoreItem(item, query, queryTokens) {
  if (!query) return item.priority || 0;

  var label = normalize(item.label);
  var text = item.searchText || label;
  var score = item.priority || 0;

  for (var i = 0; i < queryTokens.length; i++) {
    var token = queryTokens[i];
    var tokenIndex = text.indexOf(token);
    if (tokenIndex === -1) return -1;
    score += 20;
    score += Math.max(0, 15 - Math.min(tokenIndex, 15));
    if (label.indexOf(token) === 0) score += 24;
  }

  if (label === query) score += 120;
  if (label.indexOf(query) === 0) score += 60;
  else if (text.indexOf(query) === 0) score += 35;
  else if (text.indexOf(query) !== -1) score += 12;

  if (item.type === "view") score += 6;
  if (item.type === "turn") score += 4;

  return score;
}

export function searchCommandPalette(index, query) {
  if (!query || !query.trim()) return index.defaults;

  var normalizedQuery = normalize(query.trim());
  var tokens = normalizedQuery.split(/\s+/).filter(Boolean);
  var scored = [];

  for (var i = 0; i < index.items.length; i++) {
    var item = index.items[i];
    var score = scoreItem(item, normalizedQuery, tokens);
    if (score >= 0) {
      scored.push({ item: item, score: score });
    }
  }

  scored.sort(function (a, b) {
    if (b.score !== a.score) return b.score - a.score;
    if ((a.item.time || 0) !== (b.item.time || 0)) return (a.item.time || 0) - (b.item.time || 0);
    return a.item.label.localeCompare(b.item.label);
  });

  var byType = { view: 0, turn: 0, event: 0 };
  var results = [];

  for (var j = 0; j < scored.length && results.length < MAX_RESULTS; j++) {
    var nextItem = scored[j].item;
    var cap = TYPE_CAPS[nextItem.type] || MAX_RESULTS;
    if (byType[nextItem.type] >= cap) continue;
    byType[nextItem.type]++;
    results.push(nextItem);
  }

  return results;
}
