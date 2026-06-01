import React, { useState, useRef, useMemo, useCallback, useEffect } from "react";
import {
  theme,
  getResolvedThemeMode,
  readStoredThemePreference,
  syncThemeState,
} from "./lib/theme.js";
import usePersistentState from "./hooks/usePersistentState.js";
import useKeyboardShortcuts from "./hooks/useKeyboardShortcuts.js";
import lazyImport, { clearChunkReloadFlag } from "./lib/lazyImport.js";
import Timeline from "./components/Timeline.jsx";
import ReplayView from "./components/ReplayView.jsx";
import TracksView from "./components/TracksView.jsx";
import StatsView from "./components/StatsView.jsx";
import WaterfallView from "./components/WaterfallView.jsx";
var GraphView = React.lazy(function () { return lazyImport(function () { return import("./components/GraphView.jsx"); }); });
var CostView = React.lazy(function () { return lazyImport(function () { return import("./components/CostView.jsx"); }); });
import CommandPalette from "./components/CommandPalette.jsx";
import ShortcutsModal from "./components/ShortcutsModal.jsx";
import AppHeader from "./components/app/AppHeader.jsx";
import AppLandingState from "./components/app/AppLandingState.jsx";
import AppLoadingState from "./components/app/AppLoadingState.jsx";
import CompareLandingState from "./components/app/CompareLandingState.jsx";
var CompareShell = React.lazy(function () { return lazyImport(function () { return import("./components/app/CompareShell.jsx"); }); });
import { APP_VIEWS } from "./components/app/constants.js";
var DebriefView = React.lazy(function () { return lazyImport(function () { return import("./components/DebriefView.jsx"); }); });
import QADrawer from "./components/QADrawer.jsx";
import useFeatureFlag from "./hooks/useFeatureFlag.js";
import useQA from "./hooks/useQA.js";
import { PlaybackProvider, usePlaybackContext } from "./contexts/PlaybackContext.jsx";
import { SessionProvider, useSessionContext } from "./contexts/SessionProvider.jsx";
import AppV2 from "./AppV2.jsx";

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

  if (activeView === "cost") {
    return (
      <React.Suspense fallback={<div style={{ padding: 40, color: theme.text.dim, textAlign: "center" }}>Loading cost view...</div>}>
        <CostView
          events={props.filteredEvents}
          metadata={props.session.metadata}
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
  useEffect(function () { clearChunkReloadFlag(); }, []);
  var [view, setView] = usePersistentState("agentviz:view", "replay");
  var [themeModePreference, setThemeModePreference] = usePersistentState("agentviz:theme-mode", readStoredThemePreference);
  var [v2Enabled, setV2Enabled] = usePersistentState("agentviz:v2:enabled", true);
  var [systemThemeMode, setSystemThemeMode] = useState(function () {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return "dark";
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  });
  var [showPalette, setShowPalette] = useState(false);
  var [showShortcuts, setShowShortcuts] = useState(false);
  var [showFilters, setShowFilters] = useState(false);
  var [showQA, setShowQA] = useState(false);
  var qaFlag = useFeatureFlag("qa", false);
  var searchInputRef = useRef(null);
  var filtersRef = useRef(null);

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

  var themeTokens = useMemo(function () {
    return syncThemeState(themeModePreference, systemThemeMode);
  }, [themeModePreference, systemThemeMode]);
  var resolvedThemeMode = getResolvedThemeMode(themeModePreference, systemThemeMode);

  useEffect(function () {
    if (typeof document === "undefined") return;

    document.documentElement.dataset.theme = resolvedThemeMode;
    document.documentElement.dataset.themePreference = themeModePreference;
    document.documentElement.style.colorScheme = resolvedThemeMode;
    document.documentElement.style.setProperty("--av-bg-base", themeTokens.bg.base);
    document.documentElement.style.setProperty("--av-bg-surface", themeTokens.bg.surface);
    document.documentElement.style.setProperty("--av-bg-hover", themeTokens.bg.hover);
    document.documentElement.style.setProperty("--av-bg-active", themeTokens.bg.active);
    document.documentElement.style.setProperty("--av-focus", themeTokens.border.focus);
    document.documentElement.style.setProperty("--av-border", themeTokens.border.default);
    document.documentElement.style.setProperty("--av-border-strong", themeTokens.border.strong);
    document.documentElement.style.setProperty("--av-text-primary", themeTokens.text.primary);
    document.documentElement.style.setProperty("--av-text-secondary", themeTokens.text.secondary);
    document.body.style.background = themeTokens.bg.base;
    document.body.style.color = themeTokens.text.primary;
  }, [themeModePreference, systemThemeMode, resolvedThemeMode, themeTokens]);

  var beforeSessionChange = useCallback(function () {
    setShowPalette(false);
    setShowFilters(false);
  }, []);
  var handleStoredSessionOpen = useCallback(function () {
    setView("stats");
  }, [setView]);

  if (v2Enabled) {
    return (
      <AppV2
        currentThemeMode={themeModePreference}
        onSetThemeMode={setThemeModePreference}
        onExitV2={function () { setV2Enabled(false); }}
      />
    );
  }

  return (
    <SessionProvider
      onBeforeSessionChange={beforeSessionChange}
      onStoredSessionOpen={handleStoredSessionOpen}
    >
      <AppShell
        view={view}
        setView={setView}
        themeModePreference={themeModePreference}
        setThemeModePreference={setThemeModePreference}
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
        onTryV2={function () { setV2Enabled(true); }}
      />
    </SessionProvider>
  );
}

function AppShell({
  view, setView, themeModePreference, setThemeModePreference,
  showPalette, setShowPalette, showShortcuts, setShowShortcuts,
  showFilters, setShowFilters, showQA, setShowQA, qaFlag,
  searchInputRef, filtersRef, onTryV2,
}) {
  var sessionState = useSessionContext();
  var session = sessionState.session;
  var sessionB = sessionState.sessionB;
  var sessionExport = sessionState.sessionExport;
  var compareExport = sessionState.compareExport;
  var discovered = sessionState.discovered;

  var isValidView = APP_VIEWS.some(function (item) { return item.id === view; });
  var activeView = isValidView ? view : "replay";

  useEffect(function () {
    if (!isValidView) setView("replay");
  }, [isValidView]);

  if (session.loading || (sessionState.compareLanding && sessionB.loading)) {
    return <AppLoadingState />;
  }

  if (sessionState.compareLanding && !sessionState.compareReady) {
    return (
      <CompareLandingState
        session={session}
        sessionB={sessionB}
        onLoadSessionA={sessionState.handleFile}
        onExitCompare={sessionState.exitCompare}
      />
    );
  }

  if (!session.events) {
    return (
      <AppLandingState
        error={session.error || sessionState.loadError}
        onLoad={sessionState.handleFile}
        onLoadSample={sessionState.loadSample}
        onStartCompare={function () { sessionState.setCompareLanding(true); }}
        onTryV2={onTryV2}
        inboxEntries={sessionState.allSessions}
        onOpenInboxSession={sessionState.openStoredSession}
        onRefresh={sessionState.refreshSessions}
        manifestError={discovered.manifestError}
        isManifestMode={discovered.isManifestMode}
      />
    );
  }

  if (sessionState.compareReady) {
    return (
      <React.Suspense fallback={<AppLoadingState />}>
        <CompareShell
          sessionA={{ events: session.events, metadata: session.metadata, total: session.total, file: session.file }}
          sessionB={{ events: sessionB.events, metadata: sessionB.metadata, total: sessionB.total, file: sessionB.file }}
          onExitCompare={sessionState.exitCompare}
          onExportComparison={sessionState.handleExportComparison}
          exportState={compareExport.state}
          exportError={compareExport.error}
          onOpenSessionA={function () {
            if (sessionState.openCompareSessionInCoach(session)) setView("coach");
          }}
          onOpenSessionB={function () {
            if (sessionState.openCompareSessionInCoach(sessionB)) setView("coach");
          }}
        />
      </React.Suspense>
    );
  }

  // Active session view: wrap in PlaybackProvider so children can use usePlaybackContext()
  return (
    <PlaybackProvider key={sessionState.sessionLoadKey} session={session}>
      <AppSessionView
        session={session}
        activeView={activeView}
        setView={setView}
        currentThemeMode={themeModePreference}
        onSetThemeMode={setThemeModePreference}
        autonomyMetrics={sessionState.autonomyMetrics}
        debrief={sessionState.debrief}
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
        reset={sessionState.reset}
        allSessions={sessionState.allSessions}
        openStoredSession={sessionState.openStoredSession}
        handleExportSession={sessionState.handleExportSession}
        sessionExport={sessionExport}
        setCompareLanding={sessionState.setCompareLanding}
        onTryV2={onTryV2}
      />
    </PlaybackProvider>
  );
}

// ΓöÇΓöÇ Active session view (consumes PlaybackContext) ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

function AppSessionView({
  session, activeView, setView, autonomyMetrics, debrief,
  showPalette, setShowPalette, showShortcuts, setShowShortcuts,
  showFilters, setShowFilters, showQA, setShowQA, qaFlag,
  searchInputRef, filtersRef, reset, allSessions, openStoredSession,
  handleExportSession, sessionExport, setCompareLanding,
  currentThemeMode, onSetThemeMode, onTryV2,
}) {
  var pb = usePlaybackContext();

  // Q&A state lives at this level so it persists across drawer open/close
  var qaSessionData = useMemo(function () {
    return {
      events: session.events,
      turns: session.turns,
      metadata: session.metadata,
      autonomyMetrics: autonomyMetrics,
    };
  }, [session.events, session.turns, session.metadata, autonomyMetrics]);
  var qa = useQA(qaSessionData);

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

  // Tracks that actually have events (used to hide empty filter/stat rows)
  var activeTracks = useMemo(function () {
    var set = {};
    var entries = pb.filteredEventEntries;
    for (var i = 0; i < entries.length; i++) {
      set[entries[i].event.track] = true;
    }
    return set;
  }, [pb.filteredEventEntries]);

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
        activeTracks={activeTracks}
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
        onTryV2={onTryV2}
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
        sessionData={qaSessionData}
        onSeek={pb.playback.seek}
        turns={session.turns}
        qa={qa}
      />
    </div>
  );
}
