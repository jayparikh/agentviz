import { theme } from "../lib/theme.js";
import { createElement } from "react";

/**
 * Lightweight syntax highlighter for code snippets.
 * No external deps -- handles JS/TS/Python/Shell keywords, strings, comments, numbers.
 */

var TOKEN_RE = /(\/\/.*$|#.*$|\/\*[\s\S]*?\*\/)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|((?:\/[\w.\-]+)+\.\w+)|\b(function|const|let|var|return|if|else|for|while|import|export|class|new|this|throw|try|catch|async|await|yield|from|of|in|def|self|print|True|False|None|elif|except|finally|raise|with|lambda|pass|break|continue)\b|\b(\d+\.?\d*(?:e[+-]?\d+)?)\b|([=!<>]=?|&&|\|\||=>|\+\+|--|\?\?)/gm;

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function tokenColor(match) {
  if (match[1]) return theme.text.dim;
  if (match[2]) return theme.semantic.success;
  if (match[3]) return theme.accent.primary;
  if (match[4]) return theme.track.context;
  if (match[5]) return theme.semantic.warning;
  if (match[6]) return theme.accent.primary;
  return theme.accent.primary;
}

export function highlightSyntaxToHtml(text) {
  var html = "";
  var lastIndex = 0;
  var match;

  TOKEN_RE.lastIndex = 0;

  while ((match = TOKEN_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      html += escapeHtml(text.slice(lastIndex, match.index));
    }
    html += '<span style="color:' + tokenColor(match) + '">' + escapeHtml(match[0]) + "</span>";
    lastIndex = TOKEN_RE.lastIndex;
  }

  if (lastIndex < text.length) {
    html += escapeHtml(text.slice(lastIndex));
  }

  return html;
}

function highlightSyntaxToElements(text) {
  var parts = [];
  var lastIndex = 0;
  var match;
  var key = 0;

  TOKEN_RE.lastIndex = 0;

  while ((match = TOKEN_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    parts.push(createElement("span", { key: key++, style: { color: tokenColor(match) } }, match[0]));
    lastIndex = TOKEN_RE.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts;
}

export default function SyntaxHighlight({ text, maxLines }) {
  if (!text) return null;
  if (maxLines == null) maxLines = Infinity;

  var lines = text.split("\n");
  var truncated = Number.isFinite(maxLines) && lines.length > maxLines;
  var display = truncated ? lines.slice(0, maxLines).join("\n") : text;
  var elements = highlightSyntaxToElements(display);
  if (truncated) {
    elements.push("\n");
    elements.push(createElement("span", { key: "trunc", style: { color: theme.text.ghost } }, "... " + (lines.length - maxLines) + " more lines"));
  }

  return (
    <pre
      style={{
        background: theme.bg.base, borderRadius: theme.radius.lg,
        padding: theme.space.md, fontSize: theme.fontSize.sm,
        color: theme.text.secondary, overflow: "auto", maxHeight: 200,
        border: "1px solid " + theme.border.default,
        whiteSpace: "pre-wrap", wordBreak: "break-all",
        lineHeight: 1.6, fontFamily: theme.font.mono, margin: 0,
      }}
    >{elements}</pre>
  );
}
