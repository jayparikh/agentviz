/**
 * JournalView — The narrative view: tells the story of a repo's evolution.
 *
 * Fetches git history from the backend and renders it as a Scribe-style
 * timeline table with steering commands, what happened, and level-up moments.
 * Also shows session-level narrative when a session is loaded.
 */

import { useState, useMemo, useEffect } from "react";
import { theme } from "../lib/theme.js";
import { extractJournal, computeJournalStats, JOURNAL_TYPES } from "../lib/journalExtractor.js";
import ResizablePanel from "./ResizablePanel.jsx";

// ── Type colors for git entries ──────────────────────────────────────────────

var GIT_COLORS = {
  milestone: { color: "#a78bfa", emoji: "✅", label: "Release" },
  levelup:   { color: "#10d97a", emoji: "🆙", label: "Feature" },
  pivot:     { color: "#eab308", emoji: "🔄", label: "Refactor" },
  mistake:   { color: "#f43f5e", emoji: "❌", label: "Fix" },
};

// ── Format git date to readable string ───────────────────────────────────────

function formatGitDate(isoDate) {
  if (!isoDate) return "";
  try {
    var d = new Date(isoDate);
    var month = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][d.getMonth()];
    return month + " " + d.getDate() + ", " + d.getHours().toString().padStart(2, "0") + ":" + d.getMinutes().toString().padStart(2, "0");
  } catch (e) {
    return isoDate.slice(0, 16);
  }
}

function formatGitDay(isoDate) {
  if (!isoDate) return "";
  try {
    var d = new Date(isoDate);
    var month = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][d.getMonth()];
    return month + " " + d.getDate();
  } catch (e) {
    return "";
  }
}

// ── Type badge ───────────────────────────────────────────────────────────────

function TypeBadge({ type, source }) {
  var info = source === "git" ? (GIT_COLORS[type] || GIT_COLORS.levelup) : (JOURNAL_TYPES[type] || JOURNAL_TYPES.insight);
  return (
    <span style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 3,
      fontSize: theme.fontSize.xs,
      fontFamily: theme.font.mono,
      color: info.color,
      background: info.color + "15",
      border: "1px solid " + info.color + "30",
      borderRadius: theme.radius.full,
      padding: "1px 7px",
      whiteSpace: "nowrap",
      fontWeight: 600,
      letterSpacing: 0.3,
    }}>
      <span>{info.emoji}</span>
      <span>{info.label}</span>
    </span>
  );
}

// ── Scribe-style timeline table row ──────────────────────────────────────────

function JournalRow({ entry, isSelected, onSelect }) {
  var info = GIT_COLORS[entry.type] || GIT_COLORS.levelup;
  var cellStyle = {
    padding: "8px 10px",
    fontSize: theme.fontSize.sm,
    fontFamily: theme.font.mono,
    verticalAlign: "top",
    lineHeight: 1.6,
    borderBottom: "1px solid " + theme.border.subtle,
  };

  return (
    <tr
      onClick={function () { onSelect(entry); }}
      style={{
        cursor: "pointer",
        background: isSelected ? theme.bg.active : "transparent",
        transition: "background " + theme.transition.fast,
      }}
      onMouseEnter={function (e) { if (!isSelected) e.currentTarget.style.background = theme.bg.hover; }}
      onMouseLeave={function (e) { if (!isSelected) e.currentTarget.style.background = isSelected ? theme.bg.active : "transparent"; }}
    >
      {/* Time */}
      <td style={Object.assign({}, cellStyle, {
        color: theme.text.dim,
        whiteSpace: "nowrap",
        width: 90,
        fontSize: theme.fontSize.xs,
      })}>
        {formatGitDate(entry.time)}
      </td>

      {/* Type */}
      <td style={Object.assign({}, cellStyle, { width: 90 })}>
        <TypeBadge type={entry.type} source="git" />
      </td>

      {/* Steering Command */}
      <td style={Object.assign({}, cellStyle, {
        color: theme.text.primary,
        fontWeight: 500,
      })}>
        {entry.steeringCommand}
        {entry.author && (
          <span style={{ color: theme.text.ghost, fontWeight: 400, marginLeft: 6, fontSize: theme.fontSize.xs }}>
            — {entry.author}
          </span>
        )}
      </td>

      {/* Level-Up */}
      <td style={Object.assign({}, cellStyle, {
        color: info.color,
        fontStyle: "italic",
        opacity: 0.85,
        maxWidth: 300,
      })}>
        {entry.levelUp}
      </td>
    </tr>
  );
}

// ── Detail panel for selected git entry ──────────────────────────────────────

