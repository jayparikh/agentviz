import { theme, alpha } from "../../lib/theme.js";
import { formatDurationLong } from "../../lib/formatTime.js";
import { formatCost, formatSessionCost, getSessionCostLabel } from "../../lib/pricing.js";
import {
  getNeedsReviewScore,
  getSessionCost,
  getTopTools,
  formatAutonomyEfficiency,
} from "../../lib/autonomyMetrics.js";
import useBreakpoint from "../../hooks/useBreakpoint.js";
import Icon from "../Icon.jsx";
import ToolbarButton from "../ui/ToolbarButton.jsx";
import { V2EmptyState } from "./V2ShellPrimitives.jsx";

function safeEvents(session) {
  return session && session.events ? session.events : [];
}

function safeTurns(session) {
  return session && session.turns ? session.turns : [];
}

function safeMetadata(session) {
  return session && session.metadata ? session.metadata : {};
}

function getHealthColor(score) {
  if (score >= 82) return theme.semantic.success;
  if (score >= 58) return theme.accent.primary;
  return theme.semantic.error;
}

function getHealthLabel(score) {
  if (score >= 82) return "Healthy";
  if (score >= 58) return "Needs review";
  return "High risk";
}

function firstErrorEntry(events) {
  for (var index = 0; index < events.length; index += 1) {
    if (events[index].isError) return { index: index, event: events[index] };
  }
  return null;
}

function getLongestToolEntry(events) {
  var longest = null;
  for (var index = 0; index < events.length; index += 1) {
    var event = events[index];
    if (event.track !== "tool_call") continue;
    if (!longest || (event.duration || 0) > (longest.event.duration || 0)) {
      longest = { index: index, event: event };
    }
  }
  return longest;
}

function getSeverityRank(severity) {
  if (severity === "critical") return 0;
  if (severity === "warning") return 1;
  if (severity === "info") return 2;
  if (severity === "success") return 3;
  return 4;
}

function buildHealthFactors(summary, autonomyMetrics) {
  var factors = [];
  factors.push({
    label: "Errors",
    value: summary.errorCount > 0 ? summary.errorCount + " found" : "none",
    tone: summary.errorCount > 0 ? theme.semantic.error : theme.semantic.success,
    detail: summary.errorCount > 0 ? "Errors have the strongest impact on review health." : "No error events were recorded.",
  });
  factors.push({
    label: "Interventions",
    value: summary.interventions > 0 ? summary.interventions + " follow-up" + (summary.interventions === 1 ? "" : "s") : "none",
    tone: summary.interventions > 0 ? theme.accent.primary : theme.semantic.success,
    detail: "Follow-up user turns suggest the run needed steering or correction.",
  });
  if (autonomyMetrics && autonomyMetrics.babysittingTime > 0) {
    factors.push({
      label: "Human wait",
      value: formatDurationLong(autonomyMetrics.babysittingTime),
      tone: autonomyMetrics.babysittingTime > 60 ? theme.semantic.error : theme.accent.primary,
      detail: "Time spent waiting on human input lowers autonomy.",
    });
  }
  if (autonomyMetrics && autonomyMetrics.idleTime > 0) {
    factors.push({
      label: "Idle gaps",
      value: formatDurationLong(autonomyMetrics.idleTime),
      tone: autonomyMetrics.idleTime > 90 ? theme.semantic.error : theme.accent.primary,
      detail: "Long idle gaps can indicate stalls or unclear handoffs.",
    });
  }
  if (summary.autonomyEfficiency != null) {
    factors.push({
      label: "Autonomy",
      value: formatAutonomyEfficiency(summary.autonomyEfficiency),
      tone: summary.autonomyEfficiency >= 0.7 ? theme.semantic.success : summary.autonomyEfficiency >= 0.4 ? theme.accent.primary : theme.semantic.error,
      detail: "Higher autonomy means more productive agent time with less waiting.",
    });
  }
  return factors;
}

