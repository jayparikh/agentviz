import { useMemo, useState } from "react";
import { theme, alpha } from "../lib/theme.js";
import { formatDurationLong } from "../lib/formatTime.js";
import { formatCost } from "../lib/pricing.js";
import { formatAutonomyEfficiency } from "../lib/autonomyMetrics.js";
import Icon from "./Icon.jsx";

var SORT_OPTIONS = [
  { id: "needs-review", label: "Needs review" },
  { id: "most-active", label: "Most active" },
  { id: "most-expensive", label: "Most expensive" },
  { id: "highest-babysitting", label: "Most human response time" },
  { id: "highest-idle", label: "Highest idle" },
  { id: "most-recent", label: "Most recent" },
];

function sortEntries(entries, sortMode) {
  var sorted = (entries || []).slice();

  sorted.sort(function (left, right) {
    if (sortMode === "most-active") {
      return (right.totalEvents || 0) - (left.totalEvents || 0);
    }

    if (sortMode === "most-expensive") {
      return (right.totalCost || 0) - (left.totalCost || 0);
    }

    if (sortMode === "highest-babysitting") {
      return ((right.autonomyMetrics || {}).babysittingTime || 0) - ((left.autonomyMetrics || {}).babysittingTime || 0);
    }

    if (sortMode === "highest-idle") {
      return ((right.autonomyMetrics || {}).idleTime || 0) - ((left.autonomyMetrics || {}).idleTime || 0);
    }

    if (sortMode === "most-recent") {
      return String(right.updatedAt || "").localeCompare(String(left.updatedAt || ""));
    }

    return (right.reviewScore || 0) - (left.reviewScore || 0)
      || String(right.updatedAt || "").localeCompare(String(left.updatedAt || ""));
  });

  return sorted;
}

function sortByDate(entries) {
  return (entries || []).slice().sort(function (a, b) {
    return String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
  });
}

function renderMeta(entry) {
  var parts = [
    entry.format === "copilot-cli" ? "Copilot CLI" : "Claude Code",
    entry.project || null,
    entry.primaryModel,
    entry.repository,
    entry.branch ? "#" + entry.branch : null,
  ].filter(Boolean);

  return parts.join(" \u00B7 ");
}

