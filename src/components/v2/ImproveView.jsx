import React, { useEffect, useMemo, useState } from "react";
import { alpha, theme } from "../../lib/theme.js";
import lazyImport from "../../lib/lazyImport.js";
import useBreakpoint from "../../hooks/useBreakpoint.js";
import useReducedMotion from "../../hooks/useReducedMotion.js";
import ToolbarButton from "../ui/ToolbarButton.jsx";
import Icon from "../Icon.jsx";
import { V2EmptyState, V2ZoneHeader } from "./V2ShellPrimitives.jsx";

var DebriefView = React.lazy(function () { return lazyImport(function () { return import("../DebriefView.jsx"); }); });
var MAX_EVENT_PREVIEW = 120;

function EmptyImprove({ onNavigate }) {
  return (
    <V2EmptyState
      title="Open a session to improve it"
      description="Improve combines Coach recommendations and session Q&A so you can turn a completed run into a better next run."
      actionLabel="Go to Find"
      onAction={function () { if (onNavigate) onNavigate("find"); }}
    />
  );
}

function LoadingCoach() {
  return (
    <div style={{
      height: "100%",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      color: theme.text.dim,
      fontSize: theme.fontSize.md,
    }}>
      Loading coach...
    </div>
  );
}

function truncateText(text, limit) {
  if (!text) return "";
  var value = String(text).replace(/\s+/g, " ").trim();
  return value.length > limit ? value.slice(0, limit - 3) + "..." : value;
}

function getEventByIndex(session, eventIndex) {
  if (!session || !session.events || eventIndex == null) return null;
  var numericIndex = Number(eventIndex);
  if (!Number.isInteger(numericIndex)) return null;
  return session.events[numericIndex] || null;
}

function getTopTool(events) {
  var counts = {};
  (events || []).forEach(function (event) {
    if (event.track === "tool_call" && event.toolName) counts[event.toolName] = (counts[event.toolName] || 0) + 1;
  });
  return Object.entries(counts)
    .map(function (entry) { return { name: entry[0], count: entry[1] }; })
    .sort(function (left, right) { return right.count - left.count; })[0] || null;
}

function getErrorCount(session) {
  var metadata = session && session.metadata ? session.metadata : {};
  if (metadata.errorCount != null) return metadata.errorCount;
  return (session && session.events ? session.events : []).filter(function (event) { return event.isError; }).length;
}

function buildEventQuestion(eventIndex, event) {
  if (!event) return "";
  var descriptor = event.toolName || event.track || event.agent || "event";
  var preview = truncateText(event.text || event.toolOutput || "", MAX_EVENT_PREVIEW);
  var suffix = preview ? ": " + preview : "";
  return "What should I change in the next run based on event " + eventIndex + " (" + descriptor + suffix + ")?";
}

function buildNextRunPrompt(session, autonomyMetrics, focusedEventIndex, focusedEvent) {
  var metadata = session.metadata || {};
  var turns = session.turns || [];
  var events = session.events || [];
  var topTool = getTopTool(events);
  var errorCount = getErrorCount(session);
  var lines = [
    "Use this AGENTVIZ session as evidence for the next run.",
    "",
    "Session: " + (session.file || "current session"),
    "Model: " + (metadata.primaryModel || "unknown"),
    "Events: " + (metadata.totalEvents || events.length) + ", turns: " + (metadata.totalTurns || turns.length) + ", errors: " + errorCount,
  ];

  if (focusedEvent) {
    lines.push("Focus event " + focusedEventIndex + ": " + (focusedEvent.toolName || focusedEvent.track || focusedEvent.agent || "event") + " | " + truncateText(focusedEvent.text || focusedEvent.toolOutput || "", MAX_EVENT_PREVIEW));
  }

  if (autonomyMetrics && autonomyMetrics.interventionCount) {
    lines.push("Reduce follow-up turns: fold " + autonomyMetrics.interventionCount + " observed intervention" + (autonomyMetrics.interventionCount === 1 ? "" : "s") + " into the initial prompt.");
  }

  if (errorCount > 0) {
    lines.push("Handle failures up front: include recovery steps for the " + errorCount + " observed error" + (errorCount === 1 ? "" : "s") + ".");
  }

  if (topTool) {
    lines.push("Expected tool path: " + topTool.name + " appeared " + topTool.count + " time" + (topTool.count === 1 ? "" : "s") + ". Confirm it is available before starting.");
  }

  lines.push("Before finishing, report the changed files, validation command, and any unresolved risks.");
  return lines.join("\n");
}

