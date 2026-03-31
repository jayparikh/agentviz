import { theme, alpha } from "../lib/theme.js";
import Icon from "./Icon.jsx";
import { useState, useMemo } from "react";
import { extractSkills } from "../lib/skillExtractor.ts";

// ── Category icons & colors ──────────────────────────────────────────────────

var CATEGORY_META = {
  skill: { icon: "sparkles", color: "#a78bfa", label: "Skills" },
  instruction: { icon: "context", color: "#6475e8", label: "Instructions" },
  agent: { icon: "agent", color: "#f59e0b", label: "Agents" },
  tool: { icon: "tool_call", color: "#3b9eff", label: "Tools" },
  "mcp-server": { icon: "graph", color: "#10d97a", label: "MCP Servers" },
  prompt: { icon: "output", color: "#10d97a", label: "Prompts" },
  plugin: { icon: "sparkles", color: "#ec4899", label: "Plugins" },
};

var SOURCE_META = {
  project: { color: "#3b9eff", label: "Project", desc: ".github/skills/, repo config" },
  personal: { color: "#a78bfa", label: "Personal", desc: "~/.copilot/skills/, user profile" },
  extension: { color: "#f59e0b", label: "Extension", desc: "VS Code extensions, plugins" },
  "built-in": { color: "#94a3b8", label: "Built-in", desc: "Default agent tools" },
  mcp: { color: "#10d97a", label: "MCP", desc: "Model Context Protocol servers" },
  unknown: { color: theme.text.dim, label: "Unknown", desc: "Source not determined" },
};

var STAGE_META = {
  discovered: { color: theme.text.dim, label: "Discovered", icon: "circle" },
  loaded: { color: "#6475e8", label: "Loaded", icon: "context" },
  invoked: { color: "#3b9eff", label: "Invoked", icon: "play" },
  "resource-accessed": { color: "#a78bfa", label: "Resources", icon: "context" },
  completed: { color: "#10d97a", label: "Completed", icon: "circle" },
  errored: { color: "#ef4444", label: "Errored", icon: "alert-circle" },
};

// ── Stage progress bar ───────────────────────────────────────────────────────

var STAGE_SEQUENCE = ["discovered", "loaded", "invoked", "resource-accessed", "completed"];

function StageProgressBar({ maxStage, hasError }) {
  var activeIdx = STAGE_SEQUENCE.indexOf(maxStage);
  if (activeIdx < 0) activeIdx = maxStage === "errored" ? 4 : 0;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
      {STAGE_SEQUENCE.map(function (stage, idx) {
        var reached = idx <= activeIdx;
        var isError = hasError && idx === activeIdx;
        var meta = STAGE_META[stage];
        var color = isError ? "#ef4444" : reached ? meta.color : theme.text.ghost;
        return (
          <div
            key={stage}
            title={meta.label}
            style={{
              width: 18,
              height: 4,
              borderRadius: 2,
              background: color,
              opacity: reached ? 1 : 0.3,
              transition: "background 150ms ease-out",
            }}
          />
        );
      })}
    </div>
  );
}

// ── Source badge ──────────────────────────────────────────────────────────────

function SourceBadge({ source }) {
  var meta = SOURCE_META[source] || SOURCE_META.unknown;
  return (
    <span
      title={meta.desc}
      style={{
        display: "inline-block",
        padding: "1px 6px",
        borderRadius: theme.radius.sm,
        fontSize: theme.fontSize.xs,
        fontFamily: theme.font.mono,
        color: meta.color,
        background: alpha(meta.color, 0.12),
        border: "1px solid " + alpha(meta.color, 0.2),
        lineHeight: "16px",
        whiteSpace: "nowrap",
      }}
    >
      {meta.label}
    </span>
  );
}

// ── Category badge ───────────────────────────────────────────────────────────

function CategoryBadge({ category }) {
  var meta = CATEGORY_META[category] || CATEGORY_META.tool;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        padding: "1px 6px",
        borderRadius: theme.radius.sm,
        fontSize: theme.fontSize.xs,
        fontFamily: theme.font.mono,
        color: meta.color,
        background: alpha(meta.color, 0.08),
        lineHeight: "16px",
        whiteSpace: "nowrap",
      }}
    >
      <Icon name={meta.icon} size={10} style={{ opacity: 0.8 }} />
      {meta.label}
    </span>
  );
}

// ── Summary metric card ──────────────────────────────────────────────────────

function MetricCard({ value, label, color }) {
  return (
    <div style={{
      border: "1px solid " + theme.border.default,
      borderRadius: theme.radius.lg,
      padding: "12px 14px",
      background: theme.bg.base,
    }}>
      <div style={{ fontSize: theme.fontSize.lg, color: color || theme.text.primary, fontFamily: theme.font.mono, fontWeight: 700 }}>
        {value}
      </div>
      <div style={{ fontSize: theme.fontSize.xs, color: theme.text.muted, marginTop: 4 }}>{label}</div>
    </div>
  );
}

