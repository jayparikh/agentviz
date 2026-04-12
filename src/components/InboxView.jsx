import { useMemo, useState, useEffect, useRef } from "react";
import { theme, alpha } from "../lib/theme.js";
import { formatDurationLong } from "../lib/formatTime.js";
import { formatCost } from "../lib/pricing.js";
import { formatAutonomyEfficiency } from "../lib/autonomyMetrics.js";
import {
  LANDING_FORMAT_OPTIONS,
  LANDING_SORT_LABELS,
  formatLandingClientLabel,
  filterLandingEntriesByQuery,
  getLandingEntryDisplayTitle,
  getLandingEntrySecondaryText,
  isLandingSearchShortcut,
  settleLandingRefresh,
  sortDiscoveredLandingEntries,
  sortLandingEntries,
  sortLandingEntriesByDate,
} from "../lib/landingSessions.js";
import Icon from "./Icon.jsx";
import ToolbarButton from "./ui/ToolbarButton.jsx";
import ToolbarSelect from "./ui/ToolbarSelect.jsx";
import usePersistentState from "../hooks/usePersistentState.js";

var SORT_OPTIONS = [
  { id: "needs-review", label: LANDING_SORT_LABELS["needs-review"] },
  { id: "most-active", label: LANDING_SORT_LABELS["most-active"] },
  { id: "most-expensive", label: LANDING_SORT_LABELS["most-expensive"] },
  { id: "highest-babysitting", label: "Most human response time" },
  { id: "highest-idle", label: "Highest idle" },
  { id: "most-recent", label: LANDING_SORT_LABELS["most-recent"] },
];

function sortEntries(entries, sortMode) {
  if (sortMode === "highest-babysitting") {
    return (entries || []).slice().sort(function (left, right) {
      return ((right.autonomyMetrics || {}).babysittingTime || 0) - ((left.autonomyMetrics || {}).babysittingTime || 0);
    });
  }

  if (sortMode === "highest-idle") {
    return (entries || []).slice().sort(function (left, right) {
      return ((right.autonomyMetrics || {}).idleTime || 0) - ((left.autonomyMetrics || {}).idleTime || 0);
    });
  }

  return sortLandingEntries(entries, sortMode);
}

  function sortByDate(entries) {
  return sortDiscoveredLandingEntries(entries);
}

function buildEntryTooltip(entry) {
  if (entry.discoveredPath) return entry.discoveredPath;
  // No path stored; reconstruct a likely location from what we know.
  if (entry.format === "copilot-cli" && entry.sessionId) {
    return "~/.copilot/session-state/" + entry.sessionId + "/events.jsonl";
  }
  if (entry.format === "claude-code" && entry.file) {
    return "~/.claude/projects/.../" + entry.file;
  }
  return entry.id || "";
}

function renderMeta(entry) {
  var parts = [
    formatLandingClientLabel(entry),
    entry.project || null,
    entry.primaryModel,
    entry.repository,
    entry.branch ? "#" + entry.branch : null,
    formatMtime(entry.updatedAt || entry.importedAt) || null,
  ].filter(Boolean);

  return parts.join(" \u00B7 ");
}

