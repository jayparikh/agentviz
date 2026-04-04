/**
 * QADrawer -- slide-over panel for Session Q&A.
 *
 * Slides in from the right edge, overlays any view.
 * Shows Quick insights (instant facts) and a chat input for AI-powered questions.
 * Accepts qa state from parent so conversation persists across drawer open/close.
 */

import { useState, useRef, useEffect, useMemo } from "react";
import { theme, alpha } from "../lib/theme.js";
import Icon from "./Icon.jsx";
import KeyboardHint from "./ui/KeyboardHint.jsx";
import { classify } from "../lib/qaClassifier.js";

var TURN_REF_RE = /\[Turns?\s*#?\s*(\d+(?:\s*[-,]\s*\d+)*)\]/gi;
var BOLD_RE = /\*\*(.+?)\*\*/g;
var INLINE_CODE_RE = /`([^`]+)`/g;

/**
 * Parse markdown-like text into renderable parts.
 * Supports: turn refs, bold, inline code, code blocks, list items, headers.
 */
function parseMessageContent(text) {
  // Pre-pass: split on code blocks (```...```) to protect them from inline parsing
  var segments = [];
  var codeBlockRe = /```(\w*)\n?([\s\S]*?)```/g;
  var cbLast = 0;
  var cbMatch;
  while ((cbMatch = codeBlockRe.exec(text)) !== null) {
    if (cbMatch.index > cbLast) segments.push({ type: "text", value: text.slice(cbLast, cbMatch.index) });
    segments.push({ type: "codeblock", lang: cbMatch[1] || "", value: cbMatch[2] });
    cbLast = cbMatch.index + cbMatch[0].length;
  }
  if (cbLast < text.length) segments.push({ type: "text", value: text.slice(cbLast) });

  var result = [];
  for (var s = 0; s < segments.length; s++) {
    if (segments[s].type === "codeblock") {
      result.push(segments[s]);
      continue;
    }
    // Parse inline content within non-code-block text
    var lines = segments[s].value.split("\n");
    for (var li = 0; li < lines.length; li++) {
      if (li > 0) result.push({ type: "newline" });
      var line = lines[li];

      // Check for header lines (## Header)
      var headerMatch = line.match(/^(#{1,3})\s+(.+)$/);
      if (headerMatch) {
        result.push({ type: "header", level: headerMatch[1].length, value: headerMatch[2] });
        continue;
      }

      // Check for list items (- item or * item)
      var listMatch = line.match(/^(\s*[-*])\s+(.+)$/);
      if (listMatch) {
        var indent = listMatch[1].length > 1 ? 1 : 0;
        result.push({ type: "list_start", indent: indent });
        parseInline(listMatch[2], result);
        result.push({ type: "list_end" });
        continue;
      }

      parseInline(line, result);
    }
  }
  return result;
}

/**
 * Parse inline formatting: turn refs, bold, inline code, plain text.
 */
function parseInline(text, result) {
  // Merge turn refs, bold, and inline code into one pass via combined regex
  var combined = /(\[Turns?\s*#?\s*\d+(?:\s*[-,]\s*\d+)*\])|\*\*(.+?)\*\*|`([^`]+)`/gi;
  var last = 0;
  var match;
  while ((match = combined.exec(text)) !== null) {
    if (match.index > last) result.push({ type: "text", value: text.slice(last, match.index) });

    if (match[1]) {
      // Turn ref
      TURN_REF_RE.lastIndex = 0;
      var refMatch = TURN_REF_RE.exec(match[1]);
      if (refMatch) {
        var nums = refMatch[1].split(/\s*[,\-]\s*/).map(Number).filter(function (n) { return !isNaN(n); });
        result.push({ type: "ref", label: match[1], turns: nums });
      } else {
        result.push({ type: "text", value: match[1] });
      }
    } else if (match[2]) {
      result.push({ type: "bold", value: match[2] });
    } else if (match[3]) {
      result.push({ type: "code", value: match[3] });
    }

    last = match.index + match[0].length;
  }
  if (last < text.length) result.push({ type: "text", value: text.slice(last) });
}

// ── Quick insights ──────────────────────────────────────────────────────────

var INSIGHT_DEFS = [
  { id: "summary", label: "Summary", icon: "layout-list", question: "summarize this session" },
  { id: "tools",   label: "Tools",   icon: "wrench",      question: "what tools were used" },
  { id: "errors",  label: "Errors",  icon: "alert-circle", question: "what errors occurred", condition: function (d) { return d.metadata && d.metadata.errorCount > 0; } },
  { id: "cost",    label: "Cost",    icon: "coins",       question: "how much did this cost", condition: function (d) { return d.metadata && d.metadata.tokenUsage; } },
  { id: "files",   label: "Files",   icon: "file-edit",   question: "what files were edited" },
  { id: "longest", label: "Longest", icon: "clock",       question: "which turn took the longest", condition: function (d) { return d.turns && d.turns.length > 1; } },
];

function QuickInsights({ sessionData, onAsk }) {
  var insights = useMemo(function () {
    if (!sessionData || !sessionData.metadata) return [];
    return INSIGHT_DEFS.filter(function (def) {
      return !def.condition || def.condition(sessionData);
    }).map(function (def) {
      var result = classify(def.question, sessionData);
      if (result.tier !== "instant") return null;
      // Extract a short preview from the answer (first meaningful line)
      var lines = result.answer.split("\n").filter(function (l) { return l.trim(); });
      var preview = lines[0] || "";
      // Strip markdown bold for preview
      preview = preview.replace(/\*\*/g, "");
      if (preview.length > 80) preview = preview.slice(0, 77) + "...";
      return { id: def.id, label: def.label, icon: def.icon, preview: preview, question: def.question };
    }).filter(Boolean);
  }, [sessionData]);

  if (insights.length === 0) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <span style={{
        fontSize: theme.fontSize.xs,
        color: theme.text.ghost,
        textTransform: "uppercase",
        letterSpacing: 1.5,
        fontFamily: theme.font.mono,
      }}>
        Quick insights
      </span>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {insights.map(function (ins) {
          return (
            <button
              key={ins.id}
              className="av-btn"
              onClick={function () { onAsk(ins.question); }}
              title={ins.preview}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                background: alpha(theme.accent.primary, 0.06),
                border: "1px solid " + alpha(theme.accent.primary, 0.12),
                borderRadius: theme.radius.md,
                color: theme.text.secondary,
                fontFamily: theme.font.mono,
                fontSize: theme.fontSize.sm,
                padding: "4px 8px",
                cursor: "pointer",
                transition: "background 100ms ease-out",
              }}
            >
              <Icon name={ins.icon} size={11} style={{ color: theme.text.dim, flexShrink: 0 }} />
              {ins.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Part renderer ───────────────────────────────────────────────────────────

function renderParts(parts, onSeekTurn) {
  var elements = [];
  var inList = false;

  for (var i = 0; i < parts.length; i++) {
    var part = parts[i];

    if (part.type === "ref") {
      elements.push(
        <button
          key={i}
          className="av-btn"
          aria-label={"Jump to " + part.label.replace(/[\[\]]/g, "")}
          onClick={(function (turns) {
            return function () { if (onSeekTurn && turns.length) onSeekTurn(turns[0]); };
          })(part.turns)}
          style={{
            display: "inline",
            background: theme.accent.muted,
            color: theme.accent.primary,
            border: "none",
            borderRadius: theme.radius.full,
            fontFamily: theme.font.mono,
            fontSize: theme.fontSize.sm,
            padding: "2px 4px",
            cursor: "pointer",
            fontWeight: 600,
          }}
        >
          {part.label.replace(/[\[\]]/g, "")}
        </button>
      );
    } else if (part.type === "bold") {
      elements.push(<strong key={i} style={{ color: theme.text.primary, fontWeight: 600 }}>{part.value}</strong>);
    } else if (part.type === "code") {
      elements.push(
        <code key={i} style={{
          background: alpha(theme.accent.primary, 0.08),
          borderRadius: theme.radius.sm,
          padding: "2px 4px",
          fontSize: theme.fontSize.sm,
          fontFamily: theme.font.mono,
        }}>
          {part.value}
        </code>
      );
    } else if (part.type === "codeblock") {
      elements.push(
        <pre key={i} style={{
          background: theme.bg.inset,
          border: "1px solid " + theme.border.default,
          borderRadius: theme.radius.md,
          padding: "8px 12px",
          margin: "8px 0",
          fontSize: theme.fontSize.sm,
          fontFamily: theme.font.mono,
          overflowX: "auto",
          whiteSpace: "pre",
        }}>
          {part.value}
        </pre>
      );
    } else if (part.type === "header") {
      var headerSize = part.level === 1 ? theme.fontSize.lg : part.level === 2 ? theme.fontSize.base : theme.fontSize.sm;
      elements.push(
        <div key={i} style={{
          fontSize: headerSize,
          fontWeight: 700,
          color: theme.text.primary,
          margin: "8px 0 4px",
        }}>
          {part.value}
        </div>
      );
    } else if (part.type === "list_start") {
      inList = true;
      elements.push(
        <span key={i} style={{
          display: "inline",
          color: theme.accent.primary,
          marginLeft: part.indent ? 16 : 0,
        }}>
          {"\u2022 "}
        </span>
      );
    } else if (part.type === "list_end") {
      inList = false;
    } else if (part.type === "newline") {
      elements.push(<br key={i} />);
    } else {
      elements.push(<span key={i}>{part.value}</span>);
    }
  }

  return elements;
}

// ── Message bubble ──────────────────────────────────────────────────────────

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
      {renderParts(parts, onSeekTurn)}
      {!isUser && !message.streaming && (
        <span style={{
          display: "block",
          marginTop: 6,
          fontSize: theme.fontSize.xs,
          color: theme.text.ghost,
        }}>
          {message.instant ? "quick answer" : "AI answer"}
        </span>
      )}
    </div>
  );
}

// ── Drawer ──────────────────────────────────────────────────────────────────

export default function QADrawer({ open, onClose, onDisable, sessionData, onSeek, turns, qa }) {
  var [input, setInput] = useState("");
  var messagesEndRef = useRef(null);
  var inputRef = useRef(null);

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
              gap: 12,
            }}>
              <Icon name="message-circle" size={24} style={{ color: theme.text.ghost }} />
              <div style={{
                color: theme.text.dim,
                fontSize: theme.fontSize.md,
                fontFamily: theme.font.mono,
              }}>
                Ask anything about this session
              </div>
              <QuickInsights sessionData={sessionData} onAsk={function (q) { qa.ask(q); }} />
            </div>
          )}

          {qa.messages.map(function (msg) {
            return <MessageBubble key={msg.id} message={msg} onSeekTurn={handleSeekTurn} />;
          })}

          {qa.isStreaming && qa.streamingStatus && (
            <div style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: theme.fontSize.xs,
              color: theme.text.ghost,
              fontFamily: theme.font.mono,
              padding: "2px 4px",
            }}>
              <span style={{ display: "inline-block", animation: "spin 1.2s linear infinite" }}>{"\u2726"}</span>
              <span>{qa.streamingStatus}</span>
            </div>
          )}

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
        <div style={{
          flexShrink: 0,
          borderTop: "1px solid " + theme.border.default,
          padding: "12px 16px 0",
          paddingBottom: "calc(" + theme.space.huge + "px + env(safe-area-inset-bottom, 0px))",
        }}>
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
            {qa.isStreaming ? (
              <button
                type="button"
                onClick={qa.abort}
                aria-label="Stop generating"
                style={{
                  background: theme.semantic.error,
                  border: "none",
                  borderRadius: theme.radius.sm,
                  color: theme.text.primary,
                  cursor: "pointer",
                  padding: "4px 8px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <Icon name="square" size={10} />
              </button>
            ) : (
              <button
                type="submit"
                disabled={!input.trim()}
                aria-label="Send question"
                style={{
                  background: input.trim() ? theme.accent.primary : "transparent",
                  border: "none",
                  borderRadius: theme.radius.sm,
                  color: input.trim() ? theme.text.primary : theme.text.ghost,
                  cursor: input.trim() ? "pointer" : "default",
                  padding: "4px 8px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <Icon name="send" size={12} />
              </button>
            )}
          </form>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 8 }}>
            <span style={{ fontSize: theme.fontSize.xs, color: theme.text.ghost }}>
              <KeyboardHint>Esc</KeyboardHint>{" "}close
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
