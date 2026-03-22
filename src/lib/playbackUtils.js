// Pure search matching helpers extracted from useSearch.js.
// These are stateless functions that can be tested without a DOM.

// Returns true if an event entry matches the given lowercase query string.
export function eventMatchesQuery(entry, lowerQuery) {
  var ev = entry.event;
  return (
    (ev.text && ev.text.toLowerCase().includes(lowerQuery)) ||
    (ev.toolName && ev.toolName.toLowerCase().includes(lowerQuery)) ||
    (ev.agent && ev.agent.toLowerCase().includes(lowerQuery))
  );
}

// Filters an array of event entries to those matching query.
// Returns [] when query is empty or falsy.
export function filterEventEntries(entries, query) {
  if (!entries || !query) return [];
  var lowerQuery = query.toLowerCase();
  var matches = [];
  for (var i = 0; i < entries.length; i++) {
    if (eventMatchesQuery(entries[i], lowerQuery)) matches.push(entries[i]);
  }
  return matches;
}

// Clamps a playback time value to [0, total].
export function clampTime(time, total) {
  return Math.max(0, Math.min(total, time));
}
