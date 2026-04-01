/**
 * JournalView — The narrative view that tells the story of an AI session.
 *
 * Extracts steering moments, level-ups, pivots, mistakes, and milestones
 * from session data and presents them as a readable, interactive journal.
 */

import { useState, useMemo } from "react";
import { theme } from "../lib/theme.js";
import { formatTime } from "../lib/formatTime.js";
import { extractJournal, computeJournalStats, JOURNAL_TYPES } from "../lib/journalExtractor.js";
import Icon from "./Icon.jsx";
import ResizablePanel from "./ResizablePanel.jsx";

// ── Type badge ───────────────────────────────────────────────────────────────

function TypeBadge({ type }) {
  var info = JOURNAL_TYPES[type] || JOURNAL_TYPES.insight;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontSize: theme.fontSize.xs,
        fontFamily: theme.font.mono,
        color: info.color,
        background: info.color + "18",
        border: "1px solid " + info.color + "30",
        borderRadius: theme.radius.full,
        padding: "2px 8px",
        whiteSpace: "nowrap",
        fontWeight: 600,
        letterSpacing: 0.3,
      }}
    >
      <span>{info.emoji}</span>
      <span>{info.label}</span>
    </span>
  );
}

// ── Summary stat pill ────────────────────────────────────────────────────────

function StatPill({ type, count }) {
  if (count === 0) return null;
  var info = JOURNAL_TYPES[type];
  if (!info) return null;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        fontSize: theme.fontSize.xs,
        fontFamily: theme.font.mono,
        color: info.color,
        opacity: 0.9,
      }}
    >
      <span>{info.emoji}</span>
      <span>{count}</span>
    </span>
  );
}

// ── Journal entry card ───────────────────────────────────────────────────────

function JournalEntry({ entry, isSelected, onSelect, onSeek }) {
  var info = JOURNAL_TYPES[entry.type] || JOURNAL_TYPES.insight;
  var hovered = useState(false);

  return (
    <div
      onClick={function () { onSelect(entry); }}
      onDoubleClick={function () { if (onSeek) onSeek(entry.time); }}
      style={{
        position: "relative",
        padding: "10px 14px",
        marginBottom: 2,
        background: isSelected ? theme.bg.active : "transparent",
        borderLeft: "2px solid " + (isSelected ? info.color : "transparent"),
        cursor: "pointer",
        transition: "background " + theme.transition.fast,
        borderRadius: "0 " + theme.radius.sm + "px " + theme.radius.sm + "px 0",
      }}
      onMouseEnter={function (e) { if (!isSelected) e.currentTarget.style.background = theme.bg.hover; }}
      onMouseLeave={function (e) { if (!isSelected) e.currentTarget.style.background = "transparent"; }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <TypeBadge type={entry.type} />
        <span style={{
          fontSize: theme.fontSize.xs,
          fontFamily: theme.font.mono,
          color: theme.text.dim,
        }}>
          {formatTime(entry.time)}
        </span>
        <span style={{
          fontSize: theme.fontSize.xs,
          fontFamily: theme.font.mono,
          color: theme.text.ghost,
          marginLeft: "auto",
        }}>
          T{entry.turnIndex}
        </span>
      </div>
      <div style={{
        fontSize: theme.fontSize.sm,
        color: theme.text.primary,
        fontFamily: theme.font.mono,
        lineHeight: 1.5,
        fontWeight: 500,
      }}>
        {entry.title}
      </div>
    </div>
  );
}

// ── Detail panel ─────────────────────────────────────────────────────────────

function JournalDetail({ entry, onSeek }) {
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
        <span style={{ fontSize: 28, opacity: 0.5 }}>📖</span>
        <span>Select a journal entry</span>
        <span style={{ fontSize: theme.fontSize.xs, color: theme.text.ghost }}>
          Double-click to seek in Replay
        </span>
      </div>
    );
  }

  var info = JOURNAL_TYPES[entry.type] || JOURNAL_TYPES.insight;

  return (
    <div style={{
      padding: theme.space.xl,
      fontFamily: theme.font.mono,
      overflowY: "auto",
      height: "100%",
    }}>
      {/* Header */}
      <div style={{ marginBottom: theme.space.xl }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <TypeBadge type={entry.type} />
          <span style={{
            fontSize: theme.fontSize.xs,
            color: theme.text.dim,
          }}>
            Turn {entry.turnIndex} · {formatTime(entry.time)}
          </span>
        </div>
        <div style={{
          fontSize: theme.fontSize.lg,
          color: theme.text.primary,
          fontWeight: 600,
          lineHeight: 1.4,
        }}>
          {entry.title}
        </div>
      </div>

      {/* Accent line */}
      <div style={{
        height: 2,
        background: "linear-gradient(to right, " + info.color + ", transparent)",
        borderRadius: 1,
        marginBottom: theme.space.xl,
        opacity: 0.4,
      }} />

      {/* Detail text */}
      <div style={{
        fontSize: theme.fontSize.sm,
        color: theme.text.secondary,
        lineHeight: 1.7,
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
      }}>
        {entry.detail}
      </div>

      {/* Seek button */}
      {onSeek && (
        <button
          onClick={function () { onSeek(entry.time); }}
          style={{
            marginTop: theme.space.xxl,
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
          Jump to this moment
        </button>
      )}
    </div>
  );
}

// ── Timeline connector ───────────────────────────────────────────────────────

function TimelineConnector({ color }) {
  return (
    <div style={{
      position: "absolute",
      left: 22,
      top: 0,
      bottom: 0,
      width: 1,
      background: theme.border.subtle,
      zIndex: 0,
    }} />
  );
}

// ── Filter toolbar ───────────────────────────────────────────────────────────

function FilterBar({ activeFilters, onToggle, stats }) {
  return (
    <div style={{
      display: "flex",
      flexWrap: "wrap",
      gap: 4,
      padding: "8px 14px",
      borderBottom: "1px solid " + theme.border.subtle,
    }}>
      {Object.keys(JOURNAL_TYPES).map(function (typeId) {
        var info = JOURNAL_TYPES[typeId];
        var count = stats[typeId] || 0;
        if (count === 0) return null;
        var isActive = activeFilters[typeId] !== false;
        return (
          <button
            key={typeId}
            onClick={function () { onToggle(typeId); }}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              padding: "3px 8px",
              background: isActive ? info.color + "18" : "transparent",
              border: "1px solid " + (isActive ? info.color + "40" : theme.border.subtle),
              borderRadius: theme.radius.full,
              color: isActive ? info.color : theme.text.ghost,
              fontFamily: theme.font.mono,
              fontSize: theme.fontSize.xs,
              cursor: "pointer",
              opacity: isActive ? 1 : 0.5,
              transition: "all " + theme.transition.fast,
            }}
          >
            <span>{info.emoji}</span>
            <span>{info.label}</span>
            <span style={{ opacity: 0.6 }}>{count}</span>
          </button>
        );
      })}
    </div>
  );
}

