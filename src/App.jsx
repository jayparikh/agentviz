import React, { useState, useRef, useMemo, useCallback, useEffect } from "react";
import { theme, getResolvedThemeMode, getThemeTokensForMode, setSystemThemePreference, setThemePreference } from "./lib/theme.js";
import { exportSingleSession, exportComparison } from "./lib/exportHtml.js";
import usePersistentState from "./hooks/usePersistentState.js";
import useSessionLoader from "./hooks/useSessionLoader.js";
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
var CompareShell = React.lazy(function () { return import("./components/app/CompareShell.jsx"); });
import { APP_VIEWS } from "./components/app/constants.js";
var DebriefView = React.lazy(function () { return import("./components/DebriefView.jsx"); });
import QADrawer from "./components/QADrawer.jsx";
import useFeatureFlag from "./hooks/useFeatureFlag.js";
import { buildAutonomyMetrics, buildAutonomySummary } from "./lib/autonomyMetrics.js";
import {
  loadStoredSessionContent,
  persistSessionSnapshot,
  readSessionLibrary,
} from "./lib/sessionLibrary.js";
import { PlaybackProvider, usePlaybackContext } from "./contexts/PlaybackContext.jsx";

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
      <React.Suspense fallback={<div style={{ padding: 40, color: theme.text.dim, textAlign: "center" }}>Loading coach...</div>}>
        <DebriefView
          file={props.session.file}
          summary={props.debrief.summary}
          recommendationState={props.recommendationState}
          onSetRecommendationState={props.onSetRecommendationState}
          metadata={props.session.metadata}
          rawSession={{ events: props.session.events, turns: props.session.turns, metadata: props.session.metadata, autonomyMetrics: props.autonomyMetrics }}
        />
      </React.Suspense>
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
  var [themeModePreference, setThemeModePreference] = usePersistentState("agentviz:theme-mode", "dark");
  var [libraryEntries, setLibraryEntries] = useState(function () {
    return readSessionLibrary();
  });
  var [systemThemeMode, setSystemThemeMode] = useState(function () {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return "dark";
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  });
  var [showPalette, setShowPalette] = useState(false);
  var [showShortcuts, setShowShortcuts] = useState(false);
  var [showFilters, setShowFilters] = useState(false);
  var [compareLanding, setCompareLanding] = useState(false);
  var [showQA, setShowQA] = useState(false);
  var qaFlag = useFeatureFlag("qa", false);
  var searchInputRef = useRef(null);
  var filtersRef = useRef(null);
  var sessionLoadCount = useRef(0);

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

  useLiveStream({
    enabled: session.isLive,
    onLines: session.appendLines,
  });

  useEffect(function () {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;

    var mediaQuery = window.matchMedia("(prefers-color-scheme: light)");

    function handleChange(event) {
      setSystemThemeMode(event.matches ? "light" : "dark");
    }

    setSystemThemeMode(mediaQuery.matches ? "light" : "dark");

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", handleChange);
      return function () {
        mediaQuery.removeEventListener("change", handleChange);
      };
    }

    mediaQuery.addListener(handleChange);
    return function () {
      mediaQuery.removeListener(handleChange);
    };
  }, []);

  setThemePreference(themeModePreference);
  setSystemThemePreference(systemThemeMode);

  var resolvedThemeMode = getResolvedThemeMode(themeModePreference, systemThemeMode);

  useEffect(function () {
    if (typeof document === "undefined") return;

    var tokens = getThemeTokensForMode(themeModePreference, systemThemeMode);

    document.documentElement.dataset.theme = resolvedThemeMode;
    document.documentElement.dataset.themePreference = themeModePreference;
    document.documentElement.style.colorScheme = resolvedThemeMode;
    document.documentElement.style.setProperty("--av-bg-base", tokens.bg.base);
    document.documentElement.style.setProperty("--av-bg-surface", tokens.bg.surface);
    document.documentElement.style.setProperty("--av-bg-hover", tokens.bg.hover);
    document.documentElement.style.setProperty("--av-bg-active", tokens.bg.active);
    document.documentElement.style.setProperty("--av-focus", tokens.border.focus);
    document.documentElement.style.setProperty("--av-border", tokens.border.default);
    document.documentElement.style.setProperty("--av-border-strong", tokens.border.strong);
    document.documentElement.style.setProperty("--av-text-primary", tokens.text.primary);
    document.documentElement.style.setProperty("--av-text-secondary", tokens.text.secondary);
    document.body.style.background = tokens.bg.base;
    document.body.style.color = tokens.text.primary;
  }, [themeModePreference, systemThemeMode, resolvedThemeMode]);

  var autonomyMetrics = useMemo(function () {
    return buildAutonomyMetrics(session.events, session.turns, session.metadata);
  }, [session.events, session.turns, session.metadata]);
  var debrief = useMemo(function () {
    return { summary: buildAutonomySummary(autonomyMetrics) };
  }, [autonomyMetrics]);

  var isValidView = APP_VIEWS.some(function (item) { return item.id === view; });
  var activeView = isValidView ? view : "replay";

  useEffect(function () {
    if (!isValidView) setView("replay");
  }, [isValidView]);

  var handleFile = useCallback(function (text, name) {
    sessionLoadCount.current += 1;
    setShowPalette(false);
    setShowFilters(false);
    session.handleFile(text, name);
  }, [session.handleFile]);

  var openStoredSession = useCallback(function (entry) {
    if (!entry) return;

    function afterLoad(rawText) {
      setView("stats");
      handleFile(rawText, entry.file);
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

    if (entry.isDiscovered && entry.discoveredPath) {
      discovered.fetchSessionContent(entry.discoveredPath).then(afterLoad).catch(function () { });
      return;
    }

    var rawText = loadStoredSessionContent(entry.id);
    if (rawText) { afterLoad(rawText); return; }
    if (entry.discoveredPath) {
      discovered.fetchSessionContent(entry.discoveredPath).then(afterLoad).catch(function () { });
      return;
    }
  }, [handleFile, setView, setLibraryEntries, discovered.fetchSessionContent]);

  var loadSample = useCallback(function () {
    sessionLoadCount.current += 1;
    setShowPalette(false);
    setShowFilters(false);
    session.loadSample();
  }, [session.loadSample]);

  var reset = useCallback(function () {
    setShowPalette(false);
    setShowFilters(false);
    session.resetSession();
    sessionB.resetSession();
    setCompareLanding(false);
  }, [session.resetSession, sessionB.resetSession]);

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
    session.handleFile(rawText, loader.file);
    sessionB.resetSession();
    setCompareLanding(false);
    setView("coach");
  }, [session.handleFile, sessionB.resetSession, setView]);

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
      <React.Suspense fallback={<AppLoadingState />}>
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
      </React.Suspense>
    );
  }

  // Active session view: wrap in PlaybackProvider so children can use usePlaybackContext()
  return (
    <PlaybackProvider key={sessionLoadCount.current} session={session}>
      <AppSessionView
        session={session}
        activeView={activeView}
        setView={setView}
        currentThemeMode={themeModePreference}
        onSetThemeMode={setThemeModePreference}
        autonomyMetrics={autonomyMetrics}
        debrief={debrief}
        showPalette={showPalette}
        setShowPalette={setShowPalette}
        showShortcuts={showShortcuts}
        setShowShortcuts={setShowShortcuts}
        showFilters={showFilters}
        setShowFilters={setShowFilters}
        showQA={showQA}
        setShowQA={setShowQA}
        qaFlag={qaFlag}
        searchInputRef={searchInputRef}
        filtersRef={filtersRef}
        reset={reset}
        allSessions={allSessions}
        openStoredSession={openStoredSession}
        handleExportSession={handleExportSession}
        sessionExport={sessionExport}
        setCompareLanding={setCompareLanding}
      />
    </PlaybackProvider>
  );
}

