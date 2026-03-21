import { useState, useRef, useCallback, useMemo, useEffect } from "react";
import { theme, TRACK_TYPES, alpha } from "./lib/theme.js";
import { buildFilteredEventEntries, buildTurnStartMap, buildTimeMap } from "./lib/session.js";
import usePersistentState from "./hooks/usePersistentState.js";
import useSessionLoader from "./hooks/useSessionLoader.js";
import usePlayback from "./hooks/usePlayback.js";
import useSearch from "./hooks/useSearch.js";
import useKeyboardShortcuts from "./hooks/useKeyboardShortcuts.js";
import FileUploader from "./components/FileUploader.jsx";
import Timeline from "./components/Timeline.jsx";
import ReplayView from "./components/ReplayView.jsx";
import TracksView from "./components/TracksView.jsx";
import StatsView from "./components/StatsView.jsx";
import WaterfallView from "./components/WaterfallView.jsx";
import CommandPalette from "./components/CommandPalette.jsx";
import Icon from "./components/Icon.jsx";

var VIEWS = [
  { id: "replay", label: "Replay", icon: "play" },
  { id: "tracks", label: "Tracks", icon: "tracks" },
  { id: "waterfall", label: "Waterfall", icon: "waterfall" },
  { id: "stats", label: "Stats", icon: "stats" },
];

var SPEEDS = [0.5, 1, 2, 4, 8];

