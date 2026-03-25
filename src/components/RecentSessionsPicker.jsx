import { useState, useEffect, useRef } from "react";
import { theme, alpha } from "../lib/theme.js";
import { formatAutonomyEfficiency } from "../lib/autonomyMetrics.js";
import Icon from "./Icon.jsx";

function formatRelativeDate(isoString) {
  if (!isoString) return "";
  var now = Date.now();
  var then = new Date(isoString).getTime();
  var diffMs = now - then;
  var diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return diffMin + "m ago";
  var diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return diffHr + "h ago";
  var diffDays = Math.floor(diffHr / 24);
  if (diffDays < 7) return diffDays + "d ago";
  return new Date(isoString).toLocaleDateString();
}

function getFormatLabel(format) {
  if (format === "copilot-cli") return "Copilot";
  return "Claude";
}

function getFormatColor(format) {
  if (format === "copilot-cli") return theme.semantic.success;
  return theme.accent.primary;
}

function truncateFilename(file, max) {
  if (!file) return "session";
  var name = file.split("/").pop() || file;
  if (name.length <= max) return name;
  return name.substring(0, max - 3) + "...";
}

export default function RecentSessionsPicker({ entries, onOpen, onClose, currentFile }) {
  var [activeIndex, setActiveIndex] = useState(0);
  var listRef = useRef(null);
  var containerRef = useRef(null);

  var sorted = (entries || [])
    .slice()
    .sort(function (a, b) { return new Date(b.updatedAt || b.importedAt) - new Date(a.updatedAt || a.importedAt); })
    .slice(0, 8);

  useEffect(function () {
    setActiveIndex(0);
  }, [entries]);

  useEffect(function () {
    function handleKey(e) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex(function (i) { return Math.min(i + 1, sorted.length - 1); });
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex(function (i) { return Math.max(i - 1, 0); });
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (sorted[activeIndex]) onOpen(sorted[activeIndex]);
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", handleKey);
    return function () { window.removeEventListener("keydown", handleKey); };
  }, [activeIndex, sorted, onOpen, onClose]);

  useEffect(function () {
    function handleClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        onClose();
      }
    }
    window.addEventListener("mousedown", handleClickOutside);
    return function () { window.removeEventListener("mousedown", handleClickOutside); };
  }, [onClose]);

  return (
    <div
      ref={containerRef}
      style={{
        position: "absolute",
        top: "calc(100% + 8px)",
        right: 0,
        width: 380,
        background: theme.bg.surface,
        border: "1px solid " + theme.border.strong,
        borderRadius: theme.radius.xl,
        boxShadow: theme.shadow.md,
        zIndex: theme.z.tooltip,
        overflow: "hidden",
      }}
    >
      <div style={{
        padding: "10px 14px 8px",
        borderBottom: "1px solid " + theme.border.default,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}>
        <span style={{ fontSize: theme.fontSize.xs, color: theme.text.dim, textTransform: "uppercase", letterSpacing: 2 }}>
          Recent sessions
        </span>
        <span style={{ fontSize: theme.fontSize.xs, color: theme.text.ghost }}>
          {"\u2191\u2193"} navigate &middot; Enter to open
        </span>
      </div>

      <div ref={listRef} style={{ maxHeight: 340, overflowY: "auto" }}>
        {sorted.length === 0 ? (
          <div style={{ padding: "20px 14px", color: theme.text.ghost, fontSize: theme.fontSize.sm, textAlign: "center" }}>
            No sessions imported yet
          </div>
        ) : (
          sorted.map(function (entry, idx) {
            var isActive = idx === activeIndex;
            var isCurrent = Boolean(currentFile && entry.file === currentFile);
            var efficiency = entry.autonomyMetrics && entry.autonomyMetrics.autonomyEfficiency;
            var effLabel = efficiency != null ? formatAutonomyEfficiency(efficiency) : null;

            return (
              <button
                key={entry.id}
                className="av-btn"
                onMouseEnter={function () { if (!isCurrent) setActiveIndex(idx); }}
                onClick={function () { if (!isCurrent) onOpen(entry); }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  width: "100%",
                  padding: "9px 14px",
                  background: isActive && !isCurrent ? alpha(theme.accent.primary, 0.08) : "transparent",
                  border: "none",
                  borderLeft: "2px solid " + (isActive && !isCurrent ? theme.accent.primary : "transparent"),
                  cursor: isCurrent ? "default" : "pointer",
                  textAlign: "left",
                  opacity: isCurrent ? 0.5 : 1,
                }}
              >
                <Icon name="file-text" size={13} style={{ color: getFormatColor(entry.format), flexShrink: 0 }} />

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{
                      fontSize: theme.fontSize.base,
                      color: isActive && !isCurrent ? theme.text.primary : theme.text.secondary,
                      fontFamily: theme.font.mono,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      flex: 1,
                    }}>
                      {truncateFilename(entry.file, 36)}
                    </span>
                    <span style={{
                      fontSize: theme.fontSize.xs,
                      color: getFormatColor(entry.format),
                      border: "1px solid " + alpha(getFormatColor(entry.format), 0.3),
                      borderRadius: theme.radius.full,
                      padding: "1px 6px",
                      flexShrink: 0,
                    }}>
                      {getFormatLabel(entry.format)}
                    </span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 2 }}>
                    <span style={{ fontSize: theme.fontSize.xs, color: theme.text.ghost }}>
                      {formatRelativeDate(entry.updatedAt || entry.importedAt)}
                    </span>
                    {effLabel && (
                      <span style={{ fontSize: theme.fontSize.xs, color: theme.text.dim }}>
                        {effLabel} efficiency
                      </span>
                    )}
                    {entry.totalEvents != null && (
                      <span style={{ fontSize: theme.fontSize.xs, color: theme.text.ghost }}>
                        {entry.totalEvents} events
                      </span>
                    )}
                  </div>
                </div>

                {isCurrent ? (
                  <span style={{ fontSize: theme.fontSize.xs, color: theme.text.ghost, flexShrink: 0 }}>current</span>
                ) : isActive ? (
                  <Icon name="arrow-right" size={12} style={{ color: theme.accent.primary, flexShrink: 0 }} />
                ) : null}
              </button>
            );
          })
        )}
      </div>

      {sorted.length > 0 && (
        <div style={{
          padding: "7px 14px",
          borderTop: "1px solid " + theme.border.default,
          fontSize: theme.fontSize.xs,
          color: theme.text.ghost,
        }}>
          {sorted.length} of {(entries || []).length} sessions &middot; view all in Inbox
        </div>
      )}
    </div>
  );
}
