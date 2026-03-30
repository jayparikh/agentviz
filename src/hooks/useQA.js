/**
 * useQA -- state management for the Session Q&A drawer.
 *
 * Owns: message list, ask(), abort(), clear(), streaming state.
 * Uses qaClassifier for instant answers; falls back to /api/qa/ask SSE for model answers.
 */

import { useState, useRef, useCallback } from "react";
import { classify, buildModelContext } from "../lib/qaClassifier.js";

/**
 * @param {object} sessionData - { events, turns, metadata, autonomyMetrics }
 * @returns {{ messages, isStreaming, error, ask, abort, clear }}
 */
export default function useQA(sessionData) {
  var [messages, setMessages] = useState([]);
  var [isStreaming, setIsStreaming] = useState(false);
  var [error, setError] = useState(null);
  var abortRef = useRef(null);

  var ask = useCallback(function (question) {
    if (!question || !question.trim()) return;
    var q = question.trim();

    // Add user message immediately
    setMessages(function (prev) { return prev.concat({ role: "user", content: q }); });
    setError(null);

    // Try instant classification first
    var result = classify(q, sessionData);

    if (result.tier === "instant") {
      setMessages(function (prev) {
        return prev.concat({ role: "assistant", content: result.answer, instant: true });
      });
      return;
    }

    // Model fallback via SSE
    setIsStreaming(true);
    var controller = new AbortController();
    abortRef.current = controller;

    var context = buildModelContext(q, sessionData);

    // Add empty assistant message that we'll stream into
    setMessages(function (prev) {
      return prev.concat({ role: "assistant", content: "", instant: false, streaming: true });
    });

    fetchSSE(q, context, controller.signal, {
      onToken: function (token) {
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
        abortRef.current = null;
      },
    });
  }, [sessionData]);

  var abort = useCallback(function () {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setIsStreaming(false);
  }, []);

  var clear = useCallback(function () {
    abort();
    setMessages([]);
    setError(null);
  }, [abort]);

  return { messages: messages, isStreaming: isStreaming, error: error, ask: ask, abort: abort, clear: clear };
}

// ── SSE fetch helper ─────────────────────────────────────────────

function fetchSSE(question, context, signal, handlers) {
  var reader = null;

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
        return reader.read().then(function (result) {
          if (result.done) { handlers.onDone(); return; }
          buffer += decoder.decode(result.value, { stream: true });

          // Parse SSE lines
          var lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (var i = 0; i < lines.length; i++) {
            var line = lines[i];
            if (line.startsWith("data: ")) {
              try {
                var data = JSON.parse(line.slice(6));
                if (data.token) handlers.onToken(data.token);
                else if (data.done) { handlers.onDone(); return; }
                else if (data.error) { handlers.onError(data.error); return; }
              } catch (_) { /* skip malformed SSE line */ }
            }
          }

          return pump();
        });
      }

      return pump();
    })
    .catch(function (err) {
      if (reader) reader.cancel().catch(function () {});
      if (err.name === "AbortError") {
        handlers.onDone();
      } else {
        handlers.onError(err.message || "Network error");
      }
    });
}
