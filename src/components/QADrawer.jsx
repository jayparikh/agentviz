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

// Bracketed turn references: [Turn 0], [Turns 0-5], [Turn 0, Turn 5], [Turn 0 and Turn 2]
var BRACKETED_TURN_RE = /\[Turns?\s*#?\s*[\d][\d\s,\-\u2013andTurn#]*/gi;
// Unbracketed: Turn 5, turn 3 (case insensitive)
var UNBRACKETED_TURN_RE = /Turn\s*#?\s*(\d+)/gi;
var BOLD_RE = /\*\*(.+?)\*\*/g;
var CODE_RE = /`([^`]+)`/g;

function expandTurnNums(body) {
  var nums = [];
  var segments = body.split(/,|\band\b/);
  for (var i = 0; i < segments.length; i++) {
    var seg = segments[i].trim();
    var rangeMatch = seg.match(/(?:Turns?\s*#?\s*)?(\d+)\s*[-\u2013]\s*(?:Turn\s*#?\s*)?(\d+)/i);
    if (rangeMatch) {
      var lo = parseInt(rangeMatch[1], 10);
      var hi = parseInt(rangeMatch[2], 10);
      for (var n = lo; n <= hi; n++) nums.push(n);
      continue;
    }
    var singleMatch = seg.match(/(?:Turns?\s*#?\s*)?(\d+)/i);
    if (singleMatch) nums.push(parseInt(singleMatch[1], 10));
  }
  return nums;
}

/**
 * Parse text into parts: turn refs, bold spans, code spans, and plain text.
 */
function parseMessageContent(text) {
  // Collect all turn reference markers with position info
  var markers = [];

  // Pass 1: bracketed groups
  BRACKETED_TURN_RE.lastIndex = 0;
  var bm;
  while ((bm = BRACKETED_TURN_RE.exec(text)) !== null) {
    var close = text.indexOf("]", bm.index);
    if (close === -1) continue;
    var full = text.substring(bm.index, close + 1);
    var body = full.slice(1, -1);
    var nums = expandTurnNums(body);
    if (nums.length > 0) {
      markers.push({ start: bm.index, end: close + 1, label: full, turns: nums });
    }
    BRACKETED_TURN_RE.lastIndex = close + 1;
  }

  // Pass 2: unbracketed "Turn N" not already inside a bracketed group
  UNBRACKETED_TURN_RE.lastIndex = 0;
  var um;
  while ((um = UNBRACKETED_TURN_RE.exec(text)) !== null) {
    var inside = markers.some(function (m) { return um.index >= m.start && um.index < m.end; });
    if (inside) continue;
    markers.push({ start: um.index, end: UNBRACKETED_TURN_RE.lastIndex, label: um[0], turns: [parseInt(um[1], 10)] });
  }

  markers.sort(function (a, b) { return a.start - b.start; });

  // Build turn-ref parts
  var turnParts = [];
  var last = 0;
  for (var i = 0; i < markers.length; i++) {
    var m = markers[i];
    if (m.start > last) turnParts.push({ type: "text", value: text.substring(last, m.start) });
    turnParts.push({ type: "ref", label: m.label, turns: m.turns });
    last = m.end;
  }
  if (last < text.length) turnParts.push({ type: "text", value: text.substring(last) });

  // Second pass: split text nodes on **bold** and `code`
  var result = [];
  for (var j = 0; j < turnParts.length; j++) {
    var part = turnParts[j];
    if (part.type !== "text") { result.push(part); continue; }
    splitFormattedText(part.value, result);
  }
  return result;
}

function splitFormattedText(str, out) {
  // Combine bold and code into a single pass using alternation
  var RE = /\*\*(.+?)\*\*|`([^`]+)`/g;
  var last = 0;
  var match;
  while ((match = RE.exec(str)) !== null) {
    if (match.index > last) out.push({ type: "text", value: str.slice(last, match.index) });
    if (match[1] != null) {
      out.push({ type: "bold", value: match[1] });
    } else {
      out.push({ type: "code", value: match[2] });
    }
    last = RE.lastIndex;
  }
  if (last < str.length) out.push({ type: "text", value: str.slice(last) });
}

var THINKING_LABELS = ["Thinking", "Analyzing session", "Building answer"];

function ThinkingIndicator({ phase }) {
  var [dotCount, setDotCount] = useState(0);
  var [labelIdx, setLabelIdx] = useState(0);

  useEffect(function () {
    var dotTimer = setInterval(function () {
      setDotCount(function (prev) { return (prev + 1) % 4; });
    }, 400);
    var labelTimer = setInterval(function () {
      setLabelIdx(function (prev) { return (prev + 1) % THINKING_LABELS.length; });
    }, 3000);
    return function () { clearInterval(dotTimer); clearInterval(labelTimer); };
  }, []);

  var label = phase === "connecting" ? "Connecting to AI"
    : phase === "streaming" ? "Receiving answer"
    : THINKING_LABELS[labelIdx];
  var dots = ".".repeat(dotCount);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, color: theme.accent.primary, fontSize: theme.fontSize.sm }}>
      <span style={{
        display: "inline-flex", gap: 3,
      }}>
        {[0, 1, 2].map(function (i) {
          return (
            <span key={i} style={{
              width: 6, height: 6, borderRadius: "50%",
              background: theme.accent.primary,
              opacity: dotCount === i || dotCount === 3 ? 1 : 0.25,
              transition: "opacity 200ms ease",
            }} />
          );
        })}
      </span>
      <span>{label}{dots}</span>
    </div>
  );
}

