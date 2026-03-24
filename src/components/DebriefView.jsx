import { useState, useEffect, useRef } from "react";
import { theme, alpha } from "../lib/theme.js";
import ToolbarButton from "./ui/ToolbarButton.jsx";
import { KNOWN_CONFIG_SURFACES, getRelevantSurfaces } from "../lib/projectConfig.js";
import { buildDebriefRecommendations, checkApplied } from "../lib/debriefRecommendations.js";

// User-settable status options shown in the dropdown
var STATUS_OPTIONS = [
  { id: "accepted", label: "Accepted", color: theme.semantic.success },
  { id: "applied", label: "Applied", color: theme.semantic.success },
  { id: "ignored", label: "Ignored", color: theme.semantic.error },
  { id: "not-now", label: "Not now", color: theme.accent.primary },
];

// Auto-detected statuses (not shown in dropdown, set by reconciliation)
var AUTO_STATUS_DISPLAY = {
  "already-handled": { label: "Already covered", icon: "✓", color: theme.semantic.success },
  "partial": { label: "Partial", icon: "~", color: "#f59e0b" },
};

function RecommendationStatus({ value }) {
  if (!value) return null;

  // Check auto statuses first
  if (AUTO_STATUS_DISPLAY[value]) {
    var auto = AUTO_STATUS_DISPLAY[value];
    return (
      <span style={{
        fontSize: theme.fontSize.xs,
        color: auto.color,
        border: "1px solid " + alpha(auto.color, 0.35),
        background: alpha(auto.color, 0.1),
        borderRadius: theme.radius.full,
        padding: "3px 8px",
      }}>
        {auto.icon + " " + auto.label}
      </span>
    );
  }

  var match = STATUS_OPTIONS.find(function (option) { return option.id === value; });
  if (!match) return null;

  return (
    <span style={{
      fontSize: theme.fontSize.xs,
      color: match.color,
      border: "1px solid " + alpha(match.color, 0.35),
      background: alpha(match.color, 0.1),
      borderRadius: theme.radius.full,
      padding: "3px 8px",
    }}>
      {match.label}
    </span>
  );
}

/**
 * Returns a human-readable relative timestamp string (e.g. "5 seconds ago").
 * @param {number|null} ts -- Date.now() value
 * @returns {string}
 */
function formatRelativeTime(ts) {
  if (!ts) return "";
  var diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 5) return "just now";
  if (diff < 60) return diff + " seconds ago";
  var mins = Math.floor(diff / 60);
  if (mins === 1) return "1 minute ago";
  return mins + " minutes ago";
}

function basename(filePath) {
  if (!filePath) return filePath;
  var parts = filePath.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || filePath;
}

/**
 * Builds a baseline snapshot from an array of config file results.
 * Maps configFile.id -> { exists, entriesCount, contentLength }.
 * @param {Array} configFiles
 * @returns {object}
 */
function buildBaselineSnapshot(configFiles) {
  var snapshot = {};
  for (var i = 0; i < configFiles.length; i++) {
    var cf = configFiles[i];
    snapshot[cf.id] = {
      exists: Boolean(cf.exists),
      entriesCount: cf.entries ? cf.entries.length : 0,
      contentLength: cf.content ? cf.content.length : 0,
    };
  }
  return snapshot;
}

/**
 * Runs checkApplied for every recommendation and returns an object
 * mapping rec.id -> "already-handled" | "partial" | null.
 * @param {Array} recs
 * @param {Array} configFiles
 * @returns {object}
 */
function reconcileStatuses(recs, configFiles) {
  var result = {};
  for (var i = 0; i < recs.length; i++) {
    var rec = recs[i];
    var applied = checkApplied(rec, configFiles);
    if (applied === "handled") {
      result[rec.id] = "already-handled";
    } else if (applied === "partial") {
      result[rec.id] = "partial";
    } else {
      result[rec.id] = null;
    }
  }
  return result;
}

