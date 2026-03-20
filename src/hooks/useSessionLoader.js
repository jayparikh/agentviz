import { useState, useCallback } from "react";
import { parseSession } from "../lib/parseSession.js";
import { SAMPLE_EVENTS, SAMPLE_TOTAL, SAMPLE_TURNS, SAMPLE_METADATA } from "../lib/constants.js";
import { getSessionTotal } from "../lib/session.js";

export default function useSessionLoader() {
  var [events, setEvents] = useState(null);
  var [turns, setTurns] = useState([]);
  var [metadata, setMetadata] = useState(null);
  var [total, setTotal] = useState(0);
  var [firstEventTime, setFirstEventTime] = useState(0);
  var [file, setFile] = useState("");
  var [error, setError] = useState(null);
  var [loading, setLoading] = useState(false);
  var [showHero, setShowHero] = useState(false);

  var applySession = useCallback(function (result, name) {
    setEvents(result.events);
    setTurns(result.turns);
    setMetadata(result.metadata);
    setTotal(getSessionTotal(result.events));
    setFirstEventTime(result.events.length > 0 ? result.events[0].t : 0);
    setFile(name);
    setError(null);
    setShowHero(true);
  }, []);

  var handleFile = useCallback(function (text, name) {
    setError(null);
    setLoading(true);

    setTimeout(function () {
      var result = parseSession(text);
      setLoading(false);

      if (!result || !result.events || result.events.length === 0) {
        setError("Could not parse any events. Supported formats: Claude Code JSONL, Copilot CLI JSONL.");
        return;
      }

      applySession(result, name);
    }, 16);
  }, [applySession]);

  var loadSample = useCallback(function () {
    setEvents(SAMPLE_EVENTS);
    setTurns(SAMPLE_TURNS);
    setMetadata(SAMPLE_METADATA);
    setTotal(SAMPLE_TOTAL);
    setFile("demo-session.jsonl");
    setError(null);
    setShowHero(true);
  }, []);

  var resetSession = useCallback(function () {
    setEvents(null);
    setTurns([]);
    setMetadata(null);
    setTotal(0);
    setFirstEventTime(0);
    setFile("");
    setError(null);
    setLoading(false);
    setShowHero(false);
  }, []);

  var dismissHero = useCallback(function () {
    setShowHero(false);
  }, []);

  return {
    events: events,
    turns: turns,
    metadata: metadata,
    total: total,
    firstEventTime: firstEventTime,
    file: file,
    error: error,
    loading: loading,
    showHero: showHero,
    handleFile: handleFile,
    loadSample: loadSample,
    resetSession: resetSession,
    dismissHero: dismissHero,
  };
}