function ThinkingBubble({ messages }) {
  // Show thinking from the last streaming assistant message only
  var thinkingText = "";
  var isStreaming = false;
  for (var i = messages.length - 1; i >= 0; i--) {
    var msg = messages[i];
    if (msg.role !== "assistant") continue;
    var match = (msg.content || "").match(/^<think>([\s\S]*?)(<\/think>|$)/i);
    if (match && match[1].trim()) {
      thinkingText = match[1].trim();
      isStreaming = msg.streaming;
    }
    break;
  }
  // Only show while the message is still streaming
  if (!thinkingText || !isStreaming) return null;

  return (
    <div style={{
      background: "rgba(34, 197, 94, 0.08)",
      border: "1px solid rgba(34, 197, 94, 0.2)",
      borderRadius: theme.radius.lg,
      padding: "10px 12px",
      fontSize: theme.fontSize.sm,
      fontFamily: theme.font.mono,
      color: theme.text.secondary,
      lineHeight: 1.5,
      whiteSpace: "pre-wrap",
      wordBreak: "break-word",
      alignSelf: "flex-start",
      maxWidth: "92%",
      maxHeight: 200,
      overflow: "auto",
    }}>
      <div style={{
        fontSize: theme.fontSize.xs,
        fontWeight: 600,
        color: "rgb(34, 197, 94)",
        textTransform: "uppercase",
        letterSpacing: "0.5px",
        marginBottom: 6,
      }}>
        {"\uD83D\uDCA1"} Thinking
      </div>
      {thinkingText}
    </div>
  );
}

function ToggleSwitch({ checked, onChange, label }) {
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        fontFamily: theme.font.mono,
        fontSize: theme.fontSize.xs,
        color: theme.text.ghost,
      }}
    >
      <span style={{ fontSize: 11 }} title={label}>{"\uD83D\uDCA1"}</span>
      <button
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={function () { onChange(!checked); }}
        style={{
          position: "relative",
          width: 28,
          height: 16,
          borderRadius: 8,
          background: checked ? theme.accent.primary : alpha(theme.text.muted, 0.25),
          transition: "background 150ms ease",
          flexShrink: 0,
          border: "none",
          cursor: "pointer",
          padding: 0,
        }}
      >
        <span style={{
          position: "absolute",
          top: 2,
          left: checked ? 14 : 2,
          width: 12,
          height: 12,
          borderRadius: "50%",
          background: "#fff",
          transition: "left 150ms ease",
        }} />
      </button>
    </div>
  );
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

function renderParts(parts, onSeekTurn) {
  return parts.map(function (part, i) {
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
    if (part.type === "code") {
      return <code key={i} style={{ background: alpha(theme.text.primary, 0.08), borderRadius: 3, padding: "1px 4px", fontSize: theme.fontSize.sm }}>{part.value}</code>;
    }
    return <span key={i}>{part.value}</span>;
  });
}

