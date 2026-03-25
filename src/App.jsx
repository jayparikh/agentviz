import React, { useState, useRef, useMemo, useCallback, useEffect } from "react";
import { theme } from "./lib/theme.js";
import { exportSingleSession, exportComparison } from "./lib/exportHtml.js";
import { buildFilteredEventEntries, buildTurnStartMap, buildTimeMap } from "./lib/session";
import usePersistentState from "./hooks/usePersistentState.js";
import useSessionLoader from "./hooks/useSessionLoader.js";
import usePlayback from "./hooks/usePlayback.js";
import useSearch from "./hooks/useSearch.js";
import useKeyboardShortcuts from "./hooks/useKeyboardShortcuts.js";
import useLiveStream from "./hooks/useLiveStream.js";
import useAsyncStatus from "./hooks/useAsyncStatus.js";
import useDiscoveredSessions from "./hooks/useDiscoveredSessions.js";
import useHashRouter from "./hooks/useHashRouter.js";
import Timeline from "./components/Timeline.jsx";
import ReplayView from "./components/ReplayView.jsx";
import TracksView from "./components/TracksView.jsx";
import StatsView from "./components/StatsView.jsx";
import WaterfallView from "./components/WaterfallView.jsx";
var GraphView = React.lazy(function () { return import("./components/GraphView.jsx"); });
import CommandPalette from "./components/CommandPalette.jsx";
import ShortcutsModal from "./components/ShortcutsModal.jsx";
import AppHeader from "./components/app/AppHeader.jsx";
import AppLandingState from "./components/app/AppLandingState.jsx";
import AppLoadingState from "./components/app/AppLoadingState.jsx";
import CompareLandingState from "./components/app/CompareLandingState.jsx";
import CompareShell from "./components/app/CompareShell.jsx";
import { APP_VIEWS, PLAYBACK_SPEEDS } from "./components/app/constants.js";
import DebriefView from "./components/DebriefView.jsx";
import { buildAutonomyMetrics, buildAutonomySummary } from "./lib/autonomyMetrics.js";
import {
  loadStoredSessionContent,
  persistSessionSnapshot,
  readSessionLibrary,
} from "./lib/sessionLibrary.js";

function renderActiveView(activeView, props) {
  if (activeView === "replay") {
    return (
      <ReplayView
        currentTime={props.playback.time}
        eventEntries={props.filteredEventEntries}
        turns={props.session.turns}
        turnStartMap={props.turnStartMap}
        searchQuery={props.search.searchQuery}
        matchSet={props.search.matchSet}
        metadata={props.session.metadata}
      />
    );
  }

  if (activeView === "tracks") {
    return (
      <TracksView
        currentTime={props.playback.time}
        eventEntries={props.filteredEventEntries}
        totalTime={props.session.total}
        timeMap={props.timeMap}
        turns={props.session.turns}
      />
    );
  }

  if (activeView === "waterfall") {
    return (
      <WaterfallView
        currentTime={props.playback.time}
        eventEntries={props.filteredEventEntries}
        totalTime={props.session.total}
        timeMap={props.timeMap}
        turns={props.session.turns}
      />
    );
  }

  if (activeView === "graph") {
    return (
      <React.Suspense fallback={<div style={{ padding: 40, color: theme.text.dim, textAlign: "center" }}>Loading graph...</div>}>
        <GraphView
          currentTime={props.playback.time}
          eventEntries={props.filteredEventEntries}
          totalTime={props.session.total}
          timeMap={props.timeMap}
          turns={props.session.turns}
        />
      </React.Suspense>
    );
  }

  if (activeView === "coach") {
    return (
      <DebriefView
        file={props.session.file}
        summary={props.debrief.summary}
        recommendationState={props.recommendationState}
        onSetRecommendationState={props.onSetRecommendationState}
        metadata={props.session.metadata}
        rawSession={{ events: props.session.events, turns: props.session.turns, metadata: props.session.metadata, autonomyMetrics: props.autonomyMetrics }}
      />
    );
  }

  return (
    <StatsView
      events={props.filteredEvents}
      totalTime={props.session.total}
      metadata={props.session.metadata}
      turns={props.session.turns}
      autonomyMetrics={props.autonomyMetrics}
      onOpenCoach={props.onOpenCoach}
    />
  );
}

