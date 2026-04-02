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
  steering:  { color: "#6475e8", emoji: "🎯", label: "Steering" },
  milestone: { color: "#94a3b8", emoji: "📦", label: "Commit" },
  levelup:   { color: "#94a3b8", emoji: "📦", label: "Commit" },
  pivot:     { color: "#94a3b8", emoji: "📦", label: "Commit" },
  mistake:   { color: "#94a3b8", emoji: "📦", label: "Commit" },
  insight:   { color: "#94a3b8", emoji: "💡", label: "Commit" },
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

function JournalRow({ entry, isSelected, onSelect, maxImpact }) {
  var info = ENTRY_COLORS[entry.type] || ENTRY_COLORS.levelup;
  var isPrompt = entry.type === "steering" && (entry.source === "session" || entry.source === "contributed");
  var isCommit = entry.source === "git";
  var impactValue = entry.impact || entry.linesChanged || 0;
  var impactPct = maxImpact > 0 ? Math.min(impactValue / maxImpact, 1) : 0;
  var cellStyle = {
    padding: "6px 10px",
    fontSize: theme.fontSize.sm,
    fontFamily: theme.font.mono,
    verticalAlign: "top",
    lineHeight: 1.5,
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
        width: 80,
        fontSize: theme.fontSize.xs,
      })}>
        {formatGitDate(entry.time)}
      </td>

      {/* Steering Command — prompts intense white, commits dimmer with blue hash */}
      <td style={Object.assign({}, cellStyle, {
        color: isPrompt ? theme.text.primary : theme.text.muted,
        fontWeight: isPrompt ? 500 : 400,
        maxWidth: 460,
      })}>
        {isPrompt ? (
          <span style={{ fontStyle: "italic" }}>
            &ldquo;{truncateToSentence(entry.steeringCommand, 110)}&rdquo;
          </span>
        ) : (
          <span>
            {isCommit && entry.hash && (
              <span style={{ color: "#6475e8", marginRight: 6, fontSize: theme.fontSize.xs }}>
                {entry.hash.substring(0, 7)}
              </span>
            )}
            {entry.steeringCommand}
            {entry.author && (
              <span style={{ color: theme.text.ghost, fontWeight: 400, marginLeft: 6, fontSize: theme.fontSize.xs }}>
                — {entry.author}
              </span>
            )}
          </span>
        )}
      </td>

      {/* What Happened */}
      <td style={Object.assign({}, cellStyle, {
        color: theme.text.dim,
        fontSize: theme.fontSize.xs,
        maxWidth: 280,
      })}>
        {entry.whatHappened ? truncateToSentence(entry.whatHappened, 90) : ""}
      </td>

      {/* Level-Up */}
      <td style={Object.assign({}, cellStyle, {
        color: isPrompt ? "#6475e8" : theme.text.dim,
        fontSize: theme.fontSize.xs,
        maxWidth: 240,
        lineHeight: 1.4,
      })}>
        {entry.levelUp}
      </td>

      {/* Impact bar */}
      <td style={Object.assign({}, cellStyle, { width: 60, padding: "6px 8px" })}>
        {impactValue > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <div style={{
              height: 4,
              width: Math.max(impactPct * 40, 2),
              borderRadius: 2,
              background: isPrompt ? "#6475e8" : "#94a3b850",
              transition: "width 200ms ease-out",
            }} />
            <span style={{ fontSize: 9, color: theme.text.ghost, fontFamily: theme.font.mono }}>
              {impactValue > 999 ? Math.round(impactValue / 1000) + "k" : impactValue}
            </span>
          </div>
        )}
      </td>
    </tr>
  );
}

// ── Detail panel for selected entry (git or session) ─────────────────────────

