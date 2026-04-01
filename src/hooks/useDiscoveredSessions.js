import { useState, useEffect, useCallback } from "react";

var POLL_INTERVAL_MS = 30000; // re-scan every 30s to pick up new sessions

export default function useDiscoveredSessions() {
  var params = new URLSearchParams(window.location.search);
  var forceEmpty = params.get("demo") === "empty";
  var manifestUrl = params.get("manifest");

  var [sessions, setSessions] = useState([]);
  var [loading, setLoading] = useState(false);
  var [available, setAvailable] = useState(false); // false when no CLI server

  var fetchSessions = useCallback(function () {
    if (forceEmpty) return;
    setLoading(true);

    // Static manifest mode: ?manifest=URL skips the backend entirely
    if (manifestUrl) {
      fetch(manifestUrl)
        .then(function (r) {
          if (!r.ok) throw new Error("manifest fetch failed");
          return r.json();
        })
        .then(function (manifest) {
          if (manifest && Array.isArray(manifest.sessions)) {
            // Resolve relative session URLs from the manifest's own location
            var base = manifestUrl.replace(/[^/]*$/, "");
            var mapped = manifest.sessions.map(function (s) {
              return {
                path: s.url.startsWith("http") ? s.url : base + s.url,
                name: s.name,
                mtime: s.mtime || 0,
                format: "copilot-cli",
                tags: s.tags || [],
                _manifest: true,
              };
            });
            setSessions(mapped);
            setAvailable(true);
          }
          setLoading(false);
        })
        .catch(function () {
          setAvailable(false);
          setLoading(false);
        });
      return; // don't poll the backend
    }

    // Normal backend mode
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
    // Only poll when using backend mode; manifest is loaded once
    if (!manifestUrl) {
      var timer = setInterval(fetchSessions, POLL_INTERVAL_MS);
      return function () { clearInterval(timer); };
    }
  }, [fetchSessions]);

  // Fetches the raw content of a discovered session.
  // Accepts either a session object (with ._manifest flag) or a plain path string.
  function fetchSessionContent(session) {
    if (session && session._manifest) {
      return fetch(session.path || session).then(function (r) {
        if (!r.ok) throw new Error("fetch failed: " + r.status);
        return r.text();
      });
    }
    var sessionPath = typeof session === "string" ? session : session.path;
    return fetch("/api/session?path=" + encodeURIComponent(sessionPath))
      .then(function (r) {
        if (!r.ok) throw new Error("fetch failed: " + r.status);
        return r.text();
      });
  }

  return { sessions: sessions, loading: loading, available: available, fetchSessionContent: fetchSessionContent, refresh: fetchSessions };
}