function formatFileSize(bytes) {
  if (!bytes) return "";
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

function filterByQuery(entries, q) {
  if (!q) return entries || [];
  return (entries || []).filter(function (e) {
    return (e.file || "").toLowerCase().includes(q)
      || (e.project || "").toLowerCase().includes(q)
      || (e.primaryPrompt || "").toLowerCase().includes(q)
      || (e.repository || "").toLowerCase().includes(q);
  });
}

export default function InboxView({ entries, onOpenSession, maxEntries, onImport }) {
  var [sortMode, setSortMode] = useState("most-recent");
  var [query, setQuery] = useState("");

  var parsedEntries = useMemo(function () {
    return (entries || []).filter(function (e) { return !e.isDiscovered; });
  }, [entries]);

  var discoveredEntries = useMemo(function () {
    return (entries || []).filter(function (e) { return e.isDiscovered; });
  }, [entries]);

  var analyzedCount = parsedEntries.length;
  var discoveredCount = discoveredEntries.length;

  var sortedParsed = useMemo(function () {
    var q = query.trim().toLowerCase();
    var filtered = filterByQuery(parsedEntries, q);
    var sorted = sortEntries(filtered, sortMode);
    return maxEntries ? sorted.slice(0, maxEntries) : sorted;
  }, [parsedEntries, sortMode, query, maxEntries]);

  var [showAllDiscovered, setShowAllDiscovered] = useState(false);

  var sortedDiscovered = useMemo(function () {
    var q = query.trim().toLowerCase();
    var filtered = filterByQuery(discoveredEntries, q);
    var sorted = sortByDate(filtered);
    return showAllDiscovered ? sorted : sorted.slice(0, 15);
  }, [discoveredEntries, query, showAllDiscovered]);

  var totalVisible = sortedParsed.length + sortedDiscovered.length;

  return (
    <div style={{
      flex: 1,
      minHeight: 0,
      background: theme.bg.surface,
      border: "1px solid " + theme.border.default,
      borderRadius: theme.radius.xxl,
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
    }}>
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "10px 12px",
        borderBottom: "1px solid " + theme.border.default,
        flexShrink: 0,
      }}>
        <div style={{ fontSize: theme.fontSize.xs, color: theme.text.dim, textTransform: "uppercase", letterSpacing: 2, marginRight: 4, flexShrink: 0 }}>
          Inbox
        </div>
        {(analyzedCount > 0 || discoveredCount > 0) && (
          <span style={{ fontSize: theme.fontSize.xs, color: theme.text.ghost, flexShrink: 0 }}>
            {analyzedCount > 0 && analyzedCount + " analyzed"}
            {analyzedCount > 0 && discoveredCount > 0 && ", "}
            {discoveredCount > 0 && discoveredCount + " unanalyzed"}
          </span>
        )}
        <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 6, background: theme.bg.base, border: "1px solid " + theme.border.default, borderRadius: theme.radius.md, padding: "4px 8px" }}>
          <Icon name="search" size={12} style={{ color: theme.text.ghost, flexShrink: 0 }} />
          <input
            type="text"
            value={query}
            onChange={function (e) { setQuery(e.target.value); }}
            placeholder="Search sessions..."
            style={{
              background: "transparent",
              border: "none",
              outline: "none",
              color: theme.text.primary,
              fontSize: theme.fontSize.base,
              fontFamily: theme.font.mono,
              width: "100%",
            }}
          />
          {query && (
            <button className="av-btn" aria-label="Clear search" onClick={function () { setQuery(""); }} style={{ background: "transparent", border: "none", color: theme.text.ghost, padding: 0, cursor: "pointer", lineHeight: 1 }}>
              <Icon name="close" size={11} />
            </button>
          )}
        </div>
        <select
          aria-label="Sort inbox sessions"
          value={sortMode}
          onChange={function (event) { setSortMode(event.target.value); }}
          style={{
            background: theme.bg.base,
            color: theme.text.muted,
            border: "1px solid " + theme.border.default,
            borderRadius: theme.radius.md,
            padding: "5px 8px",
            fontSize: theme.fontSize.xs,
            fontFamily: theme.font.ui,
            outline: "none",
            flexShrink: 0,
          }}
        >
          {SORT_OPTIONS.map(function (option) {
            return <option key={option.id} value={option.id}>{option.label}</option>;
          })}
        </select>
        {onImport && (
          <label title="Import a session file" style={{
            display: "flex", alignItems: "center", gap: 4, padding: "5px 8px",
            background: alpha(theme.accent.primary, 0.08), border: "1px solid " + alpha(theme.accent.primary, 0.4),
            borderRadius: theme.radius.md, color: theme.accent.primary, fontSize: theme.fontSize.xs,
            fontFamily: theme.font.ui, cursor: "pointer", flexShrink: 0, userSelect: "none",
          }}>
            <Icon name="upload" size={11} /> Import
            <input type="file" accept=".jsonl" style={{ display: "none" }} onChange={function (e) {
              var file = e.target.files && e.target.files[0];
              if (!file) return;
              var reader = new FileReader();
              reader.onload = function (ev) { onImport(ev.target.result, file.name); };
              reader.readAsText(file);
              e.target.value = "";
            }} />
          </label>
        )}
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
        {totalVisible === 0 && (
          <div style={{
            border: "1px dashed " + theme.border.strong,
            borderRadius: theme.radius.xl,
            padding: "18px 16px",
            color: theme.text.muted,
            lineHeight: 1.8,
            background: alpha(theme.bg.base, 0.4),
          }}>
            {query
              ? "No sessions matching \"" + query + "\""
              : <>Sessions from <span style={{ fontFamily: theme.font.mono, color: theme.text.secondary }}>~/.claude/projects/</span> are auto-discovered when running via CLI. You can also drag and drop a session file to import it.</>
            }
          </div>
        )}

        {sortedParsed.map(function (entry) {
          var autonomy = entry.autonomyMetrics || {};

          return (
            <div
              key={entry.id}
              style={{
                border: "1px solid " + theme.border.default,
                borderRadius: theme.radius.xl,
                padding: "12px 14px",
                background: theme.bg.base,
              }}
            >
              <div style={{ display: "flex", gap: 12, justifyContent: "space-between", alignItems: "flex-start" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: theme.fontSize.base, color: theme.text.primary, fontFamily: theme.font.mono }}>
                    {entry.file}
                  </div>
                  <div style={{ fontSize: theme.fontSize.sm, color: theme.text.muted, marginTop: 4, lineHeight: 1.5 }}>
                    {renderMeta(entry)}
                  </div>
                  {entry.primaryPrompt && (
                    <div style={{ fontSize: theme.fontSize.base, color: theme.text.secondary, marginTop: 8, lineHeight: 1.6 }}>
                      {entry.primaryPrompt}
                    </div>
                  )}
                </div>

                <button
                  className="av-btn"
                  disabled={!entry.hasContent && !entry.discoveredPath}
                  onClick={function () { onOpenSession(entry); }}
                  title={!entry.hasContent && !entry.discoveredPath ? "Session content not cached. Import the file again to reload." : ""}
                  style={{
                    background: (entry.hasContent || entry.discoveredPath) ? alpha(theme.accent.primary, 0.12) : "transparent",
                    color: (entry.hasContent || entry.discoveredPath) ? theme.accent.primary : theme.text.ghost,
                    border: "1px solid " + ((entry.hasContent || entry.discoveredPath) ? theme.accent.primary : theme.border.default),
                    borderRadius: theme.radius.md,
                    padding: "6px 10px",
                    fontSize: theme.fontSize.base,
                    fontFamily: theme.font.ui,
                    cursor: (entry.hasContent || entry.discoveredPath) ? "pointer" : "default",
                    flexShrink: 0,
                  }}
                >
                  Open in Observe
                </button>
              </div>

              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
                {[
                  { label: "Needs review", value: entry.reviewScore != null ? entry.reviewScore.toFixed(1) : "--" },
                  { label: "Autonomy", value: formatAutonomyEfficiency(autonomy.autonomyEfficiency) },
                  { label: "Human response", value: formatDurationLong(autonomy.babysittingTime) },
                  { label: "Idle", value: formatDurationLong(autonomy.idleTime) },
                  { label: "Cost", value: formatCost(entry.totalCost || 0) },
                  { label: "Events", value: String(entry.totalEvents || 0) },
                ].map(function (chip) {
                  return (
                    <div
                      key={chip.label}
                      style={{
                        padding: "4px 8px",
                        borderRadius: theme.radius.full,
                        background: theme.bg.surface,
                        border: "1px solid " + theme.border.default,
                        fontSize: theme.fontSize.xs,
                        color: theme.text.secondary,
                      }}
                    >
                      <span style={{ color: theme.text.muted }}>{chip.label}: </span>
                      <span style={{ color: theme.text.primary }}>{chip.value}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}

        {sortedDiscovered.length > 0 && (
          <>
            <div style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              marginTop: sortedParsed.length > 0 ? 4 : 0,
            }}>
              <div style={{ flex: 1, height: 1, background: theme.border.subtle }} />
              <span style={{ fontSize: theme.fontSize.xs, color: theme.text.ghost, textTransform: "uppercase", letterSpacing: 1, flexShrink: 0 }}>
                Discovered ({sortedDiscovered.length}, not yet analyzed)
              </span>
              <div style={{ flex: 1, height: 1, background: theme.border.subtle }} />
            </div>

            {sortedDiscovered.map(function (entry) {
              return (
                <div
                  key={entry.id}
                  style={{
                    border: "1px solid " + theme.border.subtle,
                    borderRadius: theme.radius.xl,
                    padding: "10px 14px",
                    background: alpha(theme.bg.base, 0.5),
                  }}
                >
                  <div style={{ display: "flex", gap: 12, justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: theme.fontSize.base, color: theme.text.secondary, fontFamily: theme.font.mono }}>
                        {entry.file}
                      </div>
                      <div style={{ fontSize: theme.fontSize.sm, color: theme.text.ghost, marginTop: 4 }}>
                        {[
                          entry.format === "copilot-cli" ? "Copilot CLI" : "Claude Code",
                          entry.project || null,
                          formatFileSize(entry.size),
                        ].filter(Boolean).join(" \u00B7 ")}
                      </div>
                    </div>

                    <button
                      className="av-btn"
                      onClick={function () { onOpenSession(entry); }}
                      style={{
                        background: alpha(theme.accent.primary, 0.08),
                        color: theme.accent.primary,
                        border: "1px solid " + alpha(theme.accent.primary, 0.4),
                        borderRadius: theme.radius.md,
                        padding: "5px 10px",
                        fontSize: theme.fontSize.sm,
                        fontFamily: theme.font.ui,
                        cursor: "pointer",
                        flexShrink: 0,
                      }}
                    >
                      Analyze
                    </button>
                  </div>
                </div>
              );
            })}

            {!showAllDiscovered && discoveredEntries.length > 15 && (
              <button
                className="av-btn"
                onClick={function () { setShowAllDiscovered(true); }}
                style={{
                  width: "100%",
                  padding: "8px",
                  background: "transparent",
                  border: "1px dashed " + theme.border.default,
                  borderRadius: theme.radius.lg,
                  color: theme.text.dim,
                  fontSize: theme.fontSize.sm,
                  fontFamily: theme.font.ui,
                  cursor: "pointer",
                  marginTop: 4,
                }}
              >
                Show {discoveredEntries.length - 15} more discovered sessions
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