function MarkdownContent({ text, onSeekTurn }) {
  if (!text) return null;
  var lines = text.split("\n");
  var elements = [];
  var listItems = [];
  var tableRows = [];

  function flushList() {
    if (listItems.length === 0) return;
    elements.push(
      <ul key={"ul-" + elements.length} style={{ margin: "4px 0", paddingLeft: 18 }}>
        {listItems.map(function (item, j) {
          return <li key={j} style={{ marginBottom: 2 }}>{renderParts(parseMessageContent(item), onSeekTurn)}</li>;
        })}
      </ul>
    );
    listItems = [];
  }

  function flushTable() {
    if (tableRows.length === 0) return;
    // Skip separator rows (|---|---|)
    var dataRows = tableRows.filter(function (r) { return !/^\|[\s\-:]+\|$/.test(r.trim()); });
    if (dataRows.length === 0) { tableRows = []; return; }
    elements.push(
      <div key={"tbl-" + elements.length} style={{ overflowX: "auto", margin: "4px 0" }}>
        <table style={{ borderCollapse: "collapse", fontSize: theme.fontSize.sm, width: "100%" }}>
          <tbody>
            {dataRows.map(function (row, j) {
              var cells = row.split("|").filter(function (c, ci, arr) { return ci > 0 && ci < arr.length - 1; });
              var Tag = j === 0 ? "th" : "td";
              return (
                <tr key={j}>
                  {cells.map(function (cell, k) {
                    return <Tag key={k} style={{
                      border: "1px solid " + alpha(theme.text.muted, 0.2),
                      padding: "3px 8px",
                      textAlign: "left",
                      fontWeight: j === 0 ? 600 : "normal",
                      background: j === 0 ? alpha(theme.text.muted, 0.06) : "transparent",
                    }}>{renderParts(parseMessageContent(cell.trim()), onSeekTurn)}</Tag>;
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
    tableRows = [];
  }

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var trimmed = line.trim();

    // Table row
    if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
      flushList();
      tableRows.push(trimmed);
      continue;
    } else {
      flushTable();
    }

    // List item (- or *)
    var listMatch = trimmed.match(/^[-*]\s+(.*)/);
    if (listMatch) {
      flushTable();
      listItems.push(listMatch[1]);
      continue;
    } else {
      flushList();
    }

    // Numbered list (1. 2. etc)
    var numMatch = trimmed.match(/^\d+\.\s+(.*)/);
    if (numMatch) {
      listItems.push(numMatch[1]);
      continue;
    } else if (listItems.length > 0 && !listMatch) {
      flushList();
    }

    // Empty line
    if (!trimmed) {
      elements.push(<div key={"br-" + i} style={{ height: 6 }} />);
      continue;
    }

    // Section headers (## and ###)
    var h3Match = trimmed.match(/^###\s+(.*)/);
    if (h3Match) {
      flushList(); flushTable();
      elements.push(<div key={"h3-" + i} style={{ fontWeight: 600, fontSize: theme.fontSize.sm, color: theme.text.primary, marginTop: 8, marginBottom: 2 }}>{renderParts(parseMessageContent(h3Match[1]), onSeekTurn)}</div>);
      continue;
    }
    var h2Match = trimmed.match(/^##\s+(.*)/);
    if (h2Match) {
      flushList(); flushTable();
      elements.push(<div key={"h2-" + i} style={{ fontWeight: 700, fontSize: theme.fontSize.base, color: theme.text.primary, marginTop: 10, marginBottom: 2 }}>{renderParts(parseMessageContent(h2Match[1]), onSeekTurn)}</div>);
      continue;
    }
    var h1Match = trimmed.match(/^#\s+(.*)/);
    if (h1Match) {
      flushList(); flushTable();
      elements.push(<div key={"h1-" + i} style={{ fontWeight: 700, fontSize: theme.fontSize.md, color: theme.text.primary, marginTop: 12, marginBottom: 4 }}>{renderParts(parseMessageContent(h1Match[1]), onSeekTurn)}</div>);
      continue;
    }

    // Regular text line
    var parts = parseMessageContent(trimmed);
    elements.push(<div key={"p-" + i}>{renderParts(parts, onSeekTurn)}</div>);
  }

  flushList();
  flushTable();

  return <>{elements}</>;
}

function MessageBubble({ message, onSeekTurn }) {
  var isUser = message.role === "user";
  var bg = isUser ? alpha(theme.agent.user, 0.08) : alpha(theme.agent.assistant, 0.06);
  var borderColor = isUser ? alpha(theme.agent.user, 0.15) : alpha(theme.agent.assistant, 0.12);

  // Strip thinking blocks from display -- they render in ThinkingBubble
  var content = message.content || "";
  var answerText = content.replace(/^<think>[\s\S]*?(<\/think>|$)/i, "").trim();

  // If streaming and no answer text yet (still in think block), don't render bubble
  if (message.streaming && !answerText) return null;
  // If finished but no answer (only thinking), show a minimal note
  if (!message.streaming && !answerText && !isUser) {
    answerText = "(The model's response was entirely in its thinking process. Toggle thinking on to see it.)";
  }

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
      wordBreak: "break-word",
      alignSelf: isUser ? "flex-end" : "flex-start",
      maxWidth: "92%",
    }}>
      {isUser
        ? <span>{answerText}</span>
        : <MarkdownContent text={answerText} onSeekTurn={onSeekTurn} />
      }
      {message.instant && (
        <span style={{
          display: "block",
          marginTop: 6,
          fontSize: theme.fontSize.xs,
          color: theme.text.ghost,
        }}>
          {"\u26A1"} instant
          {message.elapsedMs != null && " \u00B7 " + message.elapsedMs + "ms"}
        </span>
      )}
      {message.cached && (
        <span style={{
          display: "block",
          marginTop: 6,
          fontSize: theme.fontSize.xs,
          color: theme.text.ghost,
        }}>
          {"\u21BB"} cached answer
          {message.elapsedMs != null && " \u00B7 " + message.elapsedMs + "ms"}
        </span>
      )}
      {!message.instant && !message.cached && !message.streaming && message.elapsedMs != null && (
        <span style={{
          display: "block",
          marginTop: 6,
          fontSize: theme.fontSize.xs,
          color: theme.text.ghost,
        }}>
          answered in {message.elapsedMs < 1000
            ? message.elapsedMs + "ms"
            : (message.elapsedMs / 1000).toFixed(1) + "s"}
        </span>
      )}
    </div>
  );
}

export default function QADrawer({ open, onClose, onDisable, sessionKey, sessionData, onSeek, turns }) {
  var [input, setInput] = useState("");
  var [showThinking, setShowThinking] = useState(false);
  var messagesEndRef = useRef(null);
  var inputRef = useRef(null);
  var lastQuestionRef = useRef("");
  var qa = useQA(sessionData, sessionKey);

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
    lastQuestionRef.current = input.trim();
    qa.ask(input);
    setInput("");
  }

  function handleInputKeyDown(e) {
    if (e.key === "ArrowUp" && !input && lastQuestionRef.current) {
      e.preventDefault();
      setInput(lastQuestionRef.current);
    }
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
            <ToggleSwitch
              checked={showThinking}
              onChange={setShowThinking}
              label={showThinking ? "Hide thinking" : "Show thinking"}
            />
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

          {/* Thinking bubble -- green tinted, visible when toggle on and streaming */}
          {showThinking && <ThinkingBubble messages={qa.messages} />}

          {/* Show thinking indicator when streaming but no bubble yet */}
          {qa.isStreaming && !qa.messages.some(function (m) { return m.streaming; }) && (
            <div style={{
              alignSelf: "flex-start",
              maxWidth: "92%",
              background: alpha(theme.agent.assistant, 0.06),
              border: "1px solid " + alpha(theme.agent.assistant, 0.12),
              borderRadius: theme.radius.lg,
              padding: "12px 14px",
            }}>
              <ThinkingIndicator phase={qa.streamPhase} />
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
              onKeyDown={handleInputKeyDown}
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