export default function App() {
  var [view, setView] = usePersistentState("agentviz:view", "replay");
  var [trackFilters, setTrackFilters] = usePersistentState("agentviz:track-filters", {});
  var [showPalette, setShowPalette] = useState(false);
  var [showFilters, setShowFilters] = useState(false);
  var searchInputRef = useRef(null);
  var filtersRef = useRef(null);

  var session = useSessionLoader();
  var playback = usePlayback(session.total);

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

  useEffect(function () {
    if (session.total > 0) {
      playback.seek(session.total);
    }
  }, [session.total, playback.seek]);

  useEffect(function () {
    if (session.events && session.showHero) session.dismissHero();
  }, [session.events, session.showHero, session.dismissHero]);

  // Close filter dropdown on outside click
  useEffect(function () {
    if (!showFilters) return;
    function handleClick(e) {
      if (filtersRef.current && !filtersRef.current.contains(e.target)) {
        setShowFilters(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return function () { document.removeEventListener("mousedown", handleClick); };
  }, [showFilters]);

  var activeView = VIEWS.some(function (item) { return item.id === view; }) ? view : "replay";

  var resetVisualizerState = useCallback(function () {
    playback.resetPlayback(0);
    search.clearSearch();
    setTrackFilters({});
    setShowPalette(false);
    setShowFilters(false);
  }, [playback.resetPlayback, search.clearSearch, setTrackFilters]);

  var handleFile = useCallback(function (text, name) {
    resetVisualizerState();
    session.handleFile(text, name);
  }, [resetVisualizerState, session.handleFile]);

  var loadSample = useCallback(function () {
    resetVisualizerState();
    session.loadSample();
  }, [resetVisualizerState, session.loadSample]);

  var reset = useCallback(function () {
    resetVisualizerState();
    session.resetSession();
  }, [resetVisualizerState, session.resetSession]);

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
    var idx = SPEEDS.indexOf(playback.speed);
    var next = SPEEDS[(idx + 1) % SPEEDS.length];
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

  var errorEntries = useMemo(function () {
    return filteredEventEntries.filter(function (entry) { return entry.event.isError; });
  }, [filteredEventEntries]);

  var jumpToError = useCallback(function (direction) {
    jumpToEntries(errorEntries, direction);
  }, [errorEntries, jumpToEntries]);

  var jumpToMatch = useCallback(function (direction) {
    jumpToEntries(search.matchedEntries, direction);
  }, [jumpToEntries, search.matchedEntries]);

  var focusSearch = useCallback(function () {
    if (searchInputRef.current) searchInputRef.current.focus();
  }, []);

  useKeyboardShortcuts({
    hasSession: Boolean(session.events),
    showHero: session.showHero,
    showPalette: showPalette,
    time: playback.time,
    onTogglePalette: function () { setShowPalette(function (prev) { return !prev; }); },
    onDismissHero: session.dismissHero,
    onPlayPause: playback.playPause,
    onSeek: playback.seek,
    onSetView: setView,
    onJumpToError: jumpToError,
    onFocusSearch: focusSearch,
  });

  if (session.loading) {
    return (
      <div style={{
        width: "100%",
        height: "100vh",
        background: theme.bg.base,
        color: theme.text.primary,
        fontFamily: theme.font.ui,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 20,
      }}>
        <div style={{
          width: 40,
          height: 40,
          border: "3px solid " + theme.border.default,
          borderTopColor: theme.accent.primary,
          borderRadius: "50%",
          animation: "spin 0.8s linear infinite",
        }} />
        <div style={{ fontSize: theme.fontSize.md, color: theme.text.muted, letterSpacing: 1 }}>
          Parsing session...
        </div>
      </div>
    );
  }

  if (!session.events) {
    return (
      <div style={{
        width: "100%",
        height: "100vh",
        background: theme.bg.base,
        color: theme.text.primary,
        fontFamily: theme.font.mono,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 24,
        position: "relative",
        overflow: "hidden",
      }}>
        <div style={{ textAlign: "center", marginBottom: 8 }}>
          <div style={{ fontSize: theme.fontSize.hero, fontWeight: 600, fontFamily: theme.font.ui, letterSpacing: "-0.5px", color: theme.text.primary }}>
            agentviz<span style={{ color: theme.accent.primary }}>.</span>
          </div>
          <div style={{ fontSize: theme.fontSize.md, color: theme.text.dim, marginTop: 6, lineHeight: 1.6 }}>
            See what your AI agents actually do.
          </div>
        </div>

        <FileUploader onLoad={handleFile} />

        {session.error && (
          <div style={{
            background: theme.semantic.errorBg,
            border: "1px solid " + theme.semantic.error,
            borderRadius: theme.radius.xl,
            padding: "10px 16px",
            fontSize: theme.fontSize.md,
            color: theme.semantic.errorText,
            maxWidth: 500,
            animation: "fadeIn 0.3s ease",
          }}>
            {session.error}
          </div>
        )}

        <span onClick={loadSample} style={{ color: theme.text.muted, cursor: "pointer", fontSize: theme.fontSize.sm }}>
          or load a demo session
        </span>
      </div>
    );
  }

  return (
    <div style={{
      width: "100%",
      height: "100vh",
      background: theme.bg.base,
      color: theme.text.primary,
      fontFamily: theme.font.mono,
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
    }}>
      {showPalette && (
        <CommandPalette
          events={session.events}
          turns={session.turns}
          onSeek={function (nextTime) {
            playback.seek(nextTime);
            setShowPalette(false);
          }}
          onSetView={function (nextView) {
            setView(nextView);
            setShowPalette(false);
          }}
          onClose={function () { setShowPalette(false); }}
        />
      )}

      {/* Header: Left | Center | Right */}
      <div style={{
        padding: "8px 16px",
        display: "flex",
        alignItems: "center",
        gap: 10,
        borderBottom: "1px solid " + theme.border.default,
        flexShrink: 0,
      }}>
        {/* Left zone: identity + file info */}
        <span
          className="av-btn"
          onClick={reset}
          title="Back to start"
          style={{
            fontSize: theme.fontSize.lg,
            fontWeight: 600,
            fontFamily: theme.font.ui,
            letterSpacing: "-0.5px",
            color: theme.text.primary,
            padding: "2px 4px",
            borderRadius: theme.radius.sm,
            background: "transparent",
            border: "none",
          }}
        >
          agentviz<span style={{ color: theme.accent.primary }}>.</span>
        </span>
        <div style={{ height: 16, width: 1, background: theme.border.default }} />
        <span style={{
          fontSize: theme.fontSize.base,
          color: theme.text.muted,
          fontFamily: theme.font.mono,
          maxWidth: 160,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}>
          {session.file}
        </span>
        {session.metadata && (
          <span style={{ fontSize: theme.fontSize.sm, color: theme.text.ghost, display: "flex", alignItems: "center", gap: 6 }}>
            {session.metadata.totalEvents} events
            {session.metadata.errorCount > 0 && (
              <span style={{ color: theme.semantic.error, display: "inline-flex", alignItems: "center", gap: 3 }}>
                <Icon name="alert-circle" size={12} /> {session.metadata.errorCount}
              </span>
            )}
          </span>
        )}

        {/* Center zone: segmented view tabs */}
        <div style={{
          display: "flex",
          gap: 2,
          margin: "0 auto",
          background: theme.bg.surface,
          borderRadius: theme.radius.lg,
          padding: 2,
        }}>
          {VIEWS.map(function (item) {
            var isActive = activeView === item.id;
            return (
              <button
                key={item.id}
                className="av-btn"
                onClick={function () { setView(item.id); }}
                style={{
                  background: isActive ? theme.bg.raised : "transparent",
                  border: "none",
                  borderRadius: theme.radius.md,
                  color: isActive ? theme.accent.primary : theme.text.muted,
                  padding: "4px 12px",
                  fontSize: theme.fontSize.base,
                  fontFamily: theme.font.ui,
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                }}
              >
                <Icon name={item.icon} size={13} style={{ opacity: isActive ? 1 : 0.6 }} /> {item.label}
              </button>
            );
          })}
        </div>

        {/* Right zone: search, filters, speed, close */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, position: "relative" }}>
            <Icon name="search" size={13} style={{ color: theme.text.dim }} />
            <input
              ref={searchInputRef}
              id="agentviz-search"
              className="av-search"
              type="text"
              value={search.searchInput}
              onChange={function (e) { search.setSearchInput(e.target.value); }}
              onKeyDown={function (e) {
                if (e.key === "Enter") {
                  e.preventDefault();
                  jumpToMatch(e.shiftKey ? "prev" : "next");
                }
                if (e.key === "Escape") {
                  e.target.blur();
                  search.clearSearch();
                }
              }}
              placeholder="Search (/)"
              style={{
                background: theme.bg.surface,
                border: "1px solid " + theme.border.default,
                borderRadius: theme.radius.md,
                color: theme.text.primary,
                padding: "3px 8px",
                fontSize: theme.fontSize.base,
                fontFamily: theme.font.mono,
                width: 120,
                outline: "none",
              }}
            />
            {search.searchResults && (
              <span style={{
                fontSize: theme.fontSize.sm,
                color: search.searchResults.length > 0 ? theme.accent.primary : theme.semantic.error,
              }}>
                {search.searchResults.length}
              </span>
            )}
          </div>

          <button
            className="av-btn"
            onClick={function () { setShowPalette(true); }}
            title="Command Palette (Cmd+K)"
            style={{
              background: theme.bg.surface,
              border: "1px solid " + theme.border.default,
              borderRadius: theme.radius.md,
              color: theme.text.dim,
              padding: "2px 8px",
              fontSize: theme.fontSize.xs,
              fontFamily: theme.font.ui,
              display: "flex",
              alignItems: "center",
              gap: 3,
            }}
          >
            <Icon name="command" size={11} />K
          </button>

          {errorEntries.length > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
              <button
                className="av-btn"
                onClick={function () { jumpToError("prev"); }}
                title="Previous error (Shift+E)"
                style={{
                  background: "transparent",
                  border: "1px solid " + theme.semantic.errorBorder,
                  borderRadius: theme.radius.sm,
                  color: theme.semantic.error,
                  padding: "2px 4px",
                  fontSize: theme.fontSize.sm,
                  display: "flex",
                  alignItems: "center",
                }}
              >
                <Icon name="chevron-left" size={12} />
              </button>
              <span style={{ fontSize: theme.fontSize.sm, color: theme.semantic.error, display: "flex", alignItems: "center", gap: 3 }}>
                <Icon name="alert-circle" size={12} /> {errorEntries.length}
              </span>
              <button
                className="av-btn"
                onClick={function () { jumpToError("next"); }}
                title="Next error (E)"
                style={{
                  background: "transparent",
                  border: "1px solid " + theme.semantic.errorBorder,
                  borderRadius: theme.radius.sm,
                  color: theme.semantic.error,
                  padding: "2px 4px",
                  fontSize: theme.fontSize.sm,
                  display: "flex",
                  alignItems: "center",
                }}
              >
                <Icon name="chevron-right" size={12} />
              </button>
            </div>
          )}

          <div style={{ height: 12, width: 1, background: theme.border.default }} />

          {/* Track filter dropdown */}
          <div ref={filtersRef} style={{ position: "relative" }}>
            <button
              className="av-btn"
              onClick={function () { setShowFilters(function (p) { return !p; }); }}
              title="Filter tracks"
              style={{
                background: activeFilterCount > 0 ? alpha(theme.accent.primary, 0.08) : "transparent",
                border: "1px solid " + (activeFilterCount > 0 ? theme.accent.primary : theme.border.default),
                borderRadius: theme.radius.md,
                color: activeFilterCount > 0 ? theme.accent.primary : theme.text.muted,
                padding: "2px 8px",
                fontSize: theme.fontSize.sm,
                fontFamily: theme.font.ui,
                display: "flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              <Icon name="filter" size={12} />
              {activeFilterCount > 0 ? activeFilterCount + " hidden" : "Filters"}
            </button>
            {showFilters && (
              <div style={{
                position: "absolute",
                top: "calc(100% + 6px)",
                right: 0,
                background: theme.bg.surface,
                border: "1px solid " + theme.border.strong,
                borderRadius: theme.radius.lg,
                padding: 6,
                zIndex: theme.z.tooltip,
                boxShadow: theme.shadow.md,
                minWidth: 160,
              }}>
                {Object.entries(TRACK_TYPES).map(function (entry) {
                  var key = entry[0];
                  var info = entry[1];
                  var isHidden = trackFilters[key];
                  return (
                    <button
                      key={key}
                      className="av-interactive"
                      onClick={function () { toggleTrackFilter(key); }}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "6px 10px",
                        borderRadius: theme.radius.md,
                        width: "100%",
                        background: "transparent",
                        border: "none",
                        cursor: "pointer",
                        textAlign: "left",
                      }}
                    >
                      <Icon name={key} size={13} style={{ color: isHidden ? theme.text.ghost : info.color }} />
                      <span style={{
                        fontSize: theme.fontSize.base,
                        fontFamily: theme.font.ui,
                        color: isHidden ? theme.text.ghost : theme.text.secondary,
                        textDecoration: isHidden ? "line-through" : "none",
                        flex: 1,
                      }}>
                        {info.label}
                      </span>
                      {isHidden && (
                        <span style={{ fontSize: theme.fontSize.xs, color: theme.text.ghost }}>hidden</span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Speed: single cycling button */}
          <button
            className="av-btn"
            onClick={cycleSpeed}
            title="Playback speed (click to cycle)"
            style={{
              background: playback.speed !== 1 ? alpha(theme.accent.primary, 0.08) : "transparent",
              border: "1px solid " + (playback.speed !== 1 ? theme.accent.primary : theme.border.default),
              color: playback.speed !== 1 ? theme.accent.primary : theme.text.muted,
              borderRadius: theme.radius.md,
              padding: "2px 8px",
              fontSize: theme.fontSize.sm,
              fontFamily: theme.font.ui,
            }}
          >
            {playback.speed}x
          </button>

          <button
            className="av-btn"
            onClick={reset}
            title="Close session"
            style={{
              background: "transparent",
              border: "1px solid " + theme.border.default,
              color: theme.text.muted,
              borderRadius: theme.radius.md,
              padding: "2px 6px",
              fontSize: theme.fontSize.sm,
              fontFamily: theme.font.ui,
              display: "flex",
              alignItems: "center",
              gap: 3,
            }}
          >
            <Icon name="close" size={12} />
          </button>
        </div>
      </div>

      <div style={{ padding: "8px 20px 0", flexShrink: 0 }}>
        <Timeline
          currentTime={playback.time}
          totalTime={session.total}
          timeMap={timeMap}
          onSeek={playback.seek}
          isPlaying={playback.playing}
          onPlayPause={playback.playPause}
          eventEntries={filteredEventEntries}
          turns={session.turns}
          matchSet={search.matchSet}
        />
      </div>

      <div style={{ flex: 1, padding: "6px 20px 16px", minHeight: 0, overflow: "hidden" }}>
        {activeView === "replay" && (
          <ReplayView
            currentTime={playback.time}
            eventEntries={filteredEventEntries}
            turns={session.turns}
            turnStartMap={turnStartMap}
            searchQuery={search.searchQuery}
            matchSet={search.matchSet}
            metadata={session.metadata}
          />
        )}
        {activeView === "tracks" && (
          <TracksView
            currentTime={playback.time}
            eventEntries={filteredEventEntries}
            totalTime={session.total}
            timeMap={timeMap}
            turns={session.turns}
          />
        )}
        {activeView === "waterfall" && (
          <WaterfallView
            currentTime={playback.time}
            eventEntries={filteredEventEntries}
            totalTime={session.total}
            timeMap={timeMap}
            turns={session.turns}
          />
        )}
        {activeView === "stats" && (
          <StatsView
            events={filteredEvents}
            totalTime={session.total}
            metadata={session.metadata}
            turns={session.turns}
          />
        )}
      </div>
    </div>
  );
}
