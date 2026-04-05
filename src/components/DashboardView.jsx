import { useEffect, useMemo, useRef, useState } from "react";
import { theme } from "../lib/theme.js";
import { formatRelativeTime } from "../lib/formatTime.js";
import { formatCost } from "../lib/pricing.js";
import { formatAutonomyEfficiency } from "../lib/autonomyMetrics.js";
import {
  LANDING_FORMAT_OPTIONS,
  LANDING_SORT_OPTIONS,
  filterLandingEntriesByQuery,
  formatLandingClientLabel,
  getLandingEntryDisplayTitle,
  getLandingEntrySecondaryText,
  isLandingSearchShortcut,
  settleLandingRefresh,
  sortDiscoveredLandingEntries,
  sortLandingEntries,
} from "../lib/landingSessions.js";
import Icon from "./Icon.jsx";
import usePersistentState from "../hooks/usePersistentState.js";
import ToolbarButton from "./ui/ToolbarButton.jsx";
import ToolbarSelect from "./ui/ToolbarSelect.jsx";

function healthColor(entry) {
  if (entry.isDiscovered || entry.reviewScore == null) return theme.border.strong;
  if (entry.reviewScore > 8) return theme.semantic.error;
  if (entry.reviewScore > 3) return theme.accent.primary;
  return theme.semantic.success;
}

function uniquePush(parts, value) {
  if (!value) return;
  if (parts.indexOf(value) !== -1) return;
  parts.push(value);
}

function getCardSummary(entry, title) {
  var candidates = [getLandingEntrySecondaryText(entry, title), entry.project, entry.repository];
  for (var i = 0; i < candidates.length; i += 1) {
    var candidate = candidates[i];
    if (!candidate || candidate === title) continue;
    return candidate;
  }
  return null;
}

function buildCardMeta(entry, title) {
  var parts = [];
  uniquePush(parts, formatLandingClientLabel(entry));
  if (entry.project && entry.project !== title) uniquePush(parts, entry.project);
  if (entry.repository && entry.repository !== title) uniquePush(parts, entry.repository);
  if (entry.branch) uniquePush(parts, "#" + entry.branch);
  return parts.join(" \u00B7 ");
}

function StatCard({ label, value, sub }) {
  return (
    <div style={{
      background: theme.bg.base,
      border: "1px solid " + theme.border.default,
      borderRadius: theme.radius.lg,
      padding: "12px 16px",
      minWidth: 0,
    }}>
      <div style={{
        fontSize: theme.fontSize.xxl,
        fontFamily: theme.font.mono,
        color: theme.text.primary,
        lineHeight: 1,
      }}>
        {value}
      </div>
      <div style={{ fontSize: theme.fontSize.xs, color: theme.text.dim, marginTop: 4 }}>
        {label}
      </div>
      {sub && (
        <div style={{ fontSize: theme.fontSize.xs, color: theme.text.muted, marginTop: 2, lineHeight: 1.6 }}>
          {sub}
        </div>
      )}
    </div>
  );
}

function MetricChip({ label, value, tone }) {
  return (
    <span style={{
      padding: "4px 8px",
      borderRadius: theme.radius.full,
      background: theme.bg.base,
      border: "1px solid " + theme.border.default,
      fontSize: theme.fontSize.xs,
      color: theme.text.secondary,
    }}>
      <span style={{ color: theme.text.muted }}>{label}: </span>
      <span style={{ color: tone || theme.text.primary }}>{value}</span>
    </span>
  );
}

