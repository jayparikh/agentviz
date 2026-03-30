/**
 * PlaybackContext -- owns playback, search, track filtering, and derived data.
 *
 * Extracts ~80 lines of hooks/memos/callbacks from App.jsx into a provider
 * that any child component can consume via usePlaybackContext().
 */

import React, { createContext, useContext, useMemo, useCallback, useEffect } from "react";
import usePlayback from "../hooks/usePlayback.js";
import useSearch from "../hooks/useSearch.js";
import usePersistentState from "../hooks/usePersistentState.js";
import { buildFilteredEventEntries, buildTurnStartMap, buildTimeMap } from "../lib/session";
import { PLAYBACK_SPEEDS } from "../components/app/constants.js";

var PlaybackCtx = createContext(null);

/**
 * @param {{ session, children }} props
 *   session: { events, turns, total, isLive, metadata } from useSessionLoader
 */
export function PlaybackProvider({ session, children }) {
  var [trackFilters, setTrackFilters] = usePersistentState("agentviz:track-filters", {});

  var playback = usePlayback(session.total, session.isLive);

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

  var search = useSearch(filteredEventEntries);

  var errorEntries = useMemo(function () {
    return filteredEventEntries.filter(function (entry) { return entry.event.isError; });
  }, [filteredEventEntries]);

  // Auto-seek to end when session data changes (live mode or initial load)
  useEffect(function () {
    if (session.total > 0) {
      playback.seek(session.total);
    }
  }, [session.total, session.isLive, playback.seek]);

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

  var cycleSpeed = useCallback(function () {
    var idx = PLAYBACK_SPEEDS.indexOf(playback.speed);
    var next = PLAYBACK_SPEEDS[(idx + 1) % PLAYBACK_SPEEDS.length];
    playback.setSpeed(next);
  }, [playback.speed, playback.setSpeed]);

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

  var value = useMemo(function () {
    return {
      playback: playback,
      search: search,
      filteredEventEntries: filteredEventEntries,
      filteredEvents: filteredEvents,
      turnStartMap: turnStartMap,
      timeMap: timeMap,
      errorEntries: errorEntries,
      trackFilters: trackFilters,
      activeFilterCount: activeFilterCount,
      toggleTrackFilter: toggleTrackFilter,
      cycleSpeed: cycleSpeed,
      jumpToError: jumpToError,
      jumpToMatch: jumpToMatch,
      resetPlaybackState: resetPlaybackState,
    };
  }, [
    playback, search, filteredEventEntries, filteredEvents,
    turnStartMap, timeMap, errorEntries, trackFilters,
    activeFilterCount, toggleTrackFilter, cycleSpeed,
    jumpToError, jumpToMatch, resetPlaybackState,
  ]);

  return React.createElement(PlaybackCtx.Provider, { value: value }, children);
}

export function usePlaybackContext() {
  var ctx = useContext(PlaybackCtx);
  if (!ctx) throw new Error("usePlaybackContext must be used within PlaybackProvider");
  return ctx;
}