function buildDataReadiness(metadata, summary) {
  var tokenUsage = metadata && metadata.tokenUsage;
  var hasTokens = Boolean(tokenUsage && ((tokenUsage.inputTokens || 0) + (tokenUsage.outputTokens || 0) + (tokenUsage.cacheRead || 0) + (tokenUsage.cacheWrite || 0)) > 0);
  var hasCost = summary.cost != null;
  return [
    {
      label: "Token data",
      value: hasTokens ? "available" : "not logged",
      tone: hasTokens ? theme.semantic.success : theme.text.dim,
      detail: hasTokens ? "Stats, Cost, Review, and Compare can use token totals." : "This source did not include token counters.",
    },
    {
      label: "Cost data",
      value: hasCost ? (metadata.totalCost != null ? formatSessionCost(metadata) : formatCost(summary.cost)) : "not available",
      tone: hasCost ? theme.semantic.success : theme.text.dim,
      detail: hasCost ? "Cost or premium-request usage is reported, or estimated from recognized model pricing." : "No reported cost and no recognized model pricing is available.",
    },
  ];
}

export function buildReviewSummary(session, autonomyMetrics) {
  var events = safeEvents(session);
  var turns = safeTurns(session);
  var metadata = safeMetadata(session);
  var score = Math.max(0, Math.min(100, Math.round(100 - getNeedsReviewScore({
    autonomyMetrics: autonomyMetrics,
    errorCount: metadata.errorCount || 0,
  }))));
  var totalCost = getSessionCost(metadata);
  var topTools = getTopTools(events, 3);

  return {
    score: score,
    label: getHealthLabel(score),
    totalEvents: metadata.totalEvents || events.length,
    totalTurns: metadata.totalTurns || turns.length,
    totalToolCalls: metadata.totalToolCalls || events.filter(function (event) { return event.track === "tool_call"; }).length,
    errorCount: metadata.errorCount || events.filter(function (event) { return event.isError; }).length,
    duration: metadata.duration || (autonomyMetrics && autonomyMetrics.totalDuration) || 0,
    cost: totalCost,
    autonomyEfficiency: autonomyMetrics ? autonomyMetrics.autonomyEfficiency : null,
    interventions: autonomyMetrics ? autonomyMetrics.interventionCount : 0,
    topTools: topTools,
  };
}

export function buildReviewInsights(session, autonomyMetrics) {
  var events = safeEvents(session);
  var metadata = safeMetadata(session);
  var insights = [];
  var error = firstErrorEntry(events);
  var longestTool = getLongestToolEntry(events);

  if (error) {
    insights.push({
      id: "first-error",
      severity: "critical",
      title: "First error needs attention",
      description: error.event.text || error.event.toolOutput || "An error event was recorded in this session.",
      evidenceLabel: "Jump to event " + (error.index + 1),
      targetZone: "investigate",
      targetEventIndex: error.index,
    });
  }

  if (autonomyMetrics && autonomyMetrics.interventionCount > 0) {
    insights.push({
      id: "interventions",
      severity: autonomyMetrics.interventionCount > 2 ? "warning" : "info",
      title: "Human intervention changed the flow",
      description: autonomyMetrics.interventionCount + " follow-up" + (autonomyMetrics.interventionCount === 1 ? "" : "s") + " during this run.",
      evidenceLabel: "Review turns",
      targetZone: "investigate",
    });
  }

  if (longestTool && longestTool.event.duration > 5) {
    insights.push({
      id: "slow-tool",
      severity: "info",
      title: "Slowest tool call",
      description: (longestTool.event.toolName || "Tool call") + " took " + formatDurationLong(longestTool.event.duration) + ".",
      evidenceLabel: "Open Waterfall",
      targetZone: "analyze",
      targetPanelId: "waterfall",
      targetEventIndex: longestTool.index,
    });
  }

  if (metadata.tokenUsage && (metadata.tokenUsage.inputTokens || metadata.tokenUsage.outputTokens)) {
    insights.push({
      id: "token-usage",
      severity: "info",
      title: "Token usage available",
      description: "Cost and context data can be inspected in the analysis panels.",
      evidenceLabel: "Open Cost analysis",
      targetZone: "analyze",
      targetPanelId: "cost",
    });
  }

  if (insights.length === 0) {
    insights.push({
      id: "clean-run",
      severity: "success",
      title: "No urgent issues detected",
      description: "No errors, intervention spikes, or slow tool calls were found in the current summary.",
      evidenceLabel: "Inspect evidence",
      targetZone: "investigate",
    });
  }

  return insights.sort(function (left, right) {
    return getSeverityRank(left.severity) - getSeverityRank(right.severity);
  }).slice(0, 4);
}

