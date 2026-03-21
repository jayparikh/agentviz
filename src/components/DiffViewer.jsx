import { useState } from "react";
import { theme, alpha } from "../lib/theme.js";
import { extractDiffData, computeDiff } from "../lib/diffUtils.js";

/**
 * Inline diff viewer for file-editing tool calls.
 * Renders a unified diff with dual-gutter line numbers and color-coded lines.
 */

var MAX_COLLAPSED_LINES = 40;

function DiffHeader({ filePath, type, oldLineCount, newLineCount }) {
  var icon = type === "create" ? "\u2795" : "\u270E";
  var label = type === "create" ? "Created" : "Modified";
  var stat = type === "create"
    ? "+" + newLineCount + " lines"
    : "\u2212" + oldLineCount + " / +" + newLineCount + " lines";

  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: theme.space.md,
      padding: theme.space.md + "px " + theme.space.lg + "px",
      background: alpha(theme.accent.cyan, 0.06),
      borderRadius: theme.radius.md + "px " + theme.radius.md + "px 0 0",
      borderBottom: "1px solid " + theme.border.default,
    }}>
      <span style={{ fontSize: theme.fontSize.sm }}>{icon}</span>
      <span style={{
        fontSize: theme.fontSize.sm,
        color: theme.accent.cyan,
        fontFamily: theme.font,
        flex: 1,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}>
        {filePath}
      </span>
      <span style={{
        fontSize: theme.fontSize.xs,
        color: type === "create" ? theme.accent.green : theme.accent.amber,
        background: alpha(type === "create" ? theme.accent.green : theme.accent.amber, 0.1),
        padding: "2px 6px",
        borderRadius: theme.radius.sm,
      }}>
        {label}
      </span>
      <span style={{
        fontSize: theme.fontSize.xs,
        color: theme.text.muted,
      }}>
        {stat}
      </span>
    </div>
  );
}

function HunkHeader({ hunk }) {
  var header = "@@ -" + hunk.oldStart + "," + hunk.oldCount +
    " +" + hunk.newStart + "," + hunk.newCount + " @@";

  return (
    <div style={{
      display: "flex",
      padding: "2px " + theme.space.lg + "px",
      background: alpha(theme.accent.cyan, 0.04),
      fontFamily: theme.font,
      fontSize: theme.fontSize.xs,
      color: theme.accent.cyan,
      borderTop: "1px solid " + theme.border.subtle,
      borderBottom: "1px solid " + theme.border.subtle,
    }}>
      <span style={{ width: 38 + 38, display: "inline-block" }} />
      <span>{header}</span>
    </div>
  );
}

var lineColors = {
  insert: {
    bg: alpha("#34d399", 0.08),
    gutter: alpha("#34d399", 0.15),
    marker: theme.accent.green,
    text: theme.text.primary,
  },
  delete: {
    bg: alpha("#ef4444", 0.08),
    gutter: alpha("#ef4444", 0.15),
    marker: theme.accent.red,
    text: theme.text.primary,
  },
  context: {
    bg: "transparent",
    gutter: "transparent",
    marker: theme.text.ghost,
    text: theme.text.secondary,
  },
};

function DiffLine({ line }) {
  var colors = lineColors[line.type];
  var marker = line.type === "insert" ? "+" : (line.type === "delete" ? "\u2212" : " ");

  return (
    <div style={{
      display: "flex",
      background: colors.bg,
      fontFamily: theme.font,
      fontSize: theme.fontSize.sm,
      lineHeight: "20px",
      minHeight: 20,
    }}>
      <span style={{
        width: 38,
        textAlign: "right",
        paddingRight: 6,
        color: theme.text.ghost,
        background: colors.gutter,
        flexShrink: 0,
        userSelect: "none",
      }}>
        {line.oldNum || ""}
      </span>
      <span style={{
        width: 38,
        textAlign: "right",
        paddingRight: 6,
        color: theme.text.ghost,
        background: colors.gutter,
        flexShrink: 0,
        userSelect: "none",
        borderRight: "1px solid " + theme.border.subtle,
      }}>
        {line.newNum || ""}
      </span>
      <span style={{
        width: 16,
        textAlign: "center",
        color: colors.marker,
        flexShrink: 0,
        fontWeight: 600,
        userSelect: "none",
      }}>
        {marker}
      </span>
      <span style={{
        flex: 1,
        color: colors.text,
        whiteSpace: "pre",
        overflow: "hidden",
        textOverflow: "ellipsis",
        paddingRight: theme.space.md,
      }}>
        {line.text}
      </span>
    </div>
  );
}

export default function DiffViewer({ event }) {
  var [expanded, setExpanded] = useState(false);

  var data = extractDiffData(event);
  if (!data) return null;

  var hunks = computeDiff(data.oldStr, data.newStr);

  // Count total lines for stats
  var addCount = 0;
  var delCount = 0;
  var totalLines = 0;
  for (var h = 0; h < hunks.length; h++) {
    for (var l = 0; l < hunks[h].lines.length; l++) {
      totalLines++;
      if (hunks[h].lines[l].type === "insert") addCount++;
      if (hunks[h].lines[l].type === "delete") delCount++;
    }
  }

  // For creates with no hunks (empty file), show as all new
  if (hunks.length === 0 && data.type === "create" && data.newStr) {
    var newLines = data.newStr.split("\n");
    hunks = [{
      oldStart: 0,
      oldCount: 0,
      newStart: 1,
      newCount: newLines.length,
      lines: newLines.map(function (text, i) {
        return { type: "insert", text: text, oldNum: null, newNum: i + 1 };
      }),
    }];
    addCount = newLines.length;
    totalLines = newLines.length;
  }

  var isLong = totalLines > MAX_COLLAPSED_LINES;
  var shouldTruncate = isLong && !expanded;

  // Build flat list of renderable items
  var items = [];
  var linesSoFar = 0;
  for (var h = 0; h < hunks.length; h++) {
    items.push({ type: "hunk", hunk: hunks[h], key: "h" + h });
    for (var l = 0; l < hunks[h].lines.length; l++) {
      if (shouldTruncate && linesSoFar >= MAX_COLLAPSED_LINES) break;
      items.push({ type: "line", line: hunks[h].lines[l], key: "h" + h + "l" + l });
      linesSoFar++;
    }
    if (shouldTruncate && linesSoFar >= MAX_COLLAPSED_LINES) break;
  }

  return (
    <div style={{
      borderRadius: theme.radius.lg,
      border: "1px solid " + theme.border.default,
      overflow: "hidden",
      background: theme.bg.base,
    }}>
      <DiffHeader
        filePath={data.filePath}
        type={data.type}
        oldLineCount={delCount}
        newLineCount={addCount}
      />
      <div style={{ overflow: "auto", maxHeight: expanded ? "none" : 500 }}>
        {items.map(function (item) {
          if (item.type === "hunk") {
            return <HunkHeader key={item.key} hunk={item.hunk} />;
          }
          return <DiffLine key={item.key} line={item.line} />;
        })}
      </div>
      {isLong && (
        <div
          onClick={function () { setExpanded(!expanded); }}
          style={{
            padding: theme.space.md,
            textAlign: "center",
            fontSize: theme.fontSize.xs,
            color: theme.accent.cyan,
            cursor: "pointer",
            borderTop: "1px solid " + theme.border.subtle,
            background: alpha(theme.accent.cyan, 0.03),
          }}
        >
          {expanded
            ? "\u25B2 Collapse"
            : "\u25BC Show all " + totalLines + " lines (" + (totalLines - MAX_COLLAPSED_LINES) + " more)"}
        </div>
      )}
    </div>
  );
}