function GitEntryDetail({ entry }) {
  if (!entry) {
    return (
      <div style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        color: theme.text.dim,
        fontFamily: theme.font.mono,
        fontSize: theme.fontSize.sm,
        gap: 8,
        textAlign: "center",
        padding: theme.space.xl,
      }}>
        <span style={{ fontSize: 28, opacity: 0.4 }}>📖</span>
        <span>Click a row to see details</span>
      </div>
    );
  }

  var info = GIT_COLORS[entry.type] || GIT_COLORS.levelup;

  return (
    <div style={{
      padding: theme.space.xl,
      fontFamily: theme.font.mono,
      overflowY: "auto",
      height: "100%",
    }}>
      {/* Header */}
      <div style={{ marginBottom: theme.space.lg }}>
        <TypeBadge type={entry.type} source="git" />
        <span style={{ fontSize: theme.fontSize.xs, color: theme.text.dim, marginLeft: 8 }}>
          {formatGitDate(entry.time)}
        </span>
      </div>

      <div style={{
        fontSize: theme.fontSize.lg,
        color: theme.text.primary,
        fontWeight: 600,
        lineHeight: 1.4,
        marginBottom: theme.space.lg,
      }}>
        {entry.steeringCommand}
      </div>

      {/* Accent line */}
      <div style={{
        height: 2,
        background: "linear-gradient(to right, " + info.color + ", transparent)",
        borderRadius: 1,
        marginBottom: theme.space.lg,
        opacity: 0.4,
      }} />

      {/* What happened */}
      <div style={{ marginBottom: theme.space.lg }}>
        <div style={{ fontSize: theme.fontSize.xs, color: theme.text.muted, marginBottom: 4, textTransform: "uppercase", letterSpacing: 1 }}>
          What Happened
        </div>
        <div style={{ fontSize: theme.fontSize.sm, color: theme.text.secondary, lineHeight: 1.7 }}>
          {entry.whatHappened}
        </div>
      </div>

      {/* Level-Up */}
      <div style={{ marginBottom: theme.space.lg }}>
        <div style={{ fontSize: theme.fontSize.xs, color: theme.text.muted, marginBottom: 4, textTransform: "uppercase", letterSpacing: 1 }}>
          Level-Up 🆙
        </div>
        <div style={{ fontSize: theme.fontSize.sm, color: info.color, lineHeight: 1.7, fontStyle: "italic" }}>
          {entry.levelUp}
        </div>
      </div>

      {/* Commit info */}
      {entry.hash && (
        <div style={{
          marginTop: theme.space.xl,
          padding: "8px 10px",
          background: theme.bg.base,
          borderRadius: theme.radius.md,
          border: "1px solid " + theme.border.subtle,
        }}>
          <div style={{ fontSize: theme.fontSize.xs, color: theme.text.ghost }}>
            {entry.hash.slice(0, 8)} · {entry.author}
            {entry.commitCount ? " · " + entry.commitCount + " commits" : ""}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Repo summary header ──────────────────────────────────────────────────────

function RepoSummary({ repo, entryCount }) {
  if (!repo) return null;

  var statStyle = {
    fontSize: theme.fontSize.xs,
    fontFamily: theme.font.mono,
    color: theme.text.muted,
  };

  return (
    <div style={{
      padding: "12px 16px",
      borderBottom: "1px solid " + theme.border.subtle,
      display: "flex",
      alignItems: "center",
      gap: 16,
      flexShrink: 0,
    }}>
      <span style={{
        fontSize: theme.fontSize.md,
        fontFamily: theme.font.mono,
        fontWeight: 700,
        color: theme.text.primary,
      }}>
        📖 {repo.name}
      </span>
      <span style={statStyle}>{entryCount} moments</span>
      <span style={{ color: theme.text.ghost, fontSize: theme.fontSize.xs }}>·</span>
      <span style={Object.assign({}, statStyle, { color: GIT_COLORS.milestone.color })}>
        ✅ {repo.releases} releases
      </span>
      <span style={Object.assign({}, statStyle, { color: GIT_COLORS.levelup.color })}>
        🆙 {repo.features} features
      </span>
      <span style={Object.assign({}, statStyle, { color: GIT_COLORS.mistake.color })}>
        ❌ {repo.fixes} fixes
      </span>
      <span style={Object.assign({}, statStyle, { color: theme.text.ghost })}>
        {repo.contributors} contributor{repo.contributors !== 1 ? "s" : ""}
      </span>
      {repo.firstCommit && (
        <span style={Object.assign({}, statStyle, { color: theme.text.ghost, marginLeft: "auto" })}>
          {formatGitDay(repo.firstCommit)} → {formatGitDay(repo.latestCommit)}
        </span>
      )}
    </div>
  );
}

// ── Filter bar ───────────────────────────────────────────────────────────────

function GitFilterBar({ activeFilters, onToggle, counts }) {
  return (
    <div style={{
      display: "flex",
      gap: 4,
      padding: "6px 16px",
      borderBottom: "1px solid " + theme.border.subtle,
      flexShrink: 0,
    }}>
      {Object.keys(GIT_COLORS).map(function (typeId) {
        var info = GIT_COLORS[typeId];
        var count = counts[typeId] || 0;
        if (count === 0) return null;
        var isActive = activeFilters[typeId] !== false;
        return (
          <button
            key={typeId}
            onClick={function () { onToggle(typeId); }}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 3,
              padding: "2px 8px",
              background: isActive ? info.color + "15" : "transparent",
              border: "1px solid " + (isActive ? info.color + "35" : theme.border.subtle),
              borderRadius: theme.radius.full,
              color: isActive ? info.color : theme.text.ghost,
              fontFamily: theme.font.mono,
              fontSize: theme.fontSize.xs,
              cursor: "pointer",
              opacity: isActive ? 1 : 0.45,
              transition: "all " + theme.transition.fast,
            }}
          >
            {info.emoji} {info.label} <span style={{ opacity: 0.6 }}>{count}</span>
          </button>
        );
      })}
    </div>
  );
}

// ── Main JournalView ─────────────────────────────────────────────────────────

export default function JournalView({ events, turns, metadata, onSeek }) {
  var [gitData, setGitData] = useState(null);
  var [gitError, setGitError] = useState(null);
  var [gitLoading, setGitLoading] = useState(true);
  var [selectedEntry, setSelectedEntry] = useState(null);
  var [activeFilters, setActiveFilters] = useState({});

  // Fetch git history from backend
  useEffect(function () {
    setGitLoading(true);
    fetch("/api/journal/git")
      .then(function (res) { return res.json(); })
      .then(function (data) {
        setGitData(data);
        setGitLoading(false);
      })
      .catch(function (err) {
        setGitError(err.message);
        setGitLoading(false);
      });
  }, []);

  // Also extract session-level entries (secondary)
  var sessionEntries = useMemo(function () {
    return extractJournal(events || [], turns || []);
  }, [events, turns]);

  // Git entry counts for filters
  var gitCounts = useMemo(function () {
    if (!gitData || !gitData.entries) return {};
    var c = {};
    gitData.entries.forEach(function (e) {
      c[e.type] = (c[e.type] || 0) + 1;
    });
    return c;
  }, [gitData]);

  // Filtered git entries
  var filteredGitEntries = useMemo(function () {
    if (!gitData || !gitData.entries) return [];
    return gitData.entries.filter(function (e) {
      return activeFilters[e.type] !== false;
    });
  }, [gitData, activeFilters]);

  function handleToggleFilter(typeId) {
    setActiveFilters(function (prev) {
      var next = Object.assign({}, prev);
      next[typeId] = prev[typeId] === false ? true : false;
      return next;
    });
  }

  // Loading state
  if (gitLoading) {
    return (
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        color: theme.text.dim,
        fontFamily: theme.font.mono,
        fontSize: theme.fontSize.sm,
        gap: 8,
      }}>
        <span style={{ fontSize: 20, animation: "spin 1s linear infinite" }}>📖</span>
        <span>Reading repo history...</span>
      </div>
    );
  }

  // Error or no git data
  if (gitError || !gitData || !gitData.entries || gitData.entries.length === 0) {
    return (
      <div style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        color: theme.text.dim,
        fontFamily: theme.font.mono,
        fontSize: theme.fontSize.sm,
        gap: 12,
        textAlign: "center",
      }}>
        <span style={{ fontSize: 40, opacity: 0.4 }}>📖</span>
        <span style={{ fontSize: theme.fontSize.md }}>No repo history found</span>
        <span style={{ color: theme.text.ghost, maxWidth: 400 }}>
          {gitError || "Run agentviz from inside a git repository to see its evolution story"}
        </span>
      </div>
    );
  }

  // Table header style
  var thStyle = {
    padding: "6px 10px",
    fontSize: theme.fontSize.xs,
    fontFamily: theme.font.mono,
    color: theme.text.muted,
    textAlign: "left",
    textTransform: "uppercase",
    letterSpacing: 1,
    borderBottom: "1px solid " + theme.border.default,
    position: "sticky",
    top: 0,
    background: theme.bg.surface,
    zIndex: 1,
  };

  return (
    <ResizablePanel initialSplit={0.65} minPx={300} direction="horizontal" storageKey="agentviz:journal-split">
      {/* Left: Scribe-style timeline table */}
      <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
        <RepoSummary repo={gitData.repo} entryCount={filteredGitEntries.length} />
        <GitFilterBar activeFilters={activeFilters} onToggle={handleToggleFilter} counts={gitCounts} />

        <div style={{ flex: 1, overflowY: "auto" }}>
          <table style={{
            width: "100%",
            borderCollapse: "collapse",
            tableLayout: "auto",
          }}>
            <thead>
              <tr>
                <th style={thStyle}>Time</th>
                <th style={thStyle}>Type</th>
                <th style={thStyle}>Steering Command</th>
                <th style={thStyle}>Level-Up 🆙</th>
              </tr>
            </thead>
            <tbody>
              {filteredGitEntries.map(function (entry, i) {
                return (
                  <JournalRow
                    key={entry.hash + "-" + i}
                    entry={entry}
                    isSelected={selectedEntry === entry}
                    onSelect={setSelectedEntry}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Right: Detail panel */}
      <div style={{
        background: theme.bg.surface,
        borderLeft: "1px solid " + theme.border.subtle,
        height: "100%",
      }}>
        <GitEntryDetail entry={selectedEntry} />
      </div>
    </ResizablePanel>
  );
}
