import { useEffect, useMemo, useRef, useState } from "react";
import { theme, alpha } from "../lib/theme.js";
import { getInspectorDisplay } from "../lib/dataInspector.js";
import SyntaxHighlight from "./SyntaxHighlight.jsx";

function InspectorBadge({ children, color }) {
  return (
    <span style={{
      fontSize: theme.fontSize.xs,
      color: color || theme.text.secondary,
      background: alpha(color || theme.text.secondary, 0.08),
      border: "1px solid " + alpha(color || theme.text.secondary, 0.18),
      borderRadius: theme.radius.full,
      padding: "2px 8px",
      display: "inline-flex",
      alignItems: "center",
      gap: 4,
    }}>
      {children}
    </span>
  );
}

function InspectorButton({ children, onClick, tone }) {
  var color = tone === "error" ? theme.semantic.error : theme.accent.primary;
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        border: "none",
        background: "transparent",
        color: color,
        cursor: "pointer",
        fontSize: theme.fontSize.xs,
        padding: 0,
        fontFamily: theme.font.ui,
      }}
    >
      {children}
    </button>
  );
}

export default function DataInspector({ title, value, maxChars, maxLines }) {
  var [expanded, setExpanded] = useState(false);
  var [copyState, setCopyState] = useState("idle");
  var resetTimerRef = useRef(null);

  var display = useMemo(function () {
    return getInspectorDisplay(value, {
      maxChars: maxChars,
      maxLines: maxLines,
      expanded: expanded,
    });
  }, [value, maxChars, maxLines, expanded]);

  var canCopy = typeof navigator !== "undefined"
    && navigator.clipboard
    && typeof navigator.clipboard.writeText === "function";

  useEffect(function () {
    setExpanded(false);
    setCopyState("idle");
  }, [value, title]);

  useEffect(function () {
    return function () {
      if (resetTimerRef.current) {
        clearTimeout(resetTimerRef.current);
      }
    };
  }, []);

  if (!display.safeText) return null;

  function handleCopy() {
    if (!canCopy) return;
    navigator.clipboard.writeText(display.fullText).then(function () {
      setCopyState("copied");
      if (resetTimerRef.current) {
        clearTimeout(resetTimerRef.current);
      }
      resetTimerRef.current = setTimeout(function () {
        setCopyState("idle");
        resetTimerRef.current = null;
      }, 1500);
    }, function () {
      setCopyState("error");
      if (resetTimerRef.current) {
        clearTimeout(resetTimerRef.current);
      }
      resetTimerRef.current = setTimeout(function () {
        setCopyState("idle");
        resetTimerRef.current = null;
      }, 1500);
    });
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, gap: 8 }}>
        <div style={{ fontSize: theme.fontSize.sm, color: theme.text.dim, textTransform: "uppercase", letterSpacing: 2 }}>
          {title}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {canCopy && (
            <InspectorButton onClick={handleCopy} tone={copyState === "error" ? "error" : "default"}>
              {copyState === "copied" ? "Copied" : (copyState === "error" ? "Copy failed" : "Copy")}
            </InspectorButton>
          )}
          {(display.truncatedByLines || display.truncatedByChars) && (
            <InspectorButton onClick={function () { setExpanded(function (current) { return !current; }); }}>
              {expanded ? "Collapse" : "Expand"}
            </InspectorButton>
          )}
        </div>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
        <InspectorBadge color={theme.track.context}>{display.typeLabel}</InspectorBadge>
        {display.countLabel && (
          <InspectorBadge>{display.countLabel}</InspectorBadge>
        )}
        <InspectorBadge>{display.lineCount.toLocaleString()} line{display.lineCount === 1 ? "" : "s"}</InspectorBadge>
        <InspectorBadge>{display.charCount.toLocaleString()} char{display.charCount === 1 ? "" : "s"}</InspectorBadge>
      </div>

      {display.keysPreview.length > 0 && (
        <div style={{
          fontSize: theme.fontSize.sm,
          color: theme.text.muted,
          marginBottom: 8,
          lineHeight: 1.5,
          wordBreak: "break-word",
        }}>
          Keys: <span style={{ color: theme.text.secondary, fontFamily: theme.font.mono }}>{display.keysPreview.join(", ")}</span>
          {display.countLabel && display.keysPreview.length < parseInt(display.countLabel, 10) && " ..."}
        </div>
      )}

      <SyntaxHighlight text={display.visibleText} />

      {(display.truncatedByLines || display.truncatedByChars) && (
        <div style={{
          marginTop: 8,
          fontSize: theme.fontSize.xs,
          color: theme.text.muted,
          lineHeight: 1.5,
        }}>
          {display.truncatedByChars && (
            <div>Preview trimmed to the first {display.safeText.length.toLocaleString()} characters.</div>
          )}
          {display.truncatedByLines && !expanded && (
            <div>Showing the first {maxLines || 20} lines. Expand to see more.</div>
          )}
        </div>
      )}
    </div>
  );
}
