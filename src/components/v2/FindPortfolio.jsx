import { useMemo, useRef, useState } from "react";
import { theme, alpha } from "../../lib/theme.js";
import { formatRelativeTime } from "../../lib/formatTime.js";
import { formatCostValue, isPremiumRequestUnit } from "../../lib/pricing.js";
import { formatAutonomyEfficiency } from "../../lib/autonomyMetrics.js";
import {
  LANDING_FORMAT_OPTIONS,
  LANDING_SORT_OPTIONS,
  computeVisibleTags,
  filterByTags,
  filterLandingEntriesByQuery,
  formatLandingClientLabel,
  getInitialTagsFromURL,
  getLandingEntryDisplayTitle,
  getLandingEntrySecondaryText,
  getLandingEntryTimestamp,
  settleLandingRefresh,
  sortDiscoveredLandingEntries,
  sortLandingEntries,
} from "../../lib/landingSessions.js";
import usePersistentState from "../../hooks/usePersistentState.js";
import useBreakpoint from "../../hooks/useBreakpoint.js";
import useReducedMotion from "../../hooks/useReducedMotion.js";
import Icon from "../Icon.jsx";
import ToolbarButton from "../ui/ToolbarButton.jsx";
import ToolbarSelect from "../ui/ToolbarSelect.jsx";

function getEntryId(entry) {
  return String(entry && (entry.id || entry.discoveredPath || entry.file || entry.filename));
}

function getEntryTimestamp(entry) {
  return entry && (entry.updatedAt || entry.importedAt || entry.mtime);
}

function canOpenEntry(entry) {
  return Boolean(entry && (entry.hasContent || entry.discoveredPath || entry.isDiscovered));
}

function getReviewTone(entry) {
  if (!entry || entry.isDiscovered || entry.reviewScore == null) return theme.border.strong;
  if (entry.reviewScore > 8) return theme.semantic.error;
  if (entry.reviewScore > 3) return theme.accent.primary;
  return theme.semantic.success;
}

export function buildPortfolioStats(entries) {
  var all = entries || [];
  var analyzed = all.filter(function (entry) { return !entry.isDiscovered; });
  var discovered = all.length - analyzed.length;
  var costEntries = analyzed.filter(function (entry) { return entry.totalCost != null; });
  var costUnits = Array.from(new Set(costEntries.map(function (entry) { return entry.totalCostUnit || "usd"; })));
  var totalCost = costEntries.reduce(function (sum, entry) { return sum + (entry.totalCost || 0); }, 0);
  var totalErrors = analyzed.reduce(function (sum, entry) { return sum + (entry.errorCount || 0); }, 0);
  var reviewable = analyzed.filter(function (entry) { return entry.reviewScore != null; });
  var avgReviewScore = reviewable.length > 0
    ? reviewable.reduce(function (sum, entry) { return sum + entry.reviewScore; }, 0) / reviewable.length
    : null;

  return {
    total: all.length,
    analyzed: analyzed.length,
    discovered: discovered,
    avgCost: costEntries.length > 0 && costUnits.length === 1 ? totalCost / costEntries.length : null,
    avgCostUnit: costUnits.length === 1 ? costUnits[0] : null,
    totalErrors: analyzed.length > 0 ? totalErrors : null,
    avgReviewScore: avgReviewScore,
  };
}

export function getFilteredPortfolioEntries(entries, query, formatFilter, sortMode, activeTags) {
  var filtered = filterLandingEntriesByQuery(entries || [], query);
  if (formatFilter !== "all") {
    filtered = filtered.filter(function (entry) { return entry.format === formatFilter; });
  }
  filtered = filterByTags(filtered, activeTags);

  if (sortMode === "most-recent") {
    return sortLandingEntries(filtered, sortMode);
  }

  var analyzed = filtered.filter(function (entry) { return !entry.isDiscovered; });
  var discovered = filtered.filter(function (entry) { return entry.isDiscovered; });
  return sortLandingEntries(analyzed, sortMode).concat(sortDiscoveredLandingEntries(discovered));
}

