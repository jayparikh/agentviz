import { useState, useCallback, useRef, useEffect } from "react";
import { parseSession } from "../lib/parseSession";
import { appendLiveSessionText, createLiveSessionParser } from "../lib/liveSessionParser";
import { SAMPLE_EVENTS, SAMPLE_TOTAL, SAMPLE_TURNS, SAMPLE_METADATA, MULTIAGENT_SAMPLE_EVENTS, MULTIAGENT_SAMPLE_TOTAL, MULTIAGENT_SAMPLE_TURNS, MULTIAGENT_SAMPLE_METADATA } from "../lib/constants.js";
import { getSessionTotal } from "../lib/session";
import { buildAppliedSession, parseSessionText } from "../lib/sessionParsing";
import { createLiveParserClient } from "../lib/liveParserClient";
import useFindings from "./useFindings.js";

export var LIVE_NOTIFY_DEBOUNCE_MS = 250;

export function shouldApplyLiveLines(liveRequestId, requestId) {
  return liveRequestId === requestId;
}

export default function useSessionLoader(options) {
  var autoBootstrap = !options || options.autoBootstrap !== false;
  var onSessionParsed = options ? options.onSessionParsed : null;
  var [events, setEvents] = useState(null);
  var findings = useFindings(events);
  var [turns, setTurns] = useState([]);
  var [metadata, setMetadata] = useState(null);
  var [total, setTotal] = useState(0);
  var [file, setFile] = useState("");
  var [sourcePath, setSourcePath] = useState(null);
  var [error, setError] = useState(null);
  var [loading, setLoading] = useState(false);
  var [isLive, setIsLive] = useState(false);
  var [sessionKey, setSessionKey] = useState(0);
  var [streamOffset, setStreamOffset] = useState(null);
  var [storageStatus, setStorageStatus] = useState(null);
  var snapshotRef = useRef(null);
  var findingsIdentityRef = useRef(null);
  var pendingCompletionRef = useRef(null);
  var parseTimeoutRef = useRef(null);
  var liveNotifyTimeoutRef = useRef(null);
  var requestIdRef = useRef(0);
  var rawTextRef = useRef("");
  var liveParserRef = useRef(createLiveSessionParser(""));
  var liveClientRef = useRef(null);
  // Tracks the requestId that initiated the current live session. appendLines
  // checks this so stale live data from a previous session never overwrites a
  // newly-loaded file.
  var liveRequestIdRef = useRef(0);

  var applySession = useCallback(function (result, name, nextSourcePath) {
    var applied = buildAppliedSession(result, name);
    setEvents(applied.events);
    setTurns(applied.turns);
    setMetadata(applied.metadata);
    setTotal(applied.total);
    setFile(applied.file);
    setSourcePath(nextSourcePath || null);
    setError(applied.error);
    setSessionKey(function (key) { return key + 1; });
  }, []);

  var notifySessionParsed = useCallback(function (result, name, text) {
    snapshotRef.current = { result: result, name: name, text: text };
    if (typeof onSessionParsed === "function") {
      var saved = onSessionParsed(result, name, text);
      setStorageStatus(saved ? { id: saved.id, saved: saved.saved, previousSaved: saved.previousSaved, error: saved.error } : null);
    }
  }, [onSessionParsed]);

  var clearLiveNotify = useCallback(function () {
    if (liveNotifyTimeoutRef.current) {
      clearTimeout(liveNotifyTimeoutRef.current);
      liveNotifyTimeoutRef.current = null;
    }
  }, []);

  var notifyLiveSessionParsed = useCallback(function (result, name, text) {
    snapshotRef.current = result ? { result: result, name: name, text: text } : null;
    setStorageStatus(function (status) {
      return result ? Object.assign({}, status, { saved: false, pending: true }) : null;
    });
    if (typeof onSessionParsed !== "function") return;
    clearLiveNotify();
    if (!result) return;
    liveNotifyTimeoutRef.current = setTimeout(function () {
      liveNotifyTimeoutRef.current = null;
      notifySessionParsed(result, name, text);
    }, LIVE_NOTIFY_DEBOUNCE_MS);
  }, [clearLiveNotify, notifySessionParsed, onSessionParsed]);

  var retrySave = useCallback(function () {
    clearLiveNotify();
    var snapshot = snapshotRef.current;
    if (snapshot) notifySessionParsed(snapshot.result, snapshot.name, snapshot.text);
  }, [clearLiveNotify, notifySessionParsed]);

  var invalidateSavedCopy = useCallback(function (error) {
    setStorageStatus(function (status) {
      return status && (status.saved || status.previousSaved)
        ? Object.assign({}, status, { saved: false, previousSaved: false, error: error }) : status;
    });
  }, []);

  var resetLiveParser = useCallback(function (text) {
    clearLiveNotify();
    if (liveClientRef.current) liveClientRef.current.dispose();
    liveClientRef.current = null;
    // Workers preserve batch-parser semantics without normalizing history on
    // the UI thread. The synchronous path supports non-browser consumers.
    liveParserRef.current = typeof Worker === "undefined" ? createLiveSessionParser(text || "") : null;
  }, [clearLiveNotify]);

  var cancelPendingLoad = useCallback(function () {
    if (liveClientRef.current) liveClientRef.current.dispose();
    liveClientRef.current = null;
    requestIdRef.current += 1;
    if (parseTimeoutRef.current) {
      clearTimeout(parseTimeoutRef.current);
      parseTimeoutRef.current = null;
    }
    if (pendingCompletionRef.current) {
      pendingCompletionRef.current(false);
      pendingCompletionRef.current = null;
    }
    setLoading(false);
    clearLiveNotify();
    setStorageStatus(function (status) {
      return status && status.pending ? Object.assign({}, status, {
        pending: false,
        error: status.error || { message: "The latest live snapshot has not been saved." },
      }) : status;
    });
  }, [clearLiveNotify]);

  var beginLoad = useCallback(function () {
    cancelPendingLoad();
    setError(null);
    setLoading(true);
    setIsLive(false);
    liveRequestIdRef.current = 0;
  }, [cancelPendingLoad]);

  var failLoad = useCallback(function (message) {
    setLoading(false);
    setError(message);
  }, []);

  var handleFile = useCallback(function (text, name, nextSourcePath, embeddedFindings) {
    beginLoad();
    var requestId = requestIdRef.current;
    return new Promise(function (resolve) {
      pendingCompletionRef.current = resolve;
      parseTimeoutRef.current = setTimeout(function () {
        parseTimeoutRef.current = null;
        var parsed = parseSessionText(text);

        if (requestId !== requestIdRef.current) { resolve(false); return; }

        setLoading(false);
        pendingCompletionRef.current = null;

        if (!parsed.result) {
          setError(parsed.error);
          resolve(false);
          return;
        }

        rawTextRef.current = text;
        if (nextSourcePath) parsed.result.metadata.sourcePath = nextSourcePath;
        resetLiveParser(text);
        applySession(parsed.result, name, nextSourcePath);
        findings.open(parsed.result.metadata, text, embeddedFindings, Boolean(window.__AGENTVIZ_STANDALONE__));
        findingsIdentityRef.current = parsed.result.metadata.sessionId || true;
        notifySessionParsed(parsed.result, name, text);
        resolve(true);
      }, 16);
    });
  }, [beginLoad, applySession, notifySessionParsed, resetLiveParser, findings.open]);

  // Called by useLiveStream with each batch of new JSONL lines.
  // Parses only appended lines and rebuilds normalized session output from the
  // accumulated parsed records. Guards against stale live data overwriting a
  // newly-loaded file.
  var appendLines = useCallback(function (newLines, reset) {
    if (!shouldApplyLiveLines(liveRequestIdRef.current, requestIdRef.current)) return;
    clearLiveNotify();
    if (reset) snapshotRef.current = null;
    setStorageStatus(function (status) {
      return reset ? null : Object.assign({}, status, { saved: false, pending: true });
    });

    if (typeof Worker !== "undefined") {
      if (!liveClientRef.current) {
        var requestId = requestIdRef.current;
        liveClientRef.current = createLiveParserClient(
          new Worker(new URL("../lib/liveSessionWorker.ts", import.meta.url), { type: "module" }),
          rawTextRef.current,
          function (updated) {
            if (requestId !== requestIdRef.current) return;
            if (updated.result && sourcePath) updated.result.metadata.sourcePath = sourcePath;
            if (updated.result && (!findingsIdentityRef.current
              || (updated.result.metadata.sessionId && updated.result.metadata.sessionId !== findingsIdentityRef.current))) {
              findings.open(updated.result.metadata, updated.rawText);
              findingsIdentityRef.current = updated.result.metadata.sessionId || true;
            }
            rawTextRef.current = updated.rawText;
            setEvents(updated.result ? updated.result.events : null);
            setTurns(updated.result ? updated.result.turns : []);
            setMetadata(updated.result ? updated.result.metadata : null);
            setTotal(updated.result ? getSessionTotal(updated.result.events) : 0);
            notifyLiveSessionParsed(updated.result, file || "live-session.jsonl", updated.rawText);
          },
          function (message) { if (requestId === requestIdRef.current) setError(message); },
        );
      }
      liveClientRef.current.append(newLines, reset);
      return;
    }
    if (reset) resetLiveParser("");
    var updated = appendLiveSessionText(liveParserRef.current, newLines);
    liveParserRef.current = updated.state;
    rawTextRef.current = updated.state.rawText;
    if (updated.result && sourcePath) updated.result.metadata.sourcePath = sourcePath;

    if (!updated.result) {
      setEvents(null);
      setTurns([]);
      setMetadata(null);
      setTotal(0);
      notifyLiveSessionParsed(null, file, rawTextRef.current);
      return;
    }
    if (!findingsIdentityRef.current
      || (updated.result.metadata.sessionId && updated.result.metadata.sessionId !== findingsIdentityRef.current)) {
      findings.open(updated.result.metadata, updated.state.rawText);
      findingsIdentityRef.current = updated.result.metadata.sessionId || true;
    }

    setEvents(updated.result.events);
    setTurns(updated.result.turns);
    setMetadata(updated.result.metadata);
    setTotal(getSessionTotal(updated.result.events));
    notifyLiveSessionParsed(updated.result, file || "live-session.jsonl", updated.state.rawText);
  }, [file, sourcePath, notifyLiveSessionParsed, resetLiveParser, clearLiveNotify, findings.open]);

  var loadSample = useCallback(function (mode) {
    cancelPendingLoad();

    var isMultiAgent = mode === "multiagent";
    rawTextRef.current = "";
    snapshotRef.current = null;
    setStorageStatus(null);
    resetLiveParser("");
    setEvents(isMultiAgent ? MULTIAGENT_SAMPLE_EVENTS : SAMPLE_EVENTS);
    setTurns(isMultiAgent ? MULTIAGENT_SAMPLE_TURNS : SAMPLE_TURNS);
    setMetadata(isMultiAgent ? MULTIAGENT_SAMPLE_METADATA : SAMPLE_METADATA);
    findings.open({ format: "demo", sessionId: isMultiAgent ? "multiagent" : "default" }, "");
    setTotal(isMultiAgent ? MULTIAGENT_SAMPLE_TOTAL : SAMPLE_TOTAL);
    setFile(isMultiAgent ? "multiagent-demo.jsonl" : "demo-session.jsonl");
    setSourcePath(null);
    setError(null);
    setLoading(false);
    setIsLive(false);
    setSessionKey(function (key) { return key + 1; });
  }, [resetLiveParser, cancelPendingLoad, findings.open]);

  var resetSession = useCallback(function () {
    cancelPendingLoad();

    rawTextRef.current = "";
    snapshotRef.current = null;
    findings.close();
    findingsIdentityRef.current = null;
    setStorageStatus(null);
    resetLiveParser("");
    setEvents(null);
    setTurns([]);
    setMetadata(null);
    setTotal(0);
    setFile("");
    setSourcePath(null);
    setError(null);
    setLoading(false);
    setIsLive(false);
    setSessionKey(function (key) { return key + 1; });
  }, [resetLiveParser, cancelPendingLoad, findings.close]);

  // When served by the CLI (server.js), /api/meta tells us the filename
  // and /api/file provides the initial content. Bootstrap from there.
  useEffect(function () {
    if (!autoBootstrap) return;
    var requestId = requestIdRef.current;
    var cancelled = false;
    function isCurrent() { return !cancelled && requestId === requestIdRef.current; }
    fetch("/api/meta")
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (meta) {
        if (!meta || !meta.filename || !isCurrent()) return;
        setLoading(true);
        return fetch("/api/file" + (meta.live ? "?live=1" : ""))
          .then(function (r) {
            if (!r.ok) throw new Error("Unable to load " + meta.filename + ". Reimport the session from Find.");
            if (isCurrent()) setStreamOffset(r.headers && (r.headers.get("X-Agentviz-Cursor") || r.headers.get("X-Agentviz-Offset")));
            return r.text();
          })
          .then(function (text) {
            if (!isCurrent()) return;
            var parsed = parseSessionText(text, parseSession);
            setLoading(false);
            if (!parsed.result && !meta.live) { setError(parsed.error); return; }
            rawTextRef.current = text;
            if (parsed.result && meta.path) parsed.result.metadata.sourcePath = meta.path;
            resetLiveParser(text);
            requestIdRef.current += 1;
            if (meta.live) {
              liveRequestIdRef.current = requestIdRef.current;
            } else {
              liveRequestIdRef.current = 0;
            }
            setIsLive(Boolean(meta.live));
            setFile(meta.filename);
            setSourcePath(meta.path || null);
            setError(null);
            findings.open(parsed.result ? parsed.result.metadata : { format: "live", sessionId: meta.path || meta.filename },
              text, meta.findings, Boolean(window.__AGENTVIZ_STANDALONE__));
            findingsIdentityRef.current = parsed.result ? parsed.result.metadata.sessionId || true : null;
            if (!parsed.result) return;
            applySession(parsed.result, meta.filename, meta.path);
            notifySessionParsed(parsed.result, meta.filename, text);
          });
      })
      .catch(function (err) {
        if (isCurrent()) failLoad(err.message || "Unable to load the session. Reimport it from Find.");
      });
    return function () { cancelled = true; };
  }, [autoBootstrap, notifySessionParsed, resetLiveParser, applySession, failLoad, findings.open]);

  useEffect(function () {
    return function () {
      cancelPendingLoad();
    };
  }, [cancelPendingLoad]);

  return {
    events: events,
    findings: findings,
    turns: turns,
    metadata: metadata,
    total: total,
    file: file,
    sourcePath: sourcePath,
    error: error,
    loading: loading,
    isLive: isLive,
    sessionKey: sessionKey,
    streamOffset: streamOffset,
    storageStatus: storageStatus,
    retrySave: retrySave,
    invalidateSavedCopy: invalidateSavedCopy,
    beginLoad: beginLoad,
    cancelPendingLoad: cancelPendingLoad,
    failLoad: failLoad,
    handleFile: handleFile,
    appendLines: appendLines,
    loadSample: loadSample,
    resetSession: resetSession,
    getRawText: function () { return rawTextRef.current; },
  };
}
