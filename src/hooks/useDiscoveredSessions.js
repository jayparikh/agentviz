import { useState, useEffect, useCallback } from "react";

var POLL_INTERVAL_MS = 30000; // re-scan every 30s to pick up new sessions

export default function useDiscoveredSessions() {
  var params = new URLSearchParams(window.location.search);
  var forceEmpty = params.get("demo") === "empty";
  var manifestUrl = params.get("manifest");

  var [sessions, setSessions] = useState([]);
  var [loading, setLoading] = useState(false);
  var [available, setAvailable] = useState(false); // false when no CLI server
  var [manifestError, setManifestError] = useState(null);

  var fetchSessions = useCallback(function () {
    if (forceEmpty) return;
    setLoading(true);

    // Static manifest mode: ?manifest=URL skips the backend entirely
    if (manifestUrl) {
      setManifestError(null);
      fetch(manifestUrl)
        .then(function (r) {
          if (!r.ok) throw new Error("manifest fetch failed: HTTP " + r.status);
          return r.json();
        })
        .then(function (manifest) {
          if (manifest && Array.isArray(manifest.sessions)) {
            var mapped = manifest.sessions.filter(function (s) {
              return s && s.url;
            }).map(function (s) {
              return {
                path: new URL(s.url, manifestUrl).href,
                file: s.name || s.filename || s.url,
                filename: s.filename || s.name || s.url,
                mtime: s.mtime || 0,
                format: s.format || null,
                tags: s.tags || [],
                source: "manifest",
              };
            });
            setSessions(mapped);
            setAvailable(true);
          }
          setLoading(false);
        })
        .catch(function (err) {
          setManifestError("Could not load manifest from " + manifestUrl + (err.message ? ": " + err.message : ""));
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
  // Accepts either a session object (with .source field) or a plain path string.
  function fetchSessionContent(session) {
    if (session && session.source === "manifest") {
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

  return { sessions: sessions, loading: loading, available: available, manifestError: manifestError, fetchSessionContent: fetchSessionContent, refresh: fetchSessions };
}