function buildActivityMeta(entry, timestamp) {
  var parts = [formatLandingClientLabel(entry)];
  if (entry.project) parts.push(entry.project);
  if (entry.branch) parts.push(entry.branch);
  if (timestamp) parts.push(formatRelativeTime(timestamp));
  return parts.join(" · ");
}

function Stat({ label, value, sub }) {
  return (
    <div style={{
      background: theme.bg.base,
      border: "1px solid " + theme.border.default,
      borderRadius: theme.radius.lg,
      padding: "10px 12px",
      minWidth: 0,
    }}>
      <div style={{ color: theme.text.primary, fontSize: theme.fontSize.xl, fontWeight: 700, lineHeight: 1 }}>
        {value}
      </div>
      <div style={{ color: theme.text.dim, fontSize: theme.fontSize.xs, marginTop: 4 }}>
        {label}
      </div>
      {sub && (
        <div style={{ color: theme.text.muted, fontSize: theme.fontSize.xs, marginTop: 2 }}>
          {sub}
        </div>
      )}
    </div>
  );
}

function MetricChip({ label, value, tone }) {
  return (
    <span style={{
      padding: "2px 8px",
      borderRadius: theme.radius.full,
      border: "1px solid " + theme.border.default,
      background: theme.bg.base,
      color: theme.text.secondary,
      fontSize: theme.fontSize.xs,
      whiteSpace: "nowrap",
    }}>
      <span style={{ color: theme.text.muted }}>{label}: </span>
      <span style={{ color: tone || theme.text.primary }}>{value}</span>
    </span>
  );
}

function PortfolioCard({ entry, layout, selected, onToggleSelected, onOpen }) {
  var title = getLandingEntryDisplayTitle(entry);
  var secondary = getLandingEntrySecondaryText(entry, title);
  var isDiscovered = Boolean(entry.isDiscovered);
  var sourcePath = entry.discoveredPath || null;
  var timestamp = getEntryTimestamp(entry);
  var activityMeta = buildActivityMeta(entry, timestamp);
  var autonomy = entry.autonomyMetrics || {};
  var canOpen = canOpenEntry(entry);
  var metrics = [
    entry.reviewScore != null ? { label: "Review", value: entry.reviewScore.toFixed(1) } : null,
    autonomy.autonomyEfficiency != null ? { label: "Autonomy", value: formatAutonomyEfficiency(autonomy.autonomyEfficiency) } : null,
    entry.totalCost != null ? { label: isPremiumRequestUnit(entry.totalCostUnit) ? "PRU" : "Cost", value: formatCostValue(entry.totalCost, entry.totalCostUnit) } : null,
    entry.errorCount > 0 ? { label: "Errors", value: String(entry.errorCount), tone: theme.semantic.error } : null,
    entry.totalEvents ? { label: "Events", value: String(entry.totalEvents) } : null,
  ].filter(Boolean);

  return (
    <article style={{
      position: "relative",
      minWidth: 0,
      minHeight: layout === "grid" ? 166 : 0,
      background: selected ? alpha(theme.accent.primary, 0.08) : theme.bg.surface,
      border: "1px solid " + (selected ? theme.accent.primary : theme.border.default),
      borderRadius: theme.radius.xl,
      padding: "12px 14px 12px 18px",
      display: "flex",
      flexDirection: layout === "grid" ? "column" : "row",
      gap: theme.space.lg,
      alignItems: layout === "grid" ? "stretch" : "center",
      overflow: "hidden",
    }}
    title={sourcePath || title}
    >
      <span
        aria-hidden="true"
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: 4,
          background: getReviewTone(entry),
        }}
      />

      <label style={{
        display: "flex",
        alignItems: "flex-start",
        gap: theme.space.md,
        flex: 1,
        minWidth: 0,
        cursor: "pointer",
      }}>
        <input
          type="checkbox"
          checked={selected}
          onChange={function () { onToggleSelected(entry); }}
          aria-label={"Select " + title}
          style={{ marginTop: 3, accentColor: theme.accent.primary, flexShrink: 0 }}
        />
        <span style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0, flex: 1 }}>
          <span style={{
            display: "flex",
            justifyContent: "space-between",
            gap: theme.space.lg,
            alignItems: "flex-start",
            minWidth: 0,
          }}>
            <span style={{
              color: theme.text.primary,
              fontFamily: theme.font.mono,
              fontSize: theme.fontSize.md,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              minWidth: 0,
            }}>
              {title}
            </span>
            {timestamp && (
              <span style={{ color: theme.text.ghost, fontSize: theme.fontSize.xs, flexShrink: 0 }}>
                {getLandingEntryTimestamp(entry).slice(0, 10)}
              </span>
            )}
          </span>
          <span style={{ color: theme.text.muted, fontSize: theme.fontSize.sm, lineHeight: 1.5 }}>
            {activityMeta}
          </span>
          {secondary && (
            <span style={{
              color: theme.text.secondary,
              fontSize: theme.fontSize.sm,
              lineHeight: 1.6,
              overflow: "hidden",
              display: "-webkit-box",
              WebkitBoxOrient: "vertical",
              WebkitLineClamp: layout === "grid" ? 2 : 1,
            }}>
              {secondary}
            </span>
          )}
          <span style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: layout === "grid" ? "auto" : 0 }}>
            {isDiscovered ? (
              <MetricChip label="State" value="not analyzed" />
            ) : metrics.length > 0 ? metrics.map(function (metric) {
              return <MetricChip key={metric.label} label={metric.label} value={metric.value} tone={metric.tone} />;
            }) : (
              <MetricChip label="State" value="analyzed" />
            )}
          </span>
        </span>
      </label>

      <button
        type="button"
        className="av-btn"
        disabled={!canOpen}
        onClick={function () { onOpen(entry); }}
        style={{
          alignSelf: layout === "grid" ? "flex-start" : "center",
          flexShrink: 0,
          padding: "5px 10px",
          borderRadius: theme.radius.md,
          border: "1px solid " + (canOpen ? theme.accent.primary : theme.border.default),
          background: canOpen ? theme.accent.muted : "transparent",
          color: canOpen ? theme.accent.primary : theme.text.ghost,
          fontFamily: theme.font.mono,
          fontSize: theme.fontSize.sm,
          cursor: canOpen ? "pointer" : "default",
        }}
      >
        Open
      </button>
    </article>
  );
}

