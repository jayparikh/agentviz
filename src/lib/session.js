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
