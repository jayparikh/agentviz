/**
 * useQA -- state management for the Session Q&A drawer.
 *
 * Owns: message list, ask(), abort(), clear(), streaming state.
 * Uses qaClassifier for instant answers; falls back to /api/qa/ask SSE for model answers.
 */

import { useState, useRef, useCallback, useEffect } from "react";
import { classify, buildModelContext, fingerprintQuestion } from "../lib/qaClassifier.js";

var STORAGE_PREFIX = "agentviz:qa:";
var MAX_PERSISTED_MESSAGES = 50;
var ROTATION_THRESHOLD = 6; // rotate SDK session after this many model questions

function buildRecap(messages) {
  var pairs = [];
  for (var i = 0; i < messages.length; i++) {
    var m = messages[i];
    if (m.role === "user") {
      var next = messages[i + 1];
      var answer = next && next.role === "assistant" ? next.content : "";
      pairs.push("Q: " + m.content.slice(0, 150) + "\nA: " + answer.slice(0, 200));
    }
  }
  if (pairs.length === 0) return "";
  // Keep only last few pairs to stay lean
  var recent = pairs.slice(-4);
  return "Prior conversation recap:\n" + recent.join("\n---\n");
}

function loadMessages(key) {
  if (!key) return [];
  try {
    var raw = localStorage.getItem(STORAGE_PREFIX + key);
    if (!raw) return [];
    var msgs = JSON.parse(raw);
    return Array.isArray(msgs) ? msgs : [];
  } catch (_) { return []; }
}

function saveMessages(key, messages) {
  if (!key) return;
  try {
    var toSave = messages.slice(-MAX_PERSISTED_MESSAGES).filter(function (m) { return !m.streaming; });
    localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(toSave));
  } catch (_) {}
}

function removeMessages(key) {
  if (!key) return;
  try { localStorage.removeItem(STORAGE_PREFIX + key); } catch (_) {}
}

/**
 * @param {object} sessionData - { events, turns, metadata, autonomyMetrics }
 * @param {string|null} sessionKey - unique key for persisting Q&A history
 * @returns {{ messages, isStreaming, streamPhase, error, ask, abort, clear }}
 */
export default function useQA(sessionData, sessionKey) {
  var [messages, setMessages] = useState(function () { return loadMessages(sessionKey); });
  var [streamPhase, setStreamPhase] = useState(null);
  var [isStreaming, setIsStreaming] = useState(false);
  var [error, setError] = useState(null);
  var abortRef = useRef(null);
  var keyRef = useRef(sessionKey);
  var answerCacheRef = useRef({});
  var modelQuestionCountRef = useRef(0);

  // Restore messages when sessionKey changes; clear cache for new session
  useEffect(function () {
    if (sessionKey !== keyRef.current) {
      keyRef.current = sessionKey;
      answerCacheRef.current = {};
      modelQuestionCountRef.current = 0;
      setMessages(loadMessages(sessionKey));
      setError(null);
    }
  }, [sessionKey]);

  // Persist messages on change (skip while streaming)
  useEffect(function () {
    if (!isStreaming) {
      saveMessages(keyRef.current, messages);
    }
  }, [messages, isStreaming]);

  var ask = useCallback(function (question) {
    if (!question || !question.trim()) return;
    var q = question.trim();
    var startedAt = Date.now();

    // Add user message immediately
    setMessages(function (prev) { return prev.concat({ role: "user", content: q }); });
    setError(null);

    // Try instant classification first
    var result = classify(q, sessionData);

    if (result.tier === "instant") {
      setMessages(function (prev) {
        return prev.concat({ role: "assistant", content: result.answer, instant: true, elapsedMs: Date.now() - startedAt });
      });
      return;
    }

    // Check paraphrase cache for model answers
    var fp = fingerprintQuestion(q);
    if (!fp) {
      // No fingerprint match -- build a simple content-based key from lowercased sorted tokens
      var tokens = q.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).sort().join("|");
      fp = "raw:" + tokens;
    }
    var cached = answerCacheRef.current[fp];
    if (cached) {
      setMessages(function (prev) {
        return prev.concat({ role: "assistant", content: cached.answer, instant: false, cached: true, elapsedMs: Date.now() - startedAt });
      });
      return;
    }

    // Model fallback via SSE
    setIsStreaming(true);
    var controller = new AbortController();
    abortRef.current = controller;
    modelQuestionCountRef.current++;

    var context = buildModelContext(q, sessionData);

    // Inject conversation recap when rotating past threshold
    if (modelQuestionCountRef.current > ROTATION_THRESHOLD) {
      var recap = buildRecap(messages);
      if (recap) {
        context.conversationRecap = recap;
      }
    }

    // Add empty assistant message that we'll stream into
    setMessages(function (prev) {
      return prev.concat({ role: "assistant", content: "", instant: false, streaming: true, startedAt: startedAt });
    });

    fetchSSE(q, context, controller.signal, {
      onPhase: function (phase) { setStreamPhase(phase); },
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
        setStreamPhase(null);
        setMessages(function (prev) {
          var last = prev[prev.length - 1];
          if (last && last.streaming) {
            var finished = Object.assign({}, last, { streaming: false, elapsedMs: Date.now() - startedAt });
            // Cache the model answer for paraphrase reuse
            if (fp && finished.content) {
              answerCacheRef.current[fp] = { answer: finished.content, cachedAt: Date.now() };
            }
            return prev.slice(0, -1).concat(finished);
          }
          return prev;
        });
        setIsStreaming(false);
        abortRef.current = null;
      },
      onError: function (msg) {
        setStreamPhase(null);
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
    answerCacheRef.current = {};
    modelQuestionCountRef.current = 0;
    removeMessages(keyRef.current);
  }, [abort]);

  return { messages: messages, isStreaming: isStreaming, streamPhase: streamPhase, error: error, ask: ask, abort: abort, clear: clear };
}

// ── SSE fetch helper ─────────────────────────────────────────────

var QA_TIMEOUT_MS = 60000; // 60s frontend safety net

function fetchSSE(question, context, signal, handlers) {
  var reader = null;
  var timedOut = false;
  var gotFirstToken = false;
  var timer = setTimeout(function () {
    timedOut = true;
    if (!gotFirstToken) {
      handlers.onError("Request timed out after 60s. Try a more specific question, or check that the Copilot SDK is running.");
    } else {
      handlers.onDone();
    }
  }, QA_TIMEOUT_MS);

  // Notify that we're connecting
  if (handlers.onPhase) handlers.onPhase("connecting");

  fetch("/api/qa/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question: question, context: context }),
    signal: signal,
  })
    .then(function (res) {
      if (!res.ok) {
        throw new Error("Server returned " + res.status);
      }
      if (!res.body) throw new Error("Response body is empty");
      if (handlers.onPhase) handlers.onPhase("streaming");
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
                if (data.token) { gotFirstToken = true; clearTimeout(timer); handlers.onToken(data.token); }
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
