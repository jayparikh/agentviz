import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AGENT_COLORS, TRACK_TYPES, alpha, theme } from "../../lib/theme.js";
import { usePlaybackContext } from "../../contexts/PlaybackContext.jsx";
import ReplayView from "../ReplayView.jsx";
import ToolbarButton from "../ui/ToolbarButton.jsx";
import Icon from "../Icon.jsx";
import { V2ZoneHeader } from "./V2ShellPrimitives.jsx";

function ActionButton({ children, icon, onClick, tone }) {
  return (
    <button
      type="button"
      className="av-btn"
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: theme.space.xs,
        border: "1px solid " + (tone || theme.border.default),
        borderRadius: theme.radius.md,
        background: theme.bg.base,
        color: tone || theme.text.muted,
        fontFamily: theme.font.mono,
        fontSize: theme.fontSize.xs,
        padding: "4px 8px",
        cursor: "pointer",
      }}
    >
      {icon && <Icon name={icon} size={11} />}
      {children}
    </button>
  );
}

function copyText(value) {
  if (typeof navigator === "undefined" || !navigator.clipboard || typeof navigator.clipboard.writeText !== "function") return;
  navigator.clipboard.writeText(value).catch(function () {});
}

function stringifyPayload(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch (error) {
    return String(value);
  }
}

function buildEntryActions(entry, onNavigate) {
  var event = entry && entry.event;
  var analyzePanelId = event && event.track === "tool_call" ? "waterfall" : "stats";
  var actions = [
    { id: "analyze", label: analyzePanelId === "waterfall" ? "See in Waterfall" : "See in Stats", icon: "graph", targetZone: "analyze", options: { panelId: analyzePanelId } },
    { id: "compare", label: "Compare sessions", icon: "arrow-up-down", targetZone: "compare", options: { eventIndex: entry && entry.index } },
    { id: "copy-payload", label: "Copy payload", icon: "copy", onClick: function () { copyText(stringifyPayload(event && event.raw ? event.raw : event)); } },
  ];

  if (event && event.toolOutput) {
    actions.push({ id: "copy-result", label: "Copy result", icon: "copy", onClick: function () { copyText(String(event.toolOutput || "")); } });
  }

  if (event && event.isError) {
    actions.push({ id: "coach", label: "Coach in Improve", icon: "sparkles", targetZone: "improve", options: { eventIndex: entry && entry.index }, tone: theme.semantic.error });
  } else {
    actions.push({ id: "ask", label: "Ask about this", icon: "message-circle", targetZone: "improve", options: { openQA: true, eventIndex: entry && entry.index } });
  }

  return actions.map(function (action) {
    return (
      <ActionButton
        key={action.id}
        icon={action.icon}
        tone={action.tone}
        onClick={function (event) {
          event.stopPropagation();
          if (action.onClick) action.onClick();
          else if (onNavigate) onNavigate(action.targetZone, action.options);
        }}
      >
        {action.label}
      </ActionButton>
    );
  });
}

