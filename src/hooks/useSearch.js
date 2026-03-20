import { useState, useEffect, useMemo, useCallback } from "react";

var SEARCH_DEBOUNCE_MS = 200;

export default function useSearch(eventEntries) {
  var [searchInput, setSearchInput] = useState("");
  var [searchQuery, setSearchQuery] = useState("");

  useEffect(function () {
    var timeoutId = setTimeout(function () {
      setSearchQuery(searchInput.trim());
    }, SEARCH_DEBOUNCE_MS);

    return function () {
      clearTimeout(timeoutId);
    };
  }, [searchInput]);

  var matchedEntries = useMemo(function () {
    if (!eventEntries || !searchQuery) return [];

    var lowerQuery = searchQuery.toLowerCase();
    var matches = [];

    for (var i = 0; i < eventEntries.length; i++) {
      var entry = eventEntries[i];
      var ev = entry.event;
      var hit = (ev.text && ev.text.toLowerCase().includes(lowerQuery))
        || (ev.toolName && ev.toolName.toLowerCase().includes(lowerQuery))
        || (ev.agent && ev.agent.toLowerCase().includes(lowerQuery));

      if (hit) matches.push(entry);
    }

    return matches;
  }, [eventEntries, searchQuery]);

  var searchData = useMemo(function () {
    if (!searchQuery) return { results: null, matchSet: null };
    var results = matchedEntries.map(function (entry) { return entry.index; });
    return { results: results, matchSet: new Set(results) };
  }, [matchedEntries, searchQuery]);

  var clearSearch = useCallback(function () {
    setSearchInput("");
    setSearchQuery("");
  }, []);

  return {
    searchInput: searchInput,
    setSearchInput: setSearchInput,
    searchQuery: searchQuery,
    searchResults: searchData.results,
    matchSet: searchData.matchSet,
    matchedEntries: matchedEntries,
    clearSearch: clearSearch,
  };
}