// ── Main JournalView component ───────────────────────────────────────────────

export default function JournalView({ events, turns, metadata, onSeek }) {
  var [selectedEntry, setSelectedEntry] = useState(null);
  var [activeFilters, setActiveFilters] = useState({});

  // Extract journal entries
  var entries = useMemo(function () {
    return extractJournal(events || [], turns || []);
  }, [events, turns]);

  var stats = useMemo(function () {
    return computeJournalStats(entries);
  }, [entries]);

  // Apply filters
  var filteredEntries = useMemo(function () {
    return entries.filter(function (e) {
      return activeFilters[e.type] !== false;
    });
  }, [entries, activeFilters]);

  function handleToggleFilter(typeId) {
    setActiveFilters(function (prev) {
      var next = Object.assign({}, prev);
      next[typeId] = prev[typeId] === false ? true : false;
      return next;
    });
  }

  function handleSeek(time) {
    if (onSeek) onSeek(time);
  }

  // Empty state
  if (!events || events.length === 0) {
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
        <span style={{ fontSize: theme.fontSize.md }}>No session loaded</span>
        <span style={{ color: theme.text.ghost }}>Load a session to see its story</span>
      </div>
    );
  }

  return (
    <ResizablePanel initialSplit={0.55} minPx={240} direction="horizontal" storageKey="agentviz:journal-split">
      {/* Left: Journal timeline */}
      <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
        {/* Summary bar */}
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "10px 14px",
          borderBottom: "1px solid " + theme.border.subtle,
          flexShrink: 0,
        }}>
          <span style={{
            fontSize: theme.fontSize.sm,
            fontFamily: theme.font.mono,
            fontWeight: 600,
            color: theme.text.primary,
          }}>
            📖 Session Journal
          </span>
          <span style={{
            fontSize: theme.fontSize.xs,
            fontFamily: theme.font.mono,
            color: theme.text.muted,
          }}>
            {stats.total} moments
          </span>
          <div style={{ display: "flex", gap: 10, marginLeft: "auto" }}>
            <StatPill type="steering" count={stats.steering} />
            <StatPill type="levelup" count={stats.levelup} />
            <StatPill type="pivot" count={stats.pivot} />
            <StatPill type="mistake" count={stats.mistake} />
            <StatPill type="milestone" count={stats.milestone} />
            <StatPill type="insight" count={stats.insight} />
          </div>
        </div>

        {/* Filters */}
        <FilterBar activeFilters={activeFilters} onToggle={handleToggleFilter} stats={stats} />

        {/* Entry list */}
        <div style={{ flex: 1, overflowY: "auto", position: "relative" }}>
          {filteredEntries.length === 0 ? (
            <div style={{
              padding: theme.space.xxl,
              textAlign: "center",
              color: theme.text.dim,
              fontFamily: theme.font.mono,
              fontSize: theme.fontSize.sm,
            }}>
              No entries match the current filters
            </div>
          ) : (
            filteredEntries.map(function (entry, i) {
              return (
                <JournalEntry
                  key={entry.type + "-" + entry.turnIndex + "-" + i}
                  entry={entry}
                  isSelected={selectedEntry === entry}
                  onSelect={setSelectedEntry}
                  onSeek={handleSeek}
                />
              );
            })
          )}
        </div>
      </div>

      {/* Right: Detail panel */}
      <div style={{
        background: theme.bg.surface,
        borderLeft: "1px solid " + theme.border.subtle,
        height: "100%",
      }}>
        <JournalDetail entry={selectedEntry} onSeek={handleSeek} />
      </div>
    </ResizablePanel>
  );
}
