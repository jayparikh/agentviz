import { useState, useEffect, useMemo, useCallback } from "react";
import SearchIndex from "../lib/searchIndex.js";

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
    return function () { clearTimeout(timeoutId); };
  }, [searchInput]);

  var index = useMemo(function () {
    return new SearchIndex(eventEntries || []);
  }, [eventEntries]);

  var matchedEntries = useMemo(function () {
    return index.search(searchQuery);
  }, [index, searchQuery]);

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