// ── Active session view (consumes PlaybackContext) ──────────────────────────

function AppSessionView({
  session, activeView, setView, autonomyMetrics, debrief,
  showPalette, setShowPalette, showShortcuts, setShowShortcuts,
  showFilters, setShowFilters, showQA, setShowQA, qaFlag,
  searchInputRef, filtersRef, reset, allSessions, openStoredSession,
  handleExportSession, sessionExport, setCompareLanding,
  currentThemeMode, onSetThemeMode,
}) {
  var pb = usePlaybackContext();

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
    showPalette: showPalette || showQA,
    showShortcuts: showShortcuts,
    time: pb.playback.time,
    onTogglePalette: function () { setShowPalette(function (prev) { return !prev; }); },
    onDismissHero: session.dismissHero,
    onPlayPause: pb.playback.playPause,
    onSeek: pb.playback.seek,
    onSetView: setView,
    onJumpToError: pb.jumpToError,
    onFocusSearch: focusSearch,
    onToggleShortcuts: function () { setShowShortcuts(function (prev) { return !prev; }); },
    onToggleQA: function () {
      if (!qaFlag.enabled) qaFlag.setEnabled(true);
      setShowQA(function (prev) { return !prev; });
    },
  });

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
            pb.playback.seek(nextTime);
            setShowPalette(false);
          }}
          onSetView={function (nextView) {
            setView(nextView);
            setShowPalette(false);
          }}
          onAction={function (actionId) {
            if (actionId === "toggleQA") setShowQA(true);
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
        currentThemeMode={currentThemeMode}
        onSetThemeMode={onSetThemeMode}
        onReset={reset}
        search={pb.search}
        searchInputRef={searchInputRef}
        onJumpToMatch={pb.jumpToMatch}
        onShowPalette={function () { setShowPalette(true); }}
        errorEntries={pb.errorEntries}
        onJumpToError={pb.jumpToError}
        filtersRef={filtersRef}
        showFilters={showFilters}
        onToggleFilters={function () { setShowFilters(function (p) { return !p; }); }}
        activeFilterCount={pb.activeFilterCount}
        trackFilters={pb.trackFilters}
        onToggleTrackFilter={pb.toggleTrackFilter}
        speed={pb.playback.speed}
        onCycleSpeed={pb.cycleSpeed}
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
          currentTime={pb.playback.time}
          totalTime={session.total}
          timeMap={pb.timeMap}
          onSeek={pb.playback.seek}
          isPlaying={pb.playback.playing}
          onPlayPause={pb.playback.playPause}
          isLive={session.isLive}
          eventEntries={pb.filteredEventEntries}
          turns={session.turns}
          matchSet={pb.search.matchSet}
        />
      </div>

      <div style={{ flex: 1, padding: "8px 20px 16px", minHeight: 0, overflow: "hidden" }}>
        {renderActiveView(activeView, {
          playback: pb.playback,
          filteredEventEntries: pb.filteredEventEntries,
          filteredEvents: pb.filteredEvents,
          session: session,
          search: pb.search,
          timeMap: pb.timeMap,
          turnStartMap: pb.turnStartMap,
          autonomyMetrics: autonomyMetrics,
          debrief: debrief,
          onOpenCoach: function () { setView("coach"); },
        })}
      </div>

      <QADrawer
        open={showQA}
        onClose={function () { setShowQA(false); }}
        onDisable={function () { setShowQA(false); qaFlag.setEnabled(false); }}
        sessionData={{
          events: session.events,
          turns: session.turns,
          metadata: session.metadata,
          autonomyMetrics: autonomyMetrics,
        }}
        onSeek={pb.playback.seek}
        turns={session.turns}
      />
    </div>
  );
}
