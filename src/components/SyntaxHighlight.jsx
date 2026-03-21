import { theme } from "../lib/theme.js";

/**
 * Lightweight syntax highlighter for code snippets.
 * No external deps -- handles JS/TS/Python/Shell keywords, strings, comments, numbers.
 */

var KEYWORD_RE = /\b(function|const|let|var|return|if|else|for|while|import|export|class|new|this|throw|try|catch|async|await|yield|from|of|in|def|self|print|True|False|None|elif|except|finally|raise|with|lambda|pass|break|continue)\b/g;
var STRING_RE = /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)/g;
var COMMENT_RE = /(\/\/.*$|#.*$|\/\*[\s\S]*?\*\/)/gm;
var NUMBER_RE = /\b(\d+\.?\d*(?:e[+-]?\d+)?)\b/gi;
var OPERATOR_RE = /([=!<>]=?|&&|\|\||=>|\+\+|--|\?\?)/g;
var PATH_RE = /((?:\/[\w.\-]+)+\.\w+)/g;

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function tokenize(text) {
  // Simple multi-pass replacement with markers
  var tokens = [];
  var id = 0;

  function mark(match, color) {
    var placeholder = "\x00" + id + "\x00";
    tokens.push({ id: id, html: '<span style="color:' + color + '">' + escapeHtml(match) + '</span>' });
    id++;
    return placeholder;
  }

  var s = text;

  // Order matters: comments first, then strings, then others
  s = s.replace(COMMENT_RE, function (m) { return mark(m, theme.text.dim); });
  s = s.replace(STRING_RE, function (m) { return mark(m, theme.semantic.success); });
  s = s.replace(PATH_RE, function (m) { return mark(m, theme.accent.primary); });
  s = s.replace(KEYWORD_RE, function (m) { return mark(m, theme.track.context); });
  s = s.replace(NUMBER_RE, function (m) { return mark(m, theme.semantic.warning); });
  s = s.replace(OPERATOR_RE, function (m) { return mark(m, theme.accent.primary); });

  // Escape remaining text
  s = escapeHtml(s);

  // Restore tokens
  for (var i = 0; i < tokens.length; i++) {
    s = s.replace("\x00" + tokens[i].id + "\x00", tokens[i].html);
  }

  return s;
}

export default function SyntaxHighlight({ text, maxLines }) {
  if (!text) return null;
  if (!maxLines) maxLines = 20;

  var lines = text.split("\n");
  var truncated = lines.length > maxLines;
  var display = truncated ? lines.slice(0, maxLines).join("\n") : text;
  var html = tokenize(display);
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
