import { useEffect, useRef, useCallback } from "react";

var DEBOUNCE_MS = 500;

/**
 * Connects to the SSE /api/stream endpoint and calls onLines(text) with
 * each batch of new JSONL lines, debounced so rapid file writes are coalesced.
 */
export default function useLiveStream({ enabled, onLines, offset }) {
  var esRef = useRef(null);
  var pendingRef = useRef("");
  var timerRef = useRef(null);
  var connectedRef = useRef(false);
  var onLinesRef = useRef(onLines);
  onLinesRef.current = onLines;
  var resetRef = useRef(false);

  var flush = useCallback(function () {
    timerRef.current = null;
    if (!pendingRef.current && !resetRef.current) return;
    var batch = pendingRef.current;
    pendingRef.current = "";
    var reset = resetRef.current;
    resetRef.current = false;
    onLinesRef.current(batch, reset);
  }, []);

  useEffect(function () {
    if (!enabled) return;

    pendingRef.current = "";
    resetRef.current = false;
    var es = new EventSource("/api/stream" + (offset != null ? "?cursor=" + encodeURIComponent(offset) : ""));
    esRef.current = es;
    connectedRef.current = false;

    es.onopen = function () {
      connectedRef.current = true;
    };

    es.onmessage = function (e) {
      try {
        var data = JSON.parse(e.data);
        if (data.error === "watcher_error") {
          // Server lost the file watcher -- stop trying to stream
          connectedRef.current = false;
          es.close();
          return;
        }
        if (data.reset) {
          pendingRef.current = "";
          resetRef.current = true;
        }
        if (data.lines || data.reset) {
          pendingRef.current += (pendingRef.current ? "\n" : "") + data.lines;
          if (timerRef.current) clearTimeout(timerRef.current);
          timerRef.current = setTimeout(flush, DEBOUNCE_MS);
        }
      } catch (err) {
        console.error("AGENTVIZ: invalid live stream payload", err);
      }
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
      pendingRef.current = "";
      resetRef.current = false;
    };
  }, [enabled, offset, flush]);
}
