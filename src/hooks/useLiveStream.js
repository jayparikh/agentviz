import { useEffect, useRef, useCallback } from "react";

var DEBOUNCE_MS = 500;

/**
 * Connects to the SSE /api/stream endpoint and calls onLines(text) with
 * each batch of new JSONL lines, debounced so rapid file writes are coalesced.
 *
 * Returns { connected } state (true while EventSource is open).
 */
export default function useLiveStream({ enabled, onLines }) {
  var esRef = useRef(null);
  var pendingRef = useRef("");
  var timerRef = useRef(null);
  var connectedRef = useRef(false);

  var flush = useCallback(function () {
    timerRef.current = null;
    if (!pendingRef.current) return;
    var batch = pendingRef.current;
    pendingRef.current = "";
    onLines(batch);
  }, [onLines]);

  useEffect(function () {
    if (!enabled) return;

    var es = new EventSource("/api/stream");
    esRef.current = es;
    connectedRef.current = false;

    es.onopen = function () {
      connectedRef.current = true;
    };

    es.onmessage = function (e) {
      try {
        var data = JSON.parse(e.data);
        if (data.lines) {
          pendingRef.current += (pendingRef.current ? "\n" : "") + data.lines;
          if (timerRef.current) clearTimeout(timerRef.current);
          timerRef.current = setTimeout(flush, DEBOUNCE_MS);
        }
      } catch (err) {}
    };

    es.onerror = function () {
      connectedRef.current = false;
    };

    return function () {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      es.close();
      esRef.current = null;
      connectedRef.current = false;
    };
  }, [enabled, flush]);
}
