import { theme, TRACK_TYPES, alpha } from "../lib/theme.js";
import Icon from "./Icon.jsx";
import { estimateCost, estimateMultiModelCost, formatCost, formatSessionCost, getSessionCostLabel, isAiCreditsUnit, hasModelPricing } from "../lib/pricing.js";
import { formatDurationLong } from "../lib/formatTime.js";
import { formatCacheUsageSummary, summarizeTokenUsage } from "../lib/cacheMetrics";
import ToolbarButton from "./ui/ToolbarButton.jsx";
import ResizablePanel from "./ResizablePanel.jsx";
import { buildAutonomySummary } from "../lib/autonomyMetrics.js";
import { useState, useMemo } from "react";
import { extractSkills } from "../lib/skillExtractor.js";

function getCardStyle() {
  return {
    background: theme.bg.surface,
    borderRadius: theme.radius.xl,
    padding: "14px 16px",
    border: "1px solid " + theme.border.default,
  };
}

function MetricCard({ value, label, tooltip, color }) {
  var [hovered, setHovered] = useState(false);
  var cardStyle = getCardStyle();
  return (
    <div
      style={Object.assign({}, cardStyle, { cursor: "default", position: "relative" })}
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

function getSourceColors() {
  return {
    project: theme.track.tool_call,
    personal: theme.track.context,
    extension: theme.track.agent,
    "built-in": theme.track.reasoning,
    mcp: theme.semantic.success,
    unknown: theme.text.dim,
  };
}

function getCategoryColors() {
  return {
    skill: theme.track.context,
    instruction: theme.accent.primary,
    agent: theme.track.agent,
    tool: theme.track.tool_call,
    "mcp-server": theme.semantic.success,
    prompt: theme.semantic.success,
  };
}

function getStageColors() {
  return {
    discovered: theme.text.dim,
    loaded: theme.accent.primary,
    invoked: theme.track.tool_call,
    "resource-accessed": theme.track.context,
    completed: theme.semantic.success,
    errored: theme.semantic.error,
  };
}

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
  var stageColors = getStageColors();
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
              borderRadius: theme.radius.sm / 2,
              background: isErr ? theme.semantic.error : reached ? stageColors[stage] : theme.text.ghost,
              opacity: reached ? 1 : 0.25,
            }}
          />
        );
      })}
    </div>
  );
}