function SessionCard({ entry, onClick }) {
  var [hovered, setHovered] = useState(false);
  var autonomy = entry.autonomyMetrics || {};
  var isDiscovered = entry.isDiscovered;
  var title = getLandingEntryDisplayTitle(entry);
  var summary = isDiscovered ? null : getCardSummary(entry, title);
  var meta = buildCardMeta(entry, title);
  var updatedLabel = formatRelativeTime(entry.updatedAt || entry.importedAt);
  var chips = [
    entry.reviewScore != null ? { label: "Needs review", value: entry.reviewScore.toFixed(1) } : null,
    autonomy.autonomyEfficiency != null ? { label: "Autonomy", value: formatAutonomyEfficiency(autonomy.autonomyEfficiency) } : null,
    entry.totalCost != null ? { label: "Cost", value: formatCost(entry.totalCost) } : null,
    { label: "Events", value: String(entry.totalEvents || 0) },
    entry.errorCount > 0 ? { label: "Errors", value: String(entry.errorCount), tone: theme.semantic.error } : null,
  ].filter(Boolean);

  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={function () { setHovered(true); }}
      onMouseLeave={function () { setHovered(false); }}
      onFocus={function () { setHovered(true); }}
      onBlur={function () { setHovered(false); }}
      style={{
        display: "flex",
        flexDirection: "column",
        background: hovered ? theme.bg.hover : theme.bg.surface,
        border: "1px solid " + (hovered ? theme.border.strong : theme.border.default),
        borderRadius: theme.radius.lg,
        padding: "12px 14px 12px 18px",
        overflow: "hidden",
        cursor: "pointer",
        textAlign: "left",
        transition: "background " + theme.transition.fast + ", border-color " + theme.transition.fast,
        width: "100%",
        minHeight: 152,
        minWidth: 0,
        position: "relative",
        appearance: "none",
        WebkitAppearance: "none",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: 3,
          borderRadius: "3px 0 0 3px",
          background: healthColor(entry),
        }}
      />

      <span style={{ display: "flex", flex: 1, flexDirection: "column", gap: 6, minWidth: 0 }}>
        <span style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
          <span style={{
            fontSize: theme.fontSize.base,
            color: isDiscovered ? theme.text.secondary : theme.text.primary,
            fontFamily: theme.font.mono,
            lineHeight: 1.5,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}>
            {title}
          </span>
          <span style={{ fontSize: theme.fontSize.xs, color: theme.text.ghost, flexShrink: 0, marginTop: 1 }}>
            {updatedLabel}
          </span>
        </span>

        {meta && (
          <span style={{
            fontSize: theme.fontSize.sm,
            color: isDiscovered ? theme.text.ghost : theme.text.muted,
            lineHeight: 1.5,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}>
            {meta}
          </span>
        )}

        {summary && (
          <span style={{
            fontSize: theme.fontSize.base,
            color: theme.text.secondary,
            lineHeight: 1.6,
            overflow: "hidden",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            minWidth: 0,
          }}>
            {summary}
          </span>
        )}

        {isDiscovered ? (
          <span style={{ fontSize: theme.fontSize.xs, color: theme.text.dim, marginTop: "auto", opacity: 0.8 }}>
            Not yet analyzed
          </span>
        ) : (
          <span style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: "auto" }}>
            {chips.map(function (chip) {
              return <MetricChip key={chip.label} label={chip.label} value={chip.value} tone={chip.tone} />;
            })}
          </span>
        )}
      </span>
    </button>
  );
}

