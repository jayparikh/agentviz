/**
 * QAView -- AI-powered Session Q&A panel.
 *
 * Chat-style interface for asking natural-language questions about a loaded session.
 * Answers are grounded in session data with clickable turn references.
 */

import { useState, useRef, useEffect } from "react";
import { theme, alpha } from "../lib/theme.js";
import { formatDuration } from "../lib/formatTime.js";
import Icon from "./Icon.jsx";

var SUGGESTED_QUESTIONS = [
  "What tools were used most frequently?",
  "What errors occurred and how were they resolved?",
  "What was the agent's overall approach?",
  "Which files were modified?",
  "What happened around the first error?",
];

function expandTurnIndices(body) {
  var indices = [];
  // Split on commas and "and" to handle lists like "Turn 0, Turn 1, and Turn 2"
  var segments = body.split(/,|\band\b/);
  for (var i = 0; i < segments.length; i++) {
    var seg = segments[i].trim();
    // Range: "0 - 5", "Turn 0 - Turn 5", "0-5", "Turns 0-5"
    var rangeMatch = seg.match(/(?:Turns?\s*)?(\d+)\s*[-\u2013]\s*(?:Turn\s*)?(\d+)/i);
    if (rangeMatch) {
      var lo = parseInt(rangeMatch[1], 10);
      var hi = parseInt(rangeMatch[2], 10);
      for (var n = lo; n <= hi; n++) indices.push(n);
      continue;
    }
    // Single: "Turn 3" or bare "3"
    var singleMatch = seg.match(/(?:Turns?\s*)?(\d+)/i);
    if (singleMatch) {
      var idx = parseInt(singleMatch[1], 10);
      indices.push(idx);
    }
  }
  // Deduplicate while preserving order
  var seen = {};
  return indices.filter(function (v) {
    if (seen[v]) return false;
    seen[v] = true;
    return true;
  });
}

function parseTurnReferences(text) {
  var parts = [];
  // Match bracketed numeric turn references: [Turn 0], [Turns 0-5], [Turn 0, Turn 1],
  // [Turn 10 - Turn 12], [Turn 0, 1, and 2], etc.
  var regex = /\[Turns?\s+[\d][\d\s,\-\u2013andTurn]*/gi;
  var lastIndex = 0;
  var match;
  while ((match = regex.exec(text)) !== null) {
    // Find the closing bracket
    var start = match.index;
    var close = text.indexOf("]", start);
    if (close === -1) continue;
    var full = text.substring(start, close + 1);
    var body = full.slice(1, -1); // strip brackets
    var indices = expandTurnIndices(body);
    if (indices.length === 0) continue;
    if (start > lastIndex) {
      parts.push({ type: "text", value: text.substring(lastIndex, start) });
    }
    // Emit one ref per turn index, using the full bracketed text for the first
    for (var i = 0; i < indices.length; i++) {
      if (i === 0) {
        parts.push({ type: "ref", turnIndex: indices[i], value: full });
      } else {
        parts.push({ type: "ref", turnIndex: indices[i], value: "" });
      }
    }
    lastIndex = close + 1;
    regex.lastIndex = lastIndex;
  }
  if (lastIndex < text.length) {
    parts.push({ type: "text", value: text.substring(lastIndex) });
  }
  return parts.filter(function (p) { return p.type === "ref" || p.value; });
}

export { parseTurnReferences, expandTurnIndices };

function formatAnswerTiming(timing) {
  var totalMs = timing && timing.totalMs;
  var numericTotalMs = typeof totalMs === "number" ? totalMs : Number(totalMs);
  if (!Number.isFinite(numericTotalMs) || numericTotalMs <= 0) return null;
  return "Answered in " + formatDuration(numericTotalMs / 1000);
}

function sanitizeElapsedMs(value) {
  var numericValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numericValue) || numericValue < 0) return null;
  return Math.round(numericValue);
}

function getLiveLoadingElapsedMs(qa, nowMs) {
  var elapsedMs = sanitizeElapsedMs(qa && qa.loadingElapsedMs);
  var startedAtMs = sanitizeElapsedMs(qa && qa.loadingStartedAtMs);
  if (startedAtMs !== null) {
    var liveElapsedMs = Math.max(0, nowMs - startedAtMs);
    elapsedMs = elapsedMs === null ? liveElapsedMs : Math.max(elapsedMs, liveElapsedMs);
  }
  return elapsedMs;
}

function formatLoadingElapsed(elapsedMs) {
  var safeElapsedMs = sanitizeElapsedMs(elapsedMs);
  if (safeElapsedMs === null) return null;
  return "Elapsed " + formatDuration(Math.max(1, safeElapsedMs) / 1000);
}

