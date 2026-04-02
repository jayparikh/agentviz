/**
 * SteeringView — The narrative view: tells the story of a repo AND its sessions.
 *
 * Merges git history with session-level narrative into a unified Scribe-style
 * timeline. Git entries show the repo's evolution; session entries show
 * steering moments, level-ups, and mistakes from the loaded AI session.
 */

import { useState, useMemo, useEffect, useRef } from "react";
import { theme } from "../lib/theme.js";
import { extractJournal, JOURNAL_TYPES } from "../lib/journalExtractor.js";
import { formatTime } from "../lib/formatTime.js";
import ResizablePanel from "./ResizablePanel.jsx";
import Icon from "./Icon.jsx";

// ── Unified type palette (covers both git and session entries) ───────────────

var ENTRY_COLORS = {
  milestone: { color: "#a78bfa", emoji: "✅", label: "Release" },
  levelup:   { color: "#10d97a", emoji: "🆙", label: "Level-Up" },
  pivot:     { color: "#eab308", emoji: "🔄", label: "Pivot" },
  mistake:   { color: "#f43f5e", emoji: "❌", label: "Fix" },
  steering:  { color: "#6475e8", emoji: "🎯", label: "Steering" },
  insight:   { color: "#06b6d4", emoji: "💡", label: "Insight" },
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

// ── Source badge (Git vs Session) ─────────────────────────────────────────────

function SourceBadge({ source }) {
  var isGit = source === "git";
  var isContributed = source === "contributed";
  var label = isGit ? "git" : isContributed ? "repo log" : "session";
  var color = isGit ? theme.text.muted : isContributed ? "#10d97a" : theme.accent.primary;
  var bg = isGit ? theme.bg.raised : isContributed ? "#10d97a20" : theme.accent.muted;
  return (
    <span style={{
      fontSize: 9,
      fontFamily: theme.font.mono,
      color: color,
      background: bg,
      borderRadius: theme.radius.sm,
      padding: "1px 4px",
      textTransform: "uppercase",
      letterSpacing: 0.5,
      fontWeight: 600,
    }}>
      {label}
    </span>
  );
}

// ── Type badge ───────────────────────────────────────────────────────────────

function TypeBadge({ type }) {
  var info = ENTRY_COLORS[type] || ENTRY_COLORS.levelup;
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
  var info = ENTRY_COLORS[entry.type] || ENTRY_COLORS.levelup;
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

      {/* Source + Type */}
      <td style={Object.assign({}, cellStyle, { width: 110 })}>
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <TypeBadge type={entry.type} />
          <SourceBadge source={entry.source} />
        </div>
      </td>

      {/* Steering Command */}
      <td style={Object.assign({}, cellStyle, {
        color: theme.text.primary,
        fontWeight: 500,
      })}>
        {(entry.source === "session" || entry.source === "contributed") && (entry.type === "steering" || entry.type === "pivot") ? (
          <span style={{ fontStyle: "italic" }}>
            &ldquo;{entry.steeringCommand}&rdquo;
          </span>
        ) : (
          entry.steeringCommand
        )}
        {entry.author && (
          <span style={{ color: theme.text.ghost, fontWeight: 400, marginLeft: 6, fontSize: theme.fontSize.xs }}>
            — {entry.author}
          </span>
        )}
        {entry.turnLabel && (
          <span style={{ color: theme.text.ghost, fontWeight: 400, marginLeft: 6, fontSize: theme.fontSize.xs }}>
            — {entry.turnLabel}
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

// ── Detail panel for selected entry (git or session) ─────────────────────────

function EntryDetail({ entry, onSeek }) {
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

  var info = ENTRY_COLORS[entry.type] || ENTRY_COLORS.levelup;

  return (
    <div style={{
      padding: theme.space.xl,
      fontFamily: theme.font.mono,
      overflowY: "auto",
      height: "100%",
    }}>
      {/* Header */}
      <div style={{ marginBottom: theme.space.lg, display: "flex", alignItems: "center", gap: 8 }}>
        <TypeBadge type={entry.type} />
        <SourceBadge source={entry.source} />
        <span style={{ fontSize: theme.fontSize.xs, color: theme.text.dim }}>
          {formatGitDate(entry.time)}
        </span>
      </div>

      <div style={{
        fontSize: theme.fontSize.lg,
        color: theme.text.primary,
        fontWeight: 600,
        lineHeight: 1.4,
        marginBottom: theme.space.lg,
        fontStyle: ((entry.source === "session" || entry.source === "contributed") && (entry.type === "steering" || entry.type === "pivot")) ? "italic" : "normal",
      }}>
        {(entry.source === "session" || entry.source === "contributed") && (entry.type === "steering" || entry.type === "pivot")
          ? "\u201C" + entry.steeringCommand + "\u201D"
          : entry.steeringCommand}
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
        <div style={{ fontSize: theme.fontSize.sm, color: theme.text.secondary, lineHeight: 1.7, whiteSpace: "pre-wrap" }}>
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

      {/* Commit info (git entries) */}
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

      {/* Seek button (session entries) */}
      {entry.source === "session" && entry.seekTime != null && onSeek && (
        <button
          onClick={function () { onSeek(entry.seekTime); }}
          style={{
            marginTop: theme.space.xl,
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "6px 12px",
            background: theme.bg.raised,
            border: "1px solid " + theme.border.default,
            borderRadius: theme.radius.md,
            color: theme.accent.primary,
            fontFamily: theme.font.mono,
            fontSize: theme.fontSize.xs,
            cursor: "pointer",
            transition: "background " + theme.transition.fast,
          }}
          onMouseEnter={function (e) { e.currentTarget.style.background = theme.bg.hover; }}
          onMouseLeave={function (e) { e.currentTarget.style.background = theme.bg.raised; }}
        >
          <Icon name="play" size={11} />
          Jump to this moment in Replay
        </button>
      )}
    </div>
  );
}

// ── Repo summary header ──────────────────────────────────────────────────────

function RepoSummary({ repo, entryCount, sessionCount, gitCount, contributedCount }) {
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
      {gitCount > 0 && (
        <span style={Object.assign({}, statStyle, { color: theme.text.ghost })}>
          {gitCount} git
        </span>
      )}
      {sessionCount > 0 && (
        <span style={Object.assign({}, statStyle, { color: theme.accent.primary })}>
          {sessionCount} session
        </span>
      )}
      {contributedCount > 0 && (
        <span style={Object.assign({}, statStyle, { color: "#10d97a" })}>
          {contributedCount} contributed
        </span>
      )}
      <span style={{ color: theme.text.ghost, fontSize: theme.fontSize.xs }}>·</span>
      <span style={Object.assign({}, statStyle, { color: ENTRY_COLORS.milestone.color })}>
        ✅ {repo.releases} releases
      </span>
      <span style={Object.assign({}, statStyle, { color: ENTRY_COLORS.levelup.color })}>
        🆙 {repo.features} features
      </span>
      <span style={Object.assign({}, statStyle, { color: ENTRY_COLORS.mistake.color })}>
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
      flexWrap: "wrap",
    }}>
      {Object.keys(ENTRY_COLORS).map(function (typeId) {
        var info = ENTRY_COLORS[typeId];
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

// ── Normalize session entries to unified shape ───────────────────────────────

function normalizeSessionEntries(sessionEntries) {
  return sessionEntries.map(function (e) {
    var info = JOURNAL_TYPES[e.type] || JOURNAL_TYPES.insight;
    // For steering entries, use the full user message as the steering command
    var command = (e.type === "steering" || e.type === "pivot") ? (e.detail || e.title) : e.title;
    return {
      type: e.type,
      time: new Date(Date.now() - (e.time != null ? (86400 - e.time) * 1000 : 0)).toISOString(),
      source: "session",
      steeringCommand: command,
      whatHappened: e.detail,
      levelUp: synthesizeSessionLevelUp(e),
      seekTime: e.time,
      turnLabel: "Turn " + e.turnIndex,
      _sortTime: e.time != null ? e.time : 0,
    };
  });
}

function synthesizeSessionLevelUp(entry) {
  var text = (entry.detail || entry.title || "").toLowerCase();

  if (entry.type === "steering") {
    // Extract specific insight from what they steered toward
    if (text.indexOf("instead") !== -1 || text.indexOf("switch") !== -1) return "Changed direction — chose a different approach";
    if (text.indexOf("don't") !== -1 || text.indexOf("stop") !== -1) return "Set a boundary — knowing what NOT to do is taste";
    if (text.indexOf("try") !== -1 || text.indexOf("actually") !== -1) return "Course correction — refined the approach";
    if (text.indexOf("wrong") !== -1 || text.indexOf("fix") !== -1) return "Quality gate — caught an issue and redirected";
    if (text.indexOf("repo") !== -1 || text.indexOf("git") !== -1) return "Pivoted to repo-level narrative";
    if (text.indexOf("test") !== -1 || text.indexOf("eval") !== -1) return "Raised the quality bar — demanded verification";
    return "Human steered the AI — taste shaped the outcome";
  }
  if (entry.type === "levelup") {
    if (text.indexOf("recover") !== -1) return "Recovered from failure — resilience is a capability";
    return "Overcame a challenge — proved adaptability";
  }
  if (entry.type === "mistake") {
    var errorSnippet = (entry.title || "").substring(0, 40);
    return "Hit a wall: " + errorSnippet + " — learned from it";
  }
  if (entry.type === "pivot") return "Rapid redirections — searching for the right approach";
  if (entry.type === "milestone") {
    if (text.indexOf("started") !== -1) return "Session kicked off — intent established";
    if (text.indexOf("ended") !== -1) return "Session complete — work delivered";
    return "Milestone reached — momentum matters";
  }
  if (entry.type === "insight") {
    var insightSnippet = (entry.title || "").substring(0, 50);
    return "Discovered: " + insightSnippet;
  }
  return "Progress made";
}

// ── Main JournalView ─────────────────────────────────────────────────────────

export default function JournalView({ events, turns, metadata, onSeek }) {
  var [gitData, setGitData] = useState(null);
  var [gitError, setGitError] = useState(null);
  var [gitLoading, setGitLoading] = useState(true);
  var [steeringLog, setSteeringLog] = useState([]);
  var [selectedEntry, setSelectedEntry] = useState(null);
  var [activeFilters, setActiveFilters] = useState({});

  // Fetch git history and steering log from backend
  useEffect(function () {
    setGitLoading(true);
    Promise.all([
      fetch("/api/journal/git").then(function (r) { return r.json(); }).catch(function () { return null; }),
      fetch("/api/journal/steering").then(function (r) { return r.json(); }).catch(function () { return { entries: [] }; }),
    ]).then(function (results) {
      setGitData(results[0]);
      setSteeringLog(results[1] ? results[1].entries : []);
      setGitLoading(false);
    }).catch(function (err) {
      setGitError(err.message);
      setGitLoading(false);
    });
  }, []);

  // Extract session-level entries
  var sessionEntries = useMemo(function () {
    return extractJournal(events || [], turns || []);
  }, [events, turns]);

  // Normalize session entries to unified shape
  var normalizedSessionEntries = useMemo(function () {
    return normalizeSessionEntries(sessionEntries);
  }, [sessionEntries]);

  // Auto-contribute session steering to persistent log (once per session load)
  var hasContributed = useRef(false);
  useEffect(function () {
    if (hasContributed.current) return;
    if (normalizedSessionEntries.length === 0) return;
    if (gitLoading) return; // wait until steering log is loaded

    var steeringToContribute = normalizedSessionEntries.filter(function (e) {
      return e.type === "steering" || e.type === "pivot";
    });
    if (steeringToContribute.length === 0) return;

    // Check which ones are already contributed (by matching steeringCommand text)
    var existingCommands = new Set(steeringLog.map(function (e) { return e.steeringCommand; }));
    var newEntries = steeringToContribute.filter(function (e) {
      return !existingCommands.has(e.steeringCommand);
    });
    if (newEntries.length === 0) {
      hasContributed.current = true;
      return;
    }

    hasContributed.current = true;

    // Contribute each new entry
    Promise.all(newEntries.map(function (entry) {
      return fetch("/api/journal/steering", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: entry.type,
          time: entry.time,
          steeringCommand: entry.steeringCommand,
          whatHappened: entry.whatHappened,
          levelUp: entry.levelUp,
        }),
      });
    })).then(function () {
      // Refresh the steering log
      return fetch("/api/journal/steering").then(function (r) { return r.json(); });
    }).then(function (data) {
      setSteeringLog(data.entries || []);
    }).catch(function () {});
  }, [normalizedSessionEntries, steeringLog, gitLoading]);

  // Normalize contributed steering entries
  var contributedEntries = useMemo(function () {
    return steeringLog.map(function (e) {
      return Object.assign({}, e, { source: "contributed" });
    });
  }, [steeringLog]);

  // Merge all three sources into unified timeline
  var allEntries = useMemo(function () {
    var gitEntries = (gitData && gitData.entries) ? gitData.entries.map(function (e) {
      return Object.assign({}, e, { source: "git" });
    }) : [];
    return gitEntries.concat(contributedEntries).concat(normalizedSessionEntries);
  }, [gitData, contributedEntries, normalizedSessionEntries]);

  // Count by type across all sources
  var entryCounts = useMemo(function () {
    var c = {};
    allEntries.forEach(function (e) {
      c[e.type] = (c[e.type] || 0) + 1;
    });
    return c;
  }, [allEntries]);

  // Filter
  var filteredEntries = useMemo(function () {
    return allEntries.filter(function (e) {
      return activeFilters[e.type] !== false;
    });
  }, [allEntries, activeFilters]);

  // Counts per source
  var sessionCount = normalizedSessionEntries.length;
  var gitCount = (gitData && gitData.entries) ? gitData.entries.length : 0;
  var contributedCount = contributedEntries.length;

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
        <span style={{ fontSize: 20 }}>📖</span>
        <span>Reading repo history...</span>
      </div>
    );
  }

  // No data at all
  if (allEntries.length === 0) {
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
        <span style={{ fontSize: theme.fontSize.md }}>No steering entries found</span>
        <span style={{ color: theme.text.ghost, maxWidth: 400 }}>
          {gitError || "Run agentviz from inside a git repo, or load a session with steering moments"}
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
      {/* Left: Unified timeline table */}
      <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
        <RepoSummary repo={gitData ? gitData.repo : null} entryCount={filteredEntries.length} sessionCount={sessionCount} gitCount={gitCount} contributedCount={contributedCount} />
        <GitFilterBar activeFilters={activeFilters} onToggle={handleToggleFilter} counts={entryCounts} />

        <div style={{ flex: 1, overflowY: "auto" }}>
          <table style={{
            width: "100%",
            borderCollapse: "collapse",
            tableLayout: "auto",
          }}>
            <thead>
              <tr>
                <th style={thStyle}>Time</th>
                <th style={thStyle}>Source</th>
                <th style={thStyle}>Steering Command</th>
                <th style={thStyle}>Level-Up 🆙</th>
              </tr>
            </thead>
            <tbody>
              {filteredEntries.map(function (entry, i) {
                return (
                  <JournalRow
                    key={(entry.hash || entry.type) + "-" + i}
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
        <EntryDetail entry={selectedEntry} onSeek={onSeek} />
      </div>
    </ResizablePanel>
  );
}
