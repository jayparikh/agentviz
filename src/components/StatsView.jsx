import { theme, TRACK_TYPES, alpha } from "../lib/theme.js";
import Icon from "./Icon.jsx";
import { estimateCost, formatCost } from "../lib/pricing.js";
import { formatDurationLong } from "../lib/formatTime.js";
import ToolbarButton from "./ui/ToolbarButton.jsx";
import ResizablePanel from "./ResizablePanel.jsx";
import { buildAutonomySummary } from "../lib/autonomyMetrics.js";
import { useState, useMemo } from "react";
import { extractSkills } from "../lib/skillExtractor.ts";

function MetricCard({ value, label, tooltip, color }) {
  var [hovered, setHovered] = useState(false);
  return (
    <div
      style={{ border: "1px solid " + theme.border.default, borderRadius: theme.radius.lg, padding: "12px 14px", background: theme.bg.base, cursor: "default", position: "relative" }}
      onMouseEnter={function () { setHovered(true); }}
      onMouseLeave={function () { setHovered(false); }}
    >
      <div style={{ fontSize: theme.fontSize.lg, color: color, fontFamily: theme.font.mono, fontWeight: 700 }}>{value}</div>
      <div style={{ fontSize: theme.fontSize.xs, color: theme.text.muted, marginTop: 4 }}>{label}</div>
      {hovered && tooltip && (
        <div style={{
          position: "absolute",
          bottom: "calc(100% + 8px)",
          left: "50%",
          transform: "translateX(-50%)",
          background: theme.bg.overlay || theme.bg.surface,
          border: "1px solid " + theme.border.default,
          borderRadius: theme.radius.lg,
          padding: "8px 12px",
          fontSize: theme.fontSize.xs,
          color: theme.text.secondary,
          whiteSpace: "normal",
          width: 220,
          lineHeight: 1.5,
          zIndex: theme.z.modal,
          pointerEvents: "none",
          boxShadow: theme.shadow.md,
        }}>
          {tooltip}
        </div>
      )}
    </div>
  );
}

// ── Capabilities panel (skills, instructions, MCP, agents) ──────────────────

var SOURCE_COLORS = {
  project: "#3b9eff",
  personal: "#a78bfa",
  extension: "#f59e0b",
  "built-in": "#94a3b8",
  mcp: "#10d97a",
  unknown: "#585860",
};

var CATEGORY_COLORS = {
  skill: "#a78bfa",
  instruction: "#6475e8",
  agent: "#f59e0b",
  tool: "#3b9eff",
  "mcp-server": "#10d97a",
  prompt: "#10d97a",
  plugin: "#ec4899",
};

var STAGE_COLORS = {
  discovered: "#585860",
  loaded: "#6475e8",
  invoked: "#3b9eff",
  "resource-accessed": "#a78bfa",
  completed: "#10d97a",
  errored: "#ef4444",
};

var STAGE_LABELS = {
  discovered: "Discovered",
  loaded: "Loaded",
  invoked: "Invoked",
  "resource-accessed": "Resources",
  completed: "Completed",
  errored: "Errored",
};

var STAGE_SEQUENCE = ["discovered", "loaded", "invoked", "resource-accessed", "completed"];

function SkillStageBar({ maxStage, hasError }) {
  var activeIdx = STAGE_SEQUENCE.indexOf(maxStage);
  if (activeIdx < 0) activeIdx = maxStage === "errored" ? 4 : 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 1 }}>
      {STAGE_SEQUENCE.map(function (stage, idx) {
        var reached = idx <= activeIdx;
        var isErr = hasError && idx === activeIdx;
        return (
          <div
            key={stage}
            title={STAGE_LABELS[stage]}
            style={{
              width: 14,
              height: 3,
              borderRadius: 1.5,
              background: isErr ? "#ef4444" : reached ? STAGE_COLORS[stage] : theme.text.ghost,
              opacity: reached ? 1 : 0.25,
            }}
          />
        );
      })}
    </div>
  );
}

