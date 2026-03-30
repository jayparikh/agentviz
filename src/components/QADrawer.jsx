/**
 * QADrawer -- slide-over chat panel for Session Q&A.
 *
 * Slides in from the right edge, overlays any view.
 * Uses useQA for state; qaClassifier handles instant answers client-side.
 */

import { useState, useRef, useEffect, useMemo } from "react";
import { theme, alpha } from "../lib/theme.js";
import Icon from "./Icon.jsx";
import useQA from "../hooks/useQA.js";

var TURN_REF_RE = /\[Turns?\s*#?\s*(\d+(?:\s*[-,]\s*\d+)*)\]/gi;
var BOLD_RE = /\*\*(.+?)\*\*/g;

/**
 * Parse text into parts: turn refs, bold spans, and plain text.
 */
function parseMessageContent(text) {
  // First pass: split on turn refs
  var turnParts = [];
  var last = 0;
  var match;
  TURN_REF_RE.lastIndex = 0;
  while ((match = TURN_REF_RE.exec(text)) !== null) {
    if (match.index > last) turnParts.push({ type: "text", value: text.slice(last, match.index) });
    var nums = match[1].split(/\s*[,\-]\s*/).map(Number).filter(function (n) { return !isNaN(n); });
    turnParts.push({ type: "ref", label: match[0], turns: nums });
    last = match.index + match[0].length;
  }
  if (last < text.length) turnParts.push({ type: "text", value: text.slice(last) });

  // Second pass: split text nodes on **bold**
  var result = [];
  for (var i = 0; i < turnParts.length; i++) {
    var part = turnParts[i];
    if (part.type !== "text") { result.push(part); continue; }
    var str = part.value;
    var bLast = 0;
    BOLD_RE.lastIndex = 0;
    var bMatch;
    while ((bMatch = BOLD_RE.exec(str)) !== null) {
      if (bMatch.index > bLast) result.push({ type: "text", value: str.slice(bLast, bMatch.index) });
      result.push({ type: "bold", value: bMatch[1] });
      bLast = bMatch.index + bMatch[0].length;
    }
    if (bLast < str.length) result.push({ type: "text", value: str.slice(bLast) });
  }
  return result;
}

function SuggestedChips({ sessionData, onAsk }) {
  var chips = useMemo(function () {
    var c = ["What tools were used most?", "Summarize this session"];
    if (sessionData && sessionData.metadata && sessionData.metadata.errorCount > 0) {
      c.splice(1, 0, "What errors occurred?");
    }
    if (sessionData && sessionData.metadata && sessionData.metadata.tokenUsage) {
      c.push("What was the total cost?");
    }
    return c;
  }, [sessionData]);

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 12 }}>
      {chips.map(function (q) {
        return (
          <button
            key={q}
            className="av-btn"
            onClick={function () { onAsk(q); }}
            style={{
              background: alpha(theme.accent.primary, 0.06),
              border: "1px solid " + alpha(theme.accent.primary, 0.15),
              borderRadius: theme.radius.full,
              color: theme.text.secondary,
              fontFamily: theme.font.mono,
              fontSize: theme.fontSize.sm,
              padding: "4px 10px",
              cursor: "pointer",
            }}
          >
            {q}
          </button>
        );
      })}
    </div>
  );
}

