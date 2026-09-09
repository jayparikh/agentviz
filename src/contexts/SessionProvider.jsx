import React, { createContext, useContext, useMemo, useCallback, useEffect, useRef, useState } from "react";
import { exportSingleSession, exportComparison } from "../lib/exportHtml.js";
import useSessionLoader from "../hooks/useSessionLoader.js";
import useLiveStream from "../hooks/useLiveStream.js";
import useAsyncStatus from "../hooks/useAsyncStatus.js";
import useDiscoveredSessions from "../hooks/useDiscoveredSessions.js";
import { parseSessionText } from "../lib/sessionParsing";
import { buildAutonomyMetrics, buildAutonomySummary } from "../lib/autonomyMetrics.js";
import {
  loadStoredSessionContent,
  persistSessionSnapshot,
  pruneDeadEntries,
  reconcileSessionLibrary,
} from "../lib/sessionLibrary.js";

var SessionContext = createContext(null);

function buildVisibleLibraryEntries(libraryEntries) {
  return libraryEntries.filter(function (entry) {
    var primaryPrompt = String(entry && entry.primaryPrompt || "").trim();
    if (
      entry
      && entry.format === "copilot-cli"
      && primaryPrompt.startsWith("Summarize the following conversation for context continuity.")
    ) {
      return false;
    }

    return true;
  });
}

function mergeSessionSources(libraryEntries, discoveredSessions) {
  var visibleLibraryEntries = buildVisibleLibraryEntries(libraryEntries);

  var discoveredBySessionId = {};
  discoveredSessions.forEach(function (s) {
    if (s.source !== "manifest" && s.size < 5000) return;
    if (s.sessionId) discoveredBySessionId[s.sessionId] = s;
  });

  var enrichedLibrary = visibleLibraryEntries.map(function (e) {
    if (e.discoveredPath) return e;
    var match = e.sessionId && discoveredBySessionId[e.sessionId];
    if (match) return Object.assign({}, e, { discoveredPath: match.path });
    return e;
  });

  var discoveredOnly = discoveredSessions.filter(function (s) {
    if (s.source !== "manifest" && s.size < 5000) return false;
    return !enrichedLibrary.some(function (e) {
      return e.discoveredPath === s.path || (e.sessionId && e.sessionId === s.sessionId);
    });
  }).map(function (s) {
    return {
      id: s.id || s.path,
      file: s.file || s.summary || s.filename,
      filename: s.filename || s.file,
      format: s.format,
      isInsiders: s.isInsiders || false,
      project: s.project || null,
      repository: s.repository || null,
      branch: s.branch || null,
      discoveredPath: s.path,
      sessionId: s.sessionId || null,
      importedAt: s.mtime,
      updatedAt: s.mtime,
      size: s.size,
      tags: s.tags || [],
      isDiscovered: true,
      source: s.source || "discovered",
    };
  });

  return enrichedLibrary.concat(discoveredOnly);
}

