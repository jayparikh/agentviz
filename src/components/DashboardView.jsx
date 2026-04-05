import { useMemo, useState } from "react";
import { theme, alpha } from "../lib/theme.js";
import { formatDurationLong } from "../lib/formatTime.js";
import { formatCost } from "../lib/pricing.js";
import { formatAutonomyEfficiency, getNeedsReviewScore } from "../lib/autonomyMetrics.js";
import Icon from "./Icon.jsx";
import usePersistentState from "../hooks/usePersistentState.js";

var SORT_OPTIONS = [
  { id: "needs-review", label: "Needs review" },
  { id: "most-recent", label: "Most recent" },
  { id: "most-expensive", label: "Most expensive" },
  { id: "most-active", label: "Most active" },
];

var FORMAT_OPTIONS = [
  { id: "all", label: "All clients" },
  { id: "claude-code", label: "Claude Code" },
  { id: "copilot-cli", label: "Copilot CLI" },
  { id: "vscode-chat", label: "VS Code" },
];

function healthColor(entry) {
  if (entry.isDiscovered || entry.reviewScore == null) return theme.border.strong;
  if (entry.reviewScore > 8) return theme.semantic.error;
  if (entry.reviewScore > 3) return theme.semantic.warning;
  return theme.semantic.success;
}

function formatRelativeTime(isoString) {
  if (!isoString) return "";
  var diff = Date.now() - new Date(isoString).getTime();
  var mins = Math.floor(diff / 60000);
  if (mins < 60) return mins <= 1 ? "just now" : mins + "m ago";
  var hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + "h ago";
  var days = Math.floor(hrs / 24);
  if (days < 30) return days + "d ago";
  return Math.floor(days / 30) + "mo ago";
}

function formatLabel(entry) {
  if (entry.format === "copilot-cli") return "Copilot CLI";
  if (entry.format === "vscode-chat") return entry.isInsiders ? "VS Code Insiders" : "VS Code";
  return "Claude Code";
}

function sortEntries(entries, sortMode) {
  return entries.slice().sort(function (a, b) {
    if (sortMode === "most-recent") return String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
    if (sortMode === "most-expensive") return (b.totalCost || 0) - (a.totalCost || 0);
    if (sortMode === "most-active") return (b.totalEvents || 0) - (a.totalEvents || 0);
    return (b.reviewScore || 0) - (a.reviewScore || 0)
      || String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
  });
}