function MessageBubble({ message, onSeekTurn }) {
  var isUser = message.role === "user";
  var bg = isUser ? alpha(theme.agent.user, 0.08) : alpha(theme.agent.assistant, 0.06);
  var borderColor = isUser ? alpha(theme.agent.user, 0.15) : alpha(theme.agent.assistant, 0.12);

  var parts = isUser ? [{ type: "text", value: message.content }] : parseMessageContent(message.content);

  return (
    <div style={{
      background: bg,
      border: "1px solid " + borderColor,
      borderRadius: theme.radius.lg,
      padding: "12px 14px",
      fontSize: theme.fontSize.base,
      fontFamily: theme.font.mono,
      color: theme.text.primary,
      lineHeight: 1.6,
      whiteSpace: "pre-wrap",
      wordBreak: "break-word",
      alignSelf: isUser ? "flex-end" : "flex-start",
      maxWidth: "92%",
    }}>
      {message.streaming && !message.content && (
        <span style={{ display: "inline-block", animation: "spin 1.2s linear infinite", color: theme.accent.primary }}>
          {"\u2726"}
        </span>
      )}
      {parts.map(function (part, i) {
        if (part.type === "ref") {
          return (
            <button
              key={i}
              className="av-btn"
              aria-label={"Jump to " + part.label.replace(/[\[\]]/g, "")}
              onClick={function () {
                if (onSeekTurn && part.turns.length) onSeekTurn(part.turns[0]);
              }}
              style={{
                display: "inline",
                background: theme.accent.muted,
                color: theme.accent.primary,
                border: "none",
                borderRadius: theme.radius.full,
                fontFamily: theme.font.mono,
                fontSize: theme.fontSize.sm,
                padding: "1px 6px",
                cursor: "pointer",
                fontWeight: 600,
              }}
            >
              {part.label.replace(/[\[\]]/g, "")}
            </button>
          );
        }
        if (part.type === "bold") {
          return <strong key={i} style={{ color: theme.text.primary, fontWeight: 600 }}>{part.value}</strong>;
        }
        return <span key={i}>{part.value}</span>;
      })}
      {message.instant && (
        <span style={{
          display: "block",
          marginTop: 6,
          fontSize: theme.fontSize.xs,
          color: theme.text.ghost,
        }}>
          instant answer
        </span>
      )}
    </div>
  );
}