function CapabilityRow({ skill, isExpanded, onToggle, sourceFilter, onSourceFilter }) {
  var [hovered, setHovered] = useState(false);
  var categoryColors = getCategoryColors();
  var sourceColors = getSourceColors();
  var stageColors = getStageColors();
  var catColor = categoryColors[skill.category] || theme.track.tool_call;
  return (
    <div style={{ marginBottom: 2 }}>
      <div
        onClick={onToggle}
        onMouseEnter={function () { setHovered(true); }}
        onMouseLeave={function () { setHovered(false); }}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "5px 6px",
          borderRadius: theme.radius.md,
          cursor: "pointer",
          transition: "background " + theme.transition.fast,
          background: hovered ? theme.bg.hover : "transparent",
        }}
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
            <span style={{ fontSize: theme.fontSize.xs, color: theme.text.dim, marginLeft: 4, fontFamily: theme.font.mono }}>auto</span>
          )}
        </span>
        <SkillStageBar maxStage={skill.maxStage} hasError={skill.errorCount > 0} />
        {skill.invocationCount > 0 && (
          <span style={{ fontSize: theme.fontSize.xs, color: theme.text.dim, fontFamily: theme.font.mono, flexShrink: 0 }}>
            {skill.invocationCount}x
          </span>
        )}
        <span
          onClick={function (e) { e.stopPropagation(); onSourceFilter(sourceFilter === skill.source ? null : skill.source); }}
          style={{
            fontSize: theme.fontSize.xs,
            padding: "0 4px",
            borderRadius: theme.radius.sm / 2,
            color: sourceColors[skill.source],
            background: alpha(sourceColors[skill.source] || theme.text.dim, 0.1),
            flexShrink: 0,
            cursor: "pointer",
            border: sourceFilter === skill.source ? "1px solid " + sourceColors[skill.source] : "1px solid transparent",
          }}
          title={skill.sourceLabel || skill.source}
        >
          {skill.sourceLabel || skill.source}
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
          <div style={{ fontSize: theme.fontSize.xs, color: theme.text.muted, marginBottom: 4 }}>
            {STAGE_LABELS[skill.maxStage]} {"\u2022"} {skill.events.length} events {"\u2022"} {skill.invocationCount} uses
            {skill.errorCount > 0 && (<span style={{ color: theme.semantic.error }}> {"\u2022"} {skill.errorCount} errors</span>)}
          </div>
          <div style={{ maxHeight: 120, overflowY: "auto" }}>
            {skill.events.map(function (ev, idx) {
              var stageColor = stageColors[ev.stage] || theme.text.dim;
              return (
                <div key={idx} style={{
                  display: "flex", alignItems: "center", gap: 5, padding: "2px 0",
                  fontSize: theme.fontSize.xs, color: theme.text.secondary,
                }}>
                  <span style={{ width: 4, height: 4, borderRadius: "50%", background: ev.isError ? theme.semantic.error : stageColor, flexShrink: 0 }} />
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
}

function CapabilitiesPanel({ events, turns, metadata }) {
  var [expandedId, setExpandedId] = useState(null);
  var [capFilter, setCapFilter] = useState("all");
  var [sourceFilter, setSourceFilter] = useState(null);
  var sourceColors = getSourceColors();

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

  // Category filter tabs
  var catTabs = [
    { id: "all", label: "All", count: summary.totalSkills },
    { id: "skill", label: "Skills", count: (summary.byCategory.skill || []).length },
    { id: "instruction", label: "Instructions", count: (summary.byCategory.instruction || []).length },
    { id: "agent", label: "Agents", count: (summary.byCategory.agent || []).length },
    { id: "tool", label: "Tools", count: (summary.byCategory.tool || []).length },
    { id: "mcp-server", label: "MCP", count: (summary.byCategory["mcp-server"] || []).length },
    { id: "prompt", label: "Prompts", count: (summary.byCategory.prompt || []).length },
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
                fontSize: theme.fontSize.xs,
                fontFamily: theme.font.mono,
                border: "1px solid " + (active ? theme.accent.primary : theme.border.default),
                background: active ? alpha(theme.accent.primary, 0.15) : "transparent",
                color: active ? theme.accent.primary : theme.text.dim,
                cursor: "pointer",
                lineHeight: (theme.fontSize.xs + theme.space.sm) + "px",
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
              fontSize: theme.fontSize.xs,
              fontFamily: theme.font.mono,
              border: "1px solid " + (sourceColors[sourceFilter] || theme.border.default),
              background: alpha(sourceColors[sourceFilter] || theme.text.dim, 0.15),
              color: sourceColors[sourceFilter] || theme.text.dim,
              cursor: "pointer",
              lineHeight: (theme.fontSize.xs + theme.space.sm) + "px",
            }}
            title="Click to clear source filter"
          >
            {"\u2715 "}{sourceFilter}
          </button>
        )}
      </div>

      {/* Skill list */}
      {nonToolSkills.length === 0 && (
        <div style={{ fontSize: theme.fontSize.md, color: theme.text.dim, textAlign: "center", padding: theme.space.lg + "px 0" }}>
          No matching capabilities
        </div>
      )}
      {nonToolSkills.map(function (skill) {
        return (
          <CapabilityRow
            key={skill.id}
            skill={skill}
            isExpanded={expandedId === skill.id}
            onToggle={function () { setExpandedId(expandedId === skill.id ? null : skill.id); }}
            sourceFilter={sourceFilter}
            onSourceFilter={setSourceFilter}
          />
        );
      })}
    </div>
  );
}