function buildImprovementChecklist(session, autonomyMetrics, focusedEvent) {
  var metadata = session.metadata || {};
  var events = session.events || [];
  var turns = session.turns || [];
  var topTool = getTopTool(events);
  var errorCount = getErrorCount(session);
  var interventions = autonomyMetrics && autonomyMetrics.interventionCount ? autonomyMetrics.interventionCount : Math.max(0, turns.length - 1);
  var tokenUsage = metadata.tokenUsage || {};
  var cacheRead = tokenUsage.cacheRead || 0;
  var cacheWrite = tokenUsage.cacheWrite || 0;

  return [
    {
      label: "Prompt",
      title: interventions > 0 ? "Fold follow-ups into the starter prompt" : "Keep the starter prompt crisp",
      evidence: interventions > 0
        ? interventions + " human intervention" + (interventions === 1 ? "" : "s") + " after the first turn"
        : "No repeated user steering detected",
      action: "Name success criteria, constraints, and validation commands before the agent starts.",
    },
    {
      label: "Skill",
      title: errorCount > 0 ? "Capture recovery as a reusable checklist" : "Preserve the working playbook",
      evidence: focusedEvent && focusedEvent.isError
        ? "Selected error: " + truncateText(focusedEvent.text || focusedEvent.toolOutput || "", MAX_EVENT_PREVIEW)
        : errorCount + " error event" + (errorCount === 1 ? "" : "s"),
      action: errorCount > 0
        ? "Turn the failure pattern into a skill or preflight checklist for the next run."
        : "Keep this flow as a candidate template if the same task recurs.",
    },
    {
      label: "MCP/tool",
      title: topTool ? "Make the tool path explicit" : "Confirm required tools",
      evidence: topTool ? topTool.name + " used " + topTool.count + " time" + (topTool.count === 1 ? "" : "s") : "No dominant tool call detected",
      action: "Tell the next agent which tools are expected and what fallback to use if a tool is unavailable.",
    },
    {
      label: "Config",
      title: metadata.primaryModel ? "Preserve telemetry visibility" : "Confirm model and token telemetry",
      evidence: metadata.primaryModel
        ? metadata.primaryModel + " with " + cacheRead + " cached read and " + cacheWrite + " cache write tokens"
        : "Model metadata was unavailable in this session",
      action: "Keep model, token, cache, and project-config evidence visible before applying recommendations.",
    },
  ];
}

function ImprovementChecklist({ items, focusedEventIndex, focusedEvent, nextRunPrompt, copyStatus, onCopy, onAskEvent, breakpoint }) {
  return (
    <div style={{
      flexShrink: 0,
      border: "1px solid " + theme.border.default,
      borderRadius: theme.radius.xxl,
      background: theme.bg.surface,
      padding: theme.space.lg,
      display: "flex",
      flexDirection: "column",
      gap: theme.space.md,
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: theme.space.lg }}>
        <div>
          <div style={{ color: theme.text.dim, fontSize: theme.fontSize.xs, textTransform: "uppercase", letterSpacing: 1 }}>
            Next-run checklist
          </div>
          <div style={{ color: theme.text.primary, fontSize: theme.fontSize.md, fontWeight: 700, marginTop: theme.space.xs }}>
            Evidence-grounded improvements before Coach drafts config changes
          </div>
          {focusedEvent && (
            <div style={{ color: theme.text.muted, fontSize: theme.fontSize.xs, marginTop: theme.space.xs }}>
              Focused on event {focusedEventIndex}: {focusedEvent.toolName || focusedEvent.track || focusedEvent.agent || "event"}
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: theme.space.sm, flexShrink: 0 }}>
          {focusedEvent && (
            <ToolbarButton onClick={onAskEvent} icon="message-circle">
              Ask about event
            </ToolbarButton>
          )}
          <ToolbarButton onClick={onCopy} icon="copy" style={{ color: theme.accent.primary, borderColor: theme.accent.primary }}>
            {copyStatus === "copied" ? "Copied" : "Copy next-run prompt"}
          </ToolbarButton>
        </div>
      </div>

      {copyStatus === "unavailable" && (
        <div role="status" style={{
          color: theme.semantic.warning,
          background: alpha(theme.semantic.warning, 0.08),
          border: "1px solid " + alpha(theme.semantic.warning, 0.3),
          borderRadius: theme.radius.md,
          padding: "6px 10px",
          fontSize: theme.fontSize.xs,
        }}>
          Clipboard is unavailable in this browser context.
        </div>
      )}

      <div style={{
        display: "grid",
        gridTemplateColumns: breakpoint.isCompact ? "1fr" : breakpoint.isNarrow ? "repeat(2, minmax(0, 1fr))" : "repeat(4, minmax(0, 1fr))",
        gap: theme.space.sm,
      }}>
        {items.map(function (item) {
          return (
            <div key={item.label} style={{
              border: "1px solid " + theme.border.subtle,
              borderRadius: theme.radius.xl,
              background: theme.bg.base,
              padding: "12px 14px",
              minWidth: 0,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: theme.space.xs, color: theme.accent.primary, fontSize: theme.fontSize.xs, textTransform: "uppercase", letterSpacing: 1 }}>
                <Icon name="sparkles" size={10} />
                {item.label}
              </div>
              <div style={{ color: theme.text.primary, fontSize: theme.fontSize.sm, fontWeight: 700, marginTop: theme.space.sm }}>
                {item.title}
              </div>
              <div style={{ color: theme.text.dim, fontSize: theme.fontSize.xs, marginTop: theme.space.xs, lineHeight: 1.5 }}>
                {item.evidence}
              </div>
              <div style={{ color: theme.text.muted, fontSize: theme.fontSize.xs, marginTop: theme.space.sm, lineHeight: 1.5 }}>
                {item.action}
              </div>
            </div>
          );
        })}
      </div>

      <pre style={{
        margin: 0,
        border: "1px solid " + theme.border.subtle,
        borderRadius: theme.radius.lg,
        background: theme.bg.base,
        color: theme.text.secondary,
        fontSize: theme.fontSize.xs,
        lineHeight: 1.5,
        padding: "10px 12px",
        whiteSpace: "pre-wrap",
        maxHeight: 96,
        overflow: "auto",
      }}>{nextRunPrompt}</pre>
    </div>
  );
}