var AVAILABLE_MODELS = [
  { id: "gpt-5.4", label: "GPT-5.4" },
  { id: "gpt-5.4-mini", label: "GPT-5.4 mini" },
  { id: "gpt-5.3-codex", label: "GPT-5.3-Codex" },
  { id: "gpt-5.2-codex", label: "GPT-5.2-Codex" },
  { id: "gpt-5.2", label: "GPT-5.2" },
  { id: "gpt-5.1-codex-max", label: "GPT-5.1-Codex-Max" },
  { id: "gpt-5.1-codex", label: "GPT-5.1-Codex" },
  { id: "gpt-5.1", label: "GPT-5.1" },
  { id: "gpt-5.1-codex-mini", label: "GPT-5.1-Codex-Mini" },
  { id: "gpt-5-mini", label: "GPT-5 mini" },
  { id: "gpt-4.1", label: "GPT-4.1" },
  { id: "claude-opus-4.6", label: "Claude Opus 4.6" },
  { id: "claude-sonnet-4.6", label: "Claude Sonnet 4.6" },
  { id: "claude-sonnet-4.5", label: "Claude Sonnet 4.5" },
  { id: "claude-sonnet-4", label: "Claude Sonnet 4" },
  { id: "claude-haiku-4.5", label: "Claude Haiku 4.5" },
  { id: "claude-opus-4.5", label: "Claude Opus 4.5" },
];

var DEFAULT_MODEL = "gpt-5.4";