function EntryDetail({ entry, onSeek }) {
  var [files, setFiles] = useState(null);

  // Fetch files affected when a git commit entry is selected
  useEffect(function () {
    setFiles(null);
    if (!entry || !entry.hash) return;
    fetch("/api/journal/commit-files?hash=" + entry.hash)
      .then(function (r) { return r.json(); })
      .then(function (data) { setFiles(data.files || []); })
      .catch(function () { setFiles(null); });
  }, [entry ? entry.hash : null]);
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

      {/* Squad Response (from assistant turn following the steering) */}
      {entry.assistantResponse && (
        <div style={{ marginBottom: theme.space.lg }}>
          <div style={{ fontSize: theme.fontSize.xs, color: theme.text.muted, marginBottom: 4, textTransform: "uppercase", letterSpacing: 1 }}>
            Squad Response
          </div>
          <div style={{
            fontSize: theme.fontSize.xs,
            color: theme.text.dim,
            lineHeight: 1.6,
            whiteSpace: "pre-wrap",
            padding: "8px 10px",
            background: theme.bg.base,
            borderRadius: theme.radius.md,
            border: "1px solid " + theme.border.subtle,
            maxHeight: 200,
            overflowY: "auto",
          }}>
            {entry.assistantResponse.length > 500
              ? entry.assistantResponse.substring(0, 500) + "..."
              : entry.assistantResponse}
          </div>
        </div>
      )}

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
          <div style={{ fontSize: theme.fontSize.xs, color: "#6475e8" }}>
            {entry.hash.slice(0, 8)} · {entry.author}
            {entry.commitCount ? " · " + entry.commitCount + " commits" : ""}
          </div>
        </div>
      )}

      {/* Files affected */}
      {files && files.length > 0 && (
        <div style={{ marginTop: theme.space.lg }}>
          <div style={{ fontSize: theme.fontSize.xs, color: theme.text.muted, marginBottom: 4, textTransform: "uppercase", letterSpacing: 1 }}>
            Files Changed
          </div>
          <div style={{
            fontSize: theme.fontSize.xs,
            fontFamily: theme.font.mono,
            color: theme.text.dim,
            lineHeight: 1.6,
          }}>
            {files.map(function (f, i) {
              return (
                <div key={i}>{f}</div>
              );
            })}
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
      <span style={statStyle}>
        {repo.releases} releases · {repo.features} features · {repo.fixes} fixes · {repo.contributors} contributor{repo.contributors !== 1 ? "s" : ""}
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
  // Simplified: just two filter categories
  var filters = [
    { id: "steering", label: "🎯 Steering", color: "#6475e8", count: counts.steering || 0 },
    { id: "commit", label: "📦 Commits", color: "#94a3b8", count: (counts.milestone || 0) + (counts.levelup || 0) + (counts.pivot || 0) + (counts.mistake || 0) + (counts.insight || 0) },
  ];

  return (
    <div style={{
      display: "flex",
      gap: 4,
      padding: "6px 16px",
      borderBottom: "1px solid " + theme.border.subtle,
      flexShrink: 0,
    }}>
      {filters.map(function (f) {
        if (f.count === 0) return null;
        // For "commit" filter, check if ANY commit type is filtered out
        var isActive = f.id === "steering"
          ? activeFilters.steering !== false
          : activeFilters.milestone !== false && activeFilters.levelup !== false && activeFilters.pivot !== false && activeFilters.mistake !== false;
        return (
          <button
            key={f.id}
            onClick={function () {
              if (f.id === "steering") {
                onToggle("steering");
              } else {
                // Toggle all commit types together
                var newState = !isActive;
                ["milestone", "levelup", "pivot", "mistake", "insight"].forEach(function (t) { onToggle(t, newState); });
              }
            }}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 3,
              padding: "2px 8px",
              background: isActive ? f.color + "15" : "transparent",
              border: "1px solid " + (isActive ? f.color + "35" : theme.border.subtle),
              borderRadius: theme.radius.full,
              color: isActive ? f.color : theme.text.ghost,
              fontFamily: theme.font.mono,
              fontSize: theme.fontSize.xs,
              cursor: "pointer",
              opacity: isActive ? 1 : 0.45,
              transition: "all " + theme.transition.fast,
            }}
          >
            {f.label} <span style={{ opacity: 0.6 }}>{f.count}</span>
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
    // For steering entries, truncate to first sentence for the command column
    var fullText = (e.type === "steering" || e.type === "pivot") ? (e.detail || e.title) : e.title;
    var command = truncateToSentence(fullText, 120);
    return {
      type: e.type,
      time: new Date(Date.now() - (e.time != null ? (86400 - e.time) * 1000 : 0)).toISOString(),
      source: "session",
      steeringCommand: command,
      whatHappened: e.detail,
      assistantResponse: e.assistantResponse || "",
      levelUp: synthesizeSessionLevelUp(e),
      seekTime: e.time,
      turnLabel: "Turn " + e.turnIndex,
      _sortTime: e.time != null ? e.time : 0,
    };
  });
}

function truncateToSentence(text, max) {
  if (!text) return "";
  // Take first sentence
  var first = text.split(/[.!?\n]/)[0].trim();
  if (first.length <= max) return first;
  // Truncate at word boundary
  var truncated = first.substring(0, max);
  var lastSpace = truncated.lastIndexOf(" ");
  if (lastSpace > max * 0.6) truncated = truncated.substring(0, lastSpace);
  return truncated + "...";
}

function synthesizeSessionLevelUp(entry) {
  var text = (entry.detail || entry.title || "").toLowerCase();
  var title = entry.title || "";

  if (entry.type === "steering") {
    if (text.indexOf("instead") !== -1 || text.indexOf("switch") !== -1) return "🔄 **Direction change.** Chose a different path.";
    if (text.indexOf("don't") !== -1 || text.indexOf("stop") !== -1 || text.indexOf("not") !== -1) return "🚫 **Boundary set.** Knowing what NOT to do.";
    if (text.indexOf("try") !== -1 || text.indexOf("actually") !== -1) return "🎯 **Course corrected.** Refined the approach.";
    if (text.indexOf("wrong") !== -1 || text.indexOf("fix") !== -1 || text.indexOf("broken") !== -1) return "🔧 **Quality gate.** Caught an issue, redirected.";
    if (text.indexOf("repo") !== -1 || text.indexOf("git") !== -1) return "📡 **Scope expanded.** Brought repo context in.";
    if (text.indexOf("test") !== -1 || text.indexOf("eval") !== -1) return "✅ **Quality bar raised.** Demanded verification.";
    if (text.indexOf("screenshot") !== -1 || text.indexOf("demo") !== -1) return "📸 **Show don't tell.** Visual proof requested.";
    if (text.indexOf("tone") !== -1 || text.indexOf("brag") !== -1 || text.indexOf("boast") !== -1) return "✍️ **Tone refined.** Taste applied to voice.";
    if (text.indexOf("name") !== -1 || text.indexOf("rename") !== -1 || text.indexOf("call") !== -1) return "🏷️ **Naming matters.** Words shape understanding.";
    return "🎯 **Human steered.** Taste shaped the outcome.";
  }
  if (entry.type === "levelup") {
    if (text.indexOf("recover") !== -1) return "💪 **Recovered.** Bounced back from failure.";
    return "⬆️ **Leveled up.** Overcame a challenge.";
  }
  if (entry.type === "mistake") {
    var snippet = title.substring(0, 35);
    return "❌ **Hit a wall.** " + snippet;
  }
  if (entry.type === "pivot") return "🔄 **Pivot.** Multiple redirections, searching for the right approach.";
  if (entry.type === "milestone") {
    if (text.indexOf("started") !== -1) return "🚀 **Session started.** Intent established.";
    if (text.indexOf("ended") !== -1) return "✅ **Session complete.** Work delivered.";
    return "📦 **Milestone.** Momentum matters.";
  }
  if (entry.type === "insight") {
    var insightSnippet = title.substring(0, 40);
    return "💡 **Discovered.** " + insightSnippet;
  }
  return "📝 Progress made.";
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

  // Normalize contributed steering entries — use contributedAt as the real time
  var contributedEntries = useMemo(function () {
    return steeringLog.map(function (e) {
      return Object.assign({}, e, {
        source: "contributed",
        time: e.contributedAt || e.time,
      });
    });
  }, [steeringLog]);

  // Merge all three sources and link steering to resulting commits
  var allEntries = useMemo(function () {
    var gitEntries = (gitData && gitData.entries) ? gitData.entries.map(function (e) {
      return Object.assign({}, e, { source: "git" });
    }) : [];

    // Sort git entries by time for binary lookup
    var sortedGit = gitEntries.slice().sort(function (a, b) {
      return new Date(a.time).getTime() - new Date(b.time).getTime();
    });

    // For contributed entries: the steering happened BEFORE the commit,
    // but was persisted AFTER. So find the closest feat/milestone commit
    // BEFORE the contributedAt time — that's what the steering produced.
    function findResultForContributed(contributedAt) {
      var t = new Date(contributedAt).getTime();
      if (isNaN(t)) return null;
      var best = null;
      for (var i = 0; i < sortedGit.length; i++) {
        var commitTime = new Date(sortedGit[i].time).getTime();
        if (commitTime < t && (sortedGit[i].type === "levelup" || sortedGit[i].type === "milestone")) {
          best = sortedGit[i]; // keep updating — we want the latest one before contributedAt
        }
      }
      return best;
    }

    // For session entries: find the next commit after the session time
    function findResultForSession(sessionTime) {
      var t = new Date(sessionTime).getTime();
      if (isNaN(t)) return null;
      for (var i = 0; i < sortedGit.length; i++) {
        var commitTime = new Date(sortedGit[i].time).getTime();
        if (commitTime > t && (sortedGit[i].type === "levelup" || sortedGit[i].type === "milestone")) {
          return sortedGit[i];
        }
      }
      return null;
    }

    // Track which commits have been claimed so each steering gets a unique result
    var claimedCommits = {};

    var enrichedContributed = contributedEntries.map(function (e) {
      if (e.type !== "steering" && e.type !== "pivot") return e;
      var result = findResultForContributed(e.contributedAt || e.time);
      if (result && !claimedCommits[result.hash]) {
        claimedCommits[result.hash] = true;
        return Object.assign({}, e, {
          levelUp: "→ " + result.steeringCommand,
          resultingCommit: result.hash,
          impact: result.linesChanged || 0,
        });
      }
      return e;
    });

    var enrichedSession = normalizedSessionEntries.map(function (e) {
      if (e.type !== "steering" && e.type !== "pivot") return e;
      var result = findResultForSession(e.time);
      if (result && !claimedCommits[result.hash]) {
        claimedCommits[result.hash] = true;
        return Object.assign({}, e, {
          levelUp: "→ " + result.steeringCommand,
          resultingCommit: result.hash,
          impact: result.linesChanged || 0,
        });
      }
      return e;
    });

    return gitEntries.concat(enrichedContributed).concat(enrichedSession);
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
    var filtered = allEntries.filter(function (e) {
      return activeFilters[e.type] !== false;
    });
    // Sort newest first
    filtered.sort(function (a, b) {
      return new Date(b.time).getTime() - new Date(a.time).getTime();
    });
    return filtered;
  }, [allEntries, activeFilters]);

  // Compute max impact for bar normalization
  var maxImpact = useMemo(function () {
    var max = 0;
    filteredEntries.forEach(function (e) {
      var v = e.impact || e.linesChanged || 0;
      if (v > max) max = v;
    });
    return max;
  }, [filteredEntries]);

  function handleToggleFilter(typeId, forcedState) {
    setActiveFilters(function (prev) {
      var next = Object.assign({}, prev);
      if (forcedState !== undefined) {
        next[typeId] = forcedState;
      } else {
        next[typeId] = prev[typeId] === false ? true : false;
      }
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
        <RepoSummary repo={gitData ? gitData.repo : null} entryCount={filteredEntries.length} />
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
                <th style={thStyle}>Steering Command</th>
                <th style={thStyle}>What Happened</th>
                <th style={thStyle}>Level-Up 🆙</th>
                <th style={Object.assign({}, thStyle, { width: 60 })}>Impact</th>
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
                    maxImpact={maxImpact}
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