export default function ImproveView({ session, autonomyMetrics, debrief, openQARequest, onNavigate, onOpenQA }) {
  var [focusedEventIndex, setFocusedEventIndex] = useState(null);
  var [copyStatus, setCopyStatus] = useState(null);
  var breakpoint = useBreakpoint();
  var prefersReducedMotion = useReducedMotion();
  var hasSession = Boolean(session && session.events);

  var focusedEvent = useMemo(function () {
    return getEventByIndex(session, focusedEventIndex);
  }, [session, focusedEventIndex]);
  var checklistItems = useMemo(function () {
    if (!hasSession) return [];
    return buildImprovementChecklist(session, autonomyMetrics, focusedEvent);
  }, [hasSession, session, autonomyMetrics, focusedEvent]);
  var nextRunPrompt = useMemo(function () {
    if (!hasSession) return "";
    return buildNextRunPrompt(session, autonomyMetrics, focusedEventIndex, focusedEvent);
  }, [hasSession, session, autonomyMetrics, focusedEventIndex, focusedEvent]);

  useEffect(function () {
    if (!openQARequest) return;
    if (openQARequest.eventIndex != null) setFocusedEventIndex(openQARequest.eventIndex);
    if (openQARequest.openQA) {
      var event = getEventByIndex(session, openQARequest.eventIndex);
      onOpenQA(buildEventQuestion(openQARequest.eventIndex, event));
    }
  }, [openQARequest]);

  useEffect(function () {
    setCopyStatus(null);
  }, [nextRunPrompt]);

  if (!hasSession) {
    return <EmptyImprove onNavigate={onNavigate} />;
  }

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
        eyebrow="Improve"
        title="Coach and Q&A"
        description="Evidence-backed recommendations and direct questions about the current session."
        actions={(
          <>
          <ToolbarButton onClick={function () { onOpenQA(""); }} icon="message-circle" style={{ color: theme.accent.primary, borderColor: theme.accent.primary }}>
            Ask about session
          </ToolbarButton>
          <ToolbarButton onClick={function () { if (onNavigate) onNavigate("review"); }}>
            Back to Review
          </ToolbarButton>
          </>
        )}
      />

      <section style={{
        flex: 1,
        minHeight: 0,
        overflow: "hidden",
        padding: theme.space.lg + "px " + (breakpoint.isCompact ? theme.space.lg : theme.space.xl) + "px " + (breakpoint.isCompact ? theme.space.lg : theme.space.xl) + "px",
      }}>
        <div style={{
          height: "100%",
          minHeight: 0,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          gap: theme.space.lg,
        }}>
          <ImprovementChecklist
            items={checklistItems}
            focusedEventIndex={focusedEventIndex}
            focusedEvent={focusedEvent}
            nextRunPrompt={nextRunPrompt}
            copyStatus={copyStatus}
            breakpoint={breakpoint}
            onAskEvent={function () {
              onOpenQA(buildEventQuestion(focusedEventIndex, focusedEvent));
            }}
            onCopy={function () {
              if (typeof navigator === "undefined" || !navigator.clipboard || typeof navigator.clipboard.writeText !== "function") {
                setCopyStatus("unavailable");
                return;
              }
              navigator.clipboard.writeText(nextRunPrompt).then(function () {
                setCopyStatus("copied");
              }, function () {
                setCopyStatus("unavailable");
              });
            }}
          />
          <div style={{
            flex: 1,
            minHeight: 0,
            border: "1px solid " + theme.border.default,
            borderRadius: theme.radius.xxl,
            background: theme.bg.base,
            overflow: "hidden",
            padding: theme.space.lg,
          }}>
            <React.Suspense fallback={<LoadingCoach />}>
              <DebriefView
                file={session.file}
                summary={debrief.summary}
                metadata={session.metadata}
                rawSession={{
                  events: session.events,
                  turns: session.turns,
                  metadata: session.metadata,
                  autonomyMetrics: autonomyMetrics,
                }}
                prefersReducedMotion={prefersReducedMotion}
              />
            </React.Suspense>
          </div>
        </div>
      </section>

    </main>
  );
}
