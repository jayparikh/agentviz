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
import SessionHero from "./components/SessionHero.jsx";
import CommandPalette from "./components/CommandPalette.jsx";

var VIEWS = [
  { id: "replay", label: "Replay", icon: "\u25B6" },
  { id: "tracks", label: "Tracks", icon: "\u2261" },
  { id: "waterfall", label: "Waterfall", icon: "\u2507" },
  { id: "stats", label: "Stats", icon: "\u25FB" },
];

var SPEEDS = [0.5, 1, 2, 4, 8];

export default function App() {
  var [view, setView] = usePersistentState("agentviz:view", "replay");
  var [trackFilters, setTrackFilters] = usePersistentState("agentviz:track-filters", {});
  var [showPalette, setShowPalette] = useState(false);
  var searchInputRef = useRef(null);

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

  // Auto-seek to end of session when loaded so all events are immediately visible
  useEffect(function () {
    if (session.total > 0) {
      playback.seek(session.total);
    }
  }, [session.total, playback.seek]);

  var activeView = VIEWS.some(function (item) { return item.id === view; }) ? view : "replay";

  var resetVisualizerState = useCallback(function () {
    playback.resetPlayback(0);
    search.clearSearch();
    setTrackFilters({});
    setShowPalette(false);
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
        fontFamily: theme.font,
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
          borderTopColor: theme.accent.cyan,
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
        fontFamily: theme.font,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 24,
        position: "relative",
        overflow: "hidden",
      }}>
        <div style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden" }}>
          {[0, 1, 2, 3, 4, 5, 6, 7].map(function (i) {
            return (
              <div key={i} style={{
                position: "absolute",
                left: (10 + i * 12) + "%",
                bottom: -10,
                width: 2,
                height: 2,
                borderRadius: "50%",
                background: i % 2 === 0 ? theme.accent.cyan : theme.accent.purple,
                opacity: 0,
                animation: "floatParticle " + (8 + i * 2) + "s linear infinite",
                animationDelay: i * 1.5 + "s",
              }} />
            );
          })}
        </div>

        <div style={{ textAlign: "center", marginBottom: 8, animation: "fadeInUp 0.6s ease" }}>
          <div style={{
            fontSize: theme.fontSize.hero,
            color: theme.accent.cyan,
            marginBottom: 8,
            animation: "glow 3s ease-in-out infinite",
            display: "inline-block",
          }}>{"\u25C8"}</div>
          <div style={{ fontSize: theme.fontSize.xxl, fontWeight: 700, letterSpacing: 3 }}>AGENTVIZ</div>
          <div style={{ fontSize: theme.fontSize.md, color: theme.text.dim, marginTop: 6, letterSpacing: 1, lineHeight: 1.6 }}>
            See what your AI agents actually do.
            <br />
            <span style={{ color: theme.text.ghost }}>Drop a session file to start exploring.</span>
          </div>
        </div>

        <div style={{ animation: "fadeInUp 0.6s ease 0.1s both" }}>
          <FileUploader onLoad={handleFile} />
        </div>

        {session.error && (
          <div style={{
            background: theme.errorBg,
            border: "1px solid " + theme.error,
            borderRadius: theme.radius.xl,
            padding: "10px 16px",
            fontSize: theme.fontSize.md,
            color: theme.errorText,
            maxWidth: 500,
            animation: "fadeIn 0.3s ease",
          }}>
            {session.error}
          </div>
        )}

        <div style={{ display: "flex", gap: 16, alignItems: "center", animation: "fadeInUp 0.6s ease 0.2s both" }}>
          <div style={{ height: 1, width: 60, background: theme.border.default }} />
          <span style={{ fontSize: theme.fontSize.base, color: theme.text.ghost }}>or</span>
          <div style={{ height: 1, width: 60, background: theme.border.default }} />
        </div>

        <button onClick={loadSample} style={{
          background: "transparent",
          border: "1px solid " + theme.border.strong,
          borderRadius: theme.radius.xl,
          color: theme.text.secondary,
          padding: "10px 24px",
          cursor: "pointer",
          fontSize: theme.fontSize.md,
          fontFamily: theme.font,
          letterSpacing: 1,
          transition: "all " + theme.transition.smooth,
          animation: "fadeInUp 0.6s ease 0.3s both",
        }}
          onMouseEnter={function (e) {
            e.target.style.borderColor = theme.accent.cyan;
            e.target.style.color = theme.accent.cyan;
          }}
          onMouseLeave={function (e) {
            e.target.style.borderColor = theme.border.strong;
            e.target.style.color = theme.text.secondary;
          }}
        >
          Load Demo Session
        </button>

        <div style={{
          fontSize: theme.fontSize.base,
          color: theme.text.ghost,
          maxWidth: 500,
          textAlign: "center",
          lineHeight: 1.8,
          marginTop: 16,
          animation: "fadeInUp 0.6s ease 0.4s both",
        }}>
          Find your Claude Code sessions:
          <br />
          <code style={{ color: theme.text.dim }}>ls ~/.claude/projects/</code>
          <br />
          Then drop any .jsonl session file here
        </div>
      </div>
    );
  }

  if (session.showHero) {
    return (
      <div style={{
        width: "100%",
        height: "100vh",
        background: theme.bg.base,
        color: theme.text.primary,
        fontFamily: theme.font,
      }}>
        <SessionHero
          metadata={session.metadata}
          events={session.events}
          totalTime={session.total}
          timeMap={timeMap}
          onDive={session.dismissHero}
        />
      </div>
    );
  }

  return (
    <div style={{
      width: "100%",
      height: "100vh",
      background: theme.bg.base,
      color: theme.text.primary,
      fontFamily: theme.font,
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

      <div style={{
        padding: "10px 20px",
        display: "flex",
        alignItems: "center",
        gap: 14,
        borderBottom: "1px solid " + theme.border.default,
        flexShrink: 0,
      }}>
        <span style={{ fontSize: 16, color: theme.accent.cyan, cursor: "pointer" }} onClick={reset} title="Back">
          {"\u25C8"}
        </span>
        <span style={{ fontSize: theme.fontSize.lg, fontWeight: 700, letterSpacing: 2 }}>AGENTVIZ</span>
        <div style={{ height: 16, width: 1, background: theme.border.default }} />
        <span style={{
          fontSize: theme.fontSize.base,
          color: theme.text.muted,
          maxWidth: 200,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}>
          {session.file}
        </span>

        {session.metadata && (
          <span style={{ fontSize: theme.fontSize.sm, color: theme.text.ghost }}>
            {session.metadata.totalEvents} events / {session.metadata.totalToolCalls} tools / {session.metadata.totalTurns} turns
            {session.metadata.errorCount > 0 && (
              <span style={{ color: theme.error, marginLeft: 6 }}>
                {"\u25CF"} {session.metadata.errorCount} error{session.metadata.errorCount > 1 ? "s" : ""}
              </span>
            )}
            {session.metadata.warnings && session.metadata.warnings.length > 0 && (
              <span
                title={session.metadata.warnings.join("\n")}
                style={{ color: theme.warning, marginLeft: 8 }}
              >
                {"\u25CF"} {session.metadata.warnings.length} parse warning{session.metadata.warnings.length > 1 ? "s" : ""}
              </span>
            )}
          </span>
        )}

        <div style={{
          display: "flex",
          gap: 2,
          marginLeft: 16,
          background: theme.bg.surface,
          borderRadius: theme.radius.lg,
          padding: 2,
        }}>
          {VIEWS.map(function (item) {
            return (
              <button key={item.id} onClick={function () { setView(item.id); }} style={{
                background: activeView === item.id ? theme.bg.raised : "transparent",
                border: "none",
                borderRadius: theme.radius.md,
                color: activeView === item.id ? theme.accent.cyan : theme.text.muted,
                padding: "4px 12px",
                cursor: "pointer",
                fontSize: theme.fontSize.base,
                fontFamily: theme.font,
                letterSpacing: 1,
                display: "flex",
                alignItems: "center",
                gap: 4,
                transition: "all " + theme.transition.fast,
              }}>
                <span>{item.icon}</span> {item.label}
              </button>
            );
          })}
        </div>

        <div style={{ marginLeft: 12, display: "flex", alignItems: "center", gap: 6, position: "relative" }}>
          <span style={{ fontSize: 12, color: theme.text.dim }}>{"\u2315"}</span>
          <input
            ref={searchInputRef}
            id="agentviz-search"
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
            placeholder="Search... (/)"
            style={{
              background: theme.bg.surface,
              border: "1px solid " + theme.border.default,
              borderRadius: theme.radius.md,
              color: theme.text.primary,
              padding: "3px 8px",
              fontSize: theme.fontSize.base,
              fontFamily: theme.font,
              width: 140,
              outline: "none",
              transition: "border-color " + theme.transition.fast,
            }}
            onFocus={function (e) { e.target.style.borderColor = theme.accent.cyan; }}
            onBlur={function (e) { e.target.style.borderColor = theme.border.default; }}
          />
          {search.searchResults && (
            <span style={{
              fontSize: theme.fontSize.sm,
              color: search.searchResults.length > 0 ? theme.accent.cyan : theme.error,
            }}>
              {search.searchResults.length} match{search.searchResults.length !== 1 ? "es" : ""}
            </span>
          )}
        </div>

        <button
          onClick={function () { setShowPalette(true); }}
          title="Command Palette (Cmd+K)"
          style={{
            background: theme.bg.surface,
            border: "1px solid " + theme.border.default,
            borderRadius: theme.radius.md,
            color: theme.text.dim,
            padding: "2px 8px",
            cursor: "pointer",
            fontSize: theme.fontSize.xs,
            fontFamily: theme.font,
            display: "flex",
            alignItems: "center",
            gap: 4,
            transition: "all " + theme.transition.fast,
          }}
          onMouseEnter={function (e) {
            e.currentTarget.style.borderColor = theme.accent.cyan;
            e.currentTarget.style.color = theme.accent.cyan;
          }}
          onMouseLeave={function (e) {
            e.currentTarget.style.borderColor = theme.border.default;
            e.currentTarget.style.color = theme.text.dim;
          }}
        >
          {"\u2318"}K
        </button>

        {errorEntries.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 4, marginLeft: 6 }}>
            <button
              onClick={function () { jumpToError("prev"); }}
              title="Previous error (Shift+E)"
              style={{
                background: "transparent",
                border: "1px solid " + theme.errorBorder,
                borderRadius: theme.radius.sm,
                color: theme.error,
                cursor: "pointer",
                padding: "2px 5px",
                fontSize: theme.fontSize.sm,
                fontFamily: theme.font,
              }}
            >
              {"\u25C0"}
            </button>
            <span style={{ fontSize: theme.fontSize.sm, color: theme.error }}>{"\u25CF"} Errors</span>
            <button
              onClick={function () { jumpToError("next"); }}
              title="Next error (E)"
              style={{
                background: "transparent",
                border: "1px solid " + theme.errorBorder,
                borderRadius: theme.radius.sm,
                color: theme.error,
                cursor: "pointer",
                padding: "2px 5px",
                fontSize: theme.fontSize.sm,
                fontFamily: theme.font,
              }}
            >
              {"\u25B6"}
            </button>
          </div>
        )}

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
          {Object.entries(TRACK_TYPES).map(function (entry) {
            var key = entry[0];
            var info = entry[1];
            var isHidden = trackFilters[key];
            return (
              <button
                key={key}
                onClick={function () { toggleTrackFilter(key); }}
                title={(isHidden ? "Show " : "Hide ") + info.label}
                style={{
                  background: isHidden ? "transparent" : alpha(info.color, 0.08),
                  border: "1px solid " + (isHidden ? theme.border.default : alpha(info.color, 0.25)),
                  color: isHidden ? theme.text.ghost : info.color,
                  borderRadius: theme.radius.sm,
                  padding: "1px 6px",
                  cursor: "pointer",
                  fontSize: theme.fontSize.xs,
                  fontFamily: theme.font,
                  textDecoration: isHidden ? "line-through" : "none",
                  transition: "all " + theme.transition.fast,
                }}
              >
                {info.icon}
              </button>
            );
          })}
          <div style={{ height: 12, width: 1, background: theme.border.default, margin: "0 2px" }} />
          <span style={{ fontSize: theme.fontSize.sm, color: theme.text.dim }}>SPEED</span>
          {SPEEDS.map(function (value) {
            return (
              <button
                key={value}
                onClick={function () { playback.setSpeed(value); }}
                style={{
                  background: playback.speed === value ? alpha(theme.accent.cyan, 0.08) : "transparent",
                  border: "1px solid " + (playback.speed === value ? theme.accent.cyan : theme.border.default),
                  color: playback.speed === value ? theme.accent.cyan : theme.text.muted,
                  borderRadius: theme.radius.md,
                  padding: "2px 7px",
                  cursor: "pointer",
                  fontSize: theme.fontSize.sm,
                  fontFamily: theme.font,
                  transition: "all " + theme.transition.fast,
                }}
              >
                {value}x
              </button>
            );
          })}
          <button
            onClick={reset}
            style={{
              background: "transparent",
              border: "1px solid " + theme.border.default,
              color: theme.text.muted,
              borderRadius: theme.radius.md,
              padding: "2px 8px",
              cursor: "pointer",
              fontSize: theme.fontSize.sm,
              fontFamily: theme.font,
              marginLeft: 8,
              transition: "all " + theme.transition.fast,
            }}
            onMouseEnter={function (e) {
              e.target.style.borderColor = theme.error;
              e.target.style.color = theme.error;
            }}
            onMouseLeave={function (e) {
              e.target.style.borderColor = theme.border.default;
              e.target.style.color = theme.text.muted;
            }}
          >
            {"\u2715"} Close
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
