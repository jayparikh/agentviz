import { useState } from "react";
import { theme, alpha } from "../lib/theme.js";
import { extractDiffData, computeDiff } from "../lib/diffUtils.js";
import Icon from "./Icon.jsx";

/**
 * Inline diff viewer for file-editing tool calls.
 * Renders a unified diff with dual-gutter line numbers and color-coded lines.
 */

var MAX_COLLAPSED_LINES = 40;

function DiffHeader({ filePath, type, oldLineCount, newLineCount }) {
  var icon = type === "create" ? <Icon name="file-plus" size={13} /> : <Icon name="pencil" size={13} />;
  var label = type === "create" ? "Created" : "Modified";
  var stat = type === "create"
    ? "+" + newLineCount + " lines"
    : <><Icon name="minus" size={11} style={{ display: "inline" }} /> {oldLineCount} / +{newLineCount} lines</>;

  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: theme.space.md,
      padding: theme.space.md + "px " + theme.space.lg + "px",
      background: alpha(theme.accent.primary, 0.06),
      borderRadius: theme.radius.md + "px " + theme.radius.md + "px 0 0",
      borderBottom: "1px solid " + theme.border.default,
    }}>
      <span style={{ fontSize: theme.fontSize.sm }}>{icon}</span>      <span style={{
        fontSize: theme.fontSize.sm,
        color: theme.accent.primary,
        fontFamily: theme.font.mono,
        flex: 1,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}>
        {filePath}
      </span>
      <span style={{
        fontSize: theme.fontSize.xs,
        color: type === "create" ? theme.semantic.success : theme.semantic.warning,
        background: alpha(type === "create" ? theme.semantic.success : theme.semantic.warning, 0.1),
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
      background: alpha(theme.accent.primary, 0.04),
      fontFamily: theme.font.mono,
      fontSize: theme.fontSize.xs,
      color: theme.accent.primary,
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
    bg: alpha(theme.semantic.success, 0.08),
    gutter: alpha(theme.semantic.success, 0.15),
    marker: theme.semantic.success,
    text: theme.text.primary,
  },
  delete: {
    bg: alpha(theme.semantic.error, 0.08),
    gutter: alpha(theme.semantic.error, 0.15),
    marker: theme.semantic.error,
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
      fontFamily: theme.font.mono,
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
    if (shouldTruncate && linesSoFar >= MAX_COLLAPSED_LINES) break;
    items.push({ type: "hunk", hunk: hunks[h], key: "h" + h });
    for (var l = 0; l < hunks[h].lines.length; l++) {
      if (shouldTruncate && linesSoFar >= MAX_COLLAPSED_LINES) break;
      items.push({ type: "line", line: hunks[h].lines[l], key: "h" + h + "l" + l });
      linesSoFar++;
    }
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
            color: theme.accent.primary,
            cursor: "pointer",
            borderTop: "1px solid " + theme.border.subtle,
            background: alpha(theme.accent.primary, 0.03),
          }}
        >
          {expanded
            ? <><Icon name="chevron-up" size={12} style={{ display: "inline" }} /> Collapse</>
            : <><Icon name="chevron-down" size={12} style={{ display: "inline" }} /> Show all {totalLines} lines ({totalLines - MAX_COLLAPSED_LINES} more)</>}
        </div>
      )}
    </div>
  );
}
