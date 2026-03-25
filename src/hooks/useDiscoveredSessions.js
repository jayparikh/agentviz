import { useState, useEffect, useCallback } from "react";

var POLL_INTERVAL_MS = 30000; // re-scan every 30s to pick up new sessions

export default function useDiscoveredSessions() {
  var [sessions, setSessions] = useState([]);
  var [loading, setLoading] = useState(false);
  var [available, setAvailable] = useState(false); // false when no CLI server

  var fetchSessions = useCallback(function () {
    setLoading(true);
    fetch("/api/sessions")
      .then(function (r) {
        if (!r.ok) throw new Error("not ok");
        return r.json();
      })
      .then(function (data) {
        if (Array.isArray(data)) {
          setSessions(data);
          setAvailable(true);
        }
        setLoading(false);
      })
      .catch(function () {
        // CLI server not running -- browser-only mode
        setAvailable(false);
        setLoading(false);
      });
  }, []);

  useEffect(function () {
    fetchSessions();
    var timer = setInterval(fetchSessions, POLL_INTERVAL_MS);
    return function () { clearInterval(timer); };
  }, [fetchSessions]);

  // Fetches the raw content of a discovered session by path
  function fetchSessionContent(sessionPath) {
    return fetch("/api/session?path=" + encodeURIComponent(sessionPath))
      .then(function (r) {
        if (!r.ok) throw new Error("fetch failed: " + r.status);
        return r.text();
      });
  }

  return { sessions: sessions, loading: loading, available: available, fetchSessionContent: fetchSessionContent, refresh: fetchSessions };
}