export function SessionProvider({ children }) {
  var [libraryEntries, setLibraryEntries] = useState(function () {
    return reconcileSessionLibrary();
  });
  var [comparisonActive, setComparisonActive] = useState(false);
  var [loadError, setLoadError] = useState(null);
  var [retryLoad, setRetryLoad] = useState(null);
  var sessionLoadCount = useRef(0);
  useEffect(function () {
    return function () { sessionLoadCount.current += 1; };
  }, []);
  var discovered = useDiscoveredSessions();
  var sessionExport = useAsyncStatus();
  var compareExport = useAsyncStatus();

  var handleSessionParsed = useCallback(function (result, name, rawText) {
    var persisted = persistSessionSnapshot(name, result, rawText);
    setLibraryEntries(persisted.entries);
  }, []);

  var session = useSessionLoader({ onSessionParsed: handleSessionParsed });
  var sessionB = useSessionLoader({ autoBootstrap: false, onSessionParsed: handleSessionParsed });

  var allSessions = useMemo(function () {
    try {
      return mergeSessionSources(libraryEntries, discovered.sessions);
    } catch (e) {
      console.error("[allSessions] merge error:", e);
      return buildVisibleLibraryEntries(libraryEntries);
    }
  }, [libraryEntries, discovered.sessions]);

  useEffect(function () {
    var compareData = window.__AGENTVIZ_COMPARE__;
    if (!compareData || !compareData.a || !compareData.b) return;
    delete window.__AGENTVIZ_COMPARE__;
    setComparisonActive(true);
    session.handleFile(compareData.a.text, compareData.a.name);
    sessionB.handleFile(compareData.b.text, compareData.b.name);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useLiveStream({
    enabled: session.isLive,
    onLines: session.appendLines,
    offset: session.streamOffset,
  });

  var autonomyMetrics = useMemo(function () {
    return buildAutonomyMetrics(session.events, session.turns, session.metadata);
  }, [session.events, session.turns, session.metadata]);

  var debrief = useMemo(function () {
    return { summary: buildAutonomySummary(autonomyMetrics) };
  }, [autonomyMetrics]);

  var handleFile = useCallback(function (text, name, sourcePath) {
    sessionLoadCount.current += 1;
    sessionB.cancelPendingLoad();
    setLoadError(null);
    setRetryLoad(function () { return function () { return handleFile(text, name, sourcePath); }; });
    return session.handleFile(text, name, sourcePath).then(function (success) {
      if (success) {
        setComparisonActive(false);
        sessionB.resetSession();
      }
      return success;
    });
  }, [session.handleFile, sessionB.cancelPendingLoad, sessionB.resetSession]);

  var beginFileRead = useCallback(function () {
    sessionLoadCount.current += 1;
    setLoadError(null);
    setRetryLoad(null);
    sessionB.cancelPendingLoad();
    session.beginLoad();
  }, [session.beginLoad, sessionB.cancelPendingLoad]);

  var loadSample = useCallback(function (mode) {
    sessionLoadCount.current += 1;
    sessionB.cancelPendingLoad();
    setLoadError(null);
    setRetryLoad(null);
    setComparisonActive(false);
    sessionB.resetSession();
    session.loadSample(mode);
  }, [session.loadSample, sessionB.cancelPendingLoad, sessionB.resetSession]);

  var openStoredSession = useCallback(async function (entry) {
    if (!entry) return false;
    var requestId = ++sessionLoadCount.current;
    sessionB.cancelPendingLoad();
    session.beginLoad();
    setLoadError(null);
    setRetryLoad(function () { return function () { return openStoredSession(entry); }; });
    var sessionPath = entry.discoveredPath || null;
    var sessionName = entry.file || entry.summary || entry.filename || "events.jsonl";

    async function afterLoad(rawText) {
      if (requestId !== sessionLoadCount.current) return false;
      var success = await session.handleFile(rawText, sessionName, sessionPath);
      if (!success || requestId !== sessionLoadCount.current) return false;
      setLoadError(null);
      setComparisonActive(false);
      sessionB.resetSession();

      var entryTags = entry.tags && entry.tags.length > 0 ? entry.tags : null;
      if (sessionPath || entryTags) {
        setLibraryEntries(function (prev) {
          return prev.map(function (e) {
            if (e.id !== entry.id) return e;
            var updates = {};
            if (!e.discoveredPath && sessionPath) updates.discoveredPath = sessionPath;
            if (entryTags && (!e.tags || e.tags.length === 0)) updates.tags = entryTags;
            if (Object.keys(updates).length === 0) return e;
            return Object.assign({}, e, updates);
          });
        });
      }
      return true;
    }

    function onFetchError(err) {
      if (requestId !== sessionLoadCount.current) return false;
      console.error("[session] failed to load:", sessionName, err);
      var message = "Failed to load session: " + sessionName + ". Retry or reimport the file.";
      setLoadError(message);
      session.failLoad(message);
      return false;
    }

    if ((entry.source === "manifest" || entry.isDiscovered) && sessionPath) {
      var fetchArg = entry.source === "manifest"
        ? { source: "manifest", path: sessionPath }
        : sessionPath;
      return discovered.fetchSessionContent(fetchArg).then(afterLoad).catch(onFetchError);
    }

    var rawText = loadStoredSessionContent(entry.id);
    if (rawText) return afterLoad(rawText);
    if (sessionPath) {
      return discovered.fetchSessionContent(sessionPath).then(afterLoad).catch(onFetchError);
    }

    setLibraryEntries(function (prev) {
      return prev.map(function (e) {
        return e.id === entry.id ? Object.assign({}, e, { hasContent: false }) : e;
      });
    });
    return onFetchError(new Error("Stored content is unavailable"));
  }, [discovered.fetchSessionContent, session.beginLoad, session.failLoad, session.handleFile, sessionB.cancelPendingLoad, sessionB.resetSession]);

  var loadEntryText = useCallback(function (entry) {
    if (!entry) return Promise.resolve(null);

    var sessionPath = entry.discoveredPath || null;
    if ((entry.source === "manifest" || entry.isDiscovered) && sessionPath) {
      var fetchArg = entry.source === "manifest"
        ? { source: "manifest", path: sessionPath }
        : sessionPath;
      return discovered.fetchSessionContent(fetchArg);
    }

    var rawText = loadStoredSessionContent(entry.id);
    if (rawText) return Promise.resolve(rawText);
    if (sessionPath) return discovered.fetchSessionContent(sessionPath);
    return Promise.resolve(null);
  }, [discovered.fetchSessionContent]);

  var openCompareEntries = useCallback(function (entries) {
    var pair = entries || [];
    if (pair.length < 2) return Promise.resolve(false);
    var requestId = ++sessionLoadCount.current;
    session.beginLoad();
    sessionB.beginLoad();
    setLoadError(null);
    setRetryLoad(null);

    return Promise.all([loadEntryText(pair[0]), loadEntryText(pair[1])])
      .then(async function (texts) {
        if (requestId !== sessionLoadCount.current) return false;
        if (texts.some(function (text) { return !text || !parseSessionText(text).result; })) {
          throw new Error("Both comparison files must contain a supported session");
        }
        var results = await Promise.all([
          session.handleFile(texts[0], pair[0].file || pair[0].summary || pair[0].filename || "session-a.jsonl", pair[0].discoveredPath || null),
          sessionB.handleFile(texts[1], pair[1].file || pair[1].summary || pair[1].filename || "session-b.jsonl", pair[1].discoveredPath || null),
        ]);
        if (requestId !== sessionLoadCount.current || !results.every(Boolean)) return false;
        setComparisonActive(true);
        return true;
      })
      .catch(function (err) {
        if (requestId !== sessionLoadCount.current) return false;
        console.error("[compare] failed to load selected sessions:", err);
        setLoadError("Failed to load selected sessions for comparison");
        session.failLoad("Failed to load selected sessions for comparison. Reimport valid session files.");
        sessionB.failLoad("Failed to load selected sessions for comparison.");
        return false;
      });
  }, [loadEntryText, session.beginLoad, session.failLoad, session.handleFile, sessionB.beginLoad, sessionB.failLoad, sessionB.handleFile]);

  var openCompareCurrentWithEntry = useCallback(function (entry) {
    if (!entry) return Promise.resolve(false);
    var currentRaw = session.getRawText();
    if (!currentRaw) return Promise.resolve(false);
    var currentName = session.file || "current-session.jsonl";
    var currentSourcePath = session.sourcePath || null;
    var requestId = ++sessionLoadCount.current;
    session.beginLoad();
    sessionB.beginLoad();
    setLoadError(null);
    setRetryLoad(null);

    return loadEntryText(entry)
      .then(async function (text) {
        if (requestId !== sessionLoadCount.current) return false;
        if (!text || !parseSessionText(text).result) throw new Error("Invalid comparison session");
        var results = await Promise.all([
          session.handleFile(currentRaw, currentName, currentSourcePath),
          sessionB.handleFile(text, entry.file || entry.summary || entry.filename || "session-b.jsonl", entry.discoveredPath || null),
        ]);
        if (requestId !== sessionLoadCount.current || !results.every(Boolean)) return false;
        setComparisonActive(true);
        return true;
      })
      .catch(function (err) {
        if (requestId !== sessionLoadCount.current) return false;
        console.error("[compare] failed to load comparison session:", err);
        setLoadError("Failed to load session for comparison");
        session.failLoad("Failed to load session for comparison. Reimport a valid session file.");
        sessionB.failLoad("Failed to load session for comparison.");
        return false;
      });
  }, [loadEntryText, session.getRawText, session.file, session.sourcePath, session.beginLoad, session.failLoad, session.handleFile, sessionB.beginLoad, sessionB.failLoad, sessionB.handleFile]);

  var reset = useCallback(function () {
    sessionLoadCount.current += 1;
    setLoadError(null);
    setRetryLoad(null);
    session.resetSession();
    sessionB.resetSession();
    setComparisonActive(false);
  }, [session.resetSession, sessionB.resetSession]);

  useEffect(function () {
    var params = new URLSearchParams(window.location.search);
    if (params.get("demo") === "multiagent") {
      loadSample("multiagent");
    }
  }, [loadSample]);

  var openCompareSessionInCoach = useCallback(function (loader) {
    var rawText = loader.getRawText();
    if (!rawText) return Promise.resolve(false);
    return handleFile(rawText, loader.file, loader.sourcePath);
  }, [handleFile]);

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

  var refreshSessions = useCallback(function () {
    var pruned = pruneDeadEntries();
    setLibraryEntries(pruned);
    return discovered.refresh();
  }, [discovered.refresh]);

  var compareReady = comparisonActive && !session.loading && !sessionB.loading
    && !session.error && !sessionB.error && Boolean(session.events) && Boolean(sessionB.events);

  var value = useMemo(function () {
    return {
      session: session,
      sessionB: sessionB,
      sessionLoadKey: session.sessionKey,
      allSessions: allSessions,
      discovered: discovered,
      loadError: loadError,
      retryLoad: retryLoad,
      compareReady: compareReady,
      sessionExport: sessionExport,
      compareExport: compareExport,
      autonomyMetrics: autonomyMetrics,
      debrief: debrief,
      handleFile: handleFile,
      beginFileRead: beginFileRead,
      loadSample: loadSample,
      openStoredSession: openStoredSession,
      openCompareEntries: openCompareEntries,
      openCompareCurrentWithEntry: openCompareCurrentWithEntry,
      reset: reset,
      openCompareSessionInCoach: openCompareSessionInCoach,
      handleExportSession: handleExportSession,
      handleExportComparison: handleExportComparison,
      refreshSessions: refreshSessions,
    };
  }, [
    session, sessionB, allSessions, discovered, loadError, retryLoad,
    compareReady, sessionExport, compareExport, autonomyMetrics, debrief,
    handleFile, beginFileRead, loadSample, openStoredSession, openCompareEntries, openCompareCurrentWithEntry, reset,
    openCompareSessionInCoach, handleExportSession, handleExportComparison,
    refreshSessions,
  ]);

  return (
    <SessionContext.Provider value={value}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSessionContext() {
  var ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSessionContext must be used within SessionProvider");
  return ctx;
}

export { mergeSessionSources };