export default function QAView({ qa, events, turns, metadata, sessionFilePath, rawText, onSeekTurn, onSetView }) {
  var [input, setInput] = useState("");
  var [loadingNowMs, setLoadingNowMs] = useState(function () { return Date.now(); });
  var messagesEndRef = useRef(null);
  var inputRef = useRef(null);

  useEffect(function () {
    if (messagesEndRef.current && messagesEndRef.current.scrollIntoView) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [qa.messages.length, qa.loading, qa.loadingLabel, qa.queuedCount]);

  useEffect(function () {
    if (inputRef.current) inputRef.current.focus();
  }, []);

  useEffect(function () {
    if (!qa.loading) return;
    setLoadingNowMs(Date.now());
    var intervalId = setInterval(function () {
      setLoadingNowMs(Date.now());
    }, 250);
    return function () {
      clearInterval(intervalId);
    };
  }, [qa.loading, qa.loadingStartedAtMs]);

  function handleSubmit(e) {
    if (e) e.preventDefault();
    if (!input.trim()) return;
    qa.askQuestion(input.trim(), events, turns, metadata, qa.selectedModel, sessionFilePath, rawText);
    setInput("");
  }

  function handleSuggestion(q) {
    qa.askQuestion(q, events, turns, metadata, qa.selectedModel, sessionFilePath, rawText);
  }

  function handleTurnClick(turnIndex) {
    if (onSeekTurn && turns) {
      var turn = turns.find(function (t) { return t.index === turnIndex; });
      if (turn) {
        onSeekTurn(turn.startTime);
        if (onSetView) onSetView("replay");
      }
    }
  }

  var containerStyle = {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    background: theme.bg.base,
    color: theme.text.primary,
  };

  var messagesContainerStyle = {
    flex: 1,
    overflowY: "auto",
    padding: theme.space.xl + "px",
    display: "flex",
    flexDirection: "column",
    gap: theme.space.md + "px",
  };

  var emptyStateStyle = {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    flex: 1,
    gap: theme.space.lg + "px",
    padding: theme.space.xxl + "px",
  };

  var titleStyle = {
    fontSize: theme.fontSize.lg,
    fontWeight: 600,
    color: theme.text.primary,
  };

  var subtitleStyle = {
    fontSize: theme.fontSize.sm,
    color: theme.text.secondary,
    textAlign: "center",
    maxWidth: 400,
    lineHeight: 1.5,
  };

  var suggestionsStyle = {
    display: "flex",
    flexDirection: "column",
    gap: theme.space.sm + "px",
    width: "100%",
    maxWidth: 500,
  };

  var suggestionBtnStyle = {
    background: theme.bg.surface,
    border: "1px solid " + theme.border.default,
    borderRadius: theme.radius.md + "px",
    padding: theme.space.md + "px " + theme.space.lg + "px",
    color: theme.text.secondary,
    fontSize: theme.fontSize.sm,
    fontFamily: theme.font.mono,
    cursor: "pointer",
    textAlign: "left",
    transition: theme.transition.fast,
  };

  var userMsgStyle = {
    alignSelf: "flex-end",
    background: theme.accent.primary,
    color: theme.text.primary,
    padding: theme.space.md + "px " + theme.space.lg + "px",
    borderRadius: theme.radius.lg + "px",
    maxWidth: "75%",
    fontSize: theme.fontSize.sm,
    fontFamily: theme.font.mono,
    lineHeight: 1.5,
    wordBreak: "break-word",
  };

  var assistantMsgStyle = {
    alignSelf: "flex-start",
    background: theme.bg.surface,
    border: "1px solid " + theme.border.default,
    padding: theme.space.lg + "px",
    borderRadius: theme.radius.lg + "px",
    maxWidth: "85%",
    fontSize: theme.fontSize.sm,
    fontFamily: theme.font.mono,
    lineHeight: 1.6,
    color: theme.text.primary,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  };

  var assistantMetaStyle = {
    marginTop: theme.space.sm + "px",
    fontSize: theme.fontSize.xs,
    fontFamily: theme.font.mono,
    color: theme.text.dim,
  };

  var turnRefStyle = {
    display: "inline",
    color: theme.accent.primary,
    cursor: "pointer",
    textDecoration: "underline",
    fontWeight: 600,
  };

  var loadingBubbleStyle = {
    alignSelf: "flex-start",
    display: "flex",
    alignItems: "flex-start",
    gap: theme.space.sm + "px",
    padding: theme.space.md + "px " + theme.space.lg + "px",
    background: alpha(theme.bg.surface, 0.95),
    border: "1px solid " + theme.border.default,
    borderRadius: theme.radius.lg + "px",
    color: theme.text.secondary,
    maxWidth: "85%",
  };

  var loadingTitleStyle = {
    fontSize: theme.fontSize.sm,
    fontFamily: theme.font.mono,
    fontWeight: 600,
    color: theme.text.primary,
    lineHeight: 1.5,
  };

  var loadingDetailStyle = {
    marginTop: 4,
    fontSize: theme.fontSize.xs,
    fontFamily: theme.font.mono,
    color: theme.text.secondary,
    lineHeight: 1.5,
  };

  var loadingMetaStyle = {
    marginTop: 4,
    display: "flex",
    flexWrap: "wrap",
    gap: theme.space.md + "px",
    fontSize: theme.fontSize.xs,
    fontFamily: theme.font.mono,
    color: theme.text.dim,
  };

  var inputContainerStyle = {
    display: "flex",
    gap: theme.space.sm + "px",
    padding: theme.space.lg + "px",
    borderTop: "1px solid " + theme.border.default,
    background: theme.bg.surface,
  };

  var inputStyle = {
    flex: 1,
    background: theme.bg.base,
    border: "1px solid " + theme.border.default,
    borderRadius: theme.radius.md + "px",
    padding: theme.space.md + "px " + theme.space.lg + "px",
    color: theme.text.primary,
    fontSize: theme.fontSize.sm,
    fontFamily: theme.font.mono,
    outline: "none",
  };

  var sendBtnStyle = {
    background: theme.accent.primary,
    border: "none",
    borderRadius: theme.radius.md + "px",
    padding: theme.space.md + "px " + theme.space.lg + "px",
    color: theme.text.primary,
    fontSize: theme.fontSize.sm,
    fontFamily: theme.font.mono,
    fontWeight: 600,
    cursor: "pointer",
    transition: theme.transition.fast,
  };

  var stopBtnStyle = {
    background: alpha(theme.semantic.error, 0.14),
    border: "1px solid " + alpha(theme.semantic.error, 0.4),
    borderRadius: theme.radius.md + "px",
    padding: theme.space.md + "px " + theme.space.lg + "px",
    color: theme.semantic.error,
    fontSize: theme.fontSize.sm,
    fontFamily: theme.font.mono,
    fontWeight: 600,
    cursor: "pointer",
    transition: theme.transition.fast,
  };

  var headerStyle = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: theme.space.md + "px " + theme.space.xl + "px",
    borderBottom: "1px solid " + theme.border.default,
    background: theme.bg.surface,
  };

  var headerLabelStyle = {
    fontSize: theme.fontSize.sm,
    color: theme.text.secondary,
    fontWeight: 500,
  };

  var clearBtnStyle = {
    background: "transparent",
    border: "1px solid " + theme.border.default,
    borderRadius: theme.radius.sm + "px",
    padding: "4px 10px",
    color: theme.text.muted,
    fontSize: theme.fontSize.xs,
    fontFamily: theme.font.mono,
    cursor: "pointer",
    transition: theme.transition.fast,
  };

  var errorStyle = {
    alignSelf: "center",
    color: theme.semantic.error,
    fontSize: theme.fontSize.sm,
    fontFamily: theme.font.mono,
    padding: theme.space.md + "px",
  };

  var limitationStyle = {
    fontSize: theme.fontSize.xs,
    color: theme.text.dim,
    textAlign: "center",
    padding: "4px " + theme.space.lg + "px",
    background: theme.bg.surface,
  };

  var hasMessages = qa.messages.length > 0;
  var loadingLabel = qa.loadingLabel || "Working on your question...";
  var loadingDetail = qa.loadingDetail || null;
  var loadingElapsedLabel = formatLoadingElapsed(getLiveLoadingElapsedMs(qa, loadingNowMs));

  var modelSelectStyle = {
    background: theme.bg.base,
    color: theme.text.secondary,
    border: "1px solid " + theme.border.default,
    borderRadius: theme.radius.sm + "px",
    padding: "4px 8px",
    fontSize: theme.fontSize.xs,
    fontFamily: theme.font.mono,
    outline: "none",
    cursor: "pointer",
  };

  return (
    <div style={containerStyle}>
      <div style={headerStyle}>
        <span style={headerLabelStyle}>Session Q&A</span>
        <div style={{ display: "flex", alignItems: "center", gap: theme.space.sm + "px" }}>
          <select
            style={modelSelectStyle}
            value={qa.selectedModel}
            onChange={function (e) { qa.setSelectedModel(e.target.value); }}
            title="Choose model"
            aria-label="Choose model"
          >
            {AVAILABLE_MODELS.map(function (m) {
              return <option key={m.id} value={m.id}>{m.label}</option>;
            })}
          </select>
          {hasMessages && (
            <button
              className="av-btn"
              style={clearBtnStyle}
              onClick={qa.clearHistory}
              title="Clear conversation"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      <div style={messagesContainerStyle}>
        {!hasMessages && (
          <div style={emptyStateStyle}>
            <Icon name="message-circle" size={32} color={theme.text.dim} />
            <div style={titleStyle}>Ask about this session</div>
            <div style={subtitleStyle}>
              Ask natural-language questions about the loaded session and get answers grounded in the session data.
            </div>
            <div style={suggestionsStyle}>
              {SUGGESTED_QUESTIONS.map(function (q, i) {
                return (
                  <button
                    key={i}
                    className="av-btn"
                    style={suggestionBtnStyle}
                    onClick={function () { handleSuggestion(q); }}
                  >
                    {q}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {qa.messages.map(function (msg, i) {
          if (msg.role === "user") {
            var isQueued = msg.queued;
            return (
              <div key={i} style={Object.assign({}, userMsgStyle, isQueued ? { opacity: 0.6 } : {})}>
                {isQueued && <Icon name="hourglass" size={12} style={{ marginRight: 6, verticalAlign: "middle" }} />}
                {msg.content}
              </div>
            );
          }
          if (!msg.content) return null;
          var parts = parseTurnReferences(msg.content);
          var timingLabel = formatAnswerTiming(msg.timing);
          return (
            <div key={i} style={assistantMsgStyle}>
              {parts.map(function (part, pi) {
                if (part.type === "ref") {
                  return (
                    <button
                      type="button"
                      key={pi}
                      style={turnRefStyle}
                      onClick={function () { handleTurnClick(part.turnIndex); }}
                      title={"Jump to Turn " + part.turnIndex}
                    >
                      {part.value}
                    </button>
                  );
                }
                return <span key={pi}>{part.value}</span>;
              })}
              {timingLabel && <div style={assistantMetaStyle}>{timingLabel}</div>}
            </div>
          );
        })}

        {qa.loading && (
          <div style={loadingBubbleStyle}>
            <Icon name="hourglass" size={14} style={{ marginTop: 1, flexShrink: 0 }} />
            <div>
              <div style={loadingTitleStyle}>{loadingLabel}</div>
              {loadingDetail && <div style={loadingDetailStyle}>{loadingDetail}</div>}
              {(loadingElapsedLabel || qa.queuedCount > 0) && (
                <div style={loadingMetaStyle}>
                  {loadingElapsedLabel && <span>{loadingElapsedLabel}</span>}
                  {qa.queuedCount > 0 && (
                    <span>
                      {qa.queuedCount} queued {qa.queuedCount === 1 ? "message" : "messages"} behind this answer
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
        {qa.error && <div style={errorStyle}>{qa.error}</div>}
        <div ref={messagesEndRef} />
      </div>

      <div style={limitationStyle}>
        {qa.responseModel && qa.responseModel !== "default"
          ? "Powered by " + (AVAILABLE_MODELS.find(function (m) { return m.id === qa.responseModel; }) || { label: qa.responseModel }).label
          : "Powered by Copilot SDK"}
      </div>

      <form onSubmit={handleSubmit} style={inputContainerStyle}>
        <input
          ref={inputRef}
          style={inputStyle}
          className="av-search"
          type="text"
          placeholder="Ask a question about this session..."
          value={input}
          onChange={function (e) { setInput(e.target.value); }}
        />
        {qa.loading && (
          <button
            type="button"
            style={stopBtnStyle}
            onClick={qa.stopAnswer}
            title="Stop current answer"
          >
            Stop
          </button>
        )}
        <button type="submit" style={sendBtnStyle}>
          Send
        </button>
      </form>
    </div>
  );
}