function formatFileSize(bytes) {
  if (!bytes) return "";
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

function formatMtime(isoString) {
  if (!isoString) return "";
  var d = new Date(isoString);
  if (isNaN(d.getTime())) return "";
  var mm = String(d.getMonth() + 1).padStart(2, "0");
  var dd = String(d.getDate()).padStart(2, "0");
  var hh = String(d.getHours()).padStart(2, "0");
  var min = String(d.getMinutes()).padStart(2, "0");
  return mm + "-" + dd + " " + hh + ":" + min;
}

function filterByTags(entries, activeTags) {
  if (!activeTags || activeTags.length === 0) return entries;
  return entries.filter(function (e) {
    var entryTags = e.tags || [];
    return activeTags.every(function (tag) {
      return entryTags.indexOf(tag) !== -1;
    });
  });
}

function collectAllTags(entries) {
  var tagSet = {};
  (entries || []).forEach(function (e) {
    (e.tags || []).forEach(function (t) { tagSet[t] = true; });
  });
  return Object.keys(tagSet).sort();
}

// Faceted tags: when tags are active, only show co-occurring tags
// (tags present in sessions that match ALL selected tags).
// Always include activeTags so the user can deselect them.
function computeVisibleTags(entries, activeTags) {
  var base = activeTags.length > 0 ? filterByTags(entries, activeTags) : entries;
  var coTags = collectAllTags(base);
  if (!activeTags || activeTags.length === 0) return coTags;
  var merged = {};
  coTags.forEach(function (t) { merged[t] = true; });
  activeTags.forEach(function (t) { merged[t] = true; });
  return Object.keys(merged).sort();
}

function getInitialTagsFromURL() {
  var params = new URLSearchParams(window.location.search);
  var tags = params.getAll("tag");
  return tags.length > 0 ? tags : [];
}

// Exported for testing
export { filterByTags, collectAllTags, computeVisibleTags, getInitialTagsFromURL };

export default function InboxView({ entries, onOpenSession, onImport, onLoadSample, onStartCompare, onRefresh, manifestError, isManifestMode }) {
  var [sortMode, setSortMode] = usePersistentState("agentviz:inbox-sort", "most-recent");
  var [formatFilter, setFormatFilter] = usePersistentState("agentviz:inbox-format", "all");
  var [query, setQuery] = useState("");
  var [refreshing, setRefreshing] = useState(false);
  var [activeTags, setActiveTags] = useState(getInitialTagsFromURL);
  var searchRef = useRef(null);

  useEffect(function () {
    function onKey(e) {
      if (!isLandingSearchShortcut(e)) return;
      e.preventDefault();
      if (searchRef.current) searchRef.current.focus();
    }
    document.addEventListener("keydown", onKey);
    return function () { document.removeEventListener("keydown", onKey); };
  }, []);

  var allTags = useMemo(function () {
    return computeVisibleTags(entries, activeTags);
  }, [entries, activeTags]);

  function toggleTag(tag) {
    setActiveTags(function (prev) {
      var idx = prev.indexOf(tag);
      if (idx === -1) return prev.concat([tag]);
      return prev.filter(function (t) { return t !== tag; });
    });
  }

  var parsedEntries = useMemo(function () {
    return (entries || []).filter(function (e) { return !e.isDiscovered; });
  }, [entries]);

  var discoveredEntries = useMemo(function () {
    return (entries || []).filter(function (e) { return e.isDiscovered; });
  }, [entries]);

  var analyzedCount = parsedEntries.length;
  var discoveredCount = discoveredEntries.length;

  var sortedParsed = useMemo(function () {
    var filtered = filterLandingEntriesByQuery(parsedEntries, query);
    if (formatFilter !== "all") {
      filtered = filtered.filter(function (e) { return e.format === formatFilter; });
    }
    filtered = filterByTags(filtered, activeTags);
    var sorted = sortEntries(filtered, sortMode);
    return sorted;
  }, [parsedEntries, sortMode, query, formatFilter, activeTags]);

  var [showAllDiscovered, setShowAllDiscovered] = useState(false);

  var filteredDiscovered = useMemo(function () {
    var filtered = filterLandingEntriesByQuery(discoveredEntries, query);
    if (formatFilter !== "all") {
      filtered = filtered.filter(function (e) { return e.format === formatFilter; });
    }
    filtered = filterByTags(filtered, activeTags);
    return sortByDate(filtered);
  }, [discoveredEntries, query, formatFilter, activeTags]);

  var sortedDiscovered = useMemo(function () {
    if (showAllDiscovered) return filteredDiscovered;
    return filteredDiscovered.slice(0, 15);
  }, [filteredDiscovered, showAllDiscovered]);

  var totalFilteredDiscovered = filteredDiscovered.length;

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
        position: "relative",
        zIndex: theme.z.active,
      }}>
        <div style={{ fontSize: theme.fontSize.xs, color: theme.text.dim, textTransform: "uppercase", letterSpacing: 1, marginRight: 4, flexShrink: 0 }}>
          Inbox
        </div>
        {(analyzedCount > 0 || discoveredCount > 0) && (
          <span style={{ fontSize: theme.fontSize.xs, color: theme.text.ghost, flexShrink: 0 }}>
            {analyzedCount > 0 && analyzedCount + " analyzed"}
            {analyzedCount > 0 && discoveredCount > 0 && ", "}
            {discoveredCount > 0 && discoveredCount + " unanalyzed"}
          </span>
        )}
        <div className="av-search-wrap" style={{ flex: 1, display: "flex", alignItems: "center", gap: 6, background: theme.bg.base, border: "1px solid " + theme.border.default, borderRadius: theme.radius.md, padding: "4px 8px", transition: "border-color 150ms ease-out" }}>
          <Icon name="search" size={13} style={{ color: theme.text.dim, flexShrink: 0 }} />
          <input
            ref={searchRef}
            type="text"
            value={query}
            onChange={function (e) { setQuery(e.target.value); }}
            placeholder="Search sessions (/)"
            aria-label="Search sessions"
            className="av-search"
            style={{
              background: "transparent",
              border: "none",
              outline: "none",
              color: theme.text.primary,
              fontSize: theme.fontSize.sm,
              fontFamily: theme.font.mono,
              width: "100%",
            }}
          />
          {query && (
            <button type="button" className="av-btn" aria-label="Clear search" onClick={function () { setQuery(""); }} style={{ background: "transparent", border: "none", color: theme.text.ghost, padding: 0, cursor: "pointer", lineHeight: 1 }}>
              <Icon name="close" size={11} />
            </button>
          )}
        </div>
        <ToolbarSelect
          ariaLabel="Filter by format"
          value={formatFilter}
          onChange={function (format) { setFormatFilter(format); }}
          options={LANDING_FORMAT_OPTIONS}
        />
        <ToolbarSelect
          ariaLabel="Sort inbox sessions"
          value={sortMode}
          onChange={function (mode) { setSortMode(mode); }}
          options={SORT_OPTIONS}
        />
        {onImport && (
          <label title="Import a session file" style={{
            display: "flex", alignItems: "center", gap: 4, padding: "5px 8px",
            background: alpha(theme.accent.primary, 0.08), border: "1px solid " + alpha(theme.accent.primary, 0.4),
            borderRadius: theme.radius.md, color: theme.accent.primary, fontSize: theme.fontSize.xs,
            fontFamily: theme.font.mono, cursor: "pointer", flexShrink: 0, userSelect: "none",
          }}>
            <Icon name="upload" size={11} /> Import
            <input type="file" accept=".jsonl,.json,.txt" style={{ display: "none" }} onChange={function (e) {
              var file = e.target.files && e.target.files[0];
              if (!file) return;
              var reader = new FileReader();
              reader.onload = function (ev) { onImport(ev.target.result, file.name); };
              reader.readAsText(file);
              e.target.value = "";
            }} />
          </label>
        )}
        {onRefresh && (
          <ToolbarButton
            aria-label="Rescan session directories"
            disabled={refreshing}
            onClick={function () {
              setRefreshing(true);
              var result = onRefresh();
              settleLandingRefresh(result, function () {
                setRefreshing(false);
              });
            }}
            style={{
              padding: "4px 8px",
              background: theme.bg.base,
              fontSize: theme.fontSize.xs,
              flexShrink: 0,
            }}
          >
            <Icon name="refresh-cw" size={11} style={refreshing ? { animation: "spin 0.8s linear infinite" } : undefined} />
          </ToolbarButton>
        )}
      </div>

      {allTags.length > 0 && (
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "6px 12px",
          borderBottom: "1px solid " + theme.border.default,
          flexShrink: 0,
          flexWrap: "wrap",
          minHeight: 0,
          maxHeight: 96, /* ~3 rows of tag pills */
          overflowY: "auto",
        }}>
          <Icon name="tag" size={11} style={{ color: theme.text.ghost, flexShrink: 0 }} />
          {allTags.map(function (tag) {
            var isActive = activeTags.indexOf(tag) !== -1;
            return (
              <button
                key={tag}
                className="av-btn"
                onClick={function () { toggleTag(tag); }}
                style={{
                  padding: "2px 8px",
                  borderRadius: theme.radius.full,
                  border: "1px solid " + (isActive ? theme.accent.primary : theme.border.default),
                  background: isActive ? alpha(theme.accent.primary, 0.12) : "transparent",
                  color: isActive ? theme.accent.primary : theme.text.muted,
                  fontSize: theme.fontSize.xs,
                  fontFamily: theme.font.mono,
                  cursor: "pointer",
                  lineHeight: 1.4,
                }}
              >
                {tag}
              </button>
            );
          })}
          {activeTags.length > 0 && (
            <button
              className="av-btn"
              onClick={function () { setActiveTags([]); }}
              style={{
                padding: "2px 6px",
                borderRadius: theme.radius.full,
                border: "none",
                background: "transparent",
                color: theme.text.ghost,
                fontSize: theme.fontSize.xs,
                fontFamily: theme.font.mono,
                cursor: "pointer",
              }}
            >
              clear
            </button>
          )}
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
        {manifestError && (
          <div style={{
            background: theme.semantic.errorBg,
            border: "1px solid " + theme.semantic.error,
            borderRadius: theme.radius.xl,
            padding: "12px 16px",
            fontSize: theme.fontSize.sm,
            color: theme.semantic.errorText,
            fontFamily: theme.font.mono,
            lineHeight: 1.6,
          }}>
            {manifestError}
          </div>
        )}
        {totalVisible === 0 && !manifestError && (
          <div style={{
            border: "1px dashed " + theme.border.strong,
            borderRadius: theme.radius.xl,
            padding: "18px 16px",
            color: theme.text.muted,
            fontSize: theme.fontSize.sm,
            fontFamily: theme.font.mono,
            lineHeight: 1.8,
            background: alpha(theme.bg.base, 0.4),
          }}>
            {query
              ? "No sessions matching \"" + query + "\""
              : <>Claude Code and Copilot CLI sessions under <span style={{ fontFamily: theme.font.mono, color: theme.text.secondary }}>~/.claude/projects/</span> and <span style={{ fontFamily: theme.font.mono, color: theme.text.secondary }}>~/.copilot/session-state/</span>, plus VS Code Copilot Chat sessions under your <span style={{ fontFamily: theme.font.mono, color: theme.text.secondary }}>workspaceStorage/*/chatSessions/</span> directories, are auto-discovered when running via CLI. You can also drag and drop a session file to import it.</>
            }
            {!query && !isManifestMode && (onLoadSample || onStartCompare) && (
              <div style={{ display: "flex", gap: 16, alignItems: "center", marginTop: 12 }}>
                {onLoadSample && (
                  <button
                    type="button"
                    onClick={onLoadSample}
                    style={{
                      color: theme.accent.primary,
                      cursor: "pointer",
                      fontSize: theme.fontSize.sm,
                      fontFamily: theme.font.mono,
                      background: "none",
                      border: "none",
                      padding: 0,
                    }}
                  >
                    load a demo session
                  </button>
                )}
                {onLoadSample && (
                  <span style={{ color: theme.text.ghost, fontSize: theme.fontSize.sm }}>|</span>
                )}
                {onLoadSample && (
                  <button
                    type="button"
                    onClick={function () { onLoadSample("multiagent"); }}
                    style={{
                      color: theme.accent.primary,
                      cursor: "pointer",
                      fontSize: theme.fontSize.sm,
                      fontFamily: theme.font.mono,
                      background: "none",
                      border: "none",
                      padding: 0,
                    }}
                  >
                    load multi-agent demo
                  </button>
                )}
                {onLoadSample && onStartCompare && (
                  <span style={{ color: theme.text.ghost, fontSize: theme.fontSize.sm }}>or</span>
                )}
                {onStartCompare && (
                  <button
                    type="button"
                    onClick={onStartCompare}
                    style={{
                      color: theme.accent.primary,
                      cursor: "pointer",
                      fontSize: theme.fontSize.sm,
                      fontFamily: theme.font.mono,
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                      background: "none",
                      border: "none",
                      padding: 0,
                    }}
                  >
                    <Icon name="arrow-up-down" size={12} /> compare two sessions
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {sortedParsed.map(function (entry) {
          var autonomy = entry.autonomyMetrics || {};
          var canOpen = Boolean(entry.hasContent || entry.discoveredPath);
          var title = getLandingEntryDisplayTitle(entry);
          var secondaryText = getLandingEntrySecondaryText(entry, title);

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
                  <div
                     title={buildEntryTooltip(entry)}
                     style={{ fontSize: theme.fontSize.base, color: theme.text.primary, fontFamily: theme.font.mono }}
                  >
                    {title}
                  </div>
                  <div style={{ fontSize: theme.fontSize.sm, color: theme.text.muted, marginTop: 4, lineHeight: 1.5 }}>
                    {renderMeta(entry)}
                  </div>
                  {secondaryText && (
                    <div style={{ fontSize: theme.fontSize.base, color: theme.text.secondary, marginTop: 8, lineHeight: 1.6 }}>
                      {secondaryText}
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  className="av-btn"
                  disabled={!canOpen}
                  onClick={function () { onOpenSession(entry); }}
                  title={!canOpen ? "Session content not cached. Import the file again to reload." : ""}
                  style={{
                    background: canOpen ? alpha(theme.accent.primary, 0.12) : "transparent",
                    color: canOpen ? theme.accent.primary : theme.text.ghost,
                    border: "1px solid " + (canOpen ? theme.accent.primary : theme.border.default),
                    borderRadius: theme.radius.md,
                    padding: "6px 10px",
                    fontSize: theme.fontSize.base,
                    fontFamily: theme.font.mono,
                    cursor: canOpen ? "pointer" : "default",
                    flexShrink: 0,
                  }}
                >
                  Open
                </button>
              </div>

              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
                {[
                  { label: "Needs review", value: entry.reviewScore != null ? entry.reviewScore.toFixed(1) : "--" },
                  { label: "Autonomy", value: formatAutonomyEfficiency(autonomy.autonomyEfficiency) },
                  { label: "Human response", value: formatDurationLong(autonomy.babysittingTime) },
                  { label: "Idle", value: formatDurationLong(autonomy.idleTime) },
                  { label: "Cost", value: entry.totalCost != null ? formatCost(entry.totalCost) : "--" },
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
                Discovered ({totalFilteredDiscovered}, not yet analyzed)
              </span>
              <div style={{ flex: 1, height: 1, background: theme.border.subtle }} />
            </div>

            {sortedDiscovered.map(function (entry) {
              var title = getLandingEntryDisplayTitle(entry);
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
                      <div
                        title={buildEntryTooltip(entry)}
                        style={{ fontSize: theme.fontSize.base, color: theme.text.secondary, fontFamily: theme.font.mono }}
                      >
                        {title}
                      </div>
                      <div style={{ fontSize: theme.fontSize.sm, color: theme.text.ghost, marginTop: 4 }}>
                        {[
                          formatLandingClientLabel(entry),
                          entry.project || null,
                          formatFileSize(entry.size),
                          formatMtime(entry.updatedAt || entry.importedAt),
                        ].filter(Boolean).join(" \u00B7 ")}
                      </div>
                      {entry.tags && entry.tags.length > 0 && (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
                          {entry.tags.map(function (tag) {
                            var isActive = activeTags.indexOf(tag) !== -1;
                            return (
                              <button
                                key={tag}
                                className="av-btn"
                                onClick={function (e) { e.stopPropagation(); toggleTag(tag); }}
                                style={{
                                  padding: "1px 6px",
                                  borderRadius: theme.radius.full,
                                  border: "1px solid " + (isActive ? theme.accent.primary : theme.border.default),
                                  background: isActive ? alpha(theme.accent.primary, 0.12) : alpha(theme.bg.surface, 0.6),
                                  color: isActive ? theme.accent.primary : theme.text.ghost,
                                  fontSize: theme.fontSize.xs,
                                  fontFamily: theme.font.mono,
                                  cursor: "pointer",
                                  lineHeight: 1.4,
                                }}
                              >
                                {tag}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    <button
                      type="button"
                      className="av-btn"
                      onClick={function () { onOpenSession(entry); }}
                      style={{
                        background: alpha(theme.accent.primary, 0.08),
                        color: theme.accent.primary,
                        border: "1px solid " + alpha(theme.accent.primary, 0.4),
                        borderRadius: theme.radius.md,
                        padding: "5px 10px",
                        fontSize: theme.fontSize.sm,
                        fontFamily: theme.font.mono,
                        cursor: "pointer",
                        flexShrink: 0,
                      }}
                    >
                      Open
                    </button>
                  </div>
                </div>
              );
            })}

            {!showAllDiscovered && totalFilteredDiscovered > 15 && (
              <button
                type="button"
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
                  fontFamily: theme.font.mono,
                  cursor: "pointer",
                  marginTop: 4,
                }}
              >
                Show all discovered sessions
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