function CapabilitiesPanel({ events, turns, metadata }) {
  var [expandedId, setExpandedId] = useState(null);
  var [capFilter, setCapFilter] = useState("all");
  var [sourceFilter, setSourceFilter] = useState(null);

  var summary = useMemo(function () {
    return extractSkills(events || [], turns || [], metadata || {});
  }, [events, turns, metadata]);

  if (summary.totalSkills === 0) return null;

  // Filter by category and source
  var nonToolSkills = summary.skills.filter(function (s) {
    if (capFilter !== "all" && s.category !== capFilter) return false;
    if (sourceFilter && s.source !== sourceFilter) return false;
    return true;
  });

  // Count non-tool capabilities
  var interestingCount = summary.skills.filter(function (s) { return s.category !== "tool"; }).length;

  // Category filter tabs
  var catTabs = [
    { id: "all", label: "All", count: summary.totalSkills },
    { id: "skill", label: "Skills", count: (summary.byCategory.skill || []).length },
    { id: "instruction", label: "Instructions", count: (summary.byCategory.instruction || []).length },
    { id: "agent", label: "Agents", count: (summary.byCategory.agent || []).length },
    { id: "tool", label: "Tools", count: (summary.byCategory.tool || []).length },
    { id: "mcp-server", label: "MCP", count: (summary.byCategory["mcp-server"] || []).length },
  ].filter(function (t) { return t.count > 0 || t.id === "all"; });

  return (
    <div>
      <div style={{ fontSize: theme.fontSize.xs, color: theme.text.dim, textTransform: "uppercase", letterSpacing: 1, marginBottom: theme.space.md }}>
        Tools & Skills ({summary.totalSkills})
      </div>

      {/* Category + source filter */}
      <div style={{ display: "flex", gap: 3, marginBottom: theme.space.md, flexWrap: "wrap" }}>
        {catTabs.map(function (tab) {
          var active = capFilter === tab.id;
          return (
            <button
              key={tab.id}
              onClick={function () { setCapFilter(tab.id); setSourceFilter(null); }}
              style={{
                padding: "2px 7px",
                borderRadius: theme.radius.full,
                fontSize: 9,
                fontFamily: theme.font.mono,
                border: "1px solid " + (active ? theme.accent.primary : theme.border.default),
                background: active ? alpha(theme.accent.primary, 0.15) : "transparent",
                color: active ? theme.accent.primary : theme.text.dim,
                cursor: "pointer",
                lineHeight: "14px",
              }}
            >
              {tab.label} {tab.count}
            </button>
          );
        })}
        {sourceFilter && (
          <button
            onClick={function () { setSourceFilter(null); }}
            style={{
              padding: "2px 7px",
              borderRadius: theme.radius.full,
              fontSize: 9,
              fontFamily: theme.font.mono,
              border: "1px solid " + (SOURCE_COLORS[sourceFilter] || theme.border.default),
              background: alpha(SOURCE_COLORS[sourceFilter] || "#585860", 0.15),
              color: SOURCE_COLORS[sourceFilter] || theme.text.dim,
              cursor: "pointer",
              lineHeight: "14px",
            }}
            title="Click to clear source filter"
          >
            {"\u2715 "}{sourceFilter}
          </button>
        )}
      </div>

      {/* Skill list */}
      {nonToolSkills.map(function (skill) {
        var catColor = CATEGORY_COLORS[skill.category] || "#3b9eff";
        var isExpanded = expandedId === skill.id;

        return (
          <div key={skill.id} style={{ marginBottom: 2 }}>
            <div
              onClick={function () { setExpandedId(isExpanded ? null : skill.id); }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "5px 6px",
                borderRadius: theme.radius.md,
                cursor: "pointer",
                transition: "background " + theme.transition.fast,
              }}
              onMouseEnter={function (e) { e.currentTarget.style.background = theme.bg.hover; }}
              onMouseLeave={function (e) { e.currentTarget.style.background = "transparent"; }}
            >
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: catColor, flexShrink: 0 }} />
              <span style={{
                fontSize: theme.fontSize.sm,
                color: theme.text.primary,
                fontFamily: theme.font.mono,
                flex: 1,
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}>
                {skill.name}
                {skill.autoLoaded && (
                  <span style={{ fontSize: 9, color: theme.text.dim, marginLeft: 4, fontFamily: theme.font.ui }}>auto</span>
                )}
              </span>
              <SkillStageBar maxStage={skill.maxStage} hasError={skill.errorCount > 0} />
              {skill.invocationCount > 0 && (
                <span style={{ fontSize: 9, color: theme.text.dim, fontFamily: theme.font.mono, flexShrink: 0 }}>
                  {skill.invocationCount}x
                </span>
              )}
              <span
                onClick={function (e) { e.stopPropagation(); setSourceFilter(sourceFilter === skill.source ? null : skill.source); }}
                style={{
                  fontSize: 9,
                  padding: "0 4px",
                  borderRadius: 3,
                  color: SOURCE_COLORS[skill.source],
                  background: alpha(SOURCE_COLORS[skill.source] || "#585860", 0.1),
                  flexShrink: 0,
                  cursor: "pointer",
                  border: sourceFilter === skill.source ? "1px solid " + SOURCE_COLORS[skill.source] : "1px solid transparent",
                }}
                title={"Filter by source: " + skill.source}
              >
                {skill.source}
              </span>
            </div>

            {isExpanded && (
              <div style={{
                marginLeft: 18,
                padding: "6px 8px",
                borderLeft: "2px solid " + alpha(catColor, 0.3),
                background: theme.bg.surface,
                borderRadius: "0 " + theme.radius.sm + "px " + theme.radius.sm + "px 0",
                marginBottom: 4,
              }}>
                {skill.description && (
                  <div style={{ fontSize: theme.fontSize.xs, color: theme.text.secondary, marginBottom: 4 }}>{skill.description}</div>
                )}
                <div style={{ fontSize: 9, color: theme.text.muted, marginBottom: 4 }}>
                  {STAGE_LABELS[skill.maxStage]} {"\u2022"} {skill.events.length} events {"\u2022"} {skill.invocationCount} uses
                  {skill.errorCount > 0 && (<span style={{ color: theme.semantic.error }}> {"\u2022"} {skill.errorCount} errors</span>)}
                </div>
                <div style={{ maxHeight: 120, overflowY: "auto" }}>
                  {skill.events.map(function (ev, idx) {
                    var stageColor = STAGE_COLORS[ev.stage] || "#585860";
                    return (
                      <div key={idx} style={{
                        display: "flex", alignItems: "center", gap: 5, padding: "2px 0",
                        fontSize: 9, color: theme.text.secondary,
                      }}>
                        <span style={{ width: 4, height: 4, borderRadius: "50%", background: ev.isError ? "#ef4444" : stageColor, flexShrink: 0 }} />
                        <span style={{ color: theme.text.dim, fontFamily: theme.font.mono }}>T{ev.turnIndex}</span>
                        <span style={{ color: stageColor, fontFamily: theme.font.mono }}>{STAGE_LABELS[ev.stage]}</span>
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>{ev.text}</span>
                        {ev.duration > 0 && <span style={{ color: theme.text.dim }}>{ev.duration.toFixed(1)}s</span>}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function StatsView({ events, totalTime, metadata, turns, autonomyMetrics, onOpenCoach }) {
  var [showAllTurns, setShowAllTurns] = useState(false);
  var TURNS_PREVIEW = 15;

  var trackStats = {};
  events.forEach(function (e) {
    if (!trackStats[e.track]) trackStats[e.track] = { count: 0 };
    trackStats[e.track].count++;
  });

  var toolStats = {};
  events.forEach(function (e) {
    if (e.toolName) toolStats[e.toolName] = (toolStats[e.toolName] || 0) + 1;
  });
  var sortedTools = Object.entries(toolStats).sort(function (a, b) { return b[1] - a[1]; });

  // Compute subagent stats
  var agentStats = {};
  events.forEach(function (e) {
    if (e.agentName) {
      if (!agentStats[e.agentName]) {
        agentStats[e.agentName] = { count: 0, totalDuration: 0, displayName: e.agentDisplayName || e.agentName, errors: 0 };
      }
      agentStats[e.agentName].count++;
      if (e.track === "agent" && e.duration > 0) agentStats[e.agentName].totalDuration += e.duration;
      if (e.isError) agentStats[e.agentName].errors++;
    }
  });
  var agentEntries = Object.entries(agentStats).sort(function (a, b) { return b[1].count - a[1].count; });
  var totalAgentEvents = agentEntries.reduce(function (sum, e) { return sum + e[1].count; }, 0);

  var userMsgs = events.filter(function (e) { return e.agent === "user"; }).length;
  var errorCount = metadata ? metadata.errorCount : events.filter(function (e) { return e.isError; }).length;

  // Aggregate token usage per turn
  var turnTokenMap = {};
  events.forEach(function (e) {
    if (e.tokenUsage && e.turnIndex !== undefined) {
      var t = turnTokenMap[e.turnIndex] || { inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheWrite: 0 };
      t.inputTokens += e.tokenUsage.inputTokens || 0;
      t.outputTokens += e.tokenUsage.outputTokens || 0;
      t.cacheRead += e.tokenUsage.cacheRead || 0;
      t.cacheWrite += e.tokenUsage.cacheWrite || 0;
      turnTokenMap[e.turnIndex] = t;
    }
  });

  var cards = [
    { label: "Total Events", value: events.length, color: theme.text.primary },
    { label: "Turns", value: metadata ? metadata.totalTurns : (turns ? turns.length : 0), color: theme.accent.primary },
    { label: "User Messages", value: userMsgs, color: theme.accent.primary },
    { label: "Tool Calls", value: (trackStats.tool_call || {}).count || 0, color: theme.track.tool_call },
    { label: "Errors", value: errorCount, color: errorCount > 0 ? theme.semantic.error : theme.text.ghost },
    { label: "Duration", value: formatDurationLong(totalTime), color: theme.track.context },
  ];
  var autonomySummary = buildAutonomySummary(autonomyMetrics);

  function getAutonomyItemColor(label) {
    if (!autonomyMetrics) return theme.accent.primary;

    if (label === "Autonomy efficiency") {
      var eff = autonomyMetrics.autonomyEfficiency;
      if (eff == null) return theme.accent.primary;
      if (eff >= 0.7) return theme.semantic.success;
      if (eff >= 0.4) return theme.accent.primary;
      return theme.semantic.error;
    }

    if (label === "Human response time") {
      var bt = autonomyMetrics.babysittingTime || 0;
      if (bt > 60) return theme.semantic.error;
      if (bt > 15) return theme.accent.primary;
      return theme.semantic.success;
    }

    if (label === "Idle time") {
      var it = autonomyMetrics.idleTime || 0;
      if (it > 90) return theme.semantic.error;
      if (it > 30) return theme.accent.primary;
      return theme.semantic.success;
    }

    return theme.accent.primary;
  }

  return (
    <ResizablePanel initialSplit={0.72} minPx={200} direction="horizontal">
      <div style={{ height: "100%", display: "flex", flexDirection: "column", gap: theme.space.xl, overflowY: "auto", overflowX: "hidden", padding: theme.space.md + "px 0" }}>
        <div style={{ fontSize: theme.fontSize.xs, color: theme.text.dim, textTransform: "uppercase", letterSpacing: 1 }}>
          Session Overview
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
          {cards.map(function (card) {
            return (
              <div key={card.label} style={{
                background: theme.bg.surface,
                borderRadius: theme.radius.xl,
                padding: "14px 16px",
                border: "1px solid " + theme.border.default,
              }}>
                <div style={{ fontSize: theme.fontSize.xxl, fontWeight: 700, color: card.color, fontFamily: theme.font.mono }}>
                  {card.value}
                </div>
                <div style={{ fontSize: theme.fontSize.xs, color: theme.text.muted, marginTop: 4 }}>{card.label}</div>
              </div>
            );
          })}
        </div>

        {autonomySummary.length > 0 && (
          <div style={{
            background: theme.bg.surface,
            borderRadius: theme.radius.xl,
            padding: "14px 16px",
            border: "1px solid " + theme.border.default,
          }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: theme.fontSize.xs, color: theme.text.dim, textTransform: "uppercase", letterSpacing: 1 }}>
                  Autonomy Metrics
                </div>
                <div style={{ fontSize: theme.fontSize.md, color: theme.text.secondary, marginTop: 6 }}>
                  Get improvement recommendations
                </div>
              </div>
              {onOpenCoach && (
                <ToolbarButton
                  onClick={onOpenCoach}
                  style={{
                    color: theme.accent.primary,
                    borderColor: theme.accent.primary,
                    background: theme.accent.muted,
                    flexShrink: 0,
                  }}
                >
                  Coach this session
                </ToolbarButton>
              )}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: 10 }}>
              {autonomySummary.map(function (item) {
                return (
                  <MetricCard
                    key={item.label}
                    value={item.value}
                    label={item.label}
                    tooltip={item.tooltip}
                    color={getAutonomyItemColor(item.label)}
                  />
                );
              })}
            </div>
          </div>
        )}

        {metadata && metadata.primaryModel && (
          <div style={{
            background: theme.bg.surface,
            borderRadius: theme.radius.xl,
            padding: "12px 16px",
            border: "1px solid " + theme.border.default,
            display: "flex",
            gap: 20,
            alignItems: "center",
          }}>
            <div>
              <div style={{ fontSize: theme.fontSize.xs, color: theme.text.dim, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>
                Model
              </div>
              <div style={{ fontSize: theme.fontSize.lg, color: theme.track.context, fontFamily: theme.font.mono }}>
                {metadata.primaryModel}
              </div>
            </div>
            {metadata.tokenUsage && (metadata.tokenUsage.inputTokens + metadata.tokenUsage.outputTokens) > 0 && (
              <div style={{ borderLeft: "1px solid " + theme.border.default, paddingLeft: 20 }}>
                <div style={{ fontSize: theme.fontSize.xs, color: theme.text.dim, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>
                  Tokens
                </div>
                <div style={{ fontSize: theme.fontSize.base, color: theme.text.secondary, fontFamily: theme.font.mono }}>
                  <span style={{ color: theme.accent.primary }}>{metadata.tokenUsage.inputTokens.toLocaleString()}</span>
                  {" in / "}
                  <span style={{ color: theme.semantic.success }}>{metadata.tokenUsage.outputTokens.toLocaleString()}</span>
                  {" out"}
                </div>
                {metadata.tokenUsage.cacheRead > 0 && (
                  <div style={{ fontSize: theme.fontSize.xs, color: theme.text.muted, fontFamily: theme.font.mono, marginTop: 2 }}>
                    {metadata.tokenUsage.cacheRead.toLocaleString()} cache read
                  </div>
                )}
              </div>
            )}
            {metadata.tokenUsage && (metadata.tokenUsage.inputTokens + metadata.tokenUsage.outputTokens) > 0 && (
              <div style={{ borderLeft: "1px solid " + theme.border.default, paddingLeft: 20 }}>
                <div style={{ fontSize: theme.fontSize.xs, color: theme.text.dim, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>
                  Est. Cost
                </div>
                <div style={{ fontSize: theme.fontSize.lg, color: theme.semantic.success, fontFamily: theme.font.mono, fontWeight: 600 }}>
                  {formatCost(estimateCost(metadata.tokenUsage, metadata.primaryModel))}
                </div>
                <div style={{ fontSize: theme.fontSize.xs, color: theme.text.muted, marginTop: 2 }}>
                  based on {metadata.primaryModel ? metadata.primaryModel.split("-").slice(0, 3).join("-") : "default"} pricing
                </div>
              </div>
            )}
            {Object.keys(metadata.models).length > 1 && (
              <div style={{ borderLeft: "1px solid " + theme.border.default, paddingLeft: 20 }}>
                <div style={{ fontSize: theme.fontSize.xs, color: theme.text.dim, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>
                  All Models
                </div>
                <div style={{ fontSize: theme.fontSize.sm, color: theme.text.muted }}>
                  {Object.entries(metadata.models).map(function (entry) {
                    return entry[0].split("-").slice(0, 3).join("-") + " (" + entry[1] + ")";
                  }).join(", ")}
                </div>
              </div>
            )}
          </div>
        )}

        {agentEntries.length > 0 && (
          <div style={{ marginTop: theme.space.md, marginBottom: theme.space.xl }}>
            <div style={{ fontSize: theme.fontSize.xs, color: theme.text.dim, textTransform: "uppercase", letterSpacing: 1, marginBottom: theme.space.lg, display: "flex", alignItems: "center", gap: theme.space.sm }}>
              <Icon name="agent" size={13} /> Subagents ({agentEntries.length})
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: theme.space.md }}>
              {agentEntries.map(function (entry) {
                var name = entry[0];
                var stats = entry[1];
                var agentColor = theme.agentType[name] || theme.agentType.default;
                return (
                  <div key={name} style={{
                    border: "1px solid " + alpha(agentColor, 0.3),
                    borderRadius: theme.radius.lg,
                    padding: theme.space.lg + "px " + theme.space.lg + "px",
                    background: alpha(agentColor, 0.04),
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: theme.space.sm, marginBottom: theme.space.sm }}>
                      <div style={{ width: 8, height: 8, borderRadius: theme.radius.full, background: agentColor }} />
                      <span style={{ fontSize: theme.fontSize.base, color: agentColor, fontWeight: 600, fontFamily: theme.font.mono }}>{stats.displayName}</span>
                    </div>
                    <div style={{ fontSize: theme.fontSize.xs, color: theme.text.muted, display: "flex", gap: theme.space.lg }}>
                      <span>{stats.count} events</span>
                      {stats.totalDuration > 0 && <span>{formatDurationLong(stats.totalDuration)}</span>}
                      {stats.errors > 0 && <span style={{ color: theme.semantic.error }}>{stats.errors} errors</span>}
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{ fontSize: theme.fontSize.xs, color: theme.text.dim, marginTop: theme.space.md }}>
              {totalAgentEvents} events across {agentEntries.length} agent type{agentEntries.length !== 1 ? "s" : ""}
            </div>
          </div>
        )}

        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: theme.fontSize.xs, color: theme.text.dim, textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>
            Event Distribution
          </div>
          {Object.entries(TRACK_TYPES).map(function (entry) {
            var key = entry[0];
            var info = entry[1];
            var count = (trackStats[key] || {}).count || 0;
            if (count === 0) return null;
            var pct = events.length > 0 ? (count / events.length) * 100 : 0;
            return (
              <div key={key} style={{ marginBottom: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ fontSize: theme.fontSize.base, color: info.color, display: "flex", alignItems: "center", gap: 5 }}>
                    <Icon name={key} size={13} /> {info.label}
                  </span>
                  <span style={{ fontSize: theme.fontSize.base, color: theme.text.muted }}>{count} ({pct.toFixed(0)}%)</span>
                </div>
                <div style={{ height: 6, background: theme.bg.base, borderRadius: theme.radius.sm }}>
                  <div style={{
                    height: "100%",
                    width: pct + "%",
                    background: info.color,
                    borderRadius: theme.radius.sm,
                    transition: "width " + theme.transition.smooth,
                  }} />
                </div>
              </div>
            );
          })}
        </div>

        {turns && turns.length > 0 && (
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <div style={{ fontSize: theme.fontSize.xs, color: theme.text.dim, textTransform: "uppercase", letterSpacing: 1 }}>
                Turns ({turns.length})
              </div>
              {turns.length > TURNS_PREVIEW && (
                <button className="av-btn" onClick={function () { setShowAllTurns(function (v) { return !v; }); }} style={{ fontSize: theme.fontSize.xs, color: theme.accent.primary, background: "transparent", border: "none", cursor: "pointer", padding: 0 }}>
                  {showAllTurns ? "Show less" : "Show all " + turns.length}
                </button>
              )}
            </div>
            {(showAllTurns ? turns : turns.slice(0, TURNS_PREVIEW)).map(function (turn) {
              return (
                <div key={turn.index} style={{
                  display: "flex",
                  gap: 10,
                  padding: "6px 10px",
                  borderRadius: theme.radius.lg,
                  background: turn.hasError ? theme.semantic.errorBg : theme.bg.surface,
                  border: "1px solid " + (turn.hasError ? theme.semantic.errorBorder : theme.border.default),
                  marginBottom: 6,
                  alignItems: "center",
                }}>
                  <span style={{ fontSize: theme.fontSize.base, color: theme.text.dim, fontWeight: 600, minWidth: 20, flexShrink: 0 }}>
                    {turn.index + 1}
                  </span>
                  <span style={{
                    fontSize: theme.fontSize.base,
                    color: theme.text.secondary,
                    flex: 1,
                    minWidth: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}>
                    {turn.userMessage || "(no message)"}
                  </span>
                  {turn.toolCount > 0 && (
                    <span style={{ fontSize: theme.fontSize.xs, color: theme.track.tool_call, flexShrink: 0 }}>{turn.toolCount} tools</span>
                  )}
                  {turnTokenMap[turn.index] && (
                    <span style={{ fontSize: theme.fontSize.xs, color: theme.text.muted, fontFamily: theme.font.mono, flexShrink: 0 }}>
                      {formatCost(estimateCost(turnTokenMap[turn.index], metadata && metadata.primaryModel))}
                    </span>
                  )}
                  {turn.hasError && (
                    <span style={{ fontSize: theme.fontSize.xs, color: theme.semantic.error, display: "inline-flex", alignItems: "center", flexShrink: 0 }}><Icon name="alert-circle" size={11} /></span>
                  )}
                </div>
              );
            })}
            {!showAllTurns && turns.length > TURNS_PREVIEW && (
              <div style={{ fontSize: theme.fontSize.xs, color: theme.text.dim, textAlign: "center", padding: "6px 0" }}>
                {turns.length - TURNS_PREVIEW} more turns hidden
              </div>
            )}
          </div>
        )}
      </div>

      <div style={{ height: "100%", overflowY: "auto", padding: theme.space.lg }}>
        <CapabilitiesPanel events={events} turns={turns} metadata={metadata} />
      </div>
    </ResizablePanel>
  );
}