export default function App() {
  var [view, setView] = usePersistentState("agentviz:view", "replay");
  var [trackFilters, setTrackFilters] = usePersistentState("agentviz:track-filters", {});
  var [libraryEntries, setLibraryEntries] = useState(function () {
    return readSessionLibrary();
  });
  var [showPalette, setShowPalette] = useState(false);
  var [showShortcuts, setShowShortcuts] = useState(false);
  var [showFilters, setShowFilters] = useState(false);
  var [compareLanding, setCompareLanding] = useState(false);
  var searchInputRef = useRef(null);
  var filtersRef = useRef(null);

  var discovered = useDiscoveredSessions();

  // Merge discovered sessions with library: library entries (already parsed) take precedence.
  // Filter discovered to sessions > 5KB (tiny files are Claude internal queue/ops sessions).
  var allSessions = useMemo(function () {
    try {
      // Build a lookup: discoveredPath/sessionId -> discovered session for path enrichment
      var discoveredByPath = {};
      var discoveredBySessionId = {};
      discovered.sessions.forEach(function (s) {
        if (s.size < 5000) return;
        if (s.path) discoveredByPath[s.path] = s;
        if (s.sessionId) discoveredBySessionId[s.sessionId] = s;
      });

      // Enrich library entries with discoveredPath if we can match them to a discovered session
      var enrichedLibrary = libraryEntries.map(function (e) {
        if (e.discoveredPath) return e; // already has it
        var match = (e.sessionId && discoveredBySessionId[e.sessionId])
          || (e.discoveredPath && discoveredByPath[e.discoveredPath]);
        if (match) return Object.assign({}, e, { discoveredPath: match.path });
        return e;
      });

      // Only add discovered entries that aren't already in the library
      var discoveredOnly = discovered.sessions.filter(function (s) {
        if (s.size < 5000) return false;
        return !libraryEntries.some(function (e) {
          return e.discoveredPath === s.path || e.sessionId === s.sessionId;
        });
      }).map(function (s) {
        return {
          id: s.id,
          file: s.summary || s.filename,
          filename: s.filename,
          format: s.format,
          project: s.project,
          repository: s.repository || null,
          branch: s.branch || null,
          discoveredPath: s.path,
          sessionId: s.sessionId || null,
          importedAt: s.mtime,
          updatedAt: s.mtime,
          size: s.size,
          isDiscovered: true,
        };
      });
      return enrichedLibrary.concat(discoveredOnly);
    } catch (e) {
      console.error("[allSessions] merge error:", e);
      return libraryEntries;
    }
  }, [libraryEntries, discovered.sessions]);

  var handleSessionParsed = useCallback(function (result, name, rawText) {
    var persisted = persistSessionSnapshot(name, result, rawText);
    setLibraryEntries(persisted.entries);
  }, []);

  var session = useSessionLoader({ onSessionParsed: handleSessionParsed });
  var sessionB = useSessionLoader({ autoBootstrap: false, onSessionParsed: handleSessionParsed });
  var sessionExport = useAsyncStatus();
  var compareExport = useAsyncStatus();

  useEffect(function () {
    var compareData = window.__AGENTVIZ_COMPARE__;
    if (!compareData || !compareData.a || !compareData.b) return;
    delete window.__AGENTVIZ_COMPARE__;
    setCompareLanding(true);
    session.handleFile(compareData.a.text, compareData.a.name);
    sessionB.handleFile(compareData.b.text, compareData.b.name);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  var playback = usePlayback(session.total, session.isLive);

  useLiveStream({
    enabled: session.isLive,
    onLines: session.appendLines,
  });

  var filteredEventEntries = useMemo(function () {
    return buildFilteredEventEntries(session.events, trackFilters);
  }, [session.events, trackFilters]);

  var filteredEvents = useMemo(function () {
    return filteredEventEntries.map(function (entry) { return entry.event; });
  }, [filteredEventEntries]);
  var autonomyMetrics = useMemo(function () {
    return buildAutonomyMetrics(session.events, session.turns, session.metadata);
  }, [session.events, session.turns, session.metadata]);
  var debrief = useMemo(function () {
    return { summary: buildAutonomySummary(autonomyMetrics) };
  }, [autonomyMetrics]);

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
  }, [session.total, session.isLive, playback.seek]);

  useEffect(function () {
    if (!showFilters) return;

    function handleClick(e) {
      if (filtersRef.current && !filtersRef.current.contains(e.target)) {
        setShowFilters(false);
      }
    }

    document.addEventListener("mousedown", handleClick);
    return function () {
      document.removeEventListener("mousedown", handleClick);
    };
  }, [showFilters]);

  var isValidView = APP_VIEWS.some(function (item) { return item.id === view; });
  var activeView = isValidView ? view : "replay";

  useEffect(function () {
    if (!isValidView) setView("replay");
  }, [isValidView]);

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

  var openStoredSession = useCallback(function (entry) {
    if (!entry) return;

    function afterLoad(rawText) {
      setView("stats");
      handleFile(rawText, entry.file);
      // Persist discoveredPath onto library entry so future loads can refetch from disk
      if (entry.discoveredPath) {
        setLibraryEntries(function (prev) {
          return prev.map(function (e) {
            if (e.id === entry.id && !e.discoveredPath) {
              return Object.assign({}, e, { discoveredPath: entry.discoveredPath });
            }
            return e;
          });
        });
      }
    }

    // Discovered-only session (not yet in library): fetch content from server
    if (entry.isDiscovered && entry.discoveredPath) {
      discovered.fetchSessionContent(entry.discoveredPath).then(afterLoad).catch(function () {});
      return;
    }

    // Library session: try localStorage cache first, fall back to file on disk
    var rawText = loadStoredSessionContent(entry.id);
    if (rawText) { afterLoad(rawText); return; }
    if (entry.discoveredPath) {
      discovered.fetchSessionContent(entry.discoveredPath).then(afterLoad).catch(function () {});
      return;
    }
    // No content available
  }, [handleFile, setView, setLibraryEntries, discovered.fetchSessionContent]);

  var loadSample = useCallback(function () {
    resetVisualizerState();
    session.loadSample();
  }, [resetVisualizerState, session.loadSample]);

  var reset = useCallback(function () {
    resetVisualizerState();
    session.resetSession();
    sessionB.resetSession();
    setCompareLanding(false);
  }, [resetVisualizerState, session.resetSession, sessionB.resetSession]);

  useHashRouter({
    hasSession: Boolean(session.events),
    onNavigateToLanding: reset,
  });

  var exitCompare = useCallback(function () {
    sessionB.resetSession();
    setCompareLanding(false);
  }, [sessionB.resetSession]);

  var openCompareSessionInCoach = useCallback(function (loader) {
    var rawText = loader.getRawText();
    if (!rawText) return;
    resetVisualizerState();
    session.handleFile(rawText, loader.file);
    sessionB.resetSession();
    setCompareLanding(false);
    setView("coach");
  }, [resetVisualizerState, session.handleFile, sessionB.resetSession, setView]);

  var handleExportSession = useCallback(function () {
    var rawText = session.getRawText();
    if (!rawText) return;
    sessionExport.run(function () {
      return exportSingleSession(rawText, session.file);
    });
  }, [session.getRawText, session.file, sessionExport]);

  var handleExportComparison = useCallback(function () {
    var rawA = session.getRawText();
    var rawB = sessionB.getRawText();
    if (!rawA || !rawB) return;
    compareExport.run(function () {
      return exportComparison(rawA, session.file, rawB, sessionB.file);
    });
  }, [compareExport, session.getRawText, session.file, sessionB.getRawText, sessionB.file]);

  var compareReady = compareLanding && Boolean(session.events) && Boolean(sessionB.events);

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
    var el = searchInputRef.current;
    if (el && el.offsetParent !== null) {
      el.focus();
      return true;
    }
    return false;
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
    onToggleShortcuts: function () { setShowShortcuts(function (prev) { return !prev; }); },
  });

  if (session.loading || (compareLanding && sessionB.loading)) {
    return <AppLoadingState />;
  }

  if (compareLanding && !compareReady) {
    return (
      <CompareLandingState
        session={session}
        sessionB={sessionB}
        onLoadSessionA={handleFile}
        onExitCompare={exitCompare}
      />
    );
  }

  if (!session.events) {
    return (
      <AppLandingState
        error={session.error}
        onLoad={handleFile}
        onLoadSample={loadSample}
        onStartCompare={function () { setCompareLanding(true); }}
        inboxEntries={allSessions}
        onOpenInboxSession={openStoredSession}
      />
    );
  }

  if (compareReady) {
    return (
      <CompareShell
        sessionA={{ events: session.events, metadata: session.metadata, total: session.total, file: session.file }}
        sessionB={{ events: sessionB.events, metadata: sessionB.metadata, total: sessionB.total, file: sessionB.file }}
        onExitCompare={exitCompare}
        onExportComparison={handleExportComparison}
        exportState={compareExport.state}
        exportError={compareExport.error}
        onOpenSessionA={function () { openCompareSessionInCoach(session); }}
        onOpenSessionB={function () { openCompareSessionInCoach(sessionB); }}
      />
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

      {showShortcuts && (
        <ShortcutsModal onClose={function () { setShowShortcuts(false); }} />
      )}

      <AppHeader
        session={session}
        activeView={activeView}
        views={APP_VIEWS}
        onSetView={setView}
        onReset={reset}
        search={search}
        searchInputRef={searchInputRef}
        onJumpToMatch={jumpToMatch}
        onShowPalette={function () { setShowPalette(true); }}
        errorEntries={errorEntries}
        onJumpToError={jumpToError}
        filtersRef={filtersRef}
        showFilters={showFilters}
        onToggleFilters={function () { setShowFilters(function (p) { return !p; }); }}
        activeFilterCount={activeFilterCount}
        trackFilters={trackFilters}
        onToggleTrackFilter={toggleTrackFilter}
        speed={playback.speed}
        onCycleSpeed={cycleSpeed}
        onStartCompare={function () { setCompareLanding(true); }}
        hasRawText={Boolean(session.getRawText())}
        onExportSession={handleExportSession}
        exportSessionState={sessionExport.state}
        exportSessionError={sessionExport.error}
        recentSessions={allSessions}
        onOpenRecentSession={openStoredSession}
        currentFile={session.file}
      />

      <div style={{ padding: "8px 20px 0", flexShrink: 0 }}>
        <Timeline
          currentTime={playback.time}
          totalTime={session.total}
          timeMap={timeMap}
          onSeek={playback.seek}
          isPlaying={playback.playing}
          onPlayPause={playback.playPause}
          isLive={session.isLive}
          eventEntries={filteredEventEntries}
          turns={session.turns}
          matchSet={search.matchSet}
        />
      </div>

      <div style={{ flex: 1, padding: "6px 20px 16px", minHeight: 0, overflow: "hidden" }}>
        {renderActiveView(activeView, {
          playback: playback,
          filteredEventEntries: filteredEventEntries,
          filteredEvents: filteredEvents,
          session: session,
          search: search,
          timeMap: timeMap,
          turnStartMap: turnStartMap,
          autonomyMetrics: autonomyMetrics,
          debrief: debrief,
          onOpenCoach: function () { setView("coach"); },
        })}
      </div>
    </div>
  );
}