export default function StatsView({ events, totalTime, metadata, turns, autonomyMetrics, onOpenCoach }) {
  var [showAllTurns, setShowAllTurns] = useState(false);
  var TURNS_PREVIEW = 15;
  var cardStyle = getCardStyle();
  var themeMode = theme.mode;

  // Memoize O(n) event iterations so they don't re-run on every parent re-render.
  var trackStats = useMemo(function () {
    var stats = {};
    events.forEach(function (e) {
      if (!stats[e.track]) stats[e.track] = { count: 0 };
      stats[e.track].count++;
    });
    return stats;
  }, [events]);

  var agentData = useMemo(function () {
    var stats = {};
    events.forEach(function (e) {
      if (e.agentName) {
        if (!stats[e.agentName]) {
          stats[e.agentName] = { count: 0, totalDuration: 0, displayName: e.agentDisplayName || e.agentName, errors: 0 };
        }
        stats[e.agentName].count++;
        if (e.track === "agent" && e.duration > 0) stats[e.agentName].totalDuration += e.duration;
        if (e.isError) stats[e.agentName].errors++;
      }
    });
    var entries = Object.entries(stats).sort(function (a, b) { return b[1].count - a[1].count; });
    var total = entries.reduce(function (sum, e) { return sum + e[1].count; }, 0);
    return { agentStats: stats, agentEntries: entries, totalAgentEvents: total };
  }, [events]);
  var agentStats = agentData.agentStats;
  var agentEntries = agentData.agentEntries;
  var totalAgentEvents = agentData.totalAgentEvents;

  var eventCounts = useMemo(function () {
    var userMsgs = events.filter(function (e) { return e.agent === "user"; }).length;
    var errorCount = metadata ? metadata.errorCount : events.filter(function (e) { return e.isError; }).length;
    return { userMsgs: userMsgs, errorCount: errorCount };
  }, [events, metadata]);
  var userMsgs = eventCounts.userMsgs;
  var errorCount = eventCounts.errorCount;

  var tokenMaps = useMemo(function () {
    var turnMap = {};
    var modelMap = {};
    events.forEach(function (e) {
      if (e.tokenUsage) {
        if (e.turnIndex !== undefined) {
          var t = summarizeTokenUsage([turnMap[e.turnIndex], e.tokenUsage]);
          turnMap[e.turnIndex] = t;
        }
        var modelKey = e.model || (metadata && metadata.primaryModel) || "__unknown__";
        var m = modelMap[modelKey] || { inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheWrite: 0 };
        m.inputTokens += e.tokenUsage.inputTokens || 0;
        m.outputTokens += e.tokenUsage.outputTokens || 0;
        m.cacheRead += e.tokenUsage.cacheRead || 0;
        m.cacheWrite += e.tokenUsage.cacheWrite || 0;
        modelMap[modelKey] = m;
      }
    });
    var cacheSummary = metadata && metadata.tokenUsage
      ? formatCacheUsageSummary(metadata.tokenUsage, { variant: "compact" })
      : null;
    return { turnTokenMap: turnMap, modelTokenMap: modelMap, sessionCacheSummary: cacheSummary };
  }, [events, metadata]);
  var turnTokenMap = tokenMaps.turnTokenMap;
  var modelTokenMap = tokenMaps.modelTokenMap;
  var sessionCacheSummary = tokenMaps.sessionCacheSummary;

  var cards = useMemo(function () {
    return [
      { label: "Total Events", value: events.length, color: theme.text.primary },
      { label: "Turns", value: metadata ? metadata.totalTurns : (turns ? turns.length : 0), color: theme.accent.primary },
      { label: "User Messages", value: userMsgs, color: theme.accent.primary },
      { label: "Tool Calls", value: (trackStats.tool_call || {}).count || 0, color: theme.track.tool_call },
      { label: "Errors", value: errorCount, color: errorCount > 0 ? theme.semantic.error : theme.text.muted },
      { label: "Duration", value: formatDurationLong(totalTime), color: theme.track.context },
    ];
  }, [events.length, metadata, turns, totalTime, trackStats, userMsgs, errorCount, themeMode]);
  var autonomySummary = useMemo(function () {
    return buildAutonomySummary(autonomyMetrics);
  }, [autonomyMetrics]);

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

  var modelUsageData = useMemo(function () {
    if (!metadata || !metadata.primaryModel) return null;
    var hasTokens = metadata.tokenUsage && (metadata.tokenUsage.inputTokens + metadata.tokenUsage.outputTokens) > 0;
    var hasApiCost = metadata.totalCost != null;
    var perModelData = metadata.modelTokenUsage || (Object.keys(modelTokenMap).length > 0 ? modelTokenMap : null);
    var modelKeys = perModelData ? Object.keys(perModelData) : [];
    var modelCount = modelKeys.length;
    var pricedCount = modelKeys.filter(function (k) { return hasModelPricing(k); }).length;
    var estimated = perModelData
      ? estimateMultiModelCost(perModelData)
      : estimateCost(metadata.tokenUsage, metadata.primaryModel);
    var modelLabel;
    if (modelCount > 1) {
      modelLabel = pricedCount < modelCount
        ? pricedCount + " of " + modelCount + " models"
        : modelCount + " models";
    } else if (modelCount === 1) {
      modelLabel = modelKeys[0].split("-").slice(0, 3).join("-") + " pricing";
    } else {
      modelLabel = (metadata.primaryModel ? metadata.primaryModel.split("-").slice(0, 3).join("-") : "default") + " pricing";
    }

    var usageCards = [];
    var mKeys = Object.keys(metadata.models || {});
    var modelCardValue = mKeys.length > 1
      ? metadata.primaryModel.split("-").slice(0, 3).join("-") + " +" + (mKeys.length - 1) + " more"
      : metadata.primaryModel;
    usageCards.push({ label: mKeys.length > 1 ? "Models" : "Model", value: modelCardValue, color: theme.track.context });
    if (hasTokens) {
      usageCards.push({ label: "Tokens", color: theme.accent.primary, isTokenCard: true });
    }
    if (hasApiCost) {
      usageCards.push({
        label: getSessionCostLabel(metadata),
        value: formatSessionCost(metadata),
        color: theme.semantic.success,
        sub: isAiCreditsUnit(metadata.totalCostUnit) ? "reported by Copilot" : "reported by API",
      });
    }
    if (estimated > 0) {
      usageCards.push({ label: "Est. Cost", value: formatCost(estimated), color: hasApiCost ? theme.text.muted : theme.semantic.success, sub: "based on " + modelLabel });
    }
    var allModelsEntries = Object.keys(metadata.models).length > 1
      ? Object.entries(metadata.models).sort(function (a, b) { return b[1] - a[1]; })
      : null;
    return { usageCards: usageCards, allModelsEntries: allModelsEntries };
  }, [metadata, modelTokenMap, themeMode]);

  return (
    <ResizablePanel initialSplit={0.72} minPx={200} direction="horizontal">
      <div style={{ height: "100%", display: "flex", flexDirection: "column", gap: theme.space.xl, overflowY: "auto", overflowX: "hidden", padding: theme.space.md + "px " + theme.space.lg + "px " + theme.space.md + "px 0" }}>
        <div style={{ fontSize: theme.fontSize.xs, color: theme.text.dim, textTransform: "uppercase", letterSpacing: 1 }}>
          Session Overview
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
          {cards.map(function (card) {
            return (
              <div key={card.label} style={cardStyle}>
                <div style={{ fontSize: theme.fontSize.xxl, fontWeight: 700, color: card.color, fontFamily: theme.font.mono }}>
                  {card.value}
                </div>
                <div style={{ fontSize: theme.fontSize.xs, color: theme.text.muted, marginTop: 4 }}>{card.label}</div>
              </div>
            );
          })}
        </div>

        {autonomySummary.length > 0 && (
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
              <div style={{ fontSize: theme.fontSize.xs, color: theme.text.dim, textTransform: "uppercase", letterSpacing: 1 }}>
                Autonomy Metrics
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

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
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

        {modelUsageData && (
          <div>
            <div style={{ fontSize: theme.fontSize.xs, color: theme.text.dim, textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>
              Model &amp; Usage
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
              {modelUsageData.usageCards.map(function (card) {
                return (
                  <div key={card.label} style={cardStyle}>
                    {card.isTokenCard ? (
                      <div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 2, fontFamily: theme.font.mono }}>
                          <div style={{ fontSize: theme.fontSize.lg, fontWeight: 700 }}>
                            <span style={{ color: theme.accent.primary }}>{metadata.tokenUsage.inputTokens.toLocaleString()}</span>
                            <span style={{ color: theme.text.muted }}>{" in"}</span>
                          </div>
                          <div style={{ fontSize: theme.fontSize.lg, fontWeight: 700 }}>
                            <span style={{ color: theme.semantic.success }}>{metadata.tokenUsage.outputTokens.toLocaleString()}</span>
                            <span style={{ color: theme.text.muted }}>{" out"}</span>
                          </div>
                        </div>
                        {sessionCacheSummary && (
                          <div style={{ fontSize: theme.fontSize.xs, color: theme.text.muted, fontFamily: theme.font.mono, marginTop: 6 }}>
                            {sessionCacheSummary}
                          </div>
                        )}
                        <div style={{ fontSize: theme.fontSize.xs, color: theme.text.muted, marginTop: 4 }}>{card.label}</div>
                      </div>
                    ) : (
                      <div>
                        <div style={{ fontSize: theme.fontSize.lg, fontWeight: 700, color: card.color, fontFamily: theme.font.mono }}>{card.value}</div>
                        {card.sub && <div style={{ fontSize: theme.fontSize.xs, color: theme.text.muted, marginTop: 4 }}>{card.sub}</div>}
                        <div style={{ fontSize: theme.fontSize.xs, color: theme.text.muted, marginTop: card.sub ? 2 : 4 }}>{card.label}</div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {modelUsageData.allModelsEntries && (
              <div style={Object.assign({}, cardStyle, { marginTop: 12 })}>
                <div style={{ fontSize: theme.fontSize.xs, color: theme.text.dim, textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>
                  All Models
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {modelUsageData.allModelsEntries.map(function (entry) {
                    return (
                      <div key={entry[0]} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: theme.fontSize.sm }}>
                        <span style={{ color: theme.text.secondary, fontFamily: theme.font.mono }}>{entry[0].split("-").slice(0, 3).join("-")}</span>
                        <span style={{ color: theme.text.muted, fontFamily: theme.font.mono }}>{entry[1] + " calls"}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {agentEntries.length > 0 && (
          <div>
            <div style={{ fontSize: theme.fontSize.xs, color: theme.text.dim, textTransform: "uppercase", letterSpacing: 1, marginBottom: theme.space.lg }}>
              Subagents ({agentEntries.length})
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: theme.space.md }}>
              {agentEntries.map(function (entry) {
                var name = entry[0];
                var stats = entry[1];
                var agentColor = theme.agentType[name] || theme.agentType.default;
                return (
                  <div key={name} style={Object.assign({}, cardStyle, {
                    border: "1px solid " + alpha(agentColor, 0.35),
                  })}>
                    <div style={{ display: "flex", alignItems: "center", gap: theme.space.sm, marginBottom: theme.space.sm }}>
                      <div style={{ width: 8, height: 8, borderRadius: theme.radius.full, background: agentColor }} />
                      <span style={{ fontSize: theme.fontSize.base, color: agentColor, fontWeight: 600, fontFamily: theme.font.mono }}>{stats.displayName}</span>
                    </div>
                    <div style={{ fontSize: theme.fontSize.xs, color: theme.text.muted, display: "flex", gap: theme.space.lg, flexWrap: "wrap", rowGap: 4 }}>
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
              <div key={key} style={{ marginBottom: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ fontSize: theme.fontSize.base, color: info.color, display: "flex", alignItems: "center", gap: 4 }}>
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
                  gap: 8,
                  padding: "8px 12px",
                  borderRadius: theme.radius.lg,
                  background: turn.hasError ? theme.semantic.errorBg : theme.bg.surface,
                  border: "1px solid " + (turn.hasError ? theme.semantic.errorBorder : theme.border.default),
                  marginBottom: 8,
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
                  {formatCacheUsageSummary(turnTokenMap[turn.index], { variant: "verbose" }) && (
                    <span style={{ fontSize: theme.fontSize.xs, color: theme.text.muted, fontFamily: theme.font.mono, flexShrink: 0 }}>
                      {formatCacheUsageSummary(turnTokenMap[turn.index], { variant: "verbose" })}
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
