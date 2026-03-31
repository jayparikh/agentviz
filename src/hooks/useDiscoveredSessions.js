import { useState, useEffect, useCallback } from "react";

var POLL_INTERVAL_MS = 30000; // re-scan every 30s to pick up new sessions

export default function useDiscoveredSessions() {
  var params = new URLSearchParams(window.location.search);
  var forceEmpty = params.get("demo") === "empty";
  var importId = params.get("import");

  var [sessions, setSessions] = useState([]);
  var [loading, setLoading] = useState(false);
  var [available, setAvailable] = useState(false); // false when no CLI server
  var [autoImportSession, setAutoImportSession] = useState(null);

  var fetchSessions = useCallback(function () {
    if (forceEmpty) return;
    setLoading(true);
    // Fetch both discovered and imported sessions
    Promise.all([
      fetch("/api/sessions").then(function (r) { return r.ok ? r.json() : []; }).catch(function () { return []; }),
      fetch("/api/imports").then(function (r) { return r.ok ? r.json() : []; }).catch(function () { return []; }),
    ]).then(function (results) {
      var all = results[0].concat(results[1]);
      if (all.length > 0) {
        setSessions(all);
        setAvailable(true);
      }
      // Auto-open imported session if ?import= param is present
      if (importId) {
        var match = all.find(function (s) { return s.id === "import:" + importId; });
        if (match) setAutoImportSession(match);
      }
      setLoading(false);
    });
  }, [importId]);

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

  return { sessions: sessions, loading: loading, available: available, fetchSessionContent: fetchSessionContent, refresh: fetchSessions, autoImportSession: autoImportSession };
}
