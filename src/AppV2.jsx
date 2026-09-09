import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { theme } from "./lib/theme.js";
import { SessionProvider, useSessionContext } from "./contexts/SessionProvider.jsx";
import { PlaybackProvider, usePlaybackContext } from "./contexts/PlaybackContext.jsx";
import useBreakpoint from "./hooks/useBreakpoint.js";
import useKeyboardShortcuts from "./hooks/useKeyboardShortcuts.js";
import useQA from "./hooks/useQA.js";
import QADrawer from "./components/QADrawer.jsx";
import Timeline from "./components/Timeline.jsx";
import ShortcutsModal from "./components/ShortcutsModal.jsx";
import FlowRail, { V2_ZONES } from "./components/v2/FlowRail.jsx";
import CommandPalette from "./components/CommandPalette.jsx";
import V2Header from "./components/v2/V2Header.jsx";
import FindPortfolio from "./components/v2/FindPortfolio.jsx";
import ReviewHub from "./components/v2/ReviewHub.jsx";
import AnalyzeShell, { ANALYZE_PANELS } from "./components/v2/AnalyzeShell.jsx";
import InvestigateView from "./components/v2/InvestigateView.jsx";
import InlineCompare from "./components/v2/InlineCompare.jsx";
import ImproveView from "./components/v2/ImproveView.jsx";
import LiveSessionBanner from "./components/v2/LiveSessionBanner.jsx";
import SessionStorageNotice from "./components/v2/SessionStorageNotice.jsx";
import ToolbarButton from "./components/ui/ToolbarButton.jsx";

var DEFAULT_ZONE = "find";
var ZONE_IDS = V2_ZONES.map(function (zone) { return zone.id; });

export function buildV2Hash(zone, options) {
  var safeZone = ZONE_IDS.indexOf(zone) !== -1 ? zone : DEFAULT_ZONE;
  var opts = normalizeNavigationOptions(options);
  if (safeZone === "analyze" && opts.panelId) {
    return "#/v2/analyze/" + opts.panelId;
  }
  return "#/v2/" + safeZone;
}

