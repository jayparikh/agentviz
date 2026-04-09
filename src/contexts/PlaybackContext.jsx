/**
 * PlaybackContext -- owns playback, search, track filtering, and derived data.
 *
 * Split into three focused contexts so components can subscribe to only the
 * slice they need, preventing cascade re-renders (e.g. 30fps time ticks no
 * longer force search/filter consumers to reconcile).
 *
 *   PlaybackTimeCtx -- playback object, cycleSpeed, navigation helpers
 *   FilterCtx       -- trackFilters, filtered entries, turnStartMap, timeMap
 *   SearchCtx       -- search object
 *
 * usePlaybackContext() still returns the combined shape for backward compat.
 */

import React, { createContext, useContext, useMemo, useCallback, useEffect } from "react";
import usePlayback from "../hooks/usePlayback.js";
import useSearch from "../hooks/useSearch.js";
import usePersistentState from "../hooks/usePersistentState.js";
import { buildFilteredEventEntries, buildTurnStartMap, buildTimeMap } from "../lib/session";
import { PLAYBACK_SPEEDS } from "../components/app/constants.js";

var PlaybackTimeCtx = createContext(null);
var FilterCtx = createContext(null);
var SearchCtx = createContext(null);

/**
 * @param {{ session, children }} props
 *   session: { events, turns, total, isLive, metadata } from useSessionLoader
 */
export function PlaybackProvider({ session, children }) {
  // ── playback ──────────────────────────────────────────────────────────────
  var playback = usePlayback(session.total, session.isLive);

  // Auto-seek to end when session data changes (live mode or initial load)
  useEffect(function () {
    if (session.total > 0) {
      playback.seek(session.total);
    }
  }, [session.total, session.isLive, playback.seek]);

  var cycleSpeed = useCallback(function () {
    var idx = PLAYBACK_SPEEDS.indexOf(playback.speed);
    var next = PLAYBACK_SPEEDS[(idx + 1) % PLAYBACK_SPEEDS.length];
    playback.setSpeed(next);
  }, [playback.speed, playback.setSpeed]);

  // ── filters ───────────────────────────────────────────────────────────────
  var [trackFilters, setTrackFilters] = usePersistentState("agentviz:track-filters", {});

  var filteredEventEntries = useMemo(function () {
    return buildFilteredEventEntries(session.events, trackFilters);
  }, [session.events, trackFilters]);

  var filteredEvents = useMemo(function () {
    return filteredEventEntries.map(function (entry) { return entry.event; });
  }, [filteredEventEntries]);

  var turnStartMap = useMemo(function () {
    return buildTurnStartMap(session.turns);
  }, [session.turns]);

  var timeMap = useMemo(function () {
    return buildTimeMap(session.events);
  }, [session.events]);

  var errorEntries = useMemo(function () {
    return filteredEventEntries.filter(function (entry) { return entry.event.isError; });
  }, [filteredEventEntries]);

  var toggleTrackFilter = useCallback(function (track) {
    setTrackFilters(function (prev) {
      var next = Object.assign({}, prev);
      if (next[track]) {
        delete next[track];
      } else {
        next[track] = true;
      }
      return next;
    });
  }, [setTrackFilters]);

  var activeFilterCount = Object.keys(trackFilters).length;

  var filterValue = useMemo(function () {
    return {
      filteredEventEntries: filteredEventEntries,
      filteredEvents: filteredEvents,
      turnStartMap: turnStartMap,
      timeMap: timeMap,
      errorEntries: errorEntries,
      trackFilters: trackFilters,
      activeFilterCount: activeFilterCount,
      toggleTrackFilter: toggleTrackFilter,
    };
  }, [filteredEventEntries, filteredEvents, turnStartMap, timeMap,
      errorEntries, trackFilters, activeFilterCount, toggleTrackFilter]);

  // ── search ────────────────────────────────────────────────────────────────
  var search = useSearch(filteredEventEntries);

  var searchValue = useMemo(function () {
    return { search: search };
  }, [search]);

  // ── navigation (cross-cutting: needs playback + filter + search) ──────────
  var jumpToEntries = useCallback(function (entries, direction) {
    if (!entries || entries.length === 0) return;

    if (direction === "next") {
      for (var i = 0; i < entries.length; i++) {
        if (entries[i].event.t > playback.time + 0.1) {
          playback.seek(entries[i].event.t);
          return;
        }
      }
      playback.seek(entries[0].event.t);
      return;
    }

    for (var j = entries.length - 1; j >= 0; j--) {
      if (entries[j].event.t < playback.time - 0.1) {
        playback.seek(entries[j].event.t);
        return;
      }
    }
    playback.seek(entries[entries.length - 1].event.t);
  }, [playback.seek, playback.time]);

  var jumpToError = useCallback(function (direction) {
    jumpToEntries(errorEntries, direction);
  }, [errorEntries, jumpToEntries]);

  var jumpToMatch = useCallback(function (direction) {
    jumpToEntries(search.matchedEntries, direction);
  }, [jumpToEntries, search.matchedEntries]);

  var resetPlaybackState = useCallback(function () {
    playback.resetPlayback(0);
    search.clearSearch();
    setTrackFilters({});
  }, [playback.resetPlayback, search.clearSearch, setTrackFilters]);

  // Navigation lives in PlaybackTimeCtx since it depends on playback.time
  var playbackValue = useMemo(function () {
    return {
      playback: playback,
      cycleSpeed: cycleSpeed,
      jumpToError: jumpToError,
      jumpToMatch: jumpToMatch,
      resetPlaybackState: resetPlaybackState,
    };
  }, [playback, cycleSpeed, jumpToError, jumpToMatch, resetPlaybackState]);

  return React.createElement(PlaybackTimeCtx.Provider, { value: playbackValue },
    React.createElement(FilterCtx.Provider, { value: filterValue },
      React.createElement(SearchCtx.Provider, { value: searchValue },
        children
      )
    )
  );
}

// ── Granular hooks (subscribe to one slice only) ────────────────────────────

export function usePlaybackTime() {
  var ctx = useContext(PlaybackTimeCtx);
  if (!ctx) throw new Error("usePlaybackTime must be used within PlaybackProvider");
  return ctx;
}

export function useFilterContext() {
  var ctx = useContext(FilterCtx);
  if (!ctx) throw new Error("useFilterContext must be used within PlaybackProvider");
  return ctx;
}

export function useSearchContext() {
  var ctx = useContext(SearchCtx);
  if (!ctx) throw new Error("useSearchContext must be used within PlaybackProvider");
  return ctx;
}

// ── Backward-compatible combined hook (composes all three) ──────────────────

export function usePlaybackContext() {
  var playbackCtx = useContext(PlaybackTimeCtx);
  var filterCtx = useContext(FilterCtx);
  var searchCtx = useContext(SearchCtx);
  if (!playbackCtx || !filterCtx || !searchCtx) {
    throw new Error("usePlaybackContext must be used within PlaybackProvider");
  }
  return Object.assign({}, playbackCtx, filterCtx, searchCtx);
}