export default function DashboardView({ entries, onOpenSession, onRefresh }) {
  var [sortMode, setSortMode] = usePersistentState("agentviz:dashboard-sort", "needs-review");
  var [formatFilter, setFormatFilter] = usePersistentState("agentviz:dashboard-format", "all");
  var [query, setQuery] = useState("");
  var [refreshing, setRefreshing] = useState(false);
  var searchRef = useRef(null);

  useEffect(function () {
    function onKey(event) {
      if (!isLandingSearchShortcut(event)) return;
      event.preventDefault();
      if (searchRef.current) searchRef.current.focus();
    }
    document.addEventListener("keydown", onKey);
    return function () { document.removeEventListener("keydown", onKey); };
  }, []);

  var analyzedEntries = useMemo(function () {
    return (entries || []).filter(function (entry) { return !entry.isDiscovered; });
  }, [entries]);

  var stats = useMemo(function () {
    var allEntries = entries || [];
    if (allEntries.length === 0) return null;

    var totalCost = analyzedEntries.reduce(function (sum, entry) {
      return sum + (entry.totalCost || 0);
    }, 0);
    var withAutonomy = analyzedEntries.filter(function (entry) {
      return entry.autonomyMetrics && entry.autonomyMetrics.autonomyEfficiency != null;
    });
    var avgAutonomy = withAutonomy.length > 0
      ? withAutonomy.reduce(function (sum, entry) { return sum + entry.autonomyMetrics.autonomyEfficiency; }, 0) / withAutonomy.length
      : null;
    var totalErrors = analyzedEntries.reduce(function (sum, entry) {
      return sum + (entry.errorCount || 0);
    }, 0);

    return {
      total: allEntries.length,
      analyzed: analyzedEntries.length,
      discovered: allEntries.length - analyzedEntries.length,
      avgCost: analyzedEntries.length > 0 ? totalCost / analyzedEntries.length : null,
      avgAutonomy: avgAutonomy,
      totalErrors: analyzedEntries.length > 0 ? totalErrors : null,
    };
  }, [analyzedEntries, entries]);

  var filteredEntries = useMemo(function () {
    var result = filterLandingEntriesByQuery(entries, query);

    if (formatFilter !== "all") {
      result = result.filter(function (entry) { return entry.format === formatFilter; });
    }

    var analyzed = result.filter(function (entry) { return !entry.isDiscovered; });
    var discovered = result.filter(function (entry) { return entry.isDiscovered; });
    return sortLandingEntries(analyzed, sortMode).concat(sortDiscoveredLandingEntries(discovered));
  }, [entries, sortMode, formatFilter, query]);

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
        flexDirection: "column",
        gap: 12,
        padding: 12,
        borderBottom: "1px solid " + theme.border.default,
        flexShrink: 0,
      }}>
        {stats && (
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: 10,
          }}>
            <StatCard
              label="sessions"
              value={stats.total}
              sub={stats.discovered > 0 ? stats.analyzed + " analyzed, " + stats.discovered + " discovered" : null}
            />
            <StatCard
              label="avg cost"
              value={stats.avgCost != null ? formatCost(stats.avgCost) : "--"}
              sub={stats.analyzed === 0 ? "open sessions to analyze" : null}
            />
            <StatCard
              label="avg autonomy"
              value={stats.avgAutonomy != null ? formatAutonomyEfficiency(stats.avgAutonomy) : "--"}
            />
            <StatCard
              label="total errors"
              value={stats.totalErrors != null ? stats.totalErrors : "--"}
            />
          </div>
        )}

        <div style={{
          display: "flex",
          gap: 8,
          alignItems: "center",
          flexWrap: "wrap",
          position: "relative",
          zIndex: theme.z.active,
        }}>
          <div className="av-search-wrap" style={{ flex: 1, display: "flex", alignItems: "center", gap: 6, background: theme.bg.base, border: "1px solid " + theme.border.default, borderRadius: theme.radius.md, padding: "4px 8px", transition: "border-color 150ms ease-out" }}>
            <Icon name="search" size={13} style={{ color: theme.text.dim, flexShrink: 0 }} />
            <input
              ref={searchRef}
              type="text"
              aria-label="Search sessions"
              placeholder="Search sessions (/)"
              className="av-search"
              value={query}
              onChange={function (event) { setQuery(event.target.value); }}
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
              <button
                type="button"
                className="av-btn"
                aria-label="Clear search"
                onClick={function () { setQuery(""); }}
                style={{ background: "transparent", border: "none", color: theme.text.ghost, padding: 0, cursor: "pointer", lineHeight: 1 }}
              >
                <Icon name="close" size={11} />
              </button>
            )}
          </div>

          <ToolbarSelect
            ariaLabel="Filter dashboard sessions by format"
            value={formatFilter}
            onChange={function (value) { setFormatFilter(value); }}
            options={LANDING_FORMAT_OPTIONS}
            minWidth={140}
            menuWidth={180}
          />

          <ToolbarSelect
            ariaLabel="Sort dashboard sessions"
            value={sortMode}
            onChange={function (value) { setSortMode(value); }}
            options={LANDING_SORT_OPTIONS}
            minWidth={140}
            menuWidth={180}
          />

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
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 12 }}>
        {filteredEntries.length === 0 ? (
          <div style={{
            border: "1px dashed " + theme.border.strong,
            borderRadius: theme.radius.xl,
            padding: "18px 16px",
            minHeight: 180,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            textAlign: "center",
            color: theme.text.dim,
            fontSize: theme.fontSize.md,
            fontFamily: theme.font.mono,
            lineHeight: 1.8,
            background: theme.bg.base,
          }}>
            {query ? "No sessions matching \"" + query + "\"" : "No sessions available yet."}
          </div>
        ) : (
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
            gridAutoRows: "minmax(152px, auto)",
            gap: 10,
            alignContent: "start",
            alignItems: "start",
          }}>
            {filteredEntries.map(function (entry) {
              return (
                <SessionCard
                  key={entry.id}
                  entry={entry}
                  onClick={function () { onOpenSession(entry); }}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