export default function FindPortfolio({
  entries,
  onOpenSession,
  onImport,
  onLoadSample,
  onRefresh,
  onCompareSelected,
  manifestError,
  isManifestMode,
}) {
  var [query, setQuery] = useState("");
  var [refreshing, setRefreshing] = useState(false);
  var [dragActive, setDragActive] = useState(false);
  var [layout, setLayout] = usePersistentState("agentviz:v2:portfolio-layout", "grid");
  var [sortMode, setSortMode] = usePersistentState("agentviz:v2:portfolio-sort", "most-recent");
  var [formatFilter, setFormatFilter] = usePersistentState("agentviz:v2:portfolio-format", "all");
  var [activeTags, setActiveTags] = useState(getInitialTagsFromURL);
  var [selectedIds, setSelectedIds] = useState([]);
  var fileRef = useRef(null);
  var breakpoint = useBreakpoint();
  var prefersReducedMotion = useReducedMotion();

  var allEntries = entries || [];
  var stats = useMemo(function () {
    return buildPortfolioStats(allEntries);
  }, [allEntries]);

  var visibleEntries = useMemo(function () {
    return getFilteredPortfolioEntries(allEntries, query, formatFilter, sortMode, activeTags);
  }, [allEntries, query, formatFilter, sortMode, activeTags]);

  var visibleTags = useMemo(function () {
    return computeVisibleTags(allEntries, activeTags);
  }, [allEntries, activeTags]);

  var selectedEntries = useMemo(function () {
    return allEntries.filter(function (entry) {
      return selectedIds.indexOf(getEntryId(entry)) !== -1;
    });
  }, [allEntries, selectedIds]);

  function toggleSelected(entry) {
    var id = getEntryId(entry);
    setSelectedIds(function (prev) {
      return prev.indexOf(id) === -1 ? prev.concat([id]) : prev.filter(function (item) { return item !== id; });
    });
  }

  function clearSelection() {
    setSelectedIds([]);
  }

  function toggleTag(tag) {
    setActiveTags(function (prev) {
      return prev.indexOf(tag) === -1 ? prev.concat([tag]) : prev.filter(function (item) { return item !== tag; });
    });
  }

  function handleCompareSelected() {
    if (selectedEntries.length < 2 || !onCompareSelected) return;
    onCompareSelected(selectedEntries.slice(0, 2));
  }

  function importFile(file) {
    if (!file || !onImport) return;
    var reader = new FileReader();
    reader.onload = function (readerEvent) {
      onImport(readerEvent.target.result, file.name);
    };
    reader.readAsText(file);
  }

  return (
    <main style={{
      position: "relative",
      flex: 1,
      minWidth: 0,
      minHeight: 0,
      display: "flex",
      flexDirection: "column",
      background: theme.bg.base,
      padding: breakpoint.isCompact ? theme.space.lg : theme.space.xl,
      gap: theme.space.lg,
      overflow: "hidden",
    }}
    onDragEnter={function (event) {
      if (!onImport) return;
      event.preventDefault();
      setDragActive(true);
    }}
    onDragOver={function (event) {
      if (!onImport) return;
      event.preventDefault();
      setDragActive(true);
    }}
    onDragLeave={function (event) {
      if (!event.currentTarget.contains(event.relatedTarget)) setDragActive(false);
    }}
    onDrop={function (event) {
      if (!onImport) return;
      event.preventDefault();
      setDragActive(false);
      var file = event.dataTransfer.files && event.dataTransfer.files[0];
      importFile(file);
    }}>
      {dragActive && (
        <div style={{
          position: "absolute",
          inset: theme.space.lg,
          zIndex: theme.z.overlay,
          border: "1px dashed " + theme.accent.primary,
          borderRadius: theme.radius.xxl,
          background: theme.bg.overlay,
          color: theme.text.primary,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: theme.font.mono,
          fontSize: theme.fontSize.md,
          pointerEvents: "none",
        }}>
          Drop session file to import
        </div>
      )}
      <section style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
        gap: theme.space.md,
        flexShrink: 0,
      }}>
        <Stat label="sessions" value={stats.total} sub={stats.discovered > 0 ? stats.analyzed + " analyzed, " + stats.discovered + " discovered" : null} />
        <Stat label="avg review" value={stats.avgReviewScore != null ? stats.avgReviewScore.toFixed(1) : "--"} />
        <Stat label={isPremiumRequestUnit(stats.avgCostUnit) ? "avg PRU" : "avg cost"} value={stats.avgCost != null ? formatCostValue(stats.avgCost, stats.avgCostUnit) : "--"} />
        <Stat label="errors" value={stats.totalErrors != null ? stats.totalErrors : "--"} />
      </section>

      <section style={{
        background: theme.bg.surface,
        border: "1px solid " + theme.border.default,
        borderRadius: theme.radius.xxl,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        flex: 1,
      }}>
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: theme.space.md,
          padding: theme.space.lg,
          borderBottom: "1px solid " + theme.border.default,
          flexWrap: "wrap",
        }}>
          <div style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            background: theme.bg.base,
            border: "1px solid " + theme.border.default,
            borderRadius: theme.radius.md,
            padding: "5px 8px",
            flex: "1 1 260px",
          }}>
            <Icon name="search" size={13} style={{ color: theme.text.dim, flexShrink: 0 }} />
            <input
              type="text"
              aria-label="Search v2 sessions"
              placeholder="Search sessions"
              value={query}
              onChange={function (event) { setQuery(event.target.value); }}
              style={{
                width: "100%",
                border: "none",
                outline: "none",
                background: "transparent",
                color: theme.text.primary,
                fontFamily: theme.font.mono,
                fontSize: theme.fontSize.sm,
              }}
            />
          </div>

          <ToolbarSelect
            ariaLabel="Filter v2 sessions by format"
            value={formatFilter}
            onChange={setFormatFilter}
            options={LANDING_FORMAT_OPTIONS}
            minWidth={140}
            menuWidth={180}
          />

          <ToolbarSelect
            ariaLabel="Sort v2 sessions"
            value={sortMode}
            onChange={setSortMode}
            options={LANDING_SORT_OPTIONS}
            minWidth={132}
            menuWidth={180}
          />

          <div role="group" aria-label="Portfolio layout" style={{ display: "flex", gap: 2 }}>
            {[
              { id: "grid", label: "Grid", icon: "layout-grid" },
              { id: "list", label: "List", icon: "layout-list" },
            ].map(function (item) {
              var active = layout === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  className="av-btn"
                  aria-pressed={active}
                  onClick={function () { setLayout(item.id); }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    padding: "5px 8px",
                    border: "1px solid " + (active ? theme.accent.primary : theme.border.default),
                    borderRadius: theme.radius.md,
                    background: active ? theme.accent.muted : theme.bg.base,
                    color: active ? theme.accent.primary : theme.text.muted,
                    fontFamily: theme.font.mono,
                    fontSize: theme.fontSize.xs,
                    cursor: "pointer",
                  }}
                >
                  <Icon name={item.icon} size={11} />
                  {item.label}
                </button>
              );
            })}
          </div>

          {onImport && (
            <button
              type="button"
              className="av-btn"
              onClick={function () {
                if (fileRef.current) fileRef.current.click();
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                padding: "5px 8px",
                border: "1px solid " + alpha(theme.accent.primary, 0.4),
                borderRadius: theme.radius.md,
                background: alpha(theme.accent.primary, 0.08),
                color: theme.accent.primary,
                fontFamily: theme.font.mono,
                fontSize: theme.fontSize.xs,
                cursor: "pointer",
              }}
            >
              <Icon name="upload" size={11} />
              Import
            </button>
          )}

          {onLoadSample && (
            <ToolbarButton
              onClick={function () { onLoadSample(); }}
              style={{ padding: "5px 8px", background: theme.bg.base }}
            >
              Demo
            </ToolbarButton>
          )}

          {onRefresh && (
            <ToolbarButton
              aria-label="Rescan v2 session directories"
              disabled={refreshing}
              onClick={function () {
                setRefreshing(true);
                settleLandingRefresh(onRefresh(), function () { setRefreshing(false); });
              }}
              style={{ padding: "5px 8px", background: theme.bg.base }}
            >
              <Icon name="refresh-cw" size={11} style={refreshing && !prefersReducedMotion ? { animation: "spin 0.8s linear infinite" } : undefined} />
            </ToolbarButton>
          )}
        </div>

        {(visibleTags.length > 0 || isManifestMode) && (
          <div style={{
            display: "flex",
            alignItems: "center",
            gap: theme.space.sm,
            padding: "8px " + theme.space.lg + "px",
            borderBottom: "1px solid " + theme.border.default,
            flexWrap: "wrap",
          }}>
            {isManifestMode && (
              <span style={{
                border: "1px solid " + theme.border.default,
                borderRadius: theme.radius.full,
                background: theme.bg.base,
                color: theme.text.muted,
                fontSize: theme.fontSize.xs,
                padding: "2px 8px",
              }}>
                Manifest source
              </span>
            )}
            {visibleTags.length > 0 && (
              <Icon name="tag" size={11} style={{ color: theme.text.ghost, flexShrink: 0 }} />
            )}
            {visibleTags.map(function (tag) {
              var isActive = activeTags.indexOf(tag) !== -1;
              return (
                <button
                  key={tag}
                  type="button"
                  className="av-btn"
                  onClick={function () { toggleTag(tag); }}
                  style={{
                    padding: "2px 8px",
                    borderRadius: theme.radius.full,
                    border: "1px solid " + (isActive ? theme.accent.primary : theme.border.default),
                    background: isActive ? theme.accent.muted : "transparent",
                    color: isActive ? theme.accent.primary : theme.text.muted,
                    fontSize: theme.fontSize.xs,
                    fontFamily: theme.font.mono,
                    cursor: "pointer",
                  }}
                >
                  {tag}
                </button>
              );
            })}
            {activeTags.length > 0 && (
              <button
                type="button"
                className="av-btn"
                onClick={function () { setActiveTags([]); }}
                style={{
                  border: "none",
                  background: "transparent",
                  color: theme.text.ghost,
                  fontSize: theme.fontSize.xs,
                  fontFamily: theme.font.mono,
                  cursor: "pointer",
                  padding: "2px 8px",
                }}
              >
                Clear tags
              </button>
            )}
          </div>
        )}

        {selectedEntries.length > 0 && (
          <div style={{
            display: "flex",
            alignItems: "center",
            gap: theme.space.md,
            padding: "8px " + theme.space.lg + "px",
            borderBottom: "1px solid " + theme.border.default,
            background: alpha(theme.accent.primary, 0.08),
            color: theme.text.secondary,
            fontSize: theme.fontSize.sm,
          }}>
            <span>{selectedEntries.length} selected</span>
            <button
              type="button"
              className="av-btn"
              disabled={selectedEntries.length < 2}
              onClick={handleCompareSelected}
              style={{
                border: "1px solid " + (selectedEntries.length >= 2 ? theme.accent.primary : theme.border.default),
                borderRadius: theme.radius.md,
                background: selectedEntries.length >= 2 ? theme.accent.muted : "transparent",
                color: selectedEntries.length >= 2 ? theme.accent.primary : theme.text.ghost,
                padding: "4px 9px",
                cursor: selectedEntries.length >= 2 ? "pointer" : "default",
                fontFamily: theme.font.mono,
                fontSize: theme.fontSize.xs,
              }}
            >
              Compare selected
            </button>
            <button
              type="button"
              className="av-btn"
              onClick={clearSelection}
              style={{
                border: "none",
                background: "transparent",
                color: theme.text.dim,
                cursor: "pointer",
                fontFamily: theme.font.mono,
                fontSize: theme.fontSize.xs,
              }}
            >
              Clear
            </button>
          </div>
        )}

        <div style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          padding: theme.space.lg,
        }}>
          {manifestError ? (
            <div style={{
              border: "1px solid " + theme.semantic.errorBorder,
              borderRadius: theme.radius.xl,
              background: theme.semantic.errorBg,
              color: theme.semantic.errorText,
              fontSize: theme.fontSize.sm,
              fontFamily: theme.font.mono,
              lineHeight: 1.6,
              padding: theme.space.lg,
              display: "flex",
              gap: theme.space.md,
              alignItems: "flex-start",
            }}>
              <Icon name="alert-circle" size={14} style={{ flexShrink: 0, marginTop: 2 }} />
              <span>{manifestError}</span>
            </div>
          ) : visibleEntries.length === 0 ? (
            <div style={{
              minHeight: 240,
              border: "1px dashed " + theme.border.strong,
              borderRadius: theme.radius.xl,
              background: theme.bg.base,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: theme.space.lg,
              color: theme.text.muted,
              textAlign: "center",
              fontSize: theme.fontSize.sm,
              lineHeight: 1.7,
            }}>
              <div>{query ? "No sessions matching \"" + query + "\"" : isManifestMode ? "No sessions in this manifest." : "No sessions available yet."}</div>
              {onLoadSample && (
                <button
                  type="button"
                  className="av-btn"
                  onClick={onLoadSample}
                  style={{
                    border: "1px solid " + theme.accent.primary,
                    borderRadius: theme.radius.md,
                    background: theme.accent.muted,
                    color: theme.accent.primary,
                    padding: "6px 10px",
                    cursor: "pointer",
                    fontFamily: theme.font.mono,
                  }}
                >
                  Load a demo session
                </button>
              )}
            </div>
          ) : (
            <div style={{
              display: "grid",
              gridTemplateColumns: layout === "grid" ? "repeat(auto-fill, minmax(" + (breakpoint.isCompact ? 240 : 300) + "px, 1fr))" : "1fr",
              gap: theme.space.md,
            }}>
              {visibleEntries.map(function (entry) {
                var id = getEntryId(entry);
                return (
                  <PortfolioCard
                    key={id}
                    entry={entry}
                    layout={layout}
                    selected={selectedIds.indexOf(id) !== -1}
                    onToggleSelected={toggleSelected}
                    onOpen={onOpenSession}
                  />
                );
              })}
            </div>
          )}
        </div>
      </section>

      <input
        ref={fileRef}
        type="file"
        accept=".jsonl,.json,.txt"
        style={{ display: "none" }}
        onChange={function (event) {
          var file = event.target.files && event.target.files[0];
          importFile(file);
          event.target.value = "";
        }}
      />
    </main>
  );
}