function StatCard({ label, value, sub }) {
  return (
    <div style={{
      flex: 1,
      background: theme.bg.surface,
      border: "1px solid " + theme.border.default,
      borderRadius: theme.radius.lg,
      padding: "12px 16px",
      minWidth: 120,
    }}>
      <div style={{ fontSize: theme.fontSize.xxl, fontFamily: theme.font.mono, color: theme.text.primary, lineHeight: 1 }}>
        {value}
      </div>
      <div style={{ fontSize: theme.fontSize.xs, color: theme.text.dim, marginTop: 4 }}>{label}</div>
      {sub && <div style={{ fontSize: theme.fontSize.xs, color: theme.text.muted, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function SessionCard({ entry, onClick }) {
  var [hovered, setHovered] = useState(false);
  var autonomy = entry.autonomyMetrics || {};
  var isDiscovered = entry.isDiscovered;
  var color = healthColor(entry);

  var title = entry.primaryPrompt || entry.project || entry.file || entry.filename || "Untitled";
  var metaLine = [formatLabel(entry), entry.project || entry.repository || null]
    .filter(Boolean).join(" \u00B7 ");

  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={function () { setHovered(true); }}
      onMouseLeave={function () { setHovered(false); }}
      style={{
        display: "flex",
        flexDirection: "column",
        background: hovered ? theme.bg.hover : theme.bg.surface,
        border: "1px solid " + (hovered ? theme.border.strong : theme.border.default),
        borderRadius: theme.radius.lg,
        padding: 0,
        overflow: "hidden",
        cursor: "pointer",
        textAlign: "left",
        transition: "background " + theme.transition.fast + ", border-color " + theme.transition.fast,
        width: "100%",
        opacity: isDiscovered ? 0.7 : 1,
      }}
    >
      {/* health color bar */}
      <div style={{ height: 3, background: color, flexShrink: 0 }} />

      <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 6, flex: 1 }}>
        {/* header row */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
          <div style={{
            fontSize: theme.fontSize.xs,
            color: theme.text.muted,
          }}>
            {metaLine}
          </div>
          <div style={{ fontSize: theme.fontSize.xs, color: theme.text.dim, flexShrink: 0 }}>
            {formatRelativeTime(entry.updatedAt || entry.importedAt)}
          </div>
        </div>

        {/* title / prompt */}
        <div style={{
          fontSize: theme.fontSize.md,
          color: theme.text.primary,
          fontFamily: theme.font.mono,
          overflow: "hidden",
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          lineHeight: 1.4,
        }}>
          {title}
        </div>

        {/* metrics row */}
        {isDiscovered ? (
          <div style={{ fontSize: theme.fontSize.xs, color: theme.text.dim, marginTop: "auto" }}>
            Not yet analyzed
          </div>
        ) : (
          <div style={{
            display: "flex",
            gap: 12,
            marginTop: "auto",
            fontSize: theme.fontSize.xs,
            color: theme.text.secondary,
          }}>
            {entry.duration != null && (
              <span>{formatDurationLong(entry.duration)}</span>
            )}
            {entry.totalCost != null && (
              <span>{formatCost(entry.totalCost)}</span>
            )}
            {entry.errorCount != null && entry.errorCount > 0 && (
              <span style={{ color: theme.semantic.error }}>
                {entry.errorCount} {entry.errorCount === 1 ? "error" : "errors"}
              </span>
            )}
            {autonomy.autonomyEfficiency != null && (
              <span style={{ color: theme.text.dim }}>
                {formatAutonomyEfficiency(autonomy.autonomyEfficiency)} auto
              </span>
            )}
          </div>
        )}
      </div>
    </button>
  );
}

export default function DashboardView({ entries, onOpenSession }) {
  var [sortMode, setSortMode] = usePersistentState("agentviz:dashboard-sort", "needs-review");
  var [formatFilter, setFormatFilter] = usePersistentState("agentviz:dashboard-format", "all");
  var [query, setQuery] = useState("");

  var libraryEntries = useMemo(function () {
    return (entries || []).filter(function (e) { return !e.isDiscovered; });
  }, [entries]);

  // Aggregate stats from library entries
  var stats = useMemo(function () {
    if (libraryEntries.length === 0) return null;
    var totalCost = libraryEntries.reduce(function (s, e) { return s + (e.totalCost || 0); }, 0);
    var withAutonomy = libraryEntries.filter(function (e) {
      return e.autonomyMetrics && e.autonomyMetrics.autonomyEfficiency != null;
    });
    var avgAutonomy = withAutonomy.length > 0
      ? withAutonomy.reduce(function (s, e) { return s + e.autonomyMetrics.autonomyEfficiency; }, 0) / withAutonomy.length
      : null;
    var totalErrors = libraryEntries.reduce(function (s, e) { return s + (e.errorCount || 0); }, 0);
    return {
      total: entries.length,
      analyzed: libraryEntries.length,
      avgCost: libraryEntries.length > 0 ? totalCost / libraryEntries.length : 0,
      avgAutonomy: avgAutonomy,
      totalErrors: totalErrors,
    };
  }, [libraryEntries, entries]);

  var filtered = useMemo(function () {
    var q = query.trim().toLowerCase();
    var result = entries || [];
    if (formatFilter !== "all") {
      result = result.filter(function (e) { return e.format === formatFilter; });
    }
    if (q) {
      result = result.filter(function (e) {
        return (e.primaryPrompt || "").toLowerCase().includes(q)
          || (e.project || "").toLowerCase().includes(q)
          || (e.repository || "").toLowerCase().includes(q)
          || (e.file || "").toLowerCase().includes(q);
      });
    }
    // Discovered-only always go at the end, sort within each group
    var library = result.filter(function (e) { return !e.isDiscovered; });
    var discovered = result.filter(function (e) { return e.isDiscovered; });
    return sortEntries(library, sortMode).concat(sortEntries(discovered, "most-recent"));
  }, [entries, sortMode, formatFilter, query]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: 12 }}>

      {/* stats bar */}
      {stats && (
        <div style={{ display: "flex", gap: 10, flexShrink: 0 }}>
          <StatCard
            label="sessions"
            value={stats.total}
            sub={stats.analyzed < stats.total ? stats.analyzed + " analyzed" : null}
          />
          <StatCard
            label="avg cost"
            value={stats.analyzed > 0 ? formatCost(stats.avgCost) : "--"}
          />
          <StatCard
            label="avg autonomy"
            value={stats.avgAutonomy != null ? formatAutonomyEfficiency(stats.avgAutonomy) : "--"}
          />
          <StatCard
            label="total errors"
            value={stats.totalErrors}
            sub={stats.totalErrors > 0 ? "across " + stats.analyzed + " sessions" : null}
          />
        </div>
      )}

      {/* filter row */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
        <div style={{ position: "relative", flex: 1 }}>
          <Icon name="search" size={11} style={{
            position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)",
            color: theme.text.dim, pointerEvents: "none",
          }} />
          <input
            type="text"
            placeholder="Search sessions..."
            value={query}
            onChange={function (e) { setQuery(e.target.value); }}
            style={{
              width: "100%",
              boxSizing: "border-box",
              background: theme.bg.surface,
              border: "1px solid " + theme.border.default,
              borderRadius: theme.radius.md,
              padding: "5px 10px 5px 28px",
              fontSize: theme.fontSize.xs,
              fontFamily: theme.font.mono,
              color: theme.text.primary,
              outline: "none",
            }}
          />
        </div>

        <select
          value={formatFilter}
          onChange={function (e) { setFormatFilter(e.target.value); }}
          style={{
            background: theme.bg.surface,
            border: "1px solid " + theme.border.default,
            borderRadius: theme.radius.md,
            padding: "5px 10px",
            fontSize: theme.fontSize.xs,
            fontFamily: theme.font.mono,
            color: theme.text.secondary,
            cursor: "pointer",
            outline: "none",
          }}
        >
          {FORMAT_OPTIONS.map(function (o) {
            return <option key={o.id} value={o.id}>{o.label}</option>;
          })}
        </select>

        <select
          value={sortMode}
          onChange={function (e) { setSortMode(e.target.value); }}
          style={{
            background: theme.bg.surface,
            border: "1px solid " + theme.border.default,
            borderRadius: theme.radius.md,
            padding: "5px 10px",
            fontSize: theme.fontSize.xs,
            fontFamily: theme.font.mono,
            color: theme.text.secondary,
            cursor: "pointer",
            outline: "none",
          }}
        >
          {SORT_OPTIONS.map(function (o) {
            return <option key={o.id} value={o.id}>{o.label}</option>;
          })}
        </select>
      </div>

      {/* card grid */}
      {filtered.length === 0 ? (
        <div style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: theme.text.dim,
          fontSize: theme.fontSize.md,
        }}>
          No sessions found
        </div>
      ) : (
        <div style={{
          flex: 1,
          overflowY: "auto",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
          gap: 10,
          alignContent: "start",
        }}>
          {filtered.map(function (entry) {
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
  );
}
