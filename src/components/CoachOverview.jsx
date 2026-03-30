import { useState, useEffect } from "react";
import { theme, alpha } from "../lib/theme.js";
import Icon from "./Icon.jsx";

var SEVERITY_COLORS = {
  high: theme.semantic.error,
  medium: theme.accent.primary,
  low: theme.text.muted,
};

var SEVERITY_LABELS = {
  high: "HIGH",
  medium: "MED",
  low: "LOW",
};

function InsightCard({ insight }) {
  var [expanded, setExpanded] = useState(false);
  var [applyState, setApplyState] = useState("idle"); // idle | applying | done | error
  var [applyMsg, setApplyMsg] = useState("");
  var color = SEVERITY_COLORS[insight.severity] || theme.text.muted;

  function handleApply() {
    setApplyState("applying");
    fetch("/api/insights/apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetPath: insight.targetPath, content: insight.draftContent }),
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.success) {
          setApplyState("done");
          setApplyMsg(data.created ? "Created " + insight.targetPath : "Appended to " + insight.targetPath);
        } else {
          setApplyState("error");
          setApplyMsg(data.error || "Failed to apply");
        }
      })
      .catch(function (err) {
        setApplyState("error");
        setApplyMsg(err.message || "Network error");
      });
  }

  return (
    <div style={{
      background: theme.bg.base,
      border: "1px solid " + theme.border.default,
      borderLeft: "4px solid " + color,
      borderRadius: theme.radius.xl,
      padding: "14px 16px",
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10, justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <span style={{
            fontSize: theme.fontSize.xs,
            fontFamily: theme.font.mono,
            color: color,
            background: alpha(color, 0.12),
            border: "1px solid " + alpha(color, 0.3),
            borderRadius: theme.radius.sm,
            padding: "1px 6px",
            flexShrink: 0,
          }}>
            {SEVERITY_LABELS[insight.severity] || insight.severity.toUpperCase()}
          </span>
          <span style={{ fontSize: theme.fontSize.base, color: theme.text.primary, fontFamily: theme.font.mono }}>
            {insight.title}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
          {applyState === "idle" && (
            <button
              className="av-btn"
              onClick={handleApply}
              style={{
                background: alpha(theme.accent.primary, 0.1),
                border: "1px solid " + alpha(theme.accent.primary, 0.4),
                borderRadius: theme.radius.md,
                color: theme.accent.primary,
                fontSize: theme.fontSize.xs,
                fontFamily: theme.font.mono,
                padding: "4px 10px",
                cursor: "pointer",
              }}
            >
              Apply Fix
            </button>
          )}
          {applyState === "applying" && (
            <span style={{ fontSize: theme.fontSize.xs, color: theme.text.muted, fontFamily: theme.font.mono }}>Applying...</span>
          )}
          {applyState === "done" && (
            <span style={{ fontSize: theme.fontSize.xs, color: theme.semantic.success, fontFamily: theme.font.mono }}>{applyMsg}</span>
          )}
          {applyState === "error" && (
            <span style={{ fontSize: theme.fontSize.xs, color: theme.semantic.error, fontFamily: theme.font.mono }}>{applyMsg}</span>
          )}
          <button
            className="av-btn"
            aria-label={expanded ? "Collapse" : "Expand"}
            onClick={function () { setExpanded(function (v) { return !v; }); }}
            style={{ background: "transparent", border: "none", color: theme.text.ghost, cursor: "pointer", padding: "2px 4px", display: "flex", alignItems: "center" }}
          >
            <Icon name={expanded ? "chevron-up" : "chevron-down"} size={12} />
          </button>
        </div>
      </div>

      <div style={{ fontSize: theme.fontSize.sm, color: theme.text.secondary, marginTop: 6, lineHeight: 1.6 }}>
        {insight.description}
      </div>

      {expanded && (
        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ background: theme.bg.surface, borderRadius: theme.radius.lg, padding: "10px 12px" }}>
            <div style={{ fontSize: theme.fontSize.xs, color: theme.text.ghost, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Why this matters</div>
            <div style={{ fontSize: theme.fontSize.sm, color: theme.text.secondary, lineHeight: 1.6 }}>{insight.why}</div>
          </div>
          <div style={{ background: theme.bg.surface, borderRadius: theme.radius.lg, padding: "10px 12px" }}>
            <div style={{ fontSize: theme.fontSize.xs, color: theme.text.ghost, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>How to fix</div>
            <div style={{ fontSize: theme.fontSize.sm, color: theme.text.secondary, lineHeight: 1.6 }}>{insight.fix}</div>
          </div>
          <div style={{ background: theme.bg.surface, borderRadius: theme.radius.lg, padding: "10px 12px" }}>
            <div style={{ fontSize: theme.fontSize.xs, color: theme.text.ghost, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>
              Draft content for <span style={{ color: theme.text.dim, fontFamily: theme.font.mono }}>{insight.targetPath}</span>
            </div>
            <pre style={{
              fontFamily: theme.font.mono,
              fontSize: theme.fontSize.xs,
              color: theme.text.secondary,
              background: theme.bg.base,
              border: "1px solid " + theme.border.subtle,
              borderRadius: theme.radius.md,
              padding: "8px 10px",
              margin: 0,
              overflowX: "auto",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              lineHeight: 1.6,
              maxHeight: 180,
              overflowY: "auto",
            }}>
              {insight.draftContent}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

export default function CoachOverview() {
  var [status, setStatus] = useState("loading"); // loading | ready | error
  var [data, setData] = useState(null);
  var [errorMsg, setErrorMsg] = useState("");

  useEffect(function () {
    setStatus("loading");
    fetch("/api/sessions/insights")
      .then(function (r) {
        if (!r.ok) return r.json().then(function (d) { throw new Error(d.error || r.statusText); });
        return r.json();
      })
      .then(function (d) {
        setData(d);
        setStatus("ready");
      })
      .catch(function (err) {
        setErrorMsg(err.message || "Failed to load insights");
        setStatus("error");
      });
  }, []);

  if (status === "loading") {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ fontFamily: theme.font.mono, fontSize: theme.fontSize.sm, color: theme.text.dim }}>Analyzing sessions...</span>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ fontFamily: theme.font.mono, fontSize: theme.fontSize.sm, color: theme.semantic.error }}>{errorMsg}</span>
      </div>
    );
  }

  if (!data || !data.available) {
    return (
      <div style={{
        flex: 1,
        border: "1px dashed " + theme.border.strong,
        borderRadius: theme.radius.xl,
        padding: "28px 24px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        background: alpha(theme.bg.base, 0.4),
      }}>
        <Icon name="trending-up" size={22} style={{ color: theme.text.ghost }} />
        <div style={{ fontSize: theme.fontSize.md, color: theme.text.dim, fontFamily: theme.font.mono }}>No session data yet</div>
        <div style={{ fontSize: theme.fontSize.sm, color: theme.text.ghost, textAlign: "center", maxWidth: 380, lineHeight: 1.6 }}>
          Run a few sessions via the Copilot CLI or Claude Code to start seeing patterns and recommendations.
        </div>
      </div>
    );
  }

  var insights = data.insights || [];

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: 0, background: theme.bg.surface, border: "1px solid " + theme.border.default, borderRadius: theme.radius.xxl, overflow: "hidden" }}>
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 14px",
        borderBottom: "1px solid " + theme.border.default,
        flexShrink: 0,
      }}>
        <Icon name="trending-up" size={13} style={{ color: theme.accent.primary, flexShrink: 0 }} />
        <span style={{ fontSize: theme.fontSize.xs, color: theme.text.dim, textTransform: "uppercase", letterSpacing: 2, fontFamily: theme.font.mono }}>
          Coach Overview
        </span>
        <span style={{ fontSize: theme.fontSize.xs, color: theme.text.ghost, fontFamily: theme.font.mono }}>
          {insights.length > 0
            ? insights.length + " issue" + (insights.length === 1 ? "" : "s") + " detected across " + data.sessionCount + " sessions"
            : data.sessionCount + " sessions analyzed"}
        </span>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
        {insights.length === 0 ? (
          <div style={{
            border: "1px dashed " + theme.border.strong,
            borderRadius: theme.radius.xl,
            padding: "28px 24px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            background: alpha(theme.bg.base, 0.4),
          }}>
            <Icon name="sparkles" size={18} style={{ color: theme.semantic.success }} />
            <div style={{ fontSize: theme.fontSize.md, color: theme.text.secondary, fontFamily: theme.font.mono }}>No patterns detected</div>
            <div style={{ fontSize: theme.fontSize.sm, color: theme.text.ghost, textAlign: "center", maxWidth: 360, lineHeight: 1.6 }}>
              Your sessions look efficient. Keep running sessions and patterns will surface here when they appear.
            </div>
          </div>
        ) : (
          insights.map(function (insight) {
            return <InsightCard key={insight.id} insight={insight} />;
          })
        )}
      </div>
    </div>
  );
}
