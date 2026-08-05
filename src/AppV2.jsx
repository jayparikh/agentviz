import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { theme } from "./lib/theme.js";
import { SessionProvider, useSessionContext } from "./contexts/SessionProvider.jsx";
import { PlaybackProvider } from "./contexts/PlaybackContext.jsx";
import useBreakpoint from "./hooks/useBreakpoint.js";
import { isEditableTarget } from "./hooks/useKeyboardShortcuts.js";
import FlowRail, { V2_ZONES } from "./components/v2/FlowRail.jsx";
import CommandPalette from "./components/CommandPalette.jsx";
import V2Header from "./components/v2/V2Header.jsx";
import FindPortfolio from "./components/v2/FindPortfolio.jsx";
import ReviewHub from "./components/v2/ReviewHub.jsx";
import AnalyzeShell from "./components/v2/AnalyzeShell.jsx";
import InvestigateView from "./components/v2/InvestigateView.jsx";
import InlineCompare from "./components/v2/InlineCompare.jsx";
import ImproveView from "./components/v2/ImproveView.jsx";
import LiveSessionBanner from "./components/v2/LiveSessionBanner.jsx";

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
      searchText: "ask session qa question improve coach",
      priority: 40,
    });
  }

  return zoneItems.concat(sessionItems);
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
      onOpenSession={function (entry) {
        sessionState.openStoredSession(entry);
        onNavigate("review");
      }}
      onImport={function (text, name) {
        sessionState.handleFile(text, name);
        onNavigate("review");
      }}
      onLoadSample={function (mode) {
        sessionState.loadSample(mode);
        onNavigate("review");
      }}
      onRefresh={sessionState.refreshSessions}
      onCompareSelected={function (entries) {
        if (onCompareSelected) onCompareSelected(entries);
        sessionState.openCompareEntries(entries);
        onNavigate("compare");
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

function AnalyzeZone({ sessionState, targetPanelId, onNavigate }) {
  if (!sessionState.session.events) {
    return <ZonePlaceholder zone="analyze" sessionState={sessionState} />;
  }

  return (
    <PlaybackProvider key={sessionState.sessionLoadKey} session={sessionState.session}>
      <AnalyzeShell
        session={sessionState.session}
        autonomyMetrics={sessionState.autonomyMetrics}
        targetPanelId={targetPanelId}
        onNavigate={onNavigate}
      />
    </PlaybackProvider>
  );
}

function InvestigateZone({ sessionState, targetEventIndex, onNavigate }) {
  if (!sessionState.session.events) {
    return <ZonePlaceholder zone="investigate" sessionState={sessionState} />;
  }

  return (
    <PlaybackProvider key={sessionState.sessionLoadKey} session={sessionState.session}>
      <InvestigateView
        session={sessionState.session}
        targetEventIndex={targetEventIndex}
        onNavigate={onNavigate}
      />
    </PlaybackProvider>
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
      onOpenSessionA={function () {
        if (sessionState.openCompareSessionInCoach(sessionState.session)) onNavigate("improve");
      }}
      onOpenSessionB={function () {
        if (sessionState.openCompareSessionInCoach(sessionState.sessionB)) onNavigate("improve");
      }}
    />
  );
}

function ImproveZone({ sessionState, openQARequest, onNavigate }) {
  return (
    <PlaybackProvider key={sessionState.sessionLoadKey} session={sessionState.session}>
      <ImproveView
        session={sessionState.session}
        autonomyMetrics={sessionState.autonomyMetrics}
        debrief={sessionState.debrief}
        openQARequest={openQARequest}
        onNavigate={onNavigate}
      />
    </PlaybackProvider>
  );
}

export function AppV2Shell({ currentThemeMode, onSetThemeMode, onExitV2 }) {
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
    function handleKeyDown(event) {
      if (isEditableTarget(event.target)) return;

      if ((event.metaKey || event.ctrlKey) && event.key && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setShowPalettePlaceholder(function (value) { return !value; });
        return;
      }

      var zone = getV2ZoneForShortcut(event.key);
      if (zone) {
        event.preventDefault();
        navigate(zone);
        return;
      }

      if (event.key === "7") {
        event.preventDefault();
        setShortcutNotice("Coach is now Improve. Use 6 for Improve.");
        navigate("improve");
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return function () { window.removeEventListener("keydown", handleKeyDown); };
  }, [navigate]);

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
  }, [sessionState.session.isLive, sessionState.session.events, sessionState.sessionLoadKey, navigate]);

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
        session={sessionState.session}
        activeZone={activeZone}
        currentThemeMode={currentThemeMode}
        onSetThemeMode={onSetThemeMode}
        onOpenCommandPalette={function () { setShowPalettePlaceholder(true); }}
        onExportSession={hasExportableSession ? sessionState.handleExportSession : null}
        exportSessionState={sessionState.sessionExport.state}
        exportSessionError={sessionState.sessionExport.error}
        onExitV2={onExitV2}
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
            onNavigate={navigate}
          />
        ) : activeZone === "analyze" ? (
          <AnalyzeZone
            sessionState={sessionState}
            targetPanelId={navigationTarget && navigationTarget.zone === "analyze" ? navigationTarget.panelId : getV2AnalyzePanelFromHash(window.location.hash)}
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
          />
        ) : (
          <ZonePlaceholder
            zone={activeZone}
            sessionState={sessionState}
            compareSeedEntries={compareSeedEntries}
          />
        )}
      </div>
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
          indexOptions={{ includeLegacyViews: false, includeDefaultActions: false }}
          placeholder="Search workflow, events, turns..."
          onNavigateZone={function (zoneId) { navigate(zoneId); }}
          onSeek={function () { navigate("investigate"); }}
          onClose={function () { setShowPalettePlaceholder(false); }}
        />
      )}
    </div>
  );
}

export default function AppV2({ currentThemeMode, onSetThemeMode, onExitV2 }) {
  return (
    <SessionProvider enableHashRouter={false}>
      <AppV2Shell
        currentThemeMode={currentThemeMode}
        onSetThemeMode={onSetThemeMode}
        onExitV2={onExitV2}
      />
    </SessionProvider>
  );
}
