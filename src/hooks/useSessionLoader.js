import { useState, useCallback, useRef, useEffect } from "react";
import { parseSession } from "../lib/parseSession.js";
import { SAMPLE_EVENTS, SAMPLE_TOTAL, SAMPLE_TURNS, SAMPLE_METADATA } from "../lib/constants.js";
import { getSessionTotal } from "../lib/session.js";

export default function useSessionLoader() {
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
    setEvents(result.events);
    setTurns(result.turns);
    setMetadata(result.metadata);
    setTotal(getSessionTotal(result.events));
    setFile(name);
    setError(null);
    setShowHero(true);
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
      var result;
      try {
        result = parseSession(text);
      } catch (err) {
        if (requestId !== requestIdRef.current) return;
        setLoading(false);
        setError("Failed to parse file: " + (err && err.message ? err.message : "unknown error"));
        return;
      }

      if (requestId !== requestIdRef.current) return;

      setLoading(false);

      if (!result || !result.events || result.events.length === 0) {
        setError("Could not parse any events. Supported formats: Claude Code JSONL, Copilot CLI JSONL.");
        return;
      }

      applySession(result, name);
    }, 16);
  }, [applySession]);

  // Called by useLiveStream with each batch of new JSONL lines.
  // Appends to rawText and re-parses the full accumulated text.
  // Guards against stale live data overwriting a newly-loaded file.
  var appendLines = useCallback(function (newLines) {
    if (liveRequestIdRef.current !== requestIdRef.current) return;
    rawTextRef.current = rawTextRef.current
      ? rawTextRef.current + "\n" + newLines
      : newLines;

    var result;
    try {
      result = parseSession(rawTextRef.current);
    } catch (err) {
      return;
    }
    if (!result || !result.events || result.events.length === 0) return;

    setEvents(result.events);
    setTurns(result.turns);
    setMetadata(result.metadata);
    setTotal(getSessionTotal(result.events));
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
  }, []);

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