export default function InvestigateView({ session, targetEventIndex, onNavigate }) {
  var pb = usePlaybackContext();
  var [errorsOnly, setErrorsOnly] = useState(false);
  var handledTargetRef = useRef({ session: null, eventIndex: null });
  var visibleEntries = useMemo(function () {
    return errorsOnly
      ? pb.filteredEventEntries.filter(function (entry) { return entry.event.isError; })
      : pb.filteredEventEntries;
  }, [errorsOnly, pb.filteredEventEntries]);
  var visibleMatches = useMemo(function () {
    return errorsOnly
      ? pb.search.matchedEntries.filter(function (entry) { return entry.event.isError; })
      : pb.search.matchedEntries;
  }, [errorsOnly, pb.search.matchedEntries]);
  var visibleMatchSet = useMemo(function () {
    if (!pb.search.searchQuery) return null;
    return new Set(visibleMatches.map(function (entry) { return entry.index; }));
  }, [pb.search.searchQuery, visibleMatches]);
  var errorCount = pb.errorEntries.length;

  var jumpToVisibleMatch = useCallback(function (direction) {
    var matches = pb.search.submitSearch();
    if (errorsOnly) {
      matches = matches.filter(function (entry) { return entry.event.isError; });
    }
    pb.jumpToEntries(matches, direction);
  }, [errorsOnly, pb.jumpToEntries, pb.search.submitSearch]);

  useEffect(function () {
    if (targetEventIndex == null || !session || !session.events) return;
    if (handledTargetRef.current.session === session
      && handledTargetRef.current.eventIndex === targetEventIndex) return;
    handledTargetRef.current = { session: session, eventIndex: targetEventIndex };
    var event = session.events[targetEventIndex];
    if (event && pb.agentFilter && event.agent !== pb.agentFilter) {
      pb.clearAgentFilter();
    }
    if (event && pb.trackFilters[event.track]) {
      pb.clearTrackFilter(event.track);
    }
    if (event && pb.playback && pb.playback.seek) {
      pb.playback.seek(event.t);
    }
  }, [targetEventIndex, session, pb.agentFilter, pb.clearAgentFilter, pb.trackFilters, pb.clearTrackFilter, pb.playback.seek]);

  return (
    <main style={{
      flex: 1,
      minWidth: 0,
      minHeight: 0,
      display: "flex",
      flexDirection: "column",
      background: theme.bg.base,
      overflow: "hidden",
    }}>
      <V2ZoneHeader
        eyebrow="Investigate"
        title="Evidence stream"
        description="Select an event to reveal Compare, Analyze, and Coach actions."
        actions={(
          <>
          <ToolbarButton onClick={function () { if (onNavigate) onNavigate("review"); }}>
            Back to Review
          </ToolbarButton>
          <ToolbarButton onClick={function () { if (onNavigate) onNavigate("analyze", { panelId: "stats" }); }} icon="graph">
            Stats
          </ToolbarButton>
          </>
        )}
      />

      <div style={{
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        gap: theme.space.sm,
        padding: theme.space.md + "px " + theme.space.xl + "px",
        borderBottom: "1px solid " + theme.border.default,
        background: theme.bg.base,
        overflowX: "auto",
      }}>
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          background: theme.bg.surface,
          border: "1px solid " + theme.border.default,
          borderRadius: theme.radius.md,
          padding: "5px 8px",
          minWidth: 220,
        }}>
          <Icon name="search" size={12} style={{ color: theme.text.dim, flexShrink: 0 }} />
          <input
            type="text"
            aria-label="Search evidence events"
            placeholder="Search evidence"
            value={pb.search.searchInput}
            onChange={function (event) { pb.search.setSearchInput(event.target.value); }}
            onKeyDown={function (event) {
              if (event.key === "Enter") {
                event.preventDefault();
                jumpToVisibleMatch(event.shiftKey ? "prev" : "next");
              }
              if (event.key === "Escape") {
                event.currentTarget.blur();
                pb.search.clearSearch();
              }
            }}
            style={{
              border: "none",
              outline: "none",
              background: "transparent",
              color: theme.text.primary,
              fontFamily: theme.font.mono,
              fontSize: theme.fontSize.xs,
              minWidth: 0,
              width: "100%",
            }}
          />
        </div>

        <button
          type="button"
          className="av-btn"
          aria-pressed={pb.agentFilter === "user"}
          onClick={function () { pb.toggleAgentFilter("user"); }}
          style={{
            border: "1px solid " + (pb.agentFilter === "user" ? AGENT_COLORS.user : theme.border.default),
            borderRadius: theme.radius.md,
            background: pb.agentFilter === "user" ? alpha(AGENT_COLORS.user, 0.08) : theme.bg.surface,
            color: pb.agentFilter === "user" ? AGENT_COLORS.user : theme.text.muted,
            padding: "5px 8px",
            fontFamily: theme.font.mono,
            fontSize: theme.fontSize.xs,
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          User only
        </button>

        <button
          type="button"
          className="av-btn"
          aria-pressed={errorsOnly}
          onClick={function () { setErrorsOnly(function (value) { return !value; }); }}
          style={{
            border: "1px solid " + (errorsOnly ? theme.semantic.error : theme.border.default),
            borderRadius: theme.radius.md,
            background: errorsOnly ? alpha(theme.semantic.error, 0.08) : theme.bg.surface,
            color: errorsOnly ? theme.semantic.error : theme.text.muted,
            padding: "5px 8px",
            fontFamily: theme.font.mono,
            fontSize: theme.fontSize.xs,
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          Errors only {errorCount > 0 ? "(" + errorCount + ")" : ""}
        </button>

        {Object.keys(TRACK_TYPES).map(function (track) {
          var active = Boolean(pb.trackFilters[track]);
          var info = TRACK_TYPES[track];
          return (
            <button
              key={track}
              type="button"
              className="av-btn"
              aria-pressed={active}
              onClick={function () { pb.toggleTrackFilter(track); }}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                border: "1px solid " + (active ? info.color : theme.border.default),
                borderRadius: theme.radius.md,
                background: active ? alpha(info.color, 0.08) : theme.bg.surface,
                color: active ? info.color : theme.text.muted,
                padding: "5px 8px",
                fontFamily: theme.font.mono,
                fontSize: theme.fontSize.xs,
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              <Icon name={track} size={11} />
              {info.label}
            </button>
          );
        })}

        {pb.search.searchQuery && (
          <>
            <span style={{ color: theme.text.dim, fontFamily: theme.font.mono, fontSize: theme.fontSize.xs, whiteSpace: "nowrap" }}>
              {visibleMatches.length} match{visibleMatches.length === 1 ? "" : "es"}
            </span>
            <ToolbarButton
              aria-label="Previous search match"
              title="Previous match (Shift+Enter)"
              icon="chevron-up"
              disabled={visibleMatches.length === 0}
              onClick={function () { jumpToVisibleMatch("prev"); }}
              style={{ padding: "3px 5px" }}
            />
            <ToolbarButton
              aria-label="Next search match"
              title="Next match (Enter)"
              icon="chevron-down"
              disabled={visibleMatches.length === 0}
              onClick={function () { jumpToVisibleMatch("next"); }}
              style={{ padding: "3px 5px" }}
            />
          </>
        )}
      </div>

      <section style={{
        flex: 1,
        minHeight: 0,
        overflow: "hidden",
        padding: theme.space.lg + "px " + theme.space.xl + "px " + theme.space.xl + "px",
      }}>
        <div style={{
          height: "100%",
          minHeight: 0,
          border: "1px solid " + theme.border.default,
          borderRadius: theme.radius.xxl,
          background: theme.bg.surface,
          overflow: "hidden",
        }}>
          <ReplayView
            currentTime={pb.playback.time}
            eventEntries={visibleEntries}
            turns={session.turns}
            turnStartMap={pb.turnStartMap}
            searchQuery={pb.search.searchQuery}
            matchSet={visibleMatchSet}
            metadata={session.metadata}
            targetEventIndex={targetEventIndex}
            renderSelectedActions={function (props) {
              return (
                <div style={{ display: "flex", gap: theme.space.sm, flexWrap: "wrap" }}>
                  {buildEntryActions(props.entry, onNavigate)}
                </div>
              );
            }}
          />
        </div>
      </section>
    </main>
  );
}