export default function DebriefView({ file, summary, recommendations, recommendationState, onSetRecommendationState, metadata, rawSession }) {
  var [copiedId, setCopiedId] = useState(null);
  var [editedDrafts, setEditedDrafts] = useState({});
  var [applyStatus, setApplyStatus] = useState({});
  var [configFiles, setConfigFiles] = useState([]);
  var [configLoaded, setConfigLoaded] = useState(false);
  var [showConfigExplorer, setShowConfigExplorer] = useState(false);
  var [expandedSurface, setExpandedSurface] = useState(null);
  var [configAwareRecommendations, setConfigAwareRecommendations] = useState(null);
  var [reconciledStatuses, setReconciledStatuses] = useState({});
  var [expandedCardIds, setExpandedCardIds] = useState({});
  var [lastChecked, setLastChecked] = useState(null);
  var [aiAnalysis, setAiAnalysis] = useState(null);
  var [aiStatus, setAiStatus] = useState(null); // null | "loading" | "done" | "error"
  var [aiError, setAiError] = useState(null);

  // Baseline snapshot -- set once when config first loads, never updated
  var baselineRef = useRef(null);

  useEffect(function () {
    fetch("/api/config")
      .then(function (r) { return r.json(); })
      .then(function (data) { setConfigFiles(data); setConfigLoaded(true); })
      .catch(function () { setConfigLoaded(true); });
  }, []);

  useEffect(function () {
    if (!configLoaded || configFiles.length === 0 || !rawSession) return;
    // Only run on first config load -- Refresh is handled explicitly by handleRefresh
    if (baselineRef.current !== null) return;
    var rebuilt = buildDebriefRecommendations(
      rawSession.events,
      rawSession.turns,
      rawSession.metadata,
      rawSession.autonomyMetrics,
      configFiles
    );
    var freshRecs = rebuilt.recommendations;
    setConfigAwareRecommendations(freshRecs);

    // Set baseline snapshot once (first load)
    if (baselineRef.current === null) {
      baselineRef.current = buildBaselineSnapshot(configFiles);
    }

    // Run reconciliation and pre-populate auto statuses
    var statuses = reconcileStatuses(freshRecs, configFiles);
    setReconciledStatuses(statuses);

    // Collapse already-handled cards by default on first load
    setExpandedCardIds(function (prev) {
      var next = Object.assign({}, prev);
      for (var id in statuses) {
        if (statuses[id] === "already-handled" && !Object.prototype.hasOwnProperty.call(next, id)) {
          next[id] = false;
        }
      }
      return next;
    });

    setLastChecked(Date.now());
  }, [configLoaded, configFiles]); // eslint-disable-line react-hooks/exhaustive-deps

  var activeRecommendations = (configLoaded && configFiles.length > 0 && configAwareRecommendations)
    ? configAwareRecommendations
    : recommendations;

  function getEditedDraft(recommendation) {
    return Object.prototype.hasOwnProperty.call(editedDrafts, recommendation.id)
      ? editedDrafts[recommendation.id]
      : recommendation.draftText;
  }

  function setEditedDraft(id, value) {
    setEditedDrafts(function (prev) {
      var next = Object.assign({}, prev);
      next[id] = value;
      return next;
    });
  }

  function copyDraft(id, text) {
    if (typeof navigator === "undefined" || !navigator.clipboard || !navigator.clipboard.writeText) return;

    navigator.clipboard.writeText(text).then(function () {
      setCopiedId(id);
      window.setTimeout(function () {
        setCopiedId(function (current) { return current === id ? null : current; });
      }, 1500);
    }).catch(function () {});
  }

  function applyToFile(recommendation) {
    var editedDraft = getEditedDraft(recommendation);
    setApplyStatus(function (prev) { return Object.assign({}, prev, { [recommendation.id]: "applying" }); });

    fetch("/api/apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ relativePath: recommendation.targetPath, content: editedDraft }),
    }).then(function (response) {
      if (response.ok) {
        onSetRecommendationState(recommendation.id, "applied");
        setApplyStatus(function (prev) { return Object.assign({}, prev, { [recommendation.id]: "applied" }); });
      } else {
        copyDraft(recommendation.id, editedDraft);
        setApplyStatus(function (prev) { return Object.assign({}, prev, { [recommendation.id]: "copy-fallback" }); });
      }
    }).catch(function () {
      copyDraft(recommendation.id, editedDraft);
      setApplyStatus(function (prev) { return Object.assign({}, prev, { [recommendation.id]: "copy-fallback" }); });
    });
  }

  function handleRefresh() {
    if (!rawSession) return;
    fetch("/api/config")
      .then(function (r) { return r.json(); })
      .then(function (freshData) {
        setConfigFiles(freshData);
        var rebuilt = buildDebriefRecommendations(
          rawSession.events,
          rawSession.turns,
          rawSession.metadata,
          rawSession.autonomyMetrics,
          freshData
        );
        var freshRecs = rebuilt.recommendations;
        setConfigAwareRecommendations(freshRecs);
        var statuses = reconcileStatuses(freshRecs, freshData);
        setReconciledStatuses(statuses);
        setLastChecked(Date.now());
      })
      .catch(function () {});
  }

  function handleAiAnalyze() {
    if (!rawSession) return;
    setAiStatus("loading");
    setAiError(null);
    var m = rawSession.autonomyMetrics || {};
    var met = rawSession.metadata || {};
    // Build a config summary string for context
    var cfgLines = (configFiles || []).filter(function (f) { return f.exists; }).map(function (f) {
      return f.id + ": " + (f.content ? f.content.substring(0, 200) : "(exists, no content)");
    });
    fetch("/api/coach/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        format: met.format || "claude-code",
        primaryModel: met.primaryModel || null,
        totalEvents: met.totalEvents || 0,
        totalTurns: met.totalTurns || 0,
        errorCount: met.errorCount || 0,
        totalToolCalls: met.totalToolCalls || 0,
        productiveRuntime: m.productiveRuntime ? Math.round(m.productiveRuntime) + "s" : "0s",
        humanResponseTime: m.babysittingTime ? Math.round(m.babysittingTime) + "s" : "0s",
        idleTime: m.idleTime ? Math.round(m.idleTime) + "s" : "0s",
        interventions: m.interventionCount || 0,
        autonomyEfficiency: m.autonomyEfficiency != null ? Math.round(m.autonomyEfficiency * 100) + "%" : "0%",
        topTools: m.topTools || [],
        userFollowUps: m.userFollowUps || [],
        errorSamples: (rawSession.events || [])
          .filter(function (e) { return e.isError && e.text; })
          .slice(0, 6)
          .map(function (e) { return (e.toolName ? "[" + e.toolName + "] " : "") + e.text.substring(0, 150); }),
        configSummary: cfgLines.join("\n") || "No config files found",
      }),
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.error) { setAiError(data.error); setAiStatus("error"); return; }
        setAiAnalysis(data.recommendations);
        setAiStatus("done");
      })
      .catch(function (e) { setAiError(e.message); setAiStatus("error"); });
  }

  function toggleCardExpanded(id) {
    setExpandedCardIds(function (prev) {
      var next = Object.assign({}, prev);
      next[id] = !prev[id];
      return next;
    });
  }

  function isCardCollapsed(id, autoStatus) {
    if (Object.prototype.hasOwnProperty.call(expandedCardIds, id)) {
      return !expandedCardIds[id];
    }
    // Default: collapse already-handled cards
    return autoStatus === "already-handled";
  }

  function findConfigResult(surfaceId) {
    for (var i = 0; i < configFiles.length; i++) {
      if (configFiles[i].id === surfaceId) return configFiles[i];
    }
    return null;
  }

  function getSurfacePreview(result) {
    if (!result || !result.exists) return null;
    if (result.entries) return result.entries.length + " file" + (result.entries.length === 1 ? "" : "s");
    if (result.content) return result.content.substring(0, 80) + (result.content.length > 80 ? "..." : "");
    return "1 file";
  }

  function getSurfaceFullContent(result) {
    if (!result || !result.exists) return null;
    if (result.content) return result.content;
    if (result.entries && result.entries.length > 0) {
      return result.entries.map(function (e) {
        return "--- " + e.path + " ---\n" + e.content;
      }).join("\n\n");
    }
    return null;
  }

  return (
    <div style={{ display: "flex", gap: 20, height: "100%", overflow: "hidden" }}>
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 16, overflowY: "auto", paddingRight: 4 }}>
        <div>
          <div style={{ fontSize: theme.fontSize.xs, color: theme.text.dim, textTransform: "uppercase", letterSpacing: 2 }}>
            Coach
          </div>
          <div style={{ fontSize: theme.fontSize.xl, color: theme.text.primary, marginTop: 8, fontFamily: theme.font.ui }}>
            {"Session coaching: " + file}
          </div>
          <div style={{ fontSize: theme.fontSize.md, color: theme.text.muted, marginTop: 6, lineHeight: 1.7 }}>
            Review evidence-backed drafts. Accept to apply, ignore to skip.
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: 10 }}>
          {summary.map(function (item) {
            return (
              <div
                key={item.label}
                style={{
                  background: theme.bg.surface,
                  border: "1px solid " + theme.border.default,
                  borderRadius: theme.radius.xl,
                  padding: "12px 14px",
                }}
              >
                <div style={{ fontSize: theme.fontSize.lg, color: theme.accent.primary, fontFamily: theme.font.ui, fontWeight: 700 }}>
                  {item.value}
                </div>
                <div style={{ fontSize: theme.fontSize.xs, color: theme.text.muted, marginTop: 4 }}>
                  {item.label}
                </div>
              </div>
            );
          })}
        </div>

        <div style={{
          background: theme.bg.surface,
          border: "1px solid " + theme.border.default,
          borderRadius: theme.radius.xl,
          overflow: "hidden",
        }}>
          <button
            className="av-btn"
            onClick={function () { setShowConfigExplorer(function (prev) { return !prev; }); }}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              width: "100%",
              padding: "12px 16px",
              background: "transparent",
              border: "none",
              color: theme.text.primary,
              cursor: "pointer",
              fontFamily: theme.font.ui,
              fontSize: theme.fontSize.md,
            }}
          >
            <span style={{ fontWeight: 600 }}>Project configuration</span>
            <span style={{ color: theme.text.dim, fontSize: theme.fontSize.base }}>
              {showConfigExplorer ? "collapse" : "expand"}
            </span>
          </button>

          {showConfigExplorer && (
            <div style={{ padding: "0 16px 16px" }}>
              {!configLoaded && (
                <div style={{ fontSize: theme.fontSize.base, color: theme.text.dim, fontFamily: theme.font.ui, padding: "8px 0" }}>
                  Detecting project configs...
                </div>
              )}
              {configLoaded && configFiles.length === 0 && (
                <div style={{ fontSize: theme.fontSize.base, color: theme.text.dim, fontFamily: theme.font.ui, padding: "8px 0" }}>
                  Start via CLI to detect project configs.
                </div>
              )}
              {configLoaded && configFiles.length > 0 && (function () {
                var format = metadata && metadata.format;
                var surfaces = getRelevantSurfaces(format);
                return (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
                    {surfaces.map(function (surface) {
                      var result = findConfigResult(surface.id);
                      var exists = Boolean(result && result.exists);
                      var preview = getSurfacePreview(result);
                      var isExpanded = expandedSurface === surface.id;
                      var fullContent = isExpanded ? getSurfaceFullContent(result) : null;

                      // Detect if this surface changed since baseline
                      var baseline = baselineRef.current && baselineRef.current[surface.id];
                      var wasUpdated = false;
                      if (baseline && result) {
                        var currentExists = Boolean(result.exists);
                        var currentEntries = result.entries ? result.entries.length : 0;
                        var currentContentLen = result.content ? result.content.length : 0;
                        if (!baseline.exists && currentExists) wasUpdated = true;
                        else if (baseline.entriesCount < currentEntries) wasUpdated = true;
                        else if (baseline.contentLength < currentContentLen) wasUpdated = true;
                      }

                      return (
                        <div
                          key={surface.id}
                          style={{
                            background: theme.bg.base,
                            border: "1px solid " + theme.border.subtle,
                            borderRadius: theme.radius.lg,
                            padding: "10px 12px",
                            cursor: exists ? "pointer" : "default",
                          }}
                          onClick={exists ? function () {
                            setExpandedSurface(function (prev) { return prev === surface.id ? null : surface.id; });
                          } : undefined}
                        >
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                            <span style={{ fontSize: theme.fontSize.base, color: theme.text.secondary, fontFamily: theme.font.mono }}>
                              {surface.label}
                            </span>
                            <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
                              {wasUpdated && (
                                <span style={{
                                  fontSize: theme.fontSize.xs,
                                  color: theme.semantic.success,
                                  background: alpha(theme.semantic.success, 0.1),
                                  border: "1px solid " + alpha(theme.semantic.success, 0.3),
                                  borderRadius: theme.radius.full,
                                  padding: "2px 6px",
                                }}>
                                  updated
                                </span>
                              )}
                              <span style={{
                                fontSize: theme.fontSize.xs,
                                color: exists ? theme.semantic.success : theme.text.dim,
                                background: exists ? alpha(theme.semantic.success, 0.1) : alpha(theme.text.dim, 0.1),
                                border: "1px solid " + (exists ? alpha(theme.semantic.success, 0.3) : alpha(theme.text.dim, 0.2)),
                                borderRadius: theme.radius.full,
                                padding: "2px 7px",
                              }}>
                                {exists ? "exists" : "not configured"}
                              </span>
                            </div>
                          </div>
                          {preview && (
                            <div style={{
                              fontSize: theme.fontSize.xs,
                              color: theme.text.muted,
                              marginTop: 5,
                              fontFamily: theme.font.mono,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}>
                              {preview}
                            </div>
                          )}
                          {isExpanded && fullContent && (
                            <div
                              style={{
                                marginTop: 8,
                                background: theme.bg.base,
                                border: "1px solid " + theme.border.default,
                                borderRadius: theme.radius.md,
                                padding: 10,
                                maxHeight: 200,
                                overflowY: "auto",
                                fontSize: theme.fontSize.xs,
                                fontFamily: theme.font.mono,
                                color: theme.text.secondary,
                                lineHeight: 1.6,
                                whiteSpace: "pre-wrap",
                                wordBreak: "break-word",
                              }}
                              onClick={function (e) { e.stopPropagation(); }}
                            >
                              {fullContent}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div style={{ fontSize: theme.fontSize.xs, color: theme.text.dim, fontFamily: theme.font.ui }}>
            {lastChecked
              ? "Config read at: " + formatRelativeTime(lastChecked)
              : configLoaded ? "Config loaded" : "Loading config..."}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              className="av-btn"
              onClick={handleAiAnalyze}
              disabled={aiStatus === "loading" || !rawSession}
              title={"Get AI-powered contextual recommendations using " + (typeof window !== "undefined" ? "claude / gh copilot" : "your CLI")}
              style={{
                display: "flex", alignItems: "center", gap: 5,
                border: "1px solid " + theme.accent.primary,
                background: alpha(theme.accent.primary, 0.08),
                color: theme.accent.primary,
                borderRadius: theme.radius.md,
                padding: "5px 10px",
                fontSize: theme.fontSize.xs,
                fontFamily: theme.font.ui,
                cursor: aiStatus === "loading" ? "default" : "pointer",
                opacity: aiStatus === "loading" ? 0.6 : 1,
              }}
            >
              <span>{"✦"}</span>
              {aiStatus === "loading" ? "Analyzing..." : "AI Analyze"}
            </button>
            <button
              className="av-btn"
              onClick={handleRefresh}
              title="Re-read config files and update recommendation statuses"
              style={{
                display: "flex", alignItems: "center", gap: 5,
                border: "1px solid " + theme.border.default,
                background: "transparent",
                color: theme.text.secondary,
                borderRadius: theme.radius.md,
                padding: "5px 10px",
                fontSize: theme.fontSize.xs,
                fontFamily: theme.font.ui,
                cursor: "pointer",
              }}
            >
              <span style={{ fontSize: "0.9em" }}>{"↺"}</span>
              Refresh
            </button>
          </div>
        </div>

        {aiStatus === "error" && (
          <div style={{ fontSize: theme.fontSize.xs, color: theme.semantic.error, background: theme.semantic.errorBg, border: "1px solid " + theme.semantic.errorBorder, borderRadius: theme.radius.lg, padding: "8px 12px" }}>
            AI analysis failed: {aiError}
          </div>
        )}

        {aiStatus === "done" && aiAnalysis && (
          <div style={{ background: alpha(theme.accent.primary, 0.05), border: "1px solid " + alpha(theme.accent.primary, 0.25), borderRadius: theme.radius.xl, padding: "14px 16px" }}>
            <div style={{ fontSize: theme.fontSize.xs, color: theme.accent.primary, textTransform: "uppercase", letterSpacing: 2, marginBottom: 12 }}>
              ✦ AI-generated recommendations
            </div>
            {aiAnalysis.map(function (rec, i) {
              return (
                <div key={i} style={{ marginBottom: 14, paddingBottom: 14, borderBottom: i < aiAnalysis.length - 1 ? "1px solid " + theme.border.default : "none" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    {rec.priority === "high" && (
                      <span style={{ fontSize: theme.fontSize.xs, color: theme.semantic.error, border: "1px solid " + theme.semantic.errorBorder, borderRadius: theme.radius.full, padding: "1px 7px" }}>high</span>
                    )}
                    <span style={{ fontSize: theme.fontSize.md, color: theme.text.primary, fontFamily: theme.font.ui, fontWeight: 600 }}>{rec.title}</span>
                  </div>
                  <div style={{ fontSize: theme.fontSize.sm, color: theme.text.muted, marginBottom: 6, lineHeight: 1.5 }}>{rec.summary}</div>
                  {rec.fix && <div style={{ fontSize: theme.fontSize.sm, color: theme.text.secondary, lineHeight: 1.5, marginBottom: 6 }}><strong>Fix:</strong> {rec.fix}</div>}
                  {rec.draft && (
                    <pre style={{ fontSize: theme.fontSize.xs, background: theme.bg.base, border: "1px solid " + theme.border.default, borderRadius: theme.radius.md, padding: "8px 12px", overflowX: "auto", whiteSpace: "pre-wrap", color: theme.text.secondary, margin: 0 }}>{rec.draft}</pre>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {activeRecommendations.map(function (recommendation) {
          var state = recommendationState[recommendation.id] || null;
          var autoStatus = reconciledStatuses[recommendation.id] || null;
          var effectiveStatus = state || autoStatus;
          var currentApplyStatus = applyStatus[recommendation.id] || null;
          var editedDraft = getEditedDraft(recommendation);
          var showApplyButton = (state === "accepted" || state === "applied") && recommendation.targetPath != null;
          var showTargetPath = (state === "accepted" || state === "applied") && recommendation.targetPath != null;
          var collapsed = isCardCollapsed(recommendation.id, autoStatus);
          var isAlreadyHandled = autoStatus === "already-handled" && !state;

          return (
            <div
              key={recommendation.id}
              style={{
                background: isAlreadyHandled ? alpha(theme.bg.surface, 0.5) : theme.bg.surface,
                border: "1px solid " + (isAlreadyHandled ? theme.border.subtle : theme.border.default),
                borderRadius: theme.radius.xl,
                padding: "16px 18px",
                opacity: isAlreadyHandled ? 0.75 : 1,
              }}
            >
              <div
                style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", cursor: isAlreadyHandled ? "pointer" : "default" }}
                onClick={isAlreadyHandled ? function () { toggleCardExpanded(recommendation.id); } : undefined}
              >
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ fontSize: theme.fontSize.xs, color: theme.text.dim, textTransform: "uppercase", letterSpacing: 2 }}>
                      {recommendation.surface}
                    </span>
                    <span style={{
                      fontSize: theme.fontSize.xs,
                      color: recommendation.priority === "high" ? theme.semantic.error : theme.accent.primary,
                      border: "1px solid " + (recommendation.priority === "high" ? theme.semantic.errorBorder : theme.border.default),
                      borderRadius: theme.radius.full,
                      padding: "3px 8px",
                    }}>
                      {recommendation.priority} priority
                    </span>
                    <RecommendationStatus value={effectiveStatus} />
                    {isAlreadyHandled && (
                      <span style={{
                        fontSize: theme.fontSize.xs,
                        color: theme.text.dim,
                        fontFamily: theme.font.ui,
                      }}>
                        {collapsed ? "click to expand" : "click to collapse"}
                      </span>
                    )}
                    {showApplyButton && (
                      <button
                        className="av-btn"
                        disabled={currentApplyStatus === "applying" || currentApplyStatus === "applied"}
                        onClick={function () { applyToFile(recommendation); }}
                        style={{
                          border: "1px solid " + (currentApplyStatus === "applied"
                            ? alpha(theme.semantic.success, 0.4)
                            : alpha(theme.accent.primary, 0.5)),
                          background: currentApplyStatus === "applied"
                            ? alpha(theme.semantic.success, 0.08)
                            : alpha(theme.accent.primary, 0.08),
                          color: currentApplyStatus === "applied"
                            ? theme.semantic.success
                            : theme.accent.primary,
                          borderRadius: theme.radius.md,
                          padding: "6px 10px",
                          fontSize: theme.fontSize.base,
                          fontFamily: theme.font.ui,
                          cursor: currentApplyStatus === "applying" || currentApplyStatus === "applied" ? "default" : "pointer",
                          opacity: currentApplyStatus === "applying" ? 0.6 : 1,
                        }}
                      >
                        {currentApplyStatus === "applying"
                          ? "Applying..."
                          : currentApplyStatus === "applied"
                            ? "Applied"
                            : "Apply to " + basename(recommendation.targetPath)}
                      </button>
                    )}
                    {currentApplyStatus === "copy-fallback" && recommendation.targetPath && (
                      <span style={{
                        fontSize: theme.fontSize.xs,
                        color: theme.text.dim,
                        fontFamily: theme.font.ui,
                      }}>
                        CLI server not available - content copied, save to {recommendation.targetPath}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: theme.fontSize.xl, color: theme.text.primary, fontFamily: theme.font.ui, marginTop: 8 }}>
                    {recommendation.title}
                  </div>
                  <div style={{ fontSize: theme.fontSize.md, color: theme.text.secondary, marginTop: 6, lineHeight: 1.7 }}>
                    {recommendation.summary}
                  </div>
                </div>

                <ToolbarButton
                  onClick={function () { copyDraft(recommendation.id, editedDraft); }}
                  style={{
                    color: copiedId === recommendation.id ? theme.semantic.success : theme.accent.primary,
                    borderColor: copiedId === recommendation.id ? alpha(theme.semantic.success, 0.4) : theme.accent.primary,
                    background: copiedId === recommendation.id ? alpha(theme.semantic.success, 0.08) : alpha(theme.accent.primary, 0.08),
                    flexShrink: 0,
                    display: collapsed ? "none" : undefined,
                  }}
                >
                  {copiedId === recommendation.id ? "Copied" : "Copy draft"}
                </ToolbarButton>
              </div>

              {!collapsed && (
                <>
                  <div style={{ marginTop: 14 }}>
                    <div style={{ fontSize: theme.fontSize.xs, color: theme.text.dim, textTransform: "uppercase", letterSpacing: 2, marginBottom: 8 }}>
                      Evidence
                    </div>
                    <ul style={{ margin: 0, paddingLeft: 18, color: theme.text.secondary, lineHeight: 1.8 }}>
                      {recommendation.evidence.map(function (item) {
                        return <li key={item}>{item}</li>;
                      })}
                    </ul>
                  </div>

                  <div style={{ marginTop: 14 }}>
                    <div style={{ fontSize: theme.fontSize.xs, color: theme.text.dim, textTransform: "uppercase", letterSpacing: 2, marginBottom: 8 }}>
                      Reviewable draft
                    </div>
                    <textarea
                      value={editedDraft}
                      onChange={function (e) { setEditedDraft(recommendation.id, e.target.value); }}
                      style={{
                        width: "100%",
                        minHeight: 180,
                        background: theme.bg.base,
                        color: theme.text.primary,
                        border: "1px solid " + theme.border.default,
                        borderRadius: theme.radius.lg,
                        padding: 12,
                        resize: "vertical",
                        fontSize: theme.fontSize.base,
                        fontFamily: theme.font.mono,
                        lineHeight: 1.6,
                      }}
                    />
                    {showTargetPath && (
                      <div style={{
                        fontSize: theme.fontSize.xs,
                        color: theme.text.dim,
                        marginTop: 6,
                        fontFamily: theme.font.mono,
                      }}>
                        Target: {recommendation.targetPath}
                      </div>
                    )}
                  </div>

                  <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                    {STATUS_OPTIONS.filter(function (option) { return option.id !== "applied"; }).map(function (option) {
                      var active = state === option.id;

                      return (
                        <button
                          key={option.id}
                          className="av-btn"
                          onClick={function () { onSetRecommendationState(recommendation.id, option.id); }}
                          style={{
                            border: "1px solid " + (active ? option.color : theme.border.default),
                            background: active ? alpha(option.color, 0.12) : "transparent",
                            color: active ? option.color : theme.text.muted,
                            borderRadius: theme.radius.md,
                            padding: "6px 10px",
                            fontSize: theme.fontSize.base,
                            fontFamily: theme.font.ui,
                            cursor: "pointer",
                          }}
                        >
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