// ── Skill row ────────────────────────────────────────────────────────────────

function SkillRow({ skill, isExpanded, onToggle }) {
  var [hovered, setHovered] = useState(false);
  var catMeta = CATEGORY_META[skill.category] || CATEGORY_META.tool;

  return (
    <div>
      <div
        onClick={onToggle}
        onMouseEnter={function () { setHovered(true); }}
        onMouseLeave={function () { setHovered(false); }}
        style={{
          display: "grid",
          gridTemplateColumns: "24px 1fr auto auto auto auto",
          alignItems: "center",
          gap: 12,
          padding: "8px 12px",
          cursor: "pointer",
          background: hovered ? theme.bg.hover : "transparent",
          borderRadius: theme.radius.md,
          transition: "background " + theme.transition.fast,
        }}
      >
        {/* Category icon */}
        <div style={{ color: catMeta.color, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Icon name={catMeta.icon} size={14} />
        </div>

        {/* Name + description */}
        <div style={{ minWidth: 0 }}>
          <div style={{
            fontSize: theme.fontSize.base,
            color: theme.text.primary,
            fontFamily: theme.font.mono,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}>
            {skill.name}
            {skill.autoLoaded && (
              <span style={{ fontSize: theme.fontSize.xs, color: theme.text.dim, marginLeft: 6, fontFamily: theme.font.ui }}>auto</span>
            )}
          </div>
          {skill.filePath && (
            <div style={{
              fontSize: theme.fontSize.xs,
              color: theme.text.dim,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              marginTop: 1,
            }}>
              {skill.filePath}
            </div>
          )}
        </div>

        {/* Lifecycle progress */}
        <StageProgressBar maxStage={skill.maxStage} hasError={skill.errorCount > 0} />

        {/* Source badge */}
        <SourceBadge source={skill.source} />

        {/* Invocation count */}
        <div style={{
          fontSize: theme.fontSize.sm,
          fontFamily: theme.font.mono,
          color: skill.invocationCount > 0 ? theme.text.secondary : theme.text.dim,
          textAlign: "right",
          minWidth: 32,
        }}>
          {skill.invocationCount > 0 ? skill.invocationCount + "\u00D7" : "\u2014"}
        </div>

        {/* Expand chevron */}
        <div style={{ color: theme.text.dim }}>
          <Icon name={isExpanded ? "chevron-up" : "chevron-down"} size={12} />
        </div>
      </div>

      {/* Expanded detail */}
      {isExpanded && (
        <div style={{
          marginLeft: 36,
          marginTop: 4,
          marginBottom: 8,
          padding: "8px 12px",
          borderLeft: "2px solid " + alpha(catMeta.color, 0.3),
          background: theme.bg.surface,
          borderRadius: "0 " + theme.radius.md + "px " + theme.radius.md + "px 0",
        }}>
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <CategoryBadge category={skill.category} />
            <SourceBadge source={skill.source} />
            {skill.errorCount > 0 && (
              <span style={{ fontSize: theme.fontSize.xs, color: theme.semantic.error }}>
                {skill.errorCount} error{skill.errorCount !== 1 ? "s" : ""}
              </span>
            )}
          </div>
          {skill.description && (
            <div style={{ fontSize: theme.fontSize.sm, color: theme.text.secondary, marginBottom: 6 }}>
              {skill.description}
            </div>
          )}
          <div style={{ fontSize: theme.fontSize.xs, color: theme.text.muted, marginBottom: 6 }}>
            Lifecycle: {STAGE_META[skill.maxStage].label}
            {" \u2022 "}{skill.events.length} event{skill.events.length !== 1 ? "s" : ""}
            {" \u2022 "}{skill.invocationCount} invocation{skill.invocationCount !== 1 ? "s" : ""}
          </div>
          {/* Event log */}
          <div style={{ maxHeight: 160, overflowY: "auto" }}>
            {skill.events.map(function (ev, idx) {
              var stageMeta = STAGE_META[ev.stage] || STAGE_META.discovered;
              return (
                <div key={idx} style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "3px 0",
                  fontSize: theme.fontSize.xs,
                  color: theme.text.secondary,
                }}>
                  <span style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: ev.isError ? theme.semantic.error : stageMeta.color,
                    flexShrink: 0,
                  }} />
                  <span style={{ color: theme.text.dim, fontFamily: theme.font.mono, flexShrink: 0 }}>
                    T{ev.turnIndex}
                  </span>
                  <span style={{ fontFamily: theme.font.mono, color: stageMeta.color, flexShrink: 0 }}>
                    {stageMeta.label}
                  </span>
                  <span style={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    flex: 1,
                    minWidth: 0,
                  }}>
                    {ev.text}
                  </span>
                  {ev.duration > 0 && (
                    <span style={{ color: theme.text.dim, flexShrink: 0 }}>
                      {ev.duration.toFixed(1)}s
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Filter bar ───────────────────────────────────────────────────────────────

function FilterBar({ filter, onFilterChange, summary }) {
  var filters = [
    { id: "all", label: "All", count: summary.totalSkills },
    { id: "skill", label: "Skills", count: (summary.byCategory.skill || []).length },
    { id: "instruction", label: "Instructions", count: (summary.byCategory.instruction || []).length },
    { id: "agent", label: "Agents", count: (summary.byCategory.agent || []).length },
    { id: "tool", label: "Tools", count: (summary.byCategory.tool || []).length },
    { id: "mcp-server", label: "MCP", count: (summary.byCategory["mcp-server"] || []).length },
    { id: "prompt", label: "Prompts", count: (summary.byCategory.prompt || []).length },
  ];

  return (
    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
      {filters.map(function (f) {
        if (f.count === 0 && f.id !== "all") return null;
        var active = filter === f.id;
        return (
          <button
            key={f.id}
            onClick={function () { onFilterChange(f.id); }}
            style={{
              padding: "4px 10px",
              borderRadius: theme.radius.full,
              fontSize: theme.fontSize.xs,
              fontFamily: theme.font.mono,
              border: "1px solid " + (active ? theme.accent.primary : theme.border.default),
              background: active ? alpha(theme.accent.primary, 0.15) : "transparent",
              color: active ? theme.accent.primary : theme.text.muted,
              cursor: "pointer",
              transition: "all " + theme.transition.fast,
              lineHeight: "16px",
            }}
          >
            {f.label}
            <span style={{ marginLeft: 4, opacity: 0.6 }}>{f.count}</span>
          </button>
        );
      })}
    </div>
  );
}

// ── Source distribution bar ──────────────────────────────────────────────────

function SourceDistribution({ summary }) {
  var total = summary.totalSkills;
  if (total === 0) return null;

  var sources = ["project", "personal", "extension", "built-in", "mcp", "unknown"];
  var segments = sources
    .map(function (s) {
      var count = (summary.bySource[s] || []).length;
      return { source: s, count: count, pct: (count / total) * 100 };
    })
    .filter(function (s) { return s.count > 0; });

  return (
    <div>
      <div style={{ fontSize: theme.fontSize.xs, color: theme.text.muted, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em" }}>
        Sources
      </div>
      <div style={{ display: "flex", height: 6, borderRadius: 3, overflow: "hidden", gap: 1 }}>
        {segments.map(function (seg) {
          var meta = SOURCE_META[seg.source] || SOURCE_META.unknown;
          return (
            <div
              key={seg.source}
              title={meta.label + ": " + seg.count + " (" + seg.pct.toFixed(0) + "%)"}
              style={{
                flex: seg.pct,
                background: meta.color,
                minWidth: 4,
              }}
            />
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 12, marginTop: 6, flexWrap: "wrap" }}>
        {segments.map(function (seg) {
          var meta = SOURCE_META[seg.source] || SOURCE_META.unknown;
          return (
            <div key={seg.source} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: theme.fontSize.xs }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: meta.color }} />
              <span style={{ color: theme.text.secondary }}>{meta.label}</span>
              <span style={{ color: theme.text.dim }}>{seg.count}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Lifecycle funnel ─────────────────────────────────────────────────────────

function LifecycleFunnel({ summary }) {
  var stages = ["discovered", "loaded", "invoked", "resource-accessed", "completed", "errored"];
  var maxCount = 0;
  var stageCounts = stages.map(function (s) {
    var count = (summary.byStage[s] || []).length;
    if (count > maxCount) maxCount = count;
    return { stage: s, count: count };
  }).filter(function (s) { return s.count > 0; });

  if (stageCounts.length === 0) return null;

  return (
    <div>
      <div style={{ fontSize: theme.fontSize.xs, color: theme.text.muted, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em" }}>
        Lifecycle
      </div>
      {stageCounts.map(function (s) {
        var meta = STAGE_META[s.stage];
        var pct = maxCount > 0 ? (s.count / maxCount) * 100 : 0;
        return (
          <div key={s.stage} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <span style={{ width: 70, fontSize: theme.fontSize.xs, color: meta.color, fontFamily: theme.font.mono, textAlign: "right" }}>
              {meta.label}
            </span>
            <div style={{ flex: 1, height: 6, borderRadius: 3, background: theme.bg.raised }}>
              <div style={{
                width: pct + "%",
                height: "100%",
                borderRadius: 3,
                background: meta.color,
                transition: "width 300ms ease-out",
                minWidth: s.count > 0 ? 4 : 0,
              }} />
            </div>
            <span style={{ fontSize: theme.fontSize.xs, color: theme.text.dim, fontFamily: theme.font.mono, width: 24, textAlign: "right" }}>
              {s.count}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── Main view ────────────────────────────────────────────────────────────────

export default function SkillsView({ events, turns, metadata }) {
  var [filter, setFilter] = useState("all");
  var [expandedId, setExpandedId] = useState(null);
  var [sourceFilter, setSourceFilter] = useState(null);

  var summary = useMemo(function () {
    return extractSkills(events, turns, metadata);
  }, [events, turns, metadata]);

  var filteredSkills = useMemo(function () {
    var skills = summary.skills;
    if (filter !== "all") {
      skills = skills.filter(function (s) { return s.category === filter; });
    }
    if (sourceFilter) {
      skills = skills.filter(function (s) { return s.source === sourceFilter; });
    }
    return skills;
  }, [summary, filter, sourceFilter]);

  if (summary.totalSkills === 0) {
    return (
      <div style={{ padding: 40, textAlign: "center" }}>
        <div style={{ fontSize: theme.fontSize.lg, color: theme.text.muted, marginBottom: 12 }}>
          No skills or capabilities detected
        </div>
        <div style={{ fontSize: theme.fontSize.sm, color: theme.text.dim, maxWidth: 400, margin: "0 auto", lineHeight: 1.6 }}>
          Skills are extracted from session data: custom instructions, agent skills (.github/skills/),
          MCP servers, tool calls, and slash commands. Load a session with active capabilities to see them here.
        </div>
      </div>
    );
  }

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Header metrics */}
      <div style={{ padding: "16px 20px 12px", borderBottom: "1px solid " + theme.border.subtle, flexShrink: 0 }}>
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))",
          gap: 10,
          marginBottom: 14,
        }}>
          <MetricCard value={summary.totalSkills} label="Capabilities" color={theme.accent.primary} />
          <MetricCard value={summary.totalInvocations} label="Invocations" color="#3b9eff" />
          <MetricCard value={(summary.byCategory.skill || []).length} label="Skills" color="#a78bfa" />
          <MetricCard value={(summary.byCategory.instruction || []).length} label="Instructions" color="#6475e8" />
          <MetricCard value={(summary.byCategory["mcp-server"] || []).length} label="MCP Servers" color="#10d97a" />
          <MetricCard
            value={summary.skills.filter(function (s) { return s.errorCount > 0; }).length}
            label="Errored"
            color={theme.semantic.error}
          />
        </div>

        {/* Source distribution + lifecycle side by side */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 12 }}>
          <SourceDistribution summary={summary} />
          <LifecycleFunnel summary={summary} />
        </div>

        {/* Filter bar */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <FilterBar filter={filter} onFilterChange={setFilter} summary={summary} />
          {sourceFilter && (
            <button
              onClick={function () { setSourceFilter(null); }}
              style={{
                padding: "3px 8px",
                borderRadius: theme.radius.full,
                fontSize: theme.fontSize.xs,
                border: "1px solid " + theme.border.default,
                background: "transparent",
                color: theme.text.muted,
                cursor: "pointer",
              }}
            >
              Clear source filter
            </button>
          )}
        </div>
      </div>

      {/* Skills list */}
      <div style={{ flex: 1, overflow: "auto", padding: "8px 12px" }}>
        {/* Column headers */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "24px 1fr auto auto auto auto",
          gap: 12,
          padding: "4px 12px 8px",
          fontSize: theme.fontSize.xs,
          color: theme.text.dim,
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          borderBottom: "1px solid " + theme.border.subtle,
          marginBottom: 4,
        }}>
          <span />
          <span>Name</span>
          <span>Lifecycle</span>
          <span>Source</span>
          <span style={{ textAlign: "right" }}>Uses</span>
          <span />
        </div>

        {filteredSkills.length === 0 ? (
          <div style={{ padding: 24, textAlign: "center", color: theme.text.dim, fontSize: theme.fontSize.sm }}>
            No items match the current filter.
          </div>
        ) : (
          filteredSkills.map(function (skill) {
            return (
              <SkillRow
                key={skill.id}
                skill={skill}
                isExpanded={expandedId === skill.id}
                onToggle={function () { setExpandedId(expandedId === skill.id ? null : skill.id); }}
              />
            );
          })
        )}
      </div>
    </div>
  );
}
