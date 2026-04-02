/**
 * SteeringView — The narrative view: tells the story of a repo AND its sessions.
 *
 * Merges git history with session-level narrative into a unified Scribe-style
 * timeline. Git entries show the repo's evolution; session entries show
 * steering moments, level-ups, and mistakes from the loaded AI session.
 */

import { useState, useMemo, useEffect, useRef } from "react";
import { theme } from "../lib/theme.js";
import { extractSteering, STEERING_TYPES } from "../lib/steeringExtractor.js";
import { formatTime } from "../lib/formatTime.js";
import ResizablePanel from "./ResizablePanel.jsx";
import Icon from "./Icon.jsx";

// ── Unified type palette (covers both git and session entries) ───────────────

var ENTRY_COLORS = {
  steering:  { color: theme.accent.primary, emoji: "🎯", label: "Steering" },
  milestone: { color: theme.track.reasoning, emoji: "📦", label: "Commit" },
  levelup:   { color: theme.track.reasoning, emoji: "📦", label: "Commit" },
  pivot:     { color: theme.track.reasoning, emoji: "📦", label: "Commit" },
  mistake:   { color: theme.track.reasoning, emoji: "📦", label: "Commit" },
  insight:   { color: theme.track.reasoning, emoji: "💡", label: "Commit" },
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
  var color = isGit ? theme.text.muted : isContributed ? theme.semantic.success : theme.accent.primary;
  var bg = isGit ? theme.bg.raised : isContributed ? theme.semantic.success + "20" : theme.accent.muted;
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

function SteeringRow({ entry, isSelected, onSelect, maxImpact }) {
  var info = ENTRY_COLORS[entry.type] || ENTRY_COLORS.levelup;
  var isPrompt = entry.type === "steering" && (entry.source === "session" || entry.source === "contributed");
  var isCommit = entry.source === "git";
  var lines = entry.impact || entry.linesChanged || 0;
  var turns = entry.impactTurns || 0;
  var impactValue = lines + (turns * 50); // weight turns heavily — each turn ≈ 50 lines of impact
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
              <span style={{ color: theme.accent.primary, marginRight: 6, fontSize: theme.fontSize.xs }}>
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
        color: isPrompt ? theme.accent.primary : theme.text.dim,
        fontSize: theme.fontSize.xs,
        maxWidth: 240,
        lineHeight: 1.4,
      })}>
        {entry.levelUp}
      </td>

      {/* Impact */}
      <td style={Object.assign({}, cellStyle, { width: 90, padding: "6px 8px" })}>
        <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
          {(lines > 0 || turns > 0) && (
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <div style={{
                height: 3,
                width: Math.max(impactPct * 36, 2),
                borderRadius: 2,
                background: isPrompt ? theme.accent.primary : theme.track.reasoning + "50",
              }} />
              <span style={{ fontSize: 9, color: theme.text.ghost, fontFamily: theme.font.mono, whiteSpace: "nowrap" }}>
                {lines > 0 ? (lines > 999 ? Math.round(lines / 1000) + "k" : lines) + "L" : ""}
                {turns > 0 ? " " + turns + "T" : ""}
              </span>
            </div>
          )}
          {entry.tests && (
            <span style={{ fontSize: 9, color: theme.text.ghost, fontFamily: theme.font.mono }}>
              ✓ {entry.tests}
            </span>
          )}
          {entry.levelUp && entry.whatHappened && (
            <span style={{ fontSize: 9, color: entry.levelUp.length > 20 ? theme.accent.primary : theme.text.ghost, fontFamily: theme.font.mono }}>
              {entry.levelUp && entry.whatHappened && entry.steeringCommand ? "A" : "B"}
            </span>
          )}
        </div>
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

      {/* Prior Context — what the assistant said that the user was responding to */}
      {entry.priorContext && (
        <div style={{ marginBottom: theme.space.lg }}>
          <div style={{ fontSize: theme.fontSize.xs, color: theme.text.muted, marginBottom: 4, textTransform: "uppercase", letterSpacing: 1 }}>
            Responding To
          </div>
          <div style={{
            fontSize: theme.fontSize.xs,
            color: theme.text.dim,
            lineHeight: 1.5,
            whiteSpace: "pre-wrap",
            padding: "8px 10px",
            background: theme.bg.base,
            borderRadius: theme.radius.md,
            border: "1px solid " + theme.border.subtle,
            borderLeft: "2px solid " + theme.text.ghost,
            maxHeight: 150,
            overflowY: "auto",
          }}>
            {entry.priorContext}
          </div>
        </div>
      )}

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
            color: theme.text.secondary,
            lineHeight: 1.6,
            whiteSpace: "pre-wrap",
            padding: "10px 12px",
            background: theme.bg.base,
            borderRadius: theme.radius.md,
            border: "1px solid " + theme.border.subtle,
            maxHeight: 400,
            overflowY: "auto",
          }}>
            {entry.assistantResponse}
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

      {/* Commit info (git entries or contributed with resultingCommit) */}
      {(entry.hash || entry.resultingCommit) && (
        <div style={{
          marginTop: theme.space.xl,
          padding: "8px 10px",
          background: theme.bg.base,
          borderRadius: theme.radius.md,
          border: "1px solid " + theme.border.subtle,
        }}>
          <div style={{ fontSize: theme.fontSize.xs, color: theme.accent.primary }}>
            {(entry.hash || entry.resultingCommit || "").substring(0, 8)}
            {entry.author ? " · " + entry.author : ""}
            {entry.commitCount ? " · " + entry.commitCount + " commits" : ""}
            {entry.impact ? " · " + entry.impact + " lines" : ""}
            {entry.tests ? " · tests: " + entry.tests : ""}
          </div>
        </div>
      )}

      {/* Files affected — from curated data or git fetch */}
      {(entry.filesChanged || (files && files.length > 0)) && (
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
            {(entry.filesChanged || files || []).map(function (f, i) {
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
    { id: "steering", label: "🎯 Steering", color: theme.accent.primary, count: counts.steering || 0 },
    { id: "commit", label: "📦 Commits", color: theme.track.reasoning, count: (counts.milestone || 0) + (counts.levelup || 0) + (counts.pivot || 0) + (counts.mistake || 0) + (counts.insight || 0) },
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

function normalizeSessionEntries(sessionEntries, sessionDuration) {
  // Convert session-relative seconds to wall-clock ISO timestamps
  var now = Date.now();
  var durationMs = (sessionDuration || 0) * 1000;

  return sessionEntries.map(function (e) {
    var info = STEERING_TYPES[e.type] || STEERING_TYPES.insight;
    var fullText = (e.type === "steering" || e.type === "pivot") ? (e.detail || e.title) : e.title;
    var command = truncateToSentence(fullText, 110);

    // Convert session-relative time to wall-clock
    var wallTime = new Date(now - durationMs + (e.time || 0) * 1000).toISOString();

    // whatHappened: extract substantive reasoning, skip tool calls and role tags
    var whatHappened = "";
    if (e.assistantResponse) {
      var respLines = e.assistantResponse.split("\n").filter(function (l) {
        var t = l.trim();
        if (t.length < 15) return false;
        if (t.indexOf("Invoking:") === 0) return false;
        if (t.indexOf("Intent logged") !== -1) return false;
        return true;
      });
      // Strip role tag prefixes but keep the content
      var cleaned = respLines.map(function (l) {
        return l.replace(/^>\s*\*\*\[[^\]]+\]\*\*\s*/, "").trim();
      }).filter(function (l) { return l.length > 10; });
      whatHappened = truncateToSentence(cleaned.join(" ").replace(/\s+/g, " "), 200);
    } else if (e.type !== "steering") {
      whatHappened = e.detail || "";
    }

    // Level-up: left empty for steering — the merge step fills it from resulting commit
    var levelUp = "";
    if (e.type === "milestone") {
      levelUp = e.title || "";
    } else if (e.type === "mistake") {
      levelUp = "Error encountered";
    } else if (e.type === "levelup") {
      levelUp = e.title || "Recovered";
    }

    return {
      type: e.type,
      time: wallTime,
      source: "session",
      steeringCommand: command,
      whatHappened: whatHappened,
      assistantResponse: e.assistantResponse || "",
      priorContext: e.priorContext || "",
      levelUp: levelUp,
      impactTurns: e.impactTurns || 0,
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

// ── Main SteeringView ─────────────────────────────────────────────────────────

export default function SteeringView({ events, turns, metadata, onSeek }) {
  var [gitData, setGitData] = useState(null);
  var [gitError, setGitError] = useState(null);
  var [gitLoading, setGitLoading] = useState(true);
  var [steeringLog, setSteeringLog] = useState([]);
  var [selectedEntry, setSelectedEntry] = useState(null);
  var [activeFilters, setActiveFilters] = useState({});
  var [synthesizing, setSynthesizing] = useState(false);
  var [synthResults, setSynthResults] = useState({});

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

  // Compute session duration from events
  var sessionDuration = useMemo(function () {
    if (!events || events.length === 0) return 0;
    return events[events.length - 1].t || 0;
  }, [events]);

  // Extract session-level entries
  var sessionEntries = useMemo(function () {
    return extractSteering(events || [], turns || []);
  }, [events, turns]);

  // Normalize session entries to unified shape
  var normalizedSessionEntries = useMemo(function () {
    return normalizeSessionEntries(sessionEntries, sessionDuration);
  }, [sessionEntries, sessionDuration]);

  // Auto-contribute disabled — produces noise without AI summarization.
  // Steering log is populated via curated .agentviz/steering-v1.jsonl committed to repo.

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

    // For session entries: find the next commit after the session time
    function findResultForSession(sessionTime) {
      var t = new Date(sessionTime).getTime();
      if (isNaN(t)) return null;
      for (var i = 0; i < sortedGit.length; i++) {
        var commitTime = new Date(sortedGit[i].time).getTime();
        if (commitTime > t) {
          return sortedGit[i];
        }
      }
      return null;
    }

    // For contributed entries: find closest commit before contributedAt
    function findResultForContributed(contributedAt) {
      var t = new Date(contributedAt).getTime();
      if (isNaN(t)) return null;
      var best = null;
      for (var i = 0; i < sortedGit.length; i++) {
        var commitTime = new Date(sortedGit[i].time).getTime();
        if (commitTime < t) {
          best = sortedGit[i];
        }
      }
      return best;
    }

    // Track which commits have been claimed so each steering gets a unique result
    var claimedCommits = {};

    var enrichedContributed = contributedEntries.map(function (e) {
      if (e.type !== "steering" && e.type !== "pivot") return e;
      // If curated entry already has levelUp and whatHappened, keep them
      if (e.levelUp && e.whatHappened) return e;
      var result = findResultForContributed(e.contributedAt || e.time);
      if (result && !claimedCommits[result.hash]) {
        claimedCommits[result.hash] = true;
        return Object.assign({}, e, {
          whatHappened: e.whatHappened || truncateToSentence(result.steeringCommand + " (" + result.hash.substring(0, 7) + ")", 200),
          levelUp: e.levelUp || result.levelUp || result.steeringCommand,
          resultingCommit: result.hash,
          impact: result.linesChanged || 0,
        });
      }
      return e;
    });

    var enrichedSession = normalizedSessionEntries.map(function (e) {
      if (e.type !== "steering" && e.type !== "pivot") return e;
      if (e.levelUp && e.whatHappened) return e;
      var result = findResultForSession(e.time);
      if (result && !claimedCommits[result.hash]) {
        claimedCommits[result.hash] = true;
        return Object.assign({}, e, {
          whatHappened: e.whatHappened || truncateToSentence(result.steeringCommand + " (" + result.hash.substring(0, 7) + ")", 200),
          levelUp: e.levelUp || result.levelUp || result.steeringCommand,
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
    // Apply AI synthesis results on top of heuristic data
    return filtered.map(function (e) {
      var synth = synthResults[e.steeringCommand];
      if (synth) {
        return Object.assign({}, e, {
          whatHappened: synth.whatHappened || e.whatHappened,
          levelUp: synth.levelUp || e.levelUp,
        });
      }
      return e;
    });
  }, [allEntries, activeFilters, synthResults]);

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

  function handleSynthesize() {
    if (synthesizing) return;
    // Collect session steering entries that need synthesis
    var toSynthesize = normalizedSessionEntries.filter(function (e) {
      return e.type === "steering" && !synthResults[e.steeringCommand];
    }).slice(0, 15); // cap at 15 to avoid overloading

    if (toSynthesize.length === 0) return;
    setSynthesizing(true);

    fetch("/api/journal/synthesize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        entries: toSynthesize.map(function (e) {
          return {
            steeringCommand: e.steeringCommand,
            assistantResponse: e.assistantResponse ? e.assistantResponse.substring(0, 600) : "",
            resultingCommitMsg: e.levelUp || "",
            linesChanged: e.impact || 0,
          };
        }),
      }),
    })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (data.results) {
        var newResults = Object.assign({}, synthResults);
        Object.keys(data.results).forEach(function (idx) {
          var entry = toSynthesize[parseInt(idx)];
          if (entry) {
            newResults[entry.steeringCommand] = data.results[idx];
          }
        });
        setSynthResults(newResults);
      }
      setSynthesizing(false);
    })
    .catch(function () { setSynthesizing(false); });
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
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 16px" }}>
          <GitFilterBar activeFilters={activeFilters} onToggle={handleToggleFilter} counts={entryCounts} />
          <button
            onClick={handleSynthesize}
            disabled={synthesizing}
            style={{
              padding: "2px 10px",
              background: theme.bg.raised,
              border: "1px solid " + theme.border.default,
              borderRadius: theme.radius.full,
              color: synthesizing ? theme.text.ghost : theme.accent.primary,
              fontFamily: theme.font.mono,
              fontSize: theme.fontSize.xs,
              cursor: synthesizing ? "default" : "pointer",
              whiteSpace: "nowrap",
            }}
          >
            {synthesizing ? "Synthesizing..." : "✨ Synthesize"}
          </button>
        </div>

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
                  <SteeringRow
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
