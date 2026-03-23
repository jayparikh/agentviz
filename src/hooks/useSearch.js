import { useState, useEffect, useMemo, useCallback } from "react";
import { filterEventEntries } from "../lib/playbackUtils.js";

var SEARCH_DEBOUNCE_MS = 200;

export function normalizeSearchQuery(searchInput) {
  return searchInput.trim();
}

export function buildSearchData(matchedEntries, searchQuery) {
  if (!searchQuery) return { results: null, matchSet: null };
  var results = matchedEntries.map(function (entry) { return entry.index; });
  return { results: results, matchSet: new Set(results) };
}

export default function useSearch(eventEntries) {
  var [searchInput, setSearchInput] = useState("");
  var [searchQuery, setSearchQuery] = useState("");

  useEffect(function () {
    var timeoutId = setTimeout(function () {
      setSearchQuery(normalizeSearchQuery(searchInput));
    }, SEARCH_DEBOUNCE_MS);

    return function () {
      clearTimeout(timeoutId);
    };
  }, [searchInput]);

  var matchedEntries = useMemo(function () {
    return filterEventEntries(eventEntries, searchQuery);
  }, [eventEntries, searchQuery]);

  var searchData = useMemo(function () {
    return buildSearchData(matchedEntries, searchQuery);
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
