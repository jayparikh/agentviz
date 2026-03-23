import { theme } from "../lib/theme.js";

/**
 * Lightweight syntax highlighter for code snippets.
 * No external deps -- handles JS/TS/Python/Shell keywords, strings, comments, numbers.
 */

var TOKEN_RE = /(\/\/.*$|#.*$|\/\*[\s\S]*?\*\/)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|((?:\/[\w.\-]+)+\.\w+)|\b(function|const|let|var|return|if|else|for|while|import|export|class|new|this|throw|try|catch|async|await|yield|from|of|in|def|self|print|True|False|None|elif|except|finally|raise|with|lambda|pass|break|continue)\b|\b(\d+\.?\d*(?:e[+-]?\d+)?)\b|([=!<>]=?|&&|\|\||=>|\+\+|--|\?\?)/gm;

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
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

    var color = theme.accent.primary;
    if (match[1]) color = theme.text.dim;
    if (match[2]) color = theme.semantic.success;
    if (match[3]) color = theme.accent.primary;
    if (match[4]) color = theme.track.context;
    if (match[5]) color = theme.semantic.warning;
    if (match[6]) color = theme.accent.primary;

    html += '<span style="color:' + color + '">' + escapeHtml(match[0]) + "</span>";
    lastIndex = TOKEN_RE.lastIndex;
  }

  if (lastIndex < text.length) {
    html += escapeHtml(text.slice(lastIndex));
  }

  return html;
}

export default function SyntaxHighlight({ text, maxLines }) {
  if (!text) return null;
  if (maxLines == null) maxLines = Infinity;

  var lines = text.split("\n");
  var truncated = Number.isFinite(maxLines) && lines.length > maxLines;
  var display = truncated ? lines.slice(0, maxLines).join("\n") : text;
  var html = highlightSyntaxToHtml(display);
  if (truncated) {
    html += '\n<span style="color:' + theme.text.ghost + '">... ' + (lines.length - maxLines) + ' more lines</span>';
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
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
