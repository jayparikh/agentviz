import { useState, useCallback, useRef, useEffect } from "react";
import { parseSession } from "../lib/parseSession.js";
import { SAMPLE_EVENTS, SAMPLE_TOTAL, SAMPLE_TURNS, SAMPLE_METADATA } from "../lib/constants.js";
import { getSessionTotal } from "../lib/session";

export var SUPPORTED_FORMATS_ERROR = "Could not parse any events. Supported formats: Claude Code JSONL, Copilot CLI JSONL.";

export function appendRawLines(existingText, newLines) {
  return existingText ? existingText + "\n" + newLines : newLines;
}

export function shouldApplyLiveLines(liveRequestId, requestId) {
  return liveRequestId === requestId;
}

export function parseSessionText(text, parser) {
  var parse = parser || parseSession;
  try {
    var result = parse(text);
    if (!result || !result.events || result.events.length === 0) {
      return { result: null, error: SUPPORTED_FORMATS_ERROR };
    }
    return { result: result, error: null };
  } catch (err) {
    return {
      result: null,
      error: "Failed to parse file: " + (err && err.message ? err.message : "unknown error"),
    };
  }
}

export function buildAppliedSession(result, name) {
  return {
    events: result.events,
    turns: result.turns,
    metadata: result.metadata,
    total: getSessionTotal(result.events),
    file: name,
    error: null,
    showHero: true,
  };
}

export default function useSessionLoader(options) {
  var [events, setEvents] = useState(null);
  var [turns, setTurns] = useState([]);
  var [metadata, setMetadata] = useState(null);
  var [total, setTotal] = useState(0);
  var [file, setFile] = useState("");
  var [error, setError] = useState(null);
  var [loading, setLoading] = useState(false);
  var [showHero, setShowHero] = useState(false);
  var [isLive, setIsLive] = useState(false);
  var parseTimeoutRef = useRef(null);
  var requestIdRef = useRef(0);
  var rawTextRef = useRef("");
  // Tracks the requestId that initiated the current live session. appendLines
  // checks this so stale live data from a previous session never overwrites a
  // newly-loaded file.
  var liveRequestIdRef = useRef(0);

  var applySession = useCallback(function (result, name) {
    var applied = buildAppliedSession(result, name);
    setEvents(applied.events);
    setTurns(applied.turns);
    setMetadata(applied.metadata);
    setTotal(applied.total);
    setFile(applied.file);
    setError(applied.error);
    setShowHero(applied.showHero);
  }, []);

  var handleFile = useCallback(function (text, name) {
    requestIdRef.current += 1;
    var requestId = requestIdRef.current;

    if (parseTimeoutRef.current) {
      clearTimeout(parseTimeoutRef.current);
      parseTimeoutRef.current = null;
    }

    rawTextRef.current = text;
    setError(null);
    setLoading(true);
    setIsLive(false);
    liveRequestIdRef.current = 0;

    parseTimeoutRef.current = setTimeout(function () {
      parseTimeoutRef.current = null;
      var parsed = parseSessionText(text);

      if (requestId !== requestIdRef.current) return;

      setLoading(false);

      if (!parsed.result) {
        setError(parsed.error);
        return;
      }

      applySession(parsed.result, name);
    }, 16);
  }, [applySession]);

  // Called by useLiveStream with each batch of new JSONL lines.
  // Appends to rawText and re-parses the full accumulated text.
  // Guards against stale live data overwriting a newly-loaded file.
  var appendLines = useCallback(function (newLines) {
    if (!shouldApplyLiveLines(liveRequestIdRef.current, requestIdRef.current)) return;
    rawTextRef.current = appendRawLines(rawTextRef.current, newLines);

    var parsed = parseSessionText(rawTextRef.current);
    if (!parsed.result) return;

    setEvents(parsed.result.events);
    setTurns(parsed.result.turns);
    setMetadata(parsed.result.metadata);
    setTotal(getSessionTotal(parsed.result.events));
  }, []);

  var loadSample = useCallback(function () {
    requestIdRef.current += 1;
    if (parseTimeoutRef.current) {
      clearTimeout(parseTimeoutRef.current);
      parseTimeoutRef.current = null;
    }

    rawTextRef.current = "";
    setEvents(SAMPLE_EVENTS);
    setTurns(SAMPLE_TURNS);
    setMetadata(SAMPLE_METADATA);
    setTotal(SAMPLE_TOTAL);
    setFile("demo-session.jsonl");
    setError(null);
    setLoading(false);
    setIsLive(false);
    setShowHero(true);
  }, []);

  var resetSession = useCallback(function () {
    requestIdRef.current += 1;
    if (parseTimeoutRef.current) {
      clearTimeout(parseTimeoutRef.current);
      parseTimeoutRef.current = null;
    }

    rawTextRef.current = "";
    setEvents(null);
    setTurns([]);
    setMetadata(null);
    setTotal(0);
    setFile("");
    setError(null);
    setLoading(false);
    setIsLive(false);
    setShowHero(false);
  }, []);

  var dismissHero = useCallback(function () {
    setShowHero(false);
  }, []);

  // When served by the CLI (server.js), /api/meta tells us the filename
  // and /api/file provides the initial content. Bootstrap from there.
  useEffect(function () {
    if (options && options.autoBootstrap === false) return;

    fetch("/api/meta")
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (meta) {
        if (!meta || !meta.live || !meta.filename) return;
        return fetch("/api/file")
          .then(function (r) { return r.ok ? r.text() : null; })
          .then(function (text) {
            if (!text) return;
            rawTextRef.current = text;
            requestIdRef.current += 1;
            liveRequestIdRef.current = requestIdRef.current;
            setIsLive(true);

            var result;
            try { result = parseSession(text); } catch (e) { return; }
            if (!result || !result.events || result.events.length === 0) return;

            setEvents(result.events);
            setTurns(result.turns);
            setMetadata(result.metadata);
            setTotal(getSessionTotal(result.events));
            setFile(meta.filename);
            setError(null);
            setShowHero(true);
          });
      })
      .catch(function () {});
  }, [options && options.autoBootstrap]);

  useEffect(function () {
    return function () {
      requestIdRef.current += 1;
      if (parseTimeoutRef.current) {
        clearTimeout(parseTimeoutRef.current);
        parseTimeoutRef.current = null;
      }
    };
  }, []);

  return {
    events: events,
    turns: turns,
    metadata: metadata,
    total: total,
    file: file,
    error: error,
    loading: loading,
    showHero: showHero,
    isLive: isLive,
    handleFile: handleFile,
    appendLines: appendLines,
    loadSample: loadSample,
    resetSession: resetSession,
    dismissHero: dismissHero,
    getRawText: function () { return rawTextRef.current; },
  };
}
