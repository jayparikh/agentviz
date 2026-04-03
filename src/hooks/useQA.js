/**
 * useQA -- state management for the Session Q&A drawer.
 *
 * Owns: message list, ask(), abort(), clear(), streaming state + status phases.
 * Uses qaClassifier for instant answers; falls back to /api/qa/ask SSE for model answers.
 */

import { useState, useRef, useCallback } from "react";
import { classify, buildModelContext } from "../lib/qaClassifier.js";

var _msgId = 0;
function nextMsgId() { return "qa-msg-" + (++_msgId); }

/**
 * @param {object} sessionData - { events, turns, metadata, autonomyMetrics }
 * @returns {{ messages, isStreaming, streamingStatus, error, ask, abort, clear }}
 */
export default function useQA(sessionData) {
  var [messages, setMessages] = useState([]);
  var [isStreaming, setIsStreaming] = useState(false);
  var [streamingStatus, setStreamingStatus] = useState(null);
  var [error, setError] = useState(null);
  var abortRef = useRef(null);

  var ask = useCallback(function (question) {
    if (!question || !question.trim()) return;
    var q = question.trim();

    // Add user message immediately
    setMessages(function (prev) { return prev.concat({ id: nextMsgId(), role: "user", content: q }); });
    setError(null);

    // Try instant classification first
    var result = classify(q, sessionData);

    if (result.tier === "instant") {
      setMessages(function (prev) {
        return prev.concat({ id: nextMsgId(), role: "assistant", content: result.answer, instant: true });
      });
      return;
    }

    // Model fallback via SSE
    setIsStreaming(true);
    setStreamingStatus("Analyzing session...");
    var controller = new AbortController();
    abortRef.current = controller;

    // Reuse context from classifier if available, otherwise build it
    var context = result.context || buildModelContext(q, sessionData);

    var streamMsgId = nextMsgId();

    // Add empty assistant message that we'll stream into
    setMessages(function (prev) {
      return prev.concat({ id: streamMsgId, role: "assistant", content: "", instant: false, streaming: true });
    });

    fetchSSE(q, context, controller.signal, {
      onToken: function (token) {
        setStreamingStatus("Generating answer...");
        setMessages(function (prev) {
          var last = prev[prev.length - 1];
          if (last && last.role === "assistant" && last.streaming) {
            var updated = Object.assign({}, last, { content: last.content + token });
            return prev.slice(0, -1).concat(updated);
          }
          return prev;
        });
      },
      onDone: function () {
        setMessages(function (prev) {
          var last = prev[prev.length - 1];
          if (last && last.streaming) {
            return prev.slice(0, -1).concat(Object.assign({}, last, { streaming: false }));
          }
          return prev;
        });
        setIsStreaming(false);
        setStreamingStatus(null);
        abortRef.current = null;
      },
      onError: function (msg) {
        setMessages(function (prev) {
          // Remove the empty streaming message
          if (prev.length && prev[prev.length - 1].streaming) {
            return prev.slice(0, -1);
          }
          return prev;
        });
        setError(msg);
        setIsStreaming(false);
        setStreamingStatus(null);
        abortRef.current = null;
      },
    });
  }, [sessionData]);

  var abort = useCallback(function () {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    // Mark last streaming message as done (keep partial content)
    setMessages(function (prev) {
      var last = prev[prev.length - 1];
      if (last && last.streaming) {
        if (!last.content) {
          // Empty: remove it
          return prev.slice(0, -1);
        }
        return prev.slice(0, -1).concat(Object.assign({}, last, { streaming: false }));
      }
      return prev;
    });
    setIsStreaming(false);
    setStreamingStatus(null);
  }, []);

  var clear = useCallback(function () {
    abort();
    setMessages([]);
    setError(null);
  }, [abort]);

  return {
    messages: messages,
    isStreaming: isStreaming,
    streamingStatus: streamingStatus,
    error: error,
    ask: ask,
    abort: abort,
    clear: clear,
  };
}

// ── SSE fetch helper ─────────────────────────────────────────────

var QA_TIMEOUT_MS = 60000; // 60s to match backend SESSION_TIMEOUT_MS

function fetchSSE(question, context, signal, handlers) {
  var reader = null;
  var timedOut = false;
  var timer = setTimeout(function () {
    timedOut = true;
    if (reader) reader.cancel().catch(function () {});
    handlers.onError("Request timed out. Check that the Copilot SDK is running and authenticated.");
  }, QA_TIMEOUT_MS);

  fetch("/api/qa/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question: question, context: context }),
    signal: signal,
  })
    .then(function (res) {
      if (!res.ok) throw new Error("Server returned " + res.status);
      if (!res.body) throw new Error("Response body is empty");
      reader = res.body.getReader();
      var decoder = new TextDecoder();
      var buffer = "";

      function pump() {
        if (timedOut) return;
        return reader.read().then(function (result) {
          if (timedOut) return;
          if (result.done) { clearTimeout(timer); handlers.onDone(); return; }
          buffer += decoder.decode(result.value, { stream: true });

          // Parse SSE lines
          var lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (var i = 0; i < lines.length; i++) {
            var line = lines[i];
            if (line.startsWith("data: ")) {
              try {
                var data = JSON.parse(line.slice(6));
                if (data.token) { clearTimeout(timer); handlers.onToken(data.token); }
                else if (data.done) { clearTimeout(timer); handlers.onDone(); return; }
                else if (data.error) { clearTimeout(timer); handlers.onError(data.error); return; }
              } catch (_) { /* skip malformed SSE line */ }
            }
          }

          return pump();
        });
      }

      return pump();
    })
    .catch(function (err) {
      clearTimeout(timer);
      if (timedOut) return;
      if (reader) reader.cancel().catch(function () {});
      if (err.name === "AbortError") {
        handlers.onDone();
      } else {
        handlers.onError(err.message || "Network error");
      }
    });
}