export default function QADrawer({ open, onClose, onDisable, sessionData, onSeek, turns }) {
  var [input, setInput] = useState("");
  var messagesEndRef = useRef(null);
  var inputRef = useRef(null);
  var qa = useQA(sessionData);

  // Auto-scroll to bottom on new messages
  useEffect(function () {
    if (messagesEndRef.current && messagesEndRef.current.scrollIntoView) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [qa.messages]);

  // Focus input when drawer opens
  useEffect(function () {
    if (!open) return;
    var id = setTimeout(function () {
      if (inputRef.current) inputRef.current.focus();
    }, 50);
    return function () { clearTimeout(id); };
  }, [open]);

  // Escape to close
  useEffect(function () {
    if (!open) return;
    function handleKey(e) {
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
    }
    window.addEventListener("keydown", handleKey);
    return function () { window.removeEventListener("keydown", handleKey); };
  }, [open, onClose]);

  function handleSubmit(e) {
    e.preventDefault();
    if (!input.trim() || qa.isStreaming) return;
    qa.ask(input);
    setInput("");
  }

  function handleSeekTurn(turnIndex) {
    if (turns && turns[turnIndex] && onSeek) {
      onSeek(turns[turnIndex].startTime);
    }
  }

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: alpha(theme.bg.base, 0.4),
          zIndex: theme.z.overlay,
        }}
      />

      {/* Drawer panel */}
      <div
        role="dialog"
        aria-label="Session Q&A"
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          width: 400,
          height: "100dvh",
          background: theme.bg.surface,
          borderLeft: "1px solid " + theme.border.default,
          boxShadow: theme.shadow.lg,
          zIndex: theme.z.modal,
          display: "flex",
          flexDirection: "column",
          fontFamily: theme.font.mono,
          boxSizing: "border-box",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 14px",
          borderBottom: "1px solid " + theme.border.default,
          flexShrink: 0,
        }}>
          <span style={{
            fontSize: theme.fontSize.sm,
            color: theme.text.dim,
            textTransform: "uppercase",
            letterSpacing: 2,
            fontFamily: theme.font.mono,
          }}>
            Session Q&A
          </span>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {qa.messages.length > 0 && (
              <button
                className="av-btn"
                onClick={qa.clear}
                aria-label="Clear conversation"
                style={{
                  background: "none",
                  border: "none",
                  color: theme.text.muted,
                  cursor: "pointer",
                  fontSize: theme.fontSize.sm,
                  fontFamily: theme.font.mono,
                  padding: "2px 6px",
                }}
              >
                clear
              </button>
            )}
            <button
              onClick={onClose}
              aria-label="Close Q&A drawer"
              style={{
                background: "none",
                border: "none",
                color: theme.text.muted,
                cursor: "pointer",
                fontSize: theme.fontSize.xl,
                lineHeight: 1,
                padding: 0,
              }}
            >
              <Icon name="close" size={16} />
            </button>
          </div>
        </div>

        {/* Messages area */}
        <div style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          padding: 14,
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}>
          {qa.messages.length === 0 && (
            <div style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              alignItems: "center",
              textAlign: "center",
              gap: 8,
            }}>
              <Icon name="message-circle" size={24} style={{ color: theme.text.ghost }} />
              <div style={{
                color: theme.text.dim,
                fontSize: theme.fontSize.md,
                fontFamily: theme.font.mono,
              }}>
                Ask anything about this session
              </div>
              <SuggestedChips sessionData={sessionData} onAsk={function (q) { qa.ask(q); }} />
            </div>
          )}

          {qa.messages.map(function (msg, i) {
            return <MessageBubble key={i} message={msg} onSeekTurn={handleSeekTurn} />;
          })}

          {qa.error && (
            <div style={{
              background: theme.semantic.errorBg,
              border: "1px solid " + theme.semantic.errorBorder,
              borderRadius: theme.radius.lg,
              padding: "10px 14px",
              fontSize: theme.fontSize.sm,
              color: theme.semantic.errorText,
              fontFamily: theme.font.mono,
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}>
              <Icon name="alert-circle" size={11} style={{ color: theme.semantic.error, flexShrink: 0 }} />
              <span>{qa.error}</span>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input area */}
        <div style={{ flexShrink: 0, borderTop: "1px solid " + theme.border.default, padding: "12px 16px 20px" }}>
          <form
            onSubmit={handleSubmit}
            className="av-search-wrap"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              background: theme.bg.base,
              border: "1px solid " + theme.border.default,
              borderRadius: theme.radius.md,
              padding: "4px 8px",
              transition: "border-color 150ms ease-out",
            }}
          >
            <input
              ref={inputRef}
              className="av-search"
              type="text"
              value={input}
              onChange={function (e) { setInput(e.target.value); }}
              placeholder="Ask about this session..."
              aria-label="Ask about this session"
              disabled={qa.isStreaming}
              style={{
                flex: 1,
                background: "transparent",
                border: "none",
                color: theme.text.primary,
                fontFamily: theme.font.mono,
                fontSize: theme.fontSize.sm,
                padding: "2px 0",
                outline: "none",
              }}
            />
            <button
              type="submit"
              disabled={!input.trim() || qa.isStreaming}
              aria-label="Send question"
              style={{
                background: input.trim() ? theme.accent.primary : "transparent",
                border: "none",
                borderRadius: theme.radius.sm,
                color: input.trim() ? theme.text.primary : theme.text.ghost,
                cursor: input.trim() ? "pointer" : "default",
                padding: "4px 6px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <Icon name="send" size={12} />
            </button>
          </form>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 8 }}>
            <span style={{ fontSize: theme.fontSize.xs, color: theme.text.ghost }}>
              <kbd style={{
                background: theme.bg.raised,
                border: "1px solid " + theme.border.default,
                borderRadius: theme.radius.sm,
                padding: "1px 5px",
                fontSize: theme.fontSize.xs,
                color: theme.text.primary,
              }}>Esc</kbd>{" "}to close
            </span>
            <button
              onClick={function () { if (onDisable) onDisable(); }}
              style={{
                background: "none",
                border: "none",
                color: theme.text.ghost,
                fontSize: theme.fontSize.xs,
                textDecoration: "underline",
                cursor: "pointer",
                fontFamily: theme.font.mono,
              }}
            >Disable Q&A</button>
          </div>
        </div>
      </div>
    </>
  );
}