function SummaryCard({ label, value, sub, color }) {
  return (
    <div style={{
      background: theme.bg.surface,
      border: "1px solid " + theme.border.default,
      borderRadius: theme.radius.lg,
      padding: theme.space.lg,
      minWidth: 0,
    }}>
      <div style={{
        color: color || theme.text.primary,
        fontSize: theme.fontSize.xl,
        fontFamily: theme.font.mono,
        fontWeight: 700,
        lineHeight: 1,
      }}>
        {value}
      </div>
      <div style={{ color: theme.text.dim, fontSize: theme.fontSize.xs, marginTop: theme.space.sm }}>
        {label}
      </div>
      {sub && (
        <div style={{ color: theme.text.muted, fontSize: theme.fontSize.xs, marginTop: 2, lineHeight: 1.5 }}>
          {sub}
        </div>
      )}
    </div>
  );
}

function HealthFactorList({ factors }) {
  return (
    <div style={{ display: "grid", gap: theme.space.sm, marginTop: theme.space.xl }}>
      {factors.map(function (factor) {
        return (
          <div key={factor.label} style={{
            border: "1px solid " + alpha(factor.tone, 0.28),
            borderRadius: theme.radius.lg,
            background: alpha(factor.tone, 0.06),
            padding: theme.space.md,
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: theme.space.md, color: theme.text.secondary, fontSize: theme.fontSize.xs }}>
              <span>{factor.label}</span>
              <span style={{ color: factor.tone, fontFamily: theme.font.mono }}>{factor.value}</span>
            </div>
            <div style={{ color: theme.text.muted, fontSize: theme.fontSize.xs, lineHeight: 1.45, marginTop: theme.space.xs }}>
              {factor.detail}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DataReadinessList({ items }) {
  return (
    <div>
      <div style={{ color: theme.text.dim, fontSize: theme.fontSize.xs, textTransform: "uppercase", letterSpacing: 1 }}>
        Data readiness
      </div>
      <div style={{ display: "grid", gap: theme.space.sm, marginTop: theme.space.md }}>
        {items.map(function (item) {
          return (
            <div key={item.label} style={{
              border: "1px solid " + theme.border.default,
              borderRadius: theme.radius.lg,
              background: theme.bg.base,
              padding: theme.space.md,
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: theme.space.md, fontSize: theme.fontSize.xs }}>
                <span style={{ color: theme.text.muted }}>{item.label}</span>
                <span style={{ color: item.tone, fontFamily: theme.font.mono }}>{item.value}</span>
              </div>
              <div style={{ color: theme.text.dim, fontSize: theme.fontSize.xs, lineHeight: 1.45, marginTop: theme.space.xs }}>
                {item.detail}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function InsightCard({ insight, onNavigate }) {
  var tone = insight.severity === "critical"
    ? theme.semantic.error
    : insight.severity === "warning"
      ? theme.semantic.warning
      : insight.severity === "success"
        ? theme.semantic.success
        : theme.accent.primary;

  return (
    <div style={{
      border: "1px solid " + alpha(tone, 0.45),
      borderRadius: theme.radius.xl,
      background: alpha(tone, 0.08),
      padding: theme.space.lg,
      display: "flex",
      gap: theme.space.md,
      alignItems: "flex-start",
    }}>
      <span style={{
        width: 28,
        height: 28,
        borderRadius: theme.radius.md,
        border: "1px solid " + alpha(tone, 0.55),
        background: theme.bg.base,
        color: tone,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}>
        <Icon name={insight.severity === "success" ? "sparkles" : "alert-circle"} size={14} />
      </span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ color: theme.text.primary, fontSize: theme.fontSize.md, fontWeight: 700 }}>
          {insight.title}
        </div>
        <div style={{
          color: theme.text.secondary,
          fontSize: theme.fontSize.sm,
          lineHeight: 1.6,
          marginTop: theme.space.sm,
        }}>
          {insight.description}
        </div>
        <button
          type="button"
          className="av-btn"
          onClick={function () {
            if (onNavigate) onNavigate(insight.targetZone, {
              eventIndex: insight.targetEventIndex,
              panelId: insight.targetPanelId,
            });
          }}
          style={{
            marginTop: theme.space.md,
            border: "1px solid " + alpha(tone, 0.55),
            borderRadius: theme.radius.md,
            background: theme.bg.base,
            color: tone,
            fontSize: theme.fontSize.xs,
            fontFamily: theme.font.mono,
            padding: "4px 8px",
            cursor: "pointer",
          }}
        >
          {insight.evidenceLabel}
        </button>
      </div>
    </div>
  );
}

export default function ReviewHub({ session, autonomyMetrics, onNavigate }) {
  var hasSession = Boolean(session && session.events);
  var breakpoint = useBreakpoint();

  if (!hasSession) {
    return (
      <V2EmptyState
        title="Open a session to review it"
        description="The Review Hub summarizes health, errors, tool usage, cost, autonomy, and evidence-linked next actions."
        actionLabel="Go to Find"
        onAction={function () { if (onNavigate) onNavigate("find"); }}
        maxWidth={520}
      />
    );
  }

  var summary = buildReviewSummary(session, autonomyMetrics);
  var insights = buildReviewInsights(session, autonomyMetrics);
  var metadata = session.metadata || {};
  var healthColor = getHealthColor(summary.score);
  var healthFactors = buildHealthFactors(summary, autonomyMetrics);
  var dataReadiness = buildDataReadiness(metadata, summary);

  return (
    <main style={{
      flex: 1,
      minWidth: 0,
      overflow: "auto",
      padding: breakpoint.isCompact ? theme.space.lg : theme.space.xl,
      background: theme.bg.base,
      display: "flex",
      flexDirection: "column",
      gap: theme.space.lg,
    }}>
      <section style={{
        display: "grid",
        gridTemplateColumns: breakpoint.isNarrow ? "1fr" : "minmax(240px, 0.9fr) minmax(320px, 1.8fr)",
        gap: theme.space.lg,
      }}>
        <div style={{
          border: "1px solid " + alpha(healthColor, 0.45),
          borderRadius: theme.radius.xxl,
          background: alpha(healthColor, 0.08),
          padding: theme.space.xxl,
          minWidth: 0,
        }}>
          <div style={{ color: theme.text.dim, fontSize: theme.fontSize.xs, textTransform: "uppercase", letterSpacing: 1 }}>
            Review health
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: theme.space.md, marginTop: theme.space.lg }}>
            <span style={{ color: healthColor, fontSize: theme.fontSize.hero, lineHeight: 1, fontWeight: 700, letterSpacing: "-0.08em" }}>
              {summary.score}
            </span>
            <span style={{ color: theme.text.secondary, fontSize: theme.fontSize.md }}>
              /100
            </span>
          </div>
          <div style={{ color: healthColor, fontSize: theme.fontSize.lg, fontWeight: 700, marginTop: theme.space.md }}>
            {summary.label}
          </div>
          <div style={{ color: theme.text.muted, fontSize: theme.fontSize.sm, lineHeight: 1.7, marginTop: theme.space.lg }}>
            Prioritized by errors, interventions, wait time, idle gaps, and autonomy efficiency.
          </div>
          <HealthFactorList factors={healthFactors} />
        </div>

        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
          gap: theme.space.md,
          minWidth: 0,
        }}>
          <SummaryCard label="Events" value={summary.totalEvents} />
          <SummaryCard label="Turns" value={summary.totalTurns} />
          <SummaryCard label="Tool calls" value={summary.totalToolCalls} color={theme.track.tool_call} />
          <SummaryCard label="Errors" value={summary.errorCount} color={summary.errorCount ? theme.semantic.error : theme.text.primary} />
          <SummaryCard label="Duration" value={formatDurationLong(summary.duration)} color={theme.track.context} />
          <SummaryCard label={metadata.totalCost != null ? getSessionCostLabel(metadata) : "Cost"} value={summary.cost != null ? (metadata.totalCost != null ? formatSessionCost(metadata) : formatCost(summary.cost)) : "--"} color={summary.cost != null ? theme.semantic.success : theme.text.primary} />
          <SummaryCard label="Autonomy" value={summary.autonomyEfficiency != null ? formatAutonomyEfficiency(summary.autonomyEfficiency) : "--"} />
          <SummaryCard label="Interventions" value={summary.interventions} />
        </div>
      </section>

      <section style={{
        display: "grid",
        gridTemplateColumns: breakpoint.isNarrow ? "1fr" : "minmax(360px, 1.4fr) minmax(280px, 0.8fr)",
        gap: theme.space.lg,
        minHeight: 0,
      }}>
        <div style={{
          border: "1px solid " + theme.border.default,
          borderRadius: theme.radius.xxl,
          background: theme.bg.surface,
          padding: theme.space.xl,
          minWidth: 0,
        }}>
          <div style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: theme.space.lg,
            marginBottom: theme.space.lg,
          }}>
            <div>
              <div style={{ color: theme.text.dim, fontSize: theme.fontSize.xs, textTransform: "uppercase", letterSpacing: 1 }}>
                Evidence-linked insights
              </div>
              <div style={{ color: theme.text.secondary, fontSize: theme.fontSize.sm, marginTop: theme.space.sm }}>
                Each finding links to the zone that can explain it.
              </div>
            </div>
            <ToolbarButton onClick={function () { if (onNavigate) onNavigate("investigate"); }}>
              Open evidence
            </ToolbarButton>
          </div>
          <div style={{ display: "grid", gap: theme.space.md }}>
            {insights.map(function (insight) {
              return <InsightCard key={insight.id} insight={insight} onNavigate={onNavigate} />;
            })}
          </div>
        </div>

        <aside style={{
          border: "1px solid " + theme.border.default,
          borderRadius: theme.radius.xxl,
          background: theme.bg.surface,
          padding: theme.space.xl,
          display: "flex",
          flexDirection: "column",
          gap: theme.space.lg,
          minWidth: 0,
        }}>
          <div>
            <div style={{ color: theme.text.dim, fontSize: theme.fontSize.xs, textTransform: "uppercase", letterSpacing: 1 }}>
              Top tools
            </div>
            <div style={{ display: "grid", gap: theme.space.sm, marginTop: theme.space.md }}>
              {summary.topTools.length === 0 ? (
                <div style={{ color: theme.text.dim, fontSize: theme.fontSize.sm }}>No tool calls recorded.</div>
              ) : summary.topTools.map(function (tool) {
                return (
                  <div key={tool.name} style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: theme.space.lg,
                    color: theme.text.secondary,
                    fontSize: theme.fontSize.sm,
                  }}>
                    <span style={{ color: theme.track.tool_call, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {tool.name}
                    </span>
                    <span style={{ color: theme.text.primary }}>{tool.count}x</span>
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{
            borderTop: "1px solid " + theme.border.default,
            paddingTop: theme.space.lg,
          }}>
            <DataReadinessList items={dataReadiness} />
          </div>

          <div style={{
            borderTop: "1px solid " + theme.border.default,
            paddingTop: theme.space.lg,
            display: "grid",
            gap: theme.space.sm,
          }}>
            <ToolbarButton onClick={function () { if (onNavigate) onNavigate("analyze"); }} icon="graph">
              Analyze deeper
            </ToolbarButton>
            <ToolbarButton onClick={function () { if (onNavigate) onNavigate("compare"); }} icon="arrow-up-down">
              Compare run
            </ToolbarButton>
            <ToolbarButton onClick={function () { if (onNavigate) onNavigate("improve"); }} icon="sparkles">
              Improve with Coach
            </ToolbarButton>
          </div>
        </aside>
      </section>
    </main>
  );
}