export function getV2ZoneFromHash(hash) {
  var match = String(hash || "").match(/^#\/v2\/([^/?#]+)/);
  if (!match) return DEFAULT_ZONE;
  return ZONE_IDS.indexOf(match[1]) !== -1 ? match[1] : DEFAULT_ZONE;
}

export function getV2AnalyzePanelFromHash(hash) {
  var match = String(hash || "").match(/^#\/v2\/analyze\/([^/?#]+)/);
  return match ? match[1] : null;
}

export function getV2ZoneForShortcut(key) {
  var numeric = Number(key);
  if (!numeric || numeric < 1 || numeric > V2_ZONES.length) return null;
  return V2_ZONES[numeric - 1].id;
}

export function shouldShowLiveCompletion(wasLive, liveSessionLoadKey, currentSessionLoadKey, hasEvents) {
  return Boolean(wasLive && hasEvents && liveSessionLoadKey === currentSessionLoadKey);
}

function normalizeNavigationOptions(options) {
  return options && typeof options === "object" ? options : {};
}

export function isV2ZoneDisabled(zone, session) {
  return Boolean(session && session.isLive && (zone === "compare" || zone === "improve"));
}

export function getV2DisabledZones(session) {
  return session && session.isLive ? ["compare", "improve"] : [];
}

function getV2FallbackZone(session) {
  return session && session.events ? "review" : DEFAULT_ZONE;
}

function getZoneMeta(zoneId) {
  return V2_ZONES.find(function (zone) { return zone.id === zoneId; }) || V2_ZONES[0];
}

function buildV2CommandItems(session, activeZone) {
  var hasSession = Boolean(session && session.events);
  var zoneItems = V2_ZONES.filter(function (zone) {
    return !isV2ZoneDisabled(zone.id, session);
  }).map(function (zone, index) {
    return {
      id: "v2-zone-" + zone.id,
      type: "zone",
      label: (activeZone === zone.id ? "Current: " : "Go to ") + zone.label,
      iconName: zone.icon,
      zoneId: zone.id,
      searchText: [
        zone.label,
        zone.sub,
        zone.id,
        "workflow zone",
      ].join(" "),
      priority: activeZone === zone.id ? 8 : 44 - index,
    };
  });

  if (!hasSession) return zoneItems;

  var sessionItems = [
    {
      id: "v2-failed-tools",
      type: "zone",
      label: "Go to failed tool calls",
      iconName: "alert-circle",
      zoneId: "investigate",
      options: { eventIndex: session.events.findIndex(function (event) { return event.isError; }) },
      searchText: "failed tool calls errors investigate debug",
      priority: 48,
      isError: session.metadata && session.metadata.errorCount > 0,
    },
    {
      id: "v2-cost-analysis",
      type: "zone",
      label: "Go to cost analysis",
      iconName: "coins",
      zoneId: "analyze",
      options: { panelId: "cost" },
      searchText: "cost analysis tokens spend cache context analyze",
      priority: 46,
    },
  ];

  if (!isV2ZoneDisabled("compare", session)) {
    sessionItems.push({
      id: "v2-compare-current",
      type: "zone",
      label: "Compare current run",
      iconName: "arrow-up-down",
      zoneId: "compare",
      searchText: "compare current run session",
      priority: 42,
    });
  }

  if (!isV2ZoneDisabled("improve", session)) {
    sessionItems.push({
      id: "v2-ask-session",
      type: "zone",
      label: "Ask about this session",
      iconName: "message-circle",
      zoneId: "improve",
      options: { openQA: true },
      searchText: "ask session qa question improve coach",
      priority: 40,
    });
  }

  return zoneItems.concat(sessionItems, ANALYZE_PANELS.filter(function (panel) { return panel.id !== "cost"; }).map(function (panel) {
    return {
      id: "v2-panel-" + panel.id, type: "zone", label: "Analyze " + panel.label,
      zoneId: "analyze", options: { panelId: panel.id }, iconName: panel.icon,
      searchText: ("analyze " + panel.id + " " + panel.label).toLowerCase(), priority: 38,
    };
  }));
}

function ZonePlaceholder({ zone, sessionState, compareSeedEntries }) {
  var meta = getZoneMeta(zone);
  var hasSession = Boolean(sessionState.session.events);
  var cards = {
    find: [
      "Unified session portfolio",
      "Recent sessions, discovered sessions, manifest sessions, and import live here.",
      "Open a saved run, import a file, or start with the demo session.",
    ],
    review: [
      "Review Hub",
      hasSession ? "Session health, errors, cost, autonomy, and evidence-linked insights." : "Open a session from Find to see health and evidence-linked insights.",
      hasSession ? "Use the insight cards to jump into supporting evidence." : "Find is the home for stored, discovered, manifest, and imported sessions.",
    ],
    investigate: [
      "Evidence stream",
      "Open a session to inspect the chronological replay, diffs, raw payloads, and contextual actions.",
      "Find a run first, then return here to investigate event-level evidence.",
    ],
    analyze: [
      "Deep visualizations",
      "Open a session to inspect Stats, Tracks, Waterfall, Graph, and Cost panels.",
      "Analysis panels share the same playback and filter state as the evidence stream.",
    ],
    compare: [
      "Inline compare",
      "Compare stays in the rail instead of taking over the whole app.",
      "Select two sessions in Find or use a compare action from a completed session.",
    ],
    improve: [
      "Coach and Q&A",
      "Recommendations, coach output, and session Q&A live here.",
      "Open a completed session to draft improvements and ask follow-up questions.",
    ],
  };
  var content = cards[zone] || cards.find;

  return (
    <main style={{
      flex: 1,
      minWidth: 0,
      overflow: "auto",
      padding: theme.space.xxl,
      background: theme.bg.base,
    }}>
      <div style={{
        maxWidth: 980,
        border: "1px solid " + theme.border.default,
        borderRadius: theme.radius.xxl,
        background: theme.bg.surface,
        padding: theme.space.xxl,
        boxShadow: theme.shadow.sm,
      }}>
        <div style={{
          color: theme.accent.primary,
          fontFamily: theme.font.mono,
          fontSize: theme.fontSize.xs,
          textTransform: "uppercase",
          letterSpacing: 1,
          marginBottom: theme.space.md,
        }}>
          {meta.label}
        </div>
        <h1 style={{
          margin: 0,
          color: theme.text.primary,
          fontFamily: theme.font.mono,
          fontSize: theme.fontSize.xxl,
          letterSpacing: "-0.04em",
        }}>
          {content[0]}
        </h1>
        <p style={{
          margin: theme.space.lg + "px 0 0",
          color: theme.text.secondary,
          fontFamily: theme.font.mono,
          fontSize: theme.fontSize.md,
          lineHeight: 1.7,
          maxWidth: 700,
        }}>
          {content[1]}
        </p>
        <div style={{
          marginTop: theme.space.xl,
          border: "1px solid " + theme.border.default,
          borderRadius: theme.radius.lg,
          background: theme.bg.raised,
          color: theme.text.muted,
          fontFamily: theme.font.mono,
          fontSize: theme.fontSize.sm,
          lineHeight: 1.6,
          padding: theme.space.lg,
        }}>
          {content[2]}
        </div>
        {zone === "compare" && compareSeedEntries && compareSeedEntries.length >= 2 && (
          <div style={{
            marginTop: theme.space.lg,
            display: "grid",
            gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
            gap: theme.space.md,
          }}>
            {compareSeedEntries.slice(0, 2).map(function (entry, index) {
              var label = index === 0 ? "Session A" : "Session B";
              var title = entry && (entry.primaryPrompt || entry.file || entry.filename || entry.id) || "Selected session";
              return (
                <div key={label} style={{
                  border: "1px solid " + theme.border.default,
                  borderRadius: theme.radius.lg,
                  background: theme.bg.base,
                  padding: theme.space.lg,
                  minWidth: 0,
                }}>
                  <div style={{ color: theme.text.dim, fontSize: theme.fontSize.xs, marginBottom: theme.space.sm }}>
                    {label}
                  </div>
                  <div style={{
                    color: theme.text.primary,
                    fontFamily: theme.font.mono,
                    fontSize: theme.fontSize.sm,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}>
                    {title}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}

function FindZone({ sessionState, onNavigate, onCompareSelected }) {
  return (
    <FindPortfolio
      entries={sessionState.allSessions}
      onReadStart={sessionState.beginFileRead}
      onReadError={function () { sessionState.session.failLoad(null); }}
      onOpenSession={async function (entry) {
        if (await sessionState.openStoredSession(entry)) onNavigate("review");
      }}
      onImport={async function (text, name) {
        if (await sessionState.handleFile(text, name)) onNavigate("review");
      }}
      onLoadSample={function (mode) {
        sessionState.loadSample(mode);
        onNavigate("review");
      }}
      onRefresh={sessionState.refreshSessions}
      onCompareSelected={async function (entries) {
        if (onCompareSelected) onCompareSelected(entries);
        if (await sessionState.openCompareEntries(entries)) onNavigate("compare");
      }}
      manifestError={sessionState.discovered.manifestError}
      isManifestMode={sessionState.discovered.isManifestMode}
    />
  );
}

function ReviewZone({ sessionState, onNavigate }) {
  return (
    <ReviewHub
      session={sessionState.session}
      autonomyMetrics={sessionState.autonomyMetrics}
      onNavigate={onNavigate}
    />
  );
}

function AnalyzeZone({ sessionState, targetPanelId, targetEventIndex, targetRequest, onNavigate }) {
  if (!sessionState.session.events) {
    return <ZonePlaceholder zone="analyze" sessionState={sessionState} />;
  }

  return (
      <AnalyzeShell
        session={sessionState.session}
        autonomyMetrics={sessionState.autonomyMetrics}
        targetPanelId={targetPanelId}
        targetEventIndex={targetEventIndex}
        targetRequest={targetRequest}
        onNavigate={onNavigate}
      />
  );
}

function InvestigateZone({ sessionState, targetEventIndex, targetRequest, onNavigate }) {
  if (!sessionState.session.events) {
    return <ZonePlaceholder zone="investigate" sessionState={sessionState} />;
  }

  return (
      <InvestigateView
        session={sessionState.session}
        targetEventIndex={targetEventIndex}
        targetRequest={targetRequest}
        onNavigate={onNavigate}
      />
  );
}

function CompareZone({ sessionState, compareSeedEntries, compareContext, onNavigate }) {
  return (
    <InlineCompare
      sessionA={{ events: sessionState.session.events, metadata: sessionState.session.metadata, total: sessionState.session.total, file: sessionState.session.file }}
      sessionB={{ events: sessionState.sessionB.events, metadata: sessionState.sessionB.metadata, total: sessionState.sessionB.total, file: sessionState.sessionB.file }}
      seedEntries={compareSeedEntries}
      candidateEntries={sessionState.allSessions}
      canCompareCurrent={Boolean(sessionState.session.getRawText && sessionState.session.getRawText())}
      compareContext={compareContext}
      compareReady={sessionState.compareReady}
      onNavigate={onNavigate}
      onCompareWithEntry={sessionState.openCompareCurrentWithEntry}
      onExportComparison={sessionState.handleExportComparison}
      exportState={sessionState.compareExport.state}
      exportError={sessionState.compareExport.error}
      onOpenSessionA={async function () {
        if (await sessionState.openCompareSessionInCoach(sessionState.session)) onNavigate("improve");
      }}
      onOpenSessionB={async function () {
        if (await sessionState.openCompareSessionInCoach(sessionState.sessionB)) onNavigate("improve");
      }}
    />
  );
}

function ImproveZone({ sessionState, openQARequest, onNavigate, onOpenQA }) {
  return (
      <ImproveView
        session={sessionState.session}
        autonomyMetrics={sessionState.autonomyMetrics}
        debrief={sessionState.debrief}
        openQARequest={openQARequest}
        onNavigate={onNavigate}
        onOpenQA={onOpenQA}
      />
  );
}

function WorkflowSession({ sessionState, activeZone, navigate, showPalette, onTogglePalette, onShortcutNotice, helpRequest, children }) {
  var session = sessionState.session;
  var pb = usePlaybackContext();
  var [showQA, setShowQA] = useState(false);
  var [question, setQuestion] = useState("");
  var [showShortcuts, setShowShortcuts] = useState(false);
  var previousHelpRequest = useRef(helpRequest);
  var errorIndexRef = useRef(null);
  var qaData = useMemo(function () {
    return { events: session.events || [], turns: session.turns, metadata: session.metadata, autonomyMetrics: sessionState.autonomyMetrics };
  }, [session.events, session.turns, session.metadata, sessionState.autonomyMetrics]);
  var qa = useQA(qaData);
  var transportAvailable = Boolean(session.events && (activeZone === "investigate" || activeZone === "analyze"));
  var openQA = useCallback(function (prefill) {
    if (!session.events || session.isLive) return;
    setQuestion(prefill || "");
    setShowQA(true);
  }, [session.events, session.isLive]);
  // Playback ticks update the transport, not unrelated zone subtrees.
  var content = useMemo(function () { return children(openQA); }, [children, openQA]);

  useEffect(function () {
    if (helpRequest === previousHelpRequest.current) return;
    previousHelpRequest.current = helpRequest;
    setShowShortcuts(true);
  }, [helpRequest]);

  useKeyboardShortcuts({
    hasSession: Boolean(session.events), isLive: session.isLive, transportAvailable: transportAvailable,
    showPalette: showPalette, showShortcuts: showShortcuts, showQA: showQA,
    time: pb.playback.time, onSeek: pb.playback.seek, onPlayPause: pb.playback.playPause,
    onTogglePalette: onTogglePalette, onToggleQA: function () { openQA(""); },
    onToggleShortcuts: function () { setShowShortcuts(true); },
    onNavigateShortcut: function (key) {
      if (key === "7") onShortcutNotice("Coach is now Improve. Use 6 for Improve.");
      navigate(key === "7" ? "improve" : getV2ZoneForShortcut(key));
    },
    onFocusSearch: function () {
      var selector = activeZone === "find" ? '[aria-label="Search v2 sessions"]'
        : activeZone === "investigate" ? '[aria-label="Search evidence events"]' : null;
      var input = selector && document.querySelector(selector);
      if (input) input.focus();
      return Boolean(input);
    },
    onJumpToError: function (direction) {
      var entries = (session.events || []).map(function (event, index) { return { event: event, index: index }; })
        .filter(function (entry) { return entry.event.isError; });
      if (!entries.length) return;
      var previous = entries.findIndex(function (entry) { return entry.index === errorIndexRef.current && entry.event.t === pb.playback.time; });
      var next;
      if (previous >= 0) next = entries[(previous + (direction === "next" ? 1 : entries.length - 1)) % entries.length];
      else if (direction === "next") next = entries.find(function (entry) { return entry.event.t > pb.playback.time; }) || entries[0];
      else next = entries.slice().reverse().find(function (entry) { return entry.event.t < pb.playback.time; }) || entries[entries.length - 1];
      errorIndexRef.current = next.index;
      pb.playback.seek(next.event.t);
      navigate("investigate", { eventIndex: next.index });
    },
  });

  return <>
    {content}
    {transportAvailable && <div style={{ flexShrink: 0, padding: "8px 16px 0", borderTop: "1px solid " + theme.border.default }}>
      <Timeline currentTime={pb.playback.time} totalTime={session.total} timeMap={pb.timeMap}
        onSeek={pb.playback.seek} isPlaying={pb.playback.playing} onPlayPause={pb.playback.playPause}
        speed={pb.playback.speed} onSetSpeed={pb.playback.setSpeed} isLive={session.isLive}
        eventEntries={pb.filteredEventEntries} turns={session.turns} matchSet={pb.search.matchSet} />
    </div>}
    <QADrawer open={showQA && !session.isLive} onClose={function () { setShowQA(false); }}
      sessionData={qaData} qa={qa} initialQuestion={question} turns={session.turns}
      onSeek={function (time) {
        setShowQA(false);
        var turn = session.turns.find(function (item) { return item.startTime === time; });
        navigate("investigate", { eventIndex: turn && turn.eventIndices ? turn.eventIndices[0] : 0 });
      }} />
    {showShortcuts && <ShortcutsModal onClose={function () { setShowShortcuts(false); }} />}
  </>;
}

export function AppV2Shell({ currentThemeMode, onSetThemeMode, densityControl }) {
  var sessionState = useSessionContext();
  var breakpoint = useBreakpoint();
  var [activeZone, setActiveZone] = useState(function () {
    return getV2ZoneFromHash(window.location.hash);
  });
  var [showPalettePlaceholder, setShowPalettePlaceholder] = useState(false);
  var [compareSeedEntries, setCompareSeedEntries] = useState([]);
  var [liveComplete, setLiveComplete] = useState(false);
  var [shortcutNotice, setShortcutNotice] = useState(null);
  var [navigationTarget, setNavigationTarget] = useState(null);
  var [helpRequest, setHelpRequest] = useState(0);
  var wasLiveRef = useRef(false);
  var liveSessionLoadKeyRef = useRef(null);

  useEffect(function () {
    function syncFromHash() {
      setActiveZone(getV2ZoneFromHash(window.location.hash));
      setNavigationTarget(null);
    }

    var initialZone = getV2ZoneFromHash(window.location.hash);
    if (!String(window.location.hash || "").startsWith("#/v2/")) {
      window.history.replaceState(null, "", buildV2Hash(initialZone));
    }
    setActiveZone(initialZone);

    window.addEventListener("hashchange", syncFromHash);
    window.addEventListener("popstate", syncFromHash);
    return function () {
      window.removeEventListener("hashchange", syncFromHash);
      window.removeEventListener("popstate", syncFromHash);
    };
  }, []);

  var navigate = useCallback(function (zone, options) {
    var safeZone = isV2ZoneDisabled(zone, sessionState.session)
      ? getV2FallbackZone(sessionState.session)
      : zone;
    var nextOptions = normalizeNavigationOptions(options);
    setNavigationTarget(Object.keys(nextOptions).length > 0
      ? Object.assign({ zone: safeZone, nonce: Date.now() }, nextOptions)
      : null);
    var nextHash = buildV2Hash(safeZone, nextOptions);
    if (window.location.hash !== nextHash) {
      window.history.pushState(null, "", nextHash);
    }
    setActiveZone(getV2ZoneFromHash(nextHash));
  }, [sessionState.session.events, sessionState.session.isLive]);

  useEffect(function () {
    if (!shortcutNotice) return;
    var id = setTimeout(function () {
      setShortcutNotice(null);
    }, 2200);
    return function () { clearTimeout(id); };
  }, [shortcutNotice]);

  var disabledZones = useMemo(function () {
    return getV2DisabledZones(sessionState.session);
  }, [sessionState.session.isLive]);

  useEffect(function () {
    if (isV2ZoneDisabled(activeZone, sessionState.session)) {
      navigate(getV2FallbackZone(sessionState.session));
    }
  }, [activeZone, navigate, sessionState.session.events, sessionState.session.isLive]);

  var commandItems = useMemo(function () {
    return buildV2CommandItems(sessionState.session, activeZone);
  }, [sessionState.session, activeZone]);
  var hasExportableSession = Boolean(
    sessionState.session.getRawText && sessionState.session.getRawText(),
  );

  useEffect(function () {
    if (sessionState.session.loading) {
      wasLiveRef.current = false;
      liveSessionLoadKeyRef.current = null;
      setLiveComplete(false);
      return;
    }
    if (sessionState.session.isLive) {
      wasLiveRef.current = true;
      liveSessionLoadKeyRef.current = sessionState.sessionLoadKey;
      setLiveComplete(false);
      return;
    }

    if (shouldShowLiveCompletion(wasLiveRef.current, liveSessionLoadKeyRef.current, sessionState.sessionLoadKey, sessionState.session.events)) {
      wasLiveRef.current = false;
      liveSessionLoadKeyRef.current = null;
      setLiveComplete(true);
      navigate("review");
      return;
    }

    if (wasLiveRef.current && sessionState.session.events) {
      wasLiveRef.current = false;
      liveSessionLoadKeyRef.current = null;
      setLiveComplete(false);
    }

    if (!sessionState.session.events) {
      wasLiveRef.current = false;
      liveSessionLoadKeyRef.current = null;
      setLiveComplete(false);
    }
  }, [sessionState.session.loading, sessionState.session.isLive, sessionState.session.events, sessionState.sessionLoadKey, navigate]);

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
      <V2Header
        densityControl={densityControl}
        session={sessionState.session}
        activeZone={activeZone}
        currentThemeMode={currentThemeMode}
        onSetThemeMode={onSetThemeMode}
        onOpenCommandPalette={function () { setShowPalettePlaceholder(true); }}
        onExportSession={hasExportableSession ? sessionState.handleExportSession : null}
        exportSessionState={sessionState.sessionExport.state}
        exportSessionError={sessionState.sessionExport.error}
        onOpenShortcuts={function () { setHelpRequest(function (value) { return value + 1; }); }}
        onCloseSession={sessionState.session.events || sessionState.session.loading || sessionState.session.isLive ? function () {
          sessionState.reset();
          setCompareSeedEntries([]);
          setShowPalettePlaceholder(false);
          setShortcutNotice(null);
          setLiveComplete(false);
          navigate("find");
        } : null}
        compact={breakpoint.isCompact}
      />
      {(sessionState.session.isLive || liveComplete) && (
        <LiveSessionBanner
          session={sessionState.session}
          completed={liveComplete && !sessionState.session.isLive}
          onReview={function () { navigate("review"); }}
          onCompare={function () { navigate("compare"); }}
          onImprove={function () { navigate("improve"); }}
          onDismiss={function () { setLiveComplete(false); }}
        />
      )}
      <SessionStorageNotice sessionState={sessionState} />
      <PlaybackProvider key={sessionState.sessionLoadKey} session={sessionState.session}>
      <WorkflowSession sessionState={sessionState} activeZone={activeZone} navigate={navigate}
        showPalette={showPalettePlaceholder} onTogglePalette={function () { setShowPalettePlaceholder(function (value) { return !value; }); }}
        onShortcutNotice={setShortcutNotice} helpRequest={helpRequest}>
      {function (openQA) { return <>
      {(sessionState.session.loading || sessionState.session.error || sessionState.loadError) && (
        <div
          role={sessionState.session.loading ? "status" : "alert"}
          style={{
            padding: theme.space.md,
            background: sessionState.session.loading ? theme.bg.surface : theme.semantic.errorBg,
            color: sessionState.session.loading ? theme.text.secondary : theme.semantic.errorText,
            borderBottom: "1px solid " + theme.border.default,
            fontSize: theme.fontSize.sm,
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: theme.space.md,
          }}
        >
          {sessionState.session.loading
            ? "Loading requested session..."
            : sessionState.session.error || sessionState.loadError}
          {!sessionState.session.loading && sessionState.retryLoad && (
            <ToolbarButton onClick={async function () {
              if (await sessionState.retryLoad()) navigate("review");
            }}>Retry load</ToolbarButton>
          )}
          {!sessionState.session.loading && (
            <ToolbarButton onClick={function () { navigate("find"); }}>Reimport from Find</ToolbarButton>
          )}
        </div>
      )}
      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
        <FlowRail activeZone={activeZone} onNavigate={navigate} disabledZones={disabledZones} compact={breakpoint.isCompact} />
        {activeZone === "find" ? (
          <FindZone
            sessionState={sessionState}
            onNavigate={navigate}
            onCompareSelected={function (entries) {
              setCompareSeedEntries(entries || []);
            }}
          />
        ) : activeZone === "review" ? (
          <ReviewZone sessionState={sessionState} onNavigate={navigate} />
        ) : activeZone === "investigate" ? (
          <InvestigateZone
            sessionState={sessionState}
            targetEventIndex={navigationTarget && navigationTarget.zone === "investigate" ? navigationTarget.eventIndex : null}
            targetRequest={navigationTarget}
            onNavigate={navigate}
          />
        ) : activeZone === "analyze" ? (
          <AnalyzeZone
            sessionState={sessionState}
            targetPanelId={navigationTarget && navigationTarget.zone === "analyze" ? navigationTarget.panelId : getV2AnalyzePanelFromHash(window.location.hash)}
            targetEventIndex={navigationTarget && navigationTarget.zone === "analyze" ? navigationTarget.eventIndex : null}
            targetRequest={navigationTarget}
            onNavigate={navigate}
          />
        ) : activeZone === "compare" ? (
          <CompareZone
            sessionState={sessionState}
            compareSeedEntries={compareSeedEntries}
            compareContext={navigationTarget && navigationTarget.zone === "compare" ? navigationTarget : null}
            onNavigate={navigate}
          />
        ) : activeZone === "improve" ? (
          <ImproveZone
            sessionState={sessionState}
            openQARequest={navigationTarget && navigationTarget.zone === "improve" ? navigationTarget : null}
            onNavigate={navigate}
            onOpenQA={openQA}
          />
        ) : (
          <ZonePlaceholder
            zone={activeZone}
            sessionState={sessionState}
            compareSeedEntries={compareSeedEntries}
          />
        )}
      </div>
      </>; }}
      </WorkflowSession>
      </PlaybackProvider>
      {shortcutNotice && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: "fixed",
            right: theme.space.xl,
            bottom: theme.space.xl,
            zIndex: theme.z.tooltip,
            border: "1px solid " + theme.border.strong,
            borderRadius: theme.radius.lg,
            background: theme.bg.surface,
            color: theme.text.secondary,
            boxShadow: theme.shadow.md,
            padding: "8px 12px",
            fontFamily: theme.font.mono,
            fontSize: theme.fontSize.sm,
          }}
        >
          {shortcutNotice}
        </div>
      )}
      {showPalettePlaceholder && (
        <CommandPalette
          events={sessionState.session.events || []}
          turns={sessionState.session.turns || []}
          extraItems={commandItems}
          placeholder="Search workflow, events, turns..."
          onNavigateZone={navigate}
          onSeek={function (time, eventIndex) {
            var index = eventIndex == null
              ? (sessionState.session.events || []).findIndex(function (event) { return event.t === time; })
              : eventIndex;
            navigate("investigate", { eventIndex: index });
          }}
          onClose={function () { setShowPalettePlaceholder(false); }}
        />
      )}
    </div>
  );
}

export default function AppV2({ currentThemeMode, onSetThemeMode, densityControl }) {
  return (
    <SessionProvider>
      <AppV2Shell
        densityControl={densityControl}
        currentThemeMode={currentThemeMode}
        onSetThemeMode={onSetThemeMode}
      />
    </SessionProvider>
  );
}
