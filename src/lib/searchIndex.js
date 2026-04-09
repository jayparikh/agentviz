/**
 * Pre-computed search index for fast event filtering.
 *
 * Builds a lowercase text cache on construction so queries
 * avoid repeated toLowerCase() calls across 10k+ events.
 */

export default function SearchIndex(eventEntries) {
  var cache = new Array(eventEntries.length);
  for (var i = 0; i < eventEntries.length; i++) {
    var ev = eventEntries[i].event;
    var parts = [];
    if (ev.text) parts.push(ev.text.toLowerCase());
    if (ev.toolName) parts.push(ev.toolName.toLowerCase());
    if (ev.agent) parts.push(ev.agent.toLowerCase());
    cache[i] = parts.join(" ");
  }

  this._entries = eventEntries;
  this._cache = cache;
}

SearchIndex.prototype.search = function search(query) {
  if (!query) return [];
  var lowerQuery = query.toLowerCase();
  var matches = [];
  for (var i = 0; i < this._cache.length; i++) {
    if (this._cache[i].includes(lowerQuery)) {
      matches.push(this._entries[i]);
    }
  }
  return matches;
};
