import { useState, useCallback, useRef, useEffect } from "react";
import { parseSession } from "../lib/parseSession";
import { SAMPLE_EVENTS, SAMPLE_TOTAL, SAMPLE_TURNS, SAMPLE_METADATA } from "../lib/constants.js";
import { getSessionTotal } from "../lib/session";
import { buildAppliedSession, parseSessionText } from "../lib/sessionParsing";

export function appendRawLines(existingText, newLines) {
  return existingText ? existingText + "\n" + newLines : newLines;
}

export function shouldApplyLiveLines(liveRequestId, requestId) {
  return liveRequestId === requestId;
}

export default function useSessionLoader(options) {
  var autoBootstrap = !options || options.autoBootstrap !== false;
  var onSessionParsed = options ? options.onSessionParsed : null;
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

  var notifySessionParsed = useCallback(function (result, name, text) {
    if (typeof onSessionParsed === "function") {
      onSessionParsed(result, name, text);
    }
  }, [onSessionParsed]);

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
      notifySessionParsed(parsed.result, name, text);
    }, 16);
  }, [applySession, notifySessionParsed]);

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
    notifySessionParsed(parsed.result, file || "live-session.jsonl", rawTextRef.current);
  }, [file, notifySessionParsed]);

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
    if (!autoBootstrap) return;

    fetch("/api/meta")
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (meta) {
        if (!meta || !meta.filename) return;
        return fetch("/api/file")
          .then(function (r) { return r.ok ? r.text() : null; })
          .then(function (text) {
            if (!text) return;
            rawTextRef.current = text;
            requestIdRef.current += 1;
            if (meta.live) {
              liveRequestIdRef.current = requestIdRef.current;
            } else {
              liveRequestIdRef.current = 0;
            }
            setIsLive(Boolean(meta.live));

            var parsed = parseSessionText(text, parseSession);
            if (!parsed.result) return;

            setEvents(parsed.result.events);
            setTurns(parsed.result.turns);
            setMetadata(parsed.result.metadata);
            setTotal(getSessionTotal(parsed.result.events));
            setFile(meta.filename);
            setError(null);
            setShowHero(true);
            notifySessionParsed(parsed.result, meta.filename, text);
          });
      })
      .catch(function () {});
  }, [autoBootstrap, notifySessionParsed]);

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
